/**
 * Ambient types for `d3-force-3d`, which ships untyped ESM sources.
 *
 * Deliberately not a faithful port of `@types/d3-force`: only the members the
 * dense graph layout worker actually calls are declared, so this stays small
 * enough to read in one go and to verify against the real API.
 */
declare module "d3-force-3d" {
  /** A node the simulation mutates in place on every tick. */
  export interface SimulationNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
  }

  /** Links address nodes by their index in the array passed to the simulation. */
  export interface SimulationLink {
    source: number;
    target: number;
  }

  export interface ManyBodyForce {
    strength(accessor: (node: SimulationNode, index: number) => number): ManyBodyForce;
  }

  export interface Simulation {
    tick(iterations?: number): Simulation;
    stop(): Simulation;
    alpha(): number;
    alpha(value: number): Simulation;
    alphaDecay(value: number): Simulation;
    velocityDecay(value: number): Simulation;
    numDimensions(): number;
    force(name: string): unknown;
    force(name: string, force: unknown): Simulation;
  }

  export function forceSimulation(nodes: SimulationNode[], numDimensions?: number): Simulation;
  export function forceLink(links: SimulationLink[]): unknown;
  export function forceManyBody(): ManyBodyForce;
  export function forceCenter(x?: number, y?: number, z?: number): unknown;
}
