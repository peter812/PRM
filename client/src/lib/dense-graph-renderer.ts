import * as THREE from "three";

/**
 * Batched renderer for dense social graphs.
 *
 * The standard path gives every node and every link its own `THREE.Object3D`,
 * which is what makes it interactive — the library raycasts against those
 * objects to hover, click and drag. It is also what caps it: N nodes and L links
 * cost N + L draw calls, and the per-object bookkeeping runs every tick.
 *
 * This renderer trades all of that away for two draw calls. Every node is a
 * vertex in one `THREE.Points`, every link two vertices in one
 * `THREE.LineSegments`. Nothing here is pickable, so the dense path is
 * view-only: orbit, zoom and auto-rotate, no selection and no dragging.
 *
 * Positions come from `graph-layout.worker.ts` as a flat array. Index `i` in
 * that array is the node at index `i` here — `setGraph` returns the index it
 * built so the worker is fed from the same ordering rather than a second one.
 */

/** Structural minimum this renderer needs; the page's `GraphNode` satisfies it. */
export interface DenseGraphNode {
  id: string;
  color: string;
  val: number;
  isCenter: boolean;
}

/** Structural minimum this renderer needs; the page's `GraphLink` satisfies it. */
export interface DenseGraphLink {
  source: string;
  target: string;
  color: string;
}

/** The simulation inputs implied by the ordering `setGraph` chose. */
export interface DenseGraphIndex {
  nodeCount: number;
  /** Node id to its index, for seeding a new layout from a settled one. */
  indexById: Map<string, number>;
  vals: Float32Array;
  /**
   * Flat [sourceIndex, targetIndex, ...] pairs. This doubles as the link vertex
   * order: vertex `i` of the line geometry belongs to node `linkPairs[i]`.
   */
  linkPairs: Uint32Array;
}

/** World-space radii, matching the sphere geometries the standard path uses. */
const NODE_RADIUS = 4;
const CENTER_NODE_RADIUS = 6;

