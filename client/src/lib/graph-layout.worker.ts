/**
 * Force layout for the dense social-graph renderer, run off the main thread.
 *
 * The standard renderer lets `three-forcegraph` drive d3-force on the main
 * thread. That is fine while the scene is small, but past a few thousand nodes
 * the simulation and the frame it is meant to be animating compete for the same
 * thread and both stutter. Here the simulation owns a worker and the main thread
 * only ever copies a positions array into a buffer attribute.
 *
 * Node identity is purely positional: index `i` in every array below is the same
 * node the renderer drew at index `i`. `indexDenseGraph` in
 * `dense-graph-renderer.ts` is the single place that ordering is decided, so the
 * two cannot drift apart.
 *
 * Positions are posted *without* transferring the buffer: the worker keeps one
 * scratch array for the lifetime of the graph and the structured clone hands the
 * main thread a copy. Transferring would save that copy but hand the buffer away
 * and force a fresh allocation every frame, which is the worse trade here.
 */
import { forceSimulation, forceLink, forceManyBody, forceCenter } from "d3-force-3d";
import type { Simulation, SimulationLink, SimulationNode } from "d3-force-3d";

export interface LayoutInitRequest {
  type: "init";
  nodeCount: number;
  /** Flat [sourceIndex, targetIndex, ...] pairs into the node array. */
  links: Uint32Array;
  /** Per-node `val`, which scales the charge force as the standard path does. */
  vals: Float32Array;
  chargeMultiplier: number;
  /** Divides the base charge, so lower values push the layout further apart. */
  centerPull: number;
  /**
   * Settled positions to resume from (3 floats per node), or null to start cold.
   * A node whose x is NaN has no known position and is left for d3 to place, so
   * nodes appearing for the first time do not all start stacked on the origin.
   */
  positions: Float32Array | null;
}

export interface LayoutChargeRequest {
  type: "charge";
  chargeMultiplier: number;
  centerPull: number;
}

export type LayoutRequest = LayoutInitRequest | LayoutChargeRequest;

/** d3's own default. Below this the layout has visually stopped moving. */
const ALPHA_MIN = 0.001;
/** Both match the standard path's `.d3AlphaDecay()` / `.d3VelocityDecay()`. */
const ALPHA_DECAY = 0.01;
const VELOCITY_DECAY = 0.3;
/**
 * How long each slice of ticking may run before yielding. Long enough that the
 * layout settles quickly, short enough that a `charge` message sent while it is
 * still hot is handled without a visible delay.
 */
const TICK_BUDGET_MS = 12;

let simulation: Simulation | null = null;
let nodes: SimulationNode[] = [];
let vals = new Float32Array(0);
let scratch = new Float32Array(0);
let scheduled = 0;

/**
 * Mirrors `applyChargeForce` on the standard path: bigger nodes push harder, so
 * blob mode spreads its clusters out rather than letting them overlap.
 */
function chargeStrength(multiplier: number, centerPull: number) {
  return (_node: SimulationNode, index: number): number => {
    const val = vals[index] || 10;
    return (-30 * (1 + (Math.sqrt(val / 10) - 1) * multiplier)) / centerPull;
  };
}

function postPositions(): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const base = i * 3;
    scratch[base] = node.x ?? 0;
    scratch[base + 1] = node.y ?? 0;
    scratch[base + 2] = node.z ?? 0;
  }
  self.postMessage(scratch);
}

function runSlice(): void {
  scheduled = 0;
  const sim = simulation;
  if (!sim) return;

  const deadline = performance.now() + TICK_BUDGET_MS;
  do {
    sim.tick();
  } while (sim.alpha() >= ALPHA_MIN && performance.now() < deadline);

  postPositions();
  if (sim.alpha() >= ALPHA_MIN) schedule();
}

function schedule(): void {
  if (scheduled === 0) scheduled = self.setTimeout(runSlice, 0);
}

function init(request: LayoutInitRequest): void {
  if (scheduled !== 0) {
    clearTimeout(scheduled);
    scheduled = 0;
  }
  simulation?.stop();

  vals = request.vals;
  scratch = new Float32Array(request.nodeCount * 3);

  const seed = request.positions;
  nodes = new Array(request.nodeCount);
  for (let i = 0; i < request.nodeCount; i++) {
    const base = i * 3;
    // Seeding from the previous layout means a filter change nudges the graph
    // instead of throwing it away and re-simulating from scratch.
    const x = seed ? seed[base] : NaN;
    nodes[i] = Number.isNaN(x) ? {} : { x, y: seed![base + 1], z: seed![base + 2] };
  }

  const links: SimulationLink[] = new Array(request.links.length / 2);
  for (let i = 0; i < links.length; i++) {
    links[i] = { source: request.links[i * 2], target: request.links[i * 2 + 1] };
  }

  if (request.nodeCount === 0) {
    simulation = null;
    postPositions();
    return;
  }

  // `forceSimulation` schedules its own timer; `.stop()` in the same turn kills
  // it before it can tick, leaving this file in sole control of the clock.
  simulation = forceSimulation(nodes, 3)
    .force("link", forceLink(links))
    .force("charge", forceManyBody().strength(chargeStrength(request.chargeMultiplier, request.centerPull)))
    .force("center", forceCenter())
    .alphaDecay(ALPHA_DECAY)
    .velocityDecay(VELOCITY_DECAY)
    .stop();

  schedule();
}

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const request = event.data;
  if (request.type === "init") {
    init(request);
    return;
  }
  const sim = simulation;
  if (!sim) return;
  (sim.force("charge") as ReturnType<typeof forceManyBody>).strength(
    chargeStrength(request.chargeMultiplier, request.centerPull),
  );
  sim.alpha(1);
  schedule();
};
