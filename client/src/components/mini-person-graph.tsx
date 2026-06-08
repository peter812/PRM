import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import ForceGraph3D from "3d-force-graph";
import type { RelationshipsGroupedResponse } from "@shared/schema";

interface MiniGraphNode {
  id: string;
  name: string;
  color?: string;
  val?: number;
  isCenter?: boolean;
}

interface MiniGraphLink {
  source: string;
  target: string;
  color?: string;
}

interface ForceGraphInstance {
  graphData: (data: { nodes: MiniGraphNode[]; links: MiniGraphLink[] }) => ForceGraphInstance;
  backgroundColor: (c: string) => ForceGraphInstance;
  nodeLabel: (key: string) => ForceGraphInstance;
  nodeColor: (key: string) => ForceGraphInstance;
  nodeVal: (key: string) => ForceGraphInstance;
  linkColor: (key: string) => ForceGraphInstance;
  linkOpacity: (n: number) => ForceGraphInstance;
  linkWidth: (n: number) => ForceGraphInstance;
  enableNodeDrag: (b: boolean) => ForceGraphInstance;
  enableNavigationControls: (b: boolean) => ForceGraphInstance;
  showNavInfo: (b: boolean) => ForceGraphInstance;
  onNodeClick: (cb: (node: MiniGraphNode) => void) => ForceGraphInstance;
  onNodeHover: (cb: (node: MiniGraphNode | null) => void) => ForceGraphInstance;
  d3AlphaDecay: (n: number) => ForceGraphInstance;
  d3VelocityDecay: (n: number) => ForceGraphInstance;
  warmupTicks: (n: number) => ForceGraphInstance;
  cooldownTime: (n: number) => ForceGraphInstance;
  width: (n: number) => ForceGraphInstance;
  height: (n: number) => ForceGraphInstance;
  zoomToFit: (ms: number, padding: number) => ForceGraphInstance;
  _destructor: () => void;
}

interface MiniPersonGraphProps {
  personId: string;
  personName: string;
  data: RelationshipsGroupedResponse | undefined;
}

/**
 * A compact, chrome-less 3D force graph that visualizes the direct
 * relationship connections of a single person. Designed to live next to the
 * Relationships chip list — it has no side menus and no controls beyond
 * standard mouse navigation.
 */
export function MiniPersonGraph({ personId, personName, data }: MiniPersonGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphInstance | null>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const nodes: MiniGraphNode[] = [
      { id: personId, name: personName, color: "#ef4444", val: 16, isCenter: true },
    ];
    const links: MiniGraphLink[] = [];
    const seen = new Set<string>([personId]);

    if (data) {
      for (const group of data.groups) {
        for (const rel of group.relationships) {
          const targetId = rel.toPerson.id;
          if (!seen.has(targetId)) {
            seen.add(targetId);
            nodes.push({
              id: targetId,
              name: `${rel.toPerson.firstName} ${rel.toPerson.lastName}`.trim(),
              color: group.type.color || "#6366f1",
              val: 8,
            });
          }
          links.push({
            source: personId,
            target: targetId,
            color: group.type.color || "#6b7280",
          });
        }
      }
    }

    const styles = getComputedStyle(document.documentElement);
    const backgroundHSL = styles.getPropertyValue("--background").trim();
    const values = backgroundHSL.split(" ").map((v) => parseFloat(v));
    const bgColor =
      values.length === 3 && values.every((v) => !Number.isNaN(v))
        ? `hsl(${values[0]}, ${values[1]}%, ${values[2]}%)`
        : "#0a0a0a";

    const width = el.clientWidth || 320;
    const height = el.clientHeight || 320;

    if (!fgRef.current) {
      const factory = ForceGraph3D as unknown as (
        opts: { controlType: string; rendererConfig: { antialias: boolean; alpha: boolean } }
      ) => (el: HTMLElement) => ForceGraphInstance;
      const fg = factory({
        controlType: "orbit",
        rendererConfig: { antialias: true, alpha: true },
      })(el);

      fg
        .width(width)
        .height(height)
        .graphData({ nodes, links })
        .backgroundColor(bgColor)
        .nodeLabel("name")
        .nodeColor("color")
        .nodeVal("val")
        .linkColor("color")
        .linkOpacity(0.7)
        .linkWidth(1.5)
        .enableNodeDrag(true)
        .enableNavigationControls(true)
        .showNavInfo(false)
        .onNodeClick((node) => {
          if (node.id && node.id !== personId) {
            navigate(`/person/${node.id}`);
          }
        })
        .onNodeHover((node) => {
          if (containerRef.current) {
            containerRef.current.style.cursor =
              node && node.id !== personId ? "pointer" : "default";
          }
        })
        .d3AlphaDecay(0.02)
        .d3VelocityDecay(0.35)
        .warmupTicks(80)
        .cooldownTime(8000);

      fgRef.current = fg;
    } else {
      fgRef.current.width(width).height(height).graphData({ nodes, links });
    }

    // Re-fit when the underlying graph changes.
    const fitTimer = window.setTimeout(() => {
      fgRef.current?.zoomToFit(800, 40);
    }, 600);

    // Track container resize so the canvas stays in sync with the panel width.
    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current || !fgRef.current) return;
      const w = containerRef.current.clientWidth || width;
      const h = containerRef.current.clientHeight || height;
      fgRef.current.width(w).height(h);
    });
    resizeObserver.observe(el);

    return () => {
      window.clearTimeout(fitTimer);
      resizeObserver.disconnect();
    };
  }, [personId, personName, data, navigate]);

  // Tear down the renderer when the component unmounts.
  useEffect(() => {
    return () => {
      if (fgRef.current) {
        fgRef.current._destructor();
        fgRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[320px] rounded-md border bg-background overflow-hidden"
      data-testid="mini-person-graph"
    />
  );
}
