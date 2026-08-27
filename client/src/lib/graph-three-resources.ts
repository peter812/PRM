import * as THREE from "three";

/**
 * Shared THREE.js geometry / material cache for the force-graph pages.
 *
 * `three-forcegraph` invokes `nodeThreeObject` and `linkThreeObject` once per
 * node and per link. Allocating a geometry and a material inside those
 * callbacks therefore costs N geometries + N materials + N draw calls, which
 * is what caps the dense scenes. Everything here is keyed and reused instead,
 * so adding nodes adds meshes but not GPU uploads or material state changes.
 *
 * The library never disposes these: its `onUpdateObj` handlers bail out early
 * for custom objects, so only `dispose()` below frees them. Callers must treat
 * every returned instance as immutable and shared — to recolour an object,
 * swap in a different cached material rather than mutating the one it holds.
 */
export class GraphResourceCache {
  private geometries = new Map<string, THREE.BufferGeometry>();
  private materials = new Map<string, THREE.Material>();

  sphereGeometry(radius: number, segments: number): THREE.SphereGeometry {
    const key = `sphere:${radius}:${segments}`;
    let geom = this.geometries.get(key) as THREE.SphereGeometry | undefined;
    if (!geom) {
      geom = new THREE.SphereGeometry(radius, segments, segments);
      this.geometries.set(key, geom);
    }
    return geom;
  }

  ringGeometry(innerRadius: number, outerRadius: number, segments: number): THREE.RingGeometry {
    const key = `ring:${innerRadius}:${outerRadius}:${segments}`;
    let geom = this.geometries.get(key) as THREE.RingGeometry | undefined;
    if (!geom) {
      geom = new THREE.RingGeometry(innerRadius, outerRadius, segments);
      this.geometries.set(key, geom);
    }
    return geom;
  }

  /** Lit material for regular graph nodes. */
  nodeMaterial(color: string, translucent: boolean): THREE.MeshLambertMaterial {
    const key = `lambert:${color}:${translucent}`;
    let mat = this.materials.get(key) as THREE.MeshLambertMaterial | undefined;
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({
        color,
        transparent: translucent,
        opacity: translucent ? 0.6 : 1.0,
      });
      this.materials.set(key, mat);
    }
    return mat;
  }

  /** Unlit material, used for group centres and their rings. */
  basicMaterial(
    color: string,
    opts: { opacity?: number; doubleSided?: boolean } = {},
  ): THREE.MeshBasicMaterial {
    const opacity = opts.opacity ?? 1;
    const doubleSided = opts.doubleSided ?? false;
    const key = `basic:${color}:${opacity}:${doubleSided}`;
    let mat = this.materials.get(key) as THREE.MeshBasicMaterial | undefined;
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        ...(doubleSided ? { side: THREE.DoubleSide } : {}),
      });
      this.materials.set(key, mat);
    }
    return mat;
  }

  /** Line material for graph links. Dashed variants are used for crowd links. */
  lineMaterial(color: string, dashed: boolean): THREE.LineBasicMaterial {
    const key = `line:${color}:${dashed}`;
    let mat = this.materials.get(key) as THREE.LineBasicMaterial | undefined;
    if (!mat) {
      mat = dashed
        ? new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.8 })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
      this.materials.set(key, mat);
    }
    return mat;
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.geometries.clear();
    this.materials.forEach((m) => m.dispose());
    this.materials.clear();
  }
}

/**
 * Clamp the renderer's pixel ratio.
 *
 * `three-render-objects` already clamps to `min(2, devicePixelRatio)` at init,
 * so passing 2 reproduces the stock behaviour exactly. The lever is going
 * *below* 2: on a hi-DPI display, dropping to 1 quarters the fragment work,
 * which on a fill-heavy scene beats anything MSAA costs.
 */
export function applyRendererPerfSettings(
  renderer: THREE.WebGLRenderer | undefined | null,
  maxPixelRatio: number,
): void {
  if (!renderer || typeof renderer.setPixelRatio !== "function") return;
  const ratio = Math.min(window.devicePixelRatio || 1, Math.max(1, maxPixelRatio));
  renderer.setPixelRatio(ratio);
}