const NODE_VERTEX_SHADER = /* glsl */ `
  attribute vec3 nodeColor;
  attribute float size;
  uniform float scale;
  varying vec3 vColor;
  void main() {
    vColor = nodeColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (scale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const NODE_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 offset = gl_PointCoord - vec2(0.5);
    // Discard to a disc rather than blending to one. Alpha-blending thousands of
    // overlapping points needs back-to-front sorting every frame, which a static
    // vertex buffer cannot give us; opaque points just depth-test correctly.
    if (dot(offset, offset) > 0.25) discard;
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

export class DenseGraphRenderer {
  readonly points: THREE.Points;
  readonly lines: THREE.LineSegments;

  private readonly nodeMaterial: THREE.ShaderMaterial;
  private readonly linkMaterial: THREE.LineBasicMaterial;
  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly drawingBufferSize = new THREE.Vector2();
  private readonly scratchColor = new THREE.Color();
  private linkPairs = new Uint32Array(0);

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;

    this.nodeMaterial = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 1 } },
      vertexShader: NODE_VERTEX_SHADER,
      fragmentShader: NODE_FRAGMENT_SHADER,
    });
    // Link opacity matches the standard path's shared line material.
    this.linkMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
    });

    this.points = new THREE.Points(new THREE.BufferGeometry(), this.nodeMaterial);
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.linkMaterial);
    // Every vertex moves every frame, so a bounding sphere would have to be
    // recomputed just as often to stay valid. Opting out of culling skips it.
    this.points.frustumCulled = false;
    this.lines.frustumCulled = false;
    scene.add(this.points);
    scene.add(this.lines);
  }

  /**
   * Rebuild both geometries for a new graph and return the ordering chosen, so
   * the layout worker can be initialised against the same one.
   *
   * Every link's `source` and `target` must name a node in `nodes` — callers
   * filter to that already, and honouring it here keeps one link list rather
   * than a drawn subset that `setColors` would then have to stay aligned with.
   */
  setGraph(nodes: DenseGraphNode[], links: DenseGraphLink[]): DenseGraphIndex {
    const nodeCount = nodes.length;
    const indexById = new Map<string, number>();

    const vals = new Float32Array(nodeCount);
    const sizes = new Float32Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) {
      const node = nodes[i];
      indexById.set(node.id, i);
      vals[i] = node.val;
      // `size` is a diameter in world units, so it matches a sphere of `radius`.
      sizes[i] = 2 * (node.isCenter ? CENTER_NODE_RADIUS : NODE_RADIUS);
    }

    const pairs = new Uint32Array(links.length * 2);
    for (let i = 0; i < links.length; i++) {
      pairs[i * 2] = indexById.get(links[i].source) ?? 0;
      pairs[i * 2 + 1] = indexById.get(links[i].target) ?? 0;
    }
    this.linkPairs = pairs;

    this.points.geometry.dispose();
    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nodeCount * 3), 3));
    nodeGeometry.setAttribute("nodeColor", new THREE.BufferAttribute(new Float32Array(nodeCount * 3), 3));
    nodeGeometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    this.points.geometry = nodeGeometry;

    this.lines.geometry.dispose();
    const linkGeometry = new THREE.BufferGeometry();
    const linkVertexCount = this.linkPairs.length;
    linkGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linkVertexCount * 3), 3));
    linkGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(linkVertexCount * 3), 3));
    this.lines.geometry = linkGeometry;

    this.setColors(nodes, links);

    return { nodeCount, indexById, vals, linkPairs: this.linkPairs };
  }

  /**
   * Recolour in place. Colour changes must not restart the layout, so this
   * deliberately touches nothing but the colour attributes.
   */
  setColors(nodes: DenseGraphNode[], links: DenseGraphLink[]): void {
    const nodeColors = this.points.geometry.getAttribute("nodeColor") as THREE.BufferAttribute;
    const nodeArray = nodeColors.array as Float32Array;
    const count = Math.min(nodes.length, nodeArray.length / 3);
    for (let i = 0; i < count; i++) {
      this.scratchColor.set(nodes[i].color);
      const base = i * 3;
      nodeArray[base] = this.scratchColor.r;
      nodeArray[base + 1] = this.scratchColor.g;
      nodeArray[base + 2] = this.scratchColor.b;
    }
    nodeColors.needsUpdate = true;

    const linkColors = this.lines.geometry.getAttribute("color") as THREE.BufferAttribute;
    const linkArray = linkColors.array as Float32Array;
    const linkCount = Math.min(links.length, linkArray.length / 6);
    for (let i = 0; i < linkCount; i++) {
      this.scratchColor.set(links[i].color);
      // Both endpoints of a link share its colour.
      const base = i * 6;
      linkArray[base] = linkArray[base + 3] = this.scratchColor.r;
      linkArray[base + 1] = linkArray[base + 4] = this.scratchColor.g;
      linkArray[base + 2] = linkArray[base + 5] = this.scratchColor.b;
    }
    linkColors.needsUpdate = true;
  }

  /** Copy a worker tick into both geometries. Runs once per frame at most. */
  applyPositions(positions: Float32Array): void {
    const nodePosition = this.points.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!nodePosition) return;
    const nodeArray = nodePosition.array as Float32Array;
    // A stale tick from a superseded graph would be the wrong length; ignore it
    // rather than writing a short or overlong array into the buffer.
    if (positions.length !== nodeArray.length) return;
    nodeArray.set(positions);
    nodePosition.needsUpdate = true;

    const linkPosition = this.lines.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!linkPosition) return;
    const linkArray = linkPosition.array as Float32Array;
    const pairs = this.linkPairs;
    for (let i = 0; i < pairs.length; i++) {
      const from = pairs[i] * 3;
      const to = i * 3;
      linkArray[to] = positions[from];
      linkArray[to + 1] = positions[from + 1];
      linkArray[to + 2] = positions[from + 2];
    }
    linkPosition.needsUpdate = true;

    // Point size is in world units, so the pixel scale depends on viewport
    // height exactly as three's own `PointsMaterial` does. Read from the
    // drawing buffer rather than the DOM to avoid forcing a layout every frame.
    this.renderer.getDrawingBufferSize(this.drawingBufferSize);
    this.nodeMaterial.uniforms.scale.value =
      (this.drawingBufferSize.y * 0.5) / this.renderer.getPixelRatio();
  }

  /**
   * Centre and radius of the current layout, for framing the camera. Null while
   * the graph is empty or the first tick has not arrived.
   */
  bounds(): { center: THREE.Vector3; radius: number } | null {
    const position = this.points.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!position || position.count === 0) return null;
    const array = position.array as Float32Array;

    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    for (let i = 0; i < array.length; i += 3) {
      box.expandByPoint(point.set(array[i], array[i + 1], array[i + 2]));
    }
    if (box.isEmpty()) return null;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    return { center, radius: Math.max(size.x, size.y, size.z) / 2 + NODE_RADIUS };
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.scene.remove(this.lines);
    this.points.geometry.dispose();
    this.lines.geometry.dispose();
    this.nodeMaterial.dispose();
    this.linkMaterial.dispose();
  }
}
