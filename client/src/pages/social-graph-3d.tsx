import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Settings, X, Filter, Palette } from "lucide-react";
import { useLocation } from "wouter";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import type { SocialAccount, SocialAccountType, SocialGraphData } from "@shared/schema";

interface GraphNode {
  id: string;
  name: string;
  type: 'social-account';
  color?: string;
  val?: number;
}

interface GraphLink {
  source: string;
  target: string;
  type: 'follows';
  color?: string;
  mutual?: boolean;
}

export default function SocialGraph3D() {
  const graphRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const materialCacheRef = useRef<Map<string, THREE.LineBasicMaterial>>(new Map());
  const [, navigate] = useLocation();
  const [hideOrphans, setHideOrphans] = useState(true);
  const [minConnections, setMinConnections] = useState(0);
  const [limitExtras, setLimitExtras] = useState(true);
  const [maxExtras, setMaxExtras] = useState(20);
  const [colorScheme, setColorScheme] = useState<'type' | 'distance' | 'connections'>('type');
  const [colorSchemeAccountId, setColorSchemeAccountId] = useState<string | null>(null);
  const [distanceSearchOpen, setDistanceSearchOpen] = useState(false);
  const [distanceSearchQuery, setDistanceSearchQuery] = useState('');
  const [connectionsColorMax, setConnectionsColorMax] = useState('#ef4444');
  const [connectionsColorMin, setConnectionsColorMin] = useState('#3b0764');
  const [linkMutualColor, setLinkMutualColor] = useState('#6366f1');
  const [linkDefaultColor, setLinkDefaultColor] = useState('#6b7280');
  const [distanceColorSelf, setDistanceColorSelf] = useState('#ef4444');
  const [distanceColorDirect, setDistanceColorDirect] = useState('#22c55e');
  const [distanceColor2nd, setDistanceColor2nd] = useState('#3b82f6');
  const [distanceColorOther, setDistanceColorOther] = useState('#9ca3af');
  const [singleLinkMutualColor, setSingleLinkMutualColor] = useState('#22c55e');
  const [singleLinkFollowsYouColor, setSingleLinkFollowsYouColor] = useState('#3b82f6');
  const [singleLinkYouFollowColor, setSingleLinkYouFollowColor] = useState('#ef4444');
  const [singleNodeColorScheme, setSingleNodeColorScheme] = useState<'follow-status' | 'type'>('follow-status');
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [graphMode, setGraphMode] = useState<'default' | 'blob' | 'single-highlight' | 'multi-highlight'>('default');
  const [singleHighlightAccountId, setSingleHighlightAccountId] = useState<string | null>(null);
  const [singleHighlightSearchOpen, setSingleHighlightSearchOpen] = useState(false);
  const [singleHighlightSearchQuery, setSingleHighlightSearchQuery] = useState('');
  const [singleShowFriendLinks, setSingleShowFriendLinks] = useState(true);
  const [singleRemoveExtras, setSingleRemoveExtras] = useState(false);
  const [multiHighlightAccountIds, setMultiHighlightAccountIds] = useState<string[]>([]);
  const [multiHighlightSearchOpen, setMultiHighlightSearchOpen] = useState(false);
  const [multiHighlightSearchQuery, setMultiHighlightSearchQuery] = useState('');
  const [blobMergeMultiplier, setBlobMergeMultiplier] = useState(0.5);
  const [blobForceMultiplier, setBlobForceMultiplier] = useState(2);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; accountId: string } | null>(null);

  const extrasSteps = [5, 10, 20, 50, 100];
  const mergeMultiplierSteps = [0, 0.15, 0.3, 0.5, 0.75, 1];

  const [appliedSettings, setAppliedSettings] = useState({
    hideOrphans,
    minConnections,
    limitExtras,
    maxExtras,
    singleHighlightAccountId,
    singleShowFriendLinks,
    singleRemoveExtras,
    multiHighlightAccountIds,
    mode: graphMode,
    blobMergeMultiplier,
  });

  const { data: graphData, isLoading: isGraphLoading } = useQuery<SocialGraphData>({
    queryKey: ["/api/social-graph", appliedSettings],
    queryFn: async () => {
      const res = await fetch("/api/social-graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(appliedSettings),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch graph data");
      return res.json();
    },
  });

  const handleUpdateGraph = () => {
    setAppliedSettings({
      hideOrphans,
      minConnections,
      limitExtras,
      maxExtras,
      singleHighlightAccountId,
      singleShowFriendLinks,
      singleRemoveExtras,
      multiHighlightAccountIds,
      mode: graphMode,
      blobMergeMultiplier,
    });
  };

  const { data: socialAccounts } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
  });

  const { data: socialAccountTypes } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  const allSocialAccounts = socialAccounts || [];
  const selectedAccount = selectedAccountId ? allSocialAccounts.find(a => a.id === selectedAccountId) : null;
  const selectedAccountType = selectedAccount?.typeId && socialAccountTypes ? socialAccountTypes.find(t => t.id === selectedAccount.typeId) : null;

  const interpolateColor = useCallback((hex1: string, hex2: string, t: number) => {
    const parse = (hex: string) => {
      const h = hex.replace('#', '');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };
    const [r1, g1, b1] = parse(hex1);
    const [r2, g2, b2] = parse(hex2);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }, []);

  const distanceCacheRef = useRef<{ targetId: string | null; graphDataRef: any; distances: Map<string, number> }>({ targetId: null, graphDataRef: null, distances: new Map() });

  const computeDistances = useCallback((targetId: string, nodes: SocialGraphData['nodes'], links: SocialGraphData['links']): Map<string, number> => {
    const cache = distanceCacheRef.current;
    if (cache.targetId === targetId && cache.graphDataRef === graphData) {
      return cache.distances;
    }
    const adjacency = new Map<string, Set<string>>();
    nodes.forEach(node => adjacency.set(node.id, new Set()));
    links.forEach(l => {
      const src = typeof l.source === 'string' ? l.source : (l.source as any).id;
      const tgt = typeof l.target === 'string' ? l.target : (l.target as any).id;
      adjacency.get(src)?.add(tgt);
      adjacency.get(tgt)?.add(src);
    });
    const distances = new Map<string, number>();
    distances.set(targetId, 0);
    const queue = [targetId];
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      const currentDist = distances.get(current)!;
      const peers = adjacency.get(current) || new Set<string>();
      for (const peer of Array.from(peers)) {
        if (!distances.has(peer)) {
          distances.set(peer, currentDist + 1);
          queue.push(peer);
        }
      }
    }
    cache.targetId = targetId;
    cache.graphDataRef = graphData;
    cache.distances = distances;
    return distances;
  }, [graphData]);

  const nodeColorMapRef = useRef<Map<string, string>>(new Map());

  const computeColorMap = useCallback(() => {
    if (!graphData || !graphData.nodes.length) return new Map<string, string>();

    const colorMap = new Map<string, string>();

    if (graphMode === 'single-highlight' && singleHighlightAccountId && singleNodeColorScheme === 'follow-status') {
      graphData.nodes.forEach(n => {
        if (n.id === singleHighlightAccountId) {
          colorMap.set(n.id, '#ef4444');
          return;
        }
        let isMutual = false;
        let highlightFollowsNode = false;
        let nodeFollowsHighlight = false;
        graphData.links.forEach(l => {
          const src = typeof l.source === 'string' ? l.source : (l.source as any).id;
          const tgt = typeof l.target === 'string' ? l.target : (l.target as any).id;
          const involvesHighlight = (src === singleHighlightAccountId && tgt === n.id) || (src === n.id && tgt === singleHighlightAccountId);
          if (!involvesHighlight) return;
          if (l.mutual) {
            isMutual = true;
            return;
          }
          if (src === singleHighlightAccountId && tgt === n.id) highlightFollowsNode = true;
          if (src === n.id && tgt === singleHighlightAccountId) nodeFollowsHighlight = true;
        });
        if (isMutual || (highlightFollowsNode && nodeFollowsHighlight)) {
          colorMap.set(n.id, singleLinkMutualColor);
        } else if (nodeFollowsHighlight) {
          colorMap.set(n.id, singleLinkFollowsYouColor);
        } else if (highlightFollowsNode) {
          colorMap.set(n.id, singleLinkYouFollowColor);
        } else {
          colorMap.set(n.id, '#9ca3af');
        }
      });
      return colorMap;
    }

    if (colorScheme === 'type') {
      graphData.nodes.forEach(n => colorMap.set(n.id, n.typeColor));
    } else if (colorScheme === 'connections') {
      const counts = graphData.nodes.map(node => node.connectionCount);
      const maxCount = Math.max(...counts, 1);
      const minCount = Math.min(...counts, 0);
      const range = (maxCount - minCount) || 1;
      graphData.nodes.forEach(n => {
        const linear = (n.connectionCount - minCount) / range;
        const normalized = Math.sqrt(linear);
        colorMap.set(n.id, interpolateColor(connectionsColorMin, connectionsColorMax, normalized));
      });
    } else if (colorScheme === 'distance') {
      const distanceColors: Record<number, string> = { 0: distanceColorSelf, 1: distanceColorDirect, 2: distanceColor2nd };
      if (colorSchemeAccountId && graphData.nodes.find(n => n.id === colorSchemeAccountId)) {
        const distancesMap = computeDistances(colorSchemeAccountId, graphData.nodes, graphData.links);
        graphData.nodes.forEach(n => {
          const dist = distancesMap.get(n.id);
          colorMap.set(n.id, (dist !== undefined && dist in distanceColors) ? distanceColors[dist] : distanceColorOther);
        });
      } else {
        graphData.nodes.forEach(n => colorMap.set(n.id, n.typeColor));
      }
    } else {
      graphData.nodes.forEach(n => colorMap.set(n.id, n.typeColor));
    }

    return colorMap;
  }, [graphData, colorScheme, colorSchemeAccountId, connectionsColorMin, connectionsColorMax, interpolateColor, computeDistances, distanceColorSelf, distanceColorDirect, distanceColor2nd, distanceColorOther, graphMode, singleHighlightAccountId, singleNodeColorScheme, singleLinkMutualColor, singleLinkFollowsYouColor, singleLinkYouFollowColor]);

  useEffect(() => {
    if (!graphRef.current || !graphData || !graphData.nodes.length) return;

    const colorMap = computeColorMap();
    nodeColorMapRef.current = colorMap;

    const nodes: GraphNode[] = graphData.nodes.map(n => {
      let label = n.name;
      if (n.mergedNames && n.mergedNames.length > 0) {
        label = `${n.name} (+${n.mergedNames.length} merged)`;
      }
      return {
        id: n.id,
        name: label,
        type: 'social-account' as const,
        color: colorMap.get(n.id) || n.typeColor,
        val: graphMode === 'blob' ? (n.size - 50 + 1) * n.val : n.val,
      };
    });

    const targetId = appliedSettings.singleHighlightAccountId;
    const isSingleMode = appliedSettings.mode === 'single-highlight' && targetId;

    const links: GraphLink[] = graphData.links.map(l => {
      const src = typeof l.source === 'string' ? l.source : (l.source as any).id;
      const tgt = typeof l.target === 'string' ? l.target : (l.target as any).id;
      let color: string;
      if (isSingleMode && (src === targetId || tgt === targetId)) {
        if (l.mutual) {
          color = singleLinkMutualColor;
        } else if (src === targetId) {
          color = singleLinkYouFollowColor;
        } else if (tgt === targetId) {
          color = singleLinkFollowsYouColor;
        } else {
          color = linkDefaultColor;
        }
      } else {
        color = l.mutual ? linkMutualColor : linkDefaultColor;
      }
      return { source: src, target: tgt, type: 'follows' as const, color, mutual: l.mutual };
    });

    let filteredLinks = links;
    if (isSingleMode && !appliedSettings.singleShowFriendLinks) {
      filteredLinks = links.filter(l => l.source === targetId || l.target === targetId);
    }

    const gData = { nodes, links: filteredLinks };

    const styles = getComputedStyle(document.documentElement);
    const backgroundHSL = styles.getPropertyValue('--background').trim();
    const values = backgroundHSL.split(' ').map(v => parseFloat(v));
    const bgColor = `hsl(${values[0]}, ${values[1]}%, ${values[2]}%)`;

    const getMaterial = (color: string) => {
      const cache = materialCacheRef.current;
      if (!cache.has(color)) {
        cache.set(color, new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.6,
        }));
      }
      return cache.get(color)!;
    };

    if (!fgRef.current) {
      const fg = ForceGraph3D({
        controlType: 'orbit',
        rendererConfig: { antialias: true, alpha: true },
      })(graphRef.current)
        .graphData(gData)
        .backgroundColor(bgColor)
        .nodeLabel('name')
        .nodeColor((node: any) => nodeColorMapRef.current.get(node.id) || '#10b981')
        .nodeVal('val')
        .enableNodeDrag(true)
        .enableNavigationControls(true)
        .showNavInfo(false)
        .linkThreeObject((link: any) => {
          const positions = new Float32Array(6);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          const material = getMaterial(link.color || '#6b7280');
          return new THREE.Line(geometry, material);
        })
        .linkPositionUpdate((obj: any, { start, end }: { start: any; end: any }) => {
          const line = obj as THREE.Line;
          const positions = line.geometry.attributes.position as THREE.BufferAttribute;
          positions.array[0] = start.x;
          positions.array[1] = start.y;
          positions.array[2] = start.z;
          positions.array[3] = end.x;
          positions.array[4] = end.y;
          positions.array[5] = end.z;
          positions.needsUpdate = true;
          line.geometry.computeBoundingSphere();
          return true;
        })
        .linkDirectionalArrowLength((link: any) => link.mutual ? 0 : 4)
        .linkDirectionalArrowRelPos(1)
        .linkDirectionalArrowColor((link: any) => link.color || '#6b7280')
        .linkCurvature(0)
        .onNodeClick((node: any) => {
          setSelectedAccountId(node.id);
          setContextMenu(null);
        })
        .onNodeHover((node: any) => {
          graphRef.current!.style.cursor = node ? 'pointer' : 'default';
        })
        .onNodeRightClick((node: any, event: MouseEvent) => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY, accountId: node.id });
        })
        .d3AlphaDecay(0.01)
        .d3VelocityDecay(0.3)
        .warmupTicks(100)
        .cooldownTime(15000);

      try {
        const chargeForce = fg.d3Force('charge');
        if (chargeForce && typeof chargeForce.strength === 'function') {
          chargeForce.strength((node: any) => {
            const nodeVal = node.val || 10;
            const scale = 1 + (Math.sqrt(nodeVal / 10) - 1) * blobForceMultiplier;
            return -30 * scale;
          });
        }
      } catch (_) { }

      fgRef.current = fg;
    } else {
      fgRef.current.graphData(gData);
      try {
        const chargeForce = fgRef.current.d3Force('charge');
        if (chargeForce && typeof chargeForce.strength === 'function') {
          chargeForce.strength((node: any) => {
            const nodeVal = node.val || 10;
            const scale = 1 + (Math.sqrt(nodeVal / 10) - 1) * blobForceMultiplier;
            return -30 * scale;
          });
        }
      } catch (_) { }
    }

    return () => {
      if (fgRef.current) {
        fgRef.current._destructor();
        fgRef.current = null;
      }
      materialCacheRef.current.forEach(m => m.dispose());
      materialCacheRef.current.clear();
    };
  }, [graphData, navigate, graphMode, blobForceMultiplier, linkMutualColor, linkDefaultColor, singleLinkMutualColor, singleLinkFollowsYouColor, singleLinkYouFollowColor]);

  useEffect(() => {
    if (!fgRef.current || !graphData || !graphData.nodes.length) return;
    const colorMap = computeColorMap();
    nodeColorMapRef.current = colorMap;
    fgRef.current.nodeColor((node: any) => nodeColorMapRef.current.get(node.id) || '#10b981');
  }, [colorScheme, colorSchemeAccountId, connectionsColorMin, connectionsColorMax, computeColorMap, graphData]);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleResetCamera = () => {
    if (fgRef.current) {
      fgRef.current.cameraPosition(
        { x: 0, y: 0, z: 1000 },
        { x: 0, y: 0, z: 0 },
        1000
      );
    }
  };

  const handleZoomToFit = () => {
    if (fgRef.current) {
      fgRef.current.zoomToFit(1000, 50);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
        <div>
          <h1 className="text-sm md:text-2xl font-semibold flex items-center gap-2" data-testid="text-page-title">
            3D Social Account Graph
            <span className="text-xs font-medium bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full" data-testid="text-node-count">
              {graphData?.nodes.length || 0}
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isGraphLoading && (
            <span className="text-xs text-muted-foreground" data-testid="text-graph-loading">Loading...</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsOptionsOpen(!isOptionsOpen)}
            data-testid="button-settings"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {selectedAccount && (
          <div className="absolute top-4 left-4 w-72 max-h-[calc(100%-2rem)] overflow-y-auto bg-background/80 backdrop-blur-sm border rounded-lg shadow-lg z-50" data-testid="sidebar-account-info">
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Account Info</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedAccountId(null)}
                  data-testid="button-close-sidebar"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-col items-center gap-3">
                <Avatar className="h-20 w-20">
                  {selectedAccount.currentProfile?.imageUrl ? (
                    <AvatarImage src={selectedAccount.currentProfile?.imageUrl} alt={selectedAccount.username} />
                  ) : null}
                  <AvatarFallback className="text-lg">
                    {(selectedAccount.currentProfile?.nickname || selectedAccount.username).slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="text-center space-y-0.5">
                  <p className="font-medium" data-testid="text-sidebar-username">@{selectedAccount.username}</p>
                  {selectedAccount.currentProfile?.nickname && (
                    <p className="text-sm text-muted-foreground" data-testid="text-sidebar-displayname">{selectedAccount.currentProfile?.nickname}</p>
                  )}
                </div>
              </div>
              <div className="space-y-2 text-sm">
                {selectedAccountType && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Type</span>
                    <Badge variant="secondary" style={{ borderColor: selectedAccountType.color, borderWidth: 2 }} data-testid="badge-sidebar-type">
                      {selectedAccountType.name}
                    </Badge>
                  </div>
                )}
                {selectedAccount.currentProfile?.accountUrl && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">URL</span>
                    <a
                      href={selectedAccount.currentProfile?.accountUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs truncate max-w-[140px] underline"
                      data-testid="link-sidebar-url"
                    >
                      {selectedAccount.currentProfile?.accountUrl.replace(/^https?:\/\//, '')}
                    </a>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Followers</span>
                  <span data-testid="text-sidebar-followers">{selectedAccount.latestState?.followers?.length || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Following</span>
                  <span data-testid="text-sidebar-following">{selectedAccount.latestState?.following?.length || 0}</span>
                </div>
                {selectedAccount.currentProfile?.bio && (
                  <div className="pt-2 border-t">
                    <span className="text-muted-foreground">Notes</span>
                    <p className="mt-1 text-xs" data-testid="text-sidebar-notes">{selectedAccount.currentProfile?.bio}</p>
                  </div>
                )}
              </div>
              <div className="pt-2 border-t">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => navigate(`/social-accounts/${selectedAccount.id}?from=social-graph-3d`)}
                  data-testid="button-sidebar-view-profile"
                >
                  View Full Profile
                </Button>
              </div>
            </div>
          </div>
        )}
          <div ref={graphRef} className="w-full h-full" data-testid="canvas-social-graph-3d" />

        {isOptionsOpen && (
          <div className="absolute top-4 right-4 w-80 bg-background/80 backdrop-blur-sm border rounded-lg shadow-lg p-4 space-y-3 z-50">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Graph Options</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOptionsOpen(false)}
                data-testid="button-close-options"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <Tabs defaultValue="filter" data-testid="options-tabs">
              <TabsList className="w-full">
                <TabsTrigger value="filter" className="flex-1 gap-1" data-testid="tab-filter">
                  <Filter className="h-3.5 w-3.5" />
                  Filter
                </TabsTrigger>
                <TabsTrigger value="color" className="flex-1 gap-1" data-testid="tab-color">
                  <Palette className="h-3.5 w-3.5" />
                  Color
                </TabsTrigger>
              </TabsList>

              <TabsContent value="filter" className="space-y-4" data-testid="tab-content-filter">
                <div className="space-y-2">
                  <Label>Graph Mode</Label>
                  <div className="grid grid-cols-2 gap-1" data-testid="mode-selector">
                    <Button
                      variant={graphMode === 'default' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setGraphMode('default')}
                      data-testid="button-mode-default"
                    >
                      Default
                    </Button>
                    <Button
                      variant={graphMode === 'blob' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setGraphMode('blob')}
                      data-testid="button-mode-blob"
                    >
                      Blob
                    </Button>
                    <Button
                      variant={graphMode === 'single-highlight' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setGraphMode('single-highlight')}
                      data-testid="button-mode-single"
                    >
                      Single
                    </Button>
                    <Button
                      variant={graphMode === 'multi-highlight' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setGraphMode('multi-highlight')}
                      data-testid="button-mode-multi"
                    >
                      Multi
                    </Button>
                  </div>
                </div>

                {graphMode === 'blob' && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm text-muted-foreground">Blob Size Multiplier</Label>
                        <span className="text-sm font-medium" data-testid="text-blob-merge-value">{blobMergeMultiplier.toFixed(2)}x</span>
                      </div>
                      <Slider
                        value={[Math.max(0, mergeMultiplierSteps.indexOf(blobMergeMultiplier))]}
                        min={0}
                        max={mergeMultiplierSteps.length - 1}
                        step={1}
                        onValueChange={(values) => setBlobMergeMultiplier(mergeMultiplierSteps[values[0]])}
                        data-testid="slider-blob-merge"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        {mergeMultiplierSteps.map(step => (
                          <span key={step}>{step}</span>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm text-muted-foreground">Blob Size Force</Label>
                        <span className="text-sm font-medium" data-testid="text-blob-force-value">{blobForceMultiplier.toFixed(1)}x</span>
                      </div>
                      <Slider
                        value={[blobForceMultiplier * 10]}
                        min={20}
                        max={60}
                        step={1}
                        onValueChange={(values) => setBlobForceMultiplier(values[0] / 10)}
                        data-testid="slider-blob-force"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>2x</span>
                        <span>3x</span>
                        <span>4x</span>
                        <span>5x</span>
                        <span>6x</span>
                      </div>
                    </div>
                  </>
                )}

                {graphMode === 'single-highlight' && (
                  <>
                    <div className="space-y-2">
                      <Label>Highlight Account</Label>
                      <div className="relative">
                        {singleHighlightAccountId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute left-0 top-0 h-full z-10 hover:bg-transparent"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSingleHighlightAccountId(null);
                            }}
                            data-testid="button-clear-single-highlight"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                        <Popover open={singleHighlightSearchOpen} onOpenChange={(open) => { setSingleHighlightSearchOpen(open); if (!open) setSingleHighlightSearchQuery(''); }}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full justify-start text-left font-normal"
                              style={{ paddingLeft: singleHighlightAccountId ? '2.5rem' : undefined }}
                              data-testid="button-single-highlight-search"
                            >
                              {singleHighlightAccountId
                                ? (() => {
                                  const account = allSocialAccounts.find(a => a.id === singleHighlightAccountId);
                                  return account ? (account.currentProfile?.nickname || account.username) : 'Select account...';
                                })()
                                : 'Select account...'}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-80 p-0" align="start">
                            <Command shouldFilter={false}>
                              <CommandInput
                                placeholder="Type 3+ characters to search..."
                                value={singleHighlightSearchQuery}
                                onValueChange={setSingleHighlightSearchQuery}
                              />
                              <CommandList>
                                {singleHighlightSearchQuery.length > 0 && singleHighlightSearchQuery.length < 3 && (
                                  <div className="p-3 text-sm text-muted-foreground text-center">
                                    Type {3 - singleHighlightSearchQuery.length} more character{3 - singleHighlightSearchQuery.length > 1 ? 's' : ''} to search...
                                  </div>
                                )}
                                {singleHighlightSearchQuery.length >= 3 && (() => {
                                  const query = singleHighlightSearchQuery.toLowerCase();
                                  const filtered = allSocialAccounts.filter(a =>
                                    a.username.toLowerCase().includes(query) ||
                                    (a.currentProfile?.nickname && a.currentProfile?.nickname.toLowerCase().includes(query))
                                  ).slice(0, 50);
                                  if (filtered.length === 0) return <CommandEmpty>No account found.</CommandEmpty>;
                                  return (
                                    <CommandGroup>
                                      {filtered.map((account) => (
                                        <CommandItem
                                          key={account.id}
                                          value={account.id}
                                          onSelect={() => {
                                            setSingleHighlightAccountId(account.id);
                                            setSingleHighlightSearchOpen(false);
                                            setSingleHighlightSearchQuery('');
                                          }}
                                          data-testid={`option-single-highlight-${account.id}`}
                                        >
                                          {account.currentProfile?.nickname || account.username}
                                          {account.currentProfile?.nickname && (
                                            <span className="ml-1 text-muted-foreground">@{account.username}</span>
                                          )}
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  );
                                })()}
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="single-show-friend-links">Show Friend Links</Label>
                      <Switch
                        id="single-show-friend-links"
                        checked={singleShowFriendLinks}
                        onCheckedChange={setSingleShowFriendLinks}
                        data-testid="switch-single-show-friend-links"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="single-remove-extras">Remove Extras</Label>
                      <Switch
                        id="single-remove-extras"
                        checked={singleRemoveExtras}
                        onCheckedChange={setSingleRemoveExtras}
                        data-testid="switch-single-remove-extras"
                      />
                    </div>
                  </>
                )}

                {graphMode === 'multi-highlight' && (
                  <div className="space-y-2">
                    <Label>Highlight Accounts</Label>
                    <Popover open={multiHighlightSearchOpen} onOpenChange={(open) => { setMultiHighlightSearchOpen(open); if (!open) setMultiHighlightSearchQuery(''); }}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start text-left font-normal"
                          data-testid="button-multi-highlight-search"
                        >
                          Search accounts...
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="Type 3+ characters to search..."
                            value={multiHighlightSearchQuery}
                            onValueChange={setMultiHighlightSearchQuery}
                          />
                          <CommandList>
                            {multiHighlightSearchQuery.length > 0 && multiHighlightSearchQuery.length < 3 && (
                              <div className="p-3 text-sm text-muted-foreground text-center">
                                Type {3 - multiHighlightSearchQuery.length} more character{3 - multiHighlightSearchQuery.length > 1 ? 's' : ''} to search...
                              </div>
                            )}
                            {multiHighlightSearchQuery.length >= 3 && (() => {
                              const query = multiHighlightSearchQuery.toLowerCase();
                              const filtered = allSocialAccounts.filter(a =>
                                !multiHighlightAccountIds.includes(a.id) &&
                                (a.username.toLowerCase().includes(query) ||
                                (a.currentProfile?.nickname && a.currentProfile?.nickname.toLowerCase().includes(query)))
                              ).slice(0, 50);
                              if (filtered.length === 0) return <CommandEmpty>No account found.</CommandEmpty>;
                              return (
                                <CommandGroup>
                                  {filtered.map((account) => (
                                    <CommandItem
                                      key={account.id}
                                      value={account.id}
                                      onSelect={() => {
                                        setMultiHighlightAccountIds(prev => [...prev, account.id]);
                                        setMultiHighlightSearchQuery('');
                                      }}
                                      data-testid={`option-multi-highlight-${account.id}`}
                                    >
                                      {account.currentProfile?.nickname || account.username}
                                      {account.currentProfile?.nickname && (
                                        <span className="ml-1 text-muted-foreground">@{account.username}</span>
                                      )}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              );
                            })()}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {multiHighlightAccountIds.length === 0 ? (
                      <p className="text-xs text-muted-foreground" data-testid="text-multi-highlight-empty">Select 2 or more accounts</p>
                    ) : (
                      <div className="flex flex-wrap gap-1" data-testid="multi-highlight-chips">
                        {multiHighlightAccountIds.map((id) => {
                          const account = allSocialAccounts.find(a => a.id === id);
                          return (
                            <Badge key={id} variant="secondary" className="gap-1" data-testid={`badge-multi-highlight-${id}`}>
                              {account ? (account.currentProfile?.nickname || account.username) : id}
                              <button
                                onClick={() => setMultiHighlightAccountIds(prev => prev.filter(aid => aid !== id))}
                                className="ml-0.5"
                                data-testid={`button-remove-multi-highlight-${id}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <Label htmlFor="hide-orphans">Hide Orphans</Label>
                  <Switch
                    id="hide-orphans"
                    checked={hideOrphans}
                    onCheckedChange={setHideOrphans}
                    data-testid="switch-hide-orphans"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Minimum Connections</Label>
                    <span className="text-sm font-medium" data-testid="text-min-connections-value">{minConnections}</span>
                  </div>
                  <Slider
                    value={[minConnections]}
                    min={0}
                    max={6}
                    step={1}
                    onValueChange={(values) => setMinConnections(values[0])}
                    data-testid="slider-min-connections"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>0</span>
                    <span>1</span>
                    <span>2</span>
                    <span>3</span>
                    <span>4</span>
                    <span>5</span>
                    <span>6</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="limit-extras" className={minConnections >= 2 ? "text-muted-foreground" : ""}>
                    Limit Extras
                  </Label>
                  <Switch
                    id="limit-extras"
                    checked={limitExtras}
                    onCheckedChange={setLimitExtras}
                    disabled={minConnections >= 2}
                    data-testid="switch-limit-extras"
                  />
                </div>

                {limitExtras && minConnections < 2 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground">Max Extras</Label>
                      <span className="text-sm font-medium" data-testid="text-max-extras-value">{maxExtras}</span>
                    </div>
                    <Slider
                      value={[Math.max(0, extrasSteps.indexOf(maxExtras))]}
                      min={0}
                      max={extrasSteps.length - 1}
                      step={1}
                      onValueChange={(values) => setMaxExtras(extrasSteps[values[0]])}
                      data-testid="slider-max-extras"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      {extrasSteps.map(step => (
                        <span key={step}>{step}</span>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="color" className="space-y-4" data-testid="tab-content-color">
                {graphMode === 'single-highlight' && (
                  <div className="space-y-3" data-testid="single-highlight-color-options">
                    <div className="space-y-2">
                      <Label>Node Colors</Label>
                      <Select
                        value={singleNodeColorScheme}
                        onValueChange={(value: 'follow-status' | 'type') => setSingleNodeColorScheme(value)}
                      >
                        <SelectTrigger data-testid="select-single-node-scheme">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="follow-status" data-testid="option-single-follow-status">Follow Status</SelectItem>
                          <SelectItem value="type" data-testid="option-single-type">Account Type</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Line Colors</Label>
                      <div className="flex items-center justify-between">
                        <Label className="text-sm text-muted-foreground">Mutual</Label>
                        <input type="color" value={singleLinkMutualColor} onChange={(e) => setSingleLinkMutualColor(e.target.value)} className="h-7 w-10 rounded cursor-pointer border" data-testid="input-single-link-mutual" />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-sm text-muted-foreground">Follows you</Label>
                        <input type="color" value={singleLinkFollowsYouColor} onChange={(e) => setSingleLinkFollowsYouColor(e.target.value)} className="h-7 w-10 rounded cursor-pointer border" data-testid="input-single-link-follows-you" />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-sm text-muted-foreground">You follow (one-way)</Label>
                        <input type="color" value={singleLinkYouFollowColor} onChange={(e) => setSingleLinkYouFollowColor(e.target.value)} className="h-7 w-10 rounded cursor-pointer border" data-testid="input-single-link-you-follow" />
                      </div>
                    </div>
                  </div>
                )}
                {graphMode === 'multi-highlight' && (
                  <p className="text-sm text-muted-foreground" data-testid="text-multi-highlight-color-info">
                    Selected accounts are highlighted in distinct colors. Shared connections are shown in a neutral color.
                  </p>
                )}
                {(graphMode === 'default' || graphMode === 'blob') && (
                <div className="space-y-2">
                  <Label>Color Scheme</Label>
                  <Select
                    value={colorScheme}
                    onValueChange={(value: 'type' | 'distance' | 'connections') => setColorScheme(value)}
                  >
                    <SelectTrigger data-testid="select-color-scheme">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="type" data-testid="option-color-type">Account Type</SelectItem>
                      <SelectItem value="distance" data-testid="option-color-distance">Distance From</SelectItem>
                      <SelectItem value="connections" data-testid="option-color-connections">Number of Connections</SelectItem>
                    </SelectContent>
                  </Select>
                  {colorScheme === 'distance' && (
                    <div className="space-y-2 pt-1">
                      <Label className="text-sm text-muted-foreground">Distance From Account</Label>
                      <Popover open={distanceSearchOpen} onOpenChange={(open) => { setDistanceSearchOpen(open); if (!open) setDistanceSearchQuery(''); }}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className="w-full justify-start text-left font-normal"
                            data-testid="button-distance-account-search"
                          >
                            {colorSchemeAccountId
                              ? (() => {
                                const account = allSocialAccounts.find(a => a.id === colorSchemeAccountId);
                                return account ? (account.currentProfile?.nickname || account.username) : 'Select account...';
                              })()
                              : 'Select account...'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-0" align="start">
                          <Command shouldFilter={false}>
                            <CommandInput
                              placeholder="Type 3+ characters to search..."
                              value={distanceSearchQuery}
                              onValueChange={setDistanceSearchQuery}
                            />
                            <CommandList>
                              {distanceSearchQuery.length > 0 && distanceSearchQuery.length < 3 && (
                                <div className="p-3 text-sm text-muted-foreground text-center">
                                  Type {3 - distanceSearchQuery.length} more character{3 - distanceSearchQuery.length > 1 ? 's' : ''} to search...
                                </div>
                              )}
                              {distanceSearchQuery.length >= 3 && (() => {
                                const query = distanceSearchQuery.toLowerCase();
                                const filtered = allSocialAccounts.filter(a =>
                                  a.username.toLowerCase().includes(query) ||
                                  (a.currentProfile?.nickname && a.currentProfile?.nickname.toLowerCase().includes(query))
                                ).slice(0, 50);
                                if (filtered.length === 0) return <CommandEmpty>No account found.</CommandEmpty>;
                                return (
                                  <CommandGroup>
                                    {filtered.map((account) => (
                                      <CommandItem
                                        key={account.id}
                                        value={account.id}
                                        onSelect={() => {
                                          setColorSchemeAccountId(account.id);
                                          setDistanceSearchOpen(false);
                                          setDistanceSearchQuery('');
                                        }}
                                        data-testid={`option-distance-account-${account.id}`}
                                      >
                                        {account.currentProfile?.nickname || account.username}
                                        {account.currentProfile?.nickname && (
                                          <span className="ml-1 text-muted-foreground">@{account.username}</span>
                                        )}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                );
                              })()}
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">Selected account</Label>
                          <input type="color" value={distanceColorSelf} onChange={(e) => setDistanceColorSelf(e.target.value)} className="h-7 w-10 rounded cursor-pointer border" data-testid="input-distance-color-self" />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">Directly linked</Label>
                          <input type="color" value={distanceColorDirect} onChange={(e) => setDistanceColorDirect(e.target.value)} className="h-7 w-10 rounded cursor-pointer border" data-testid="input-distance-color-direct" />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">2nd degree</Label>
                          <input type="color" value={distanceColor2nd} onChange={(e) => setDistanceColor2nd(e.target.value)} className="h-7 w-10 rounded cursor-pointer border" data-testid="input-distance-color-2nd" />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">Other</Label>
                          <input type="color" value={distanceColorOther} onChange={(e) => setDistanceColorOther(e.target.value)} className="h-7 w-10 rounded cursor-pointer border" data-testid="input-distance-color-other" />
                        </div>
                      </div>
                    </div>
                  )}
                  {colorScheme === 'connections' && (
                    <div className="space-y-3 pt-1">
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">Most Connections</Label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={connectionsColorMax}
                            onChange={(e) => setConnectionsColorMax(e.target.value)}
                            className="w-9 h-9 rounded-md border cursor-pointer"
                            data-testid="input-color-max"
                          />
                          <span className="text-xs text-muted-foreground font-mono">{connectionsColorMax}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">Least Connections</Label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={connectionsColorMin}
                            onChange={(e) => setConnectionsColorMin(e.target.value)}
                            className="w-9 h-9 rounded-md border cursor-pointer"
                            data-testid="input-color-min"
                          />
                          <span className="text-xs text-muted-foreground font-mono">{connectionsColorMin}</span>
                        </div>
                      </div>
                      <div className="space-y-1 pt-1">
                        <Label className="text-xs text-muted-foreground">Preview</Label>
                        <div
                          className="h-3 rounded-full"
                          style={{
                            background: `linear-gradient(to right, ${connectionsColorMin}, ${connectionsColorMax})`,
                          }}
                          data-testid="gradient-preview"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Few</span>
                          <span>Many</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                )}

                <div className="space-y-3 pt-2 border-t">
                  <Label>Line Colors</Label>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground">Mutual</Label>
                      <input
                        type="color"
                        value={linkMutualColor}
                        onChange={(e) => setLinkMutualColor(e.target.value)}
                        className="h-7 w-10 rounded cursor-pointer border"
                        data-testid="input-link-mutual-color"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground">One-way</Label>
                      <input
                        type="color"
                        value={linkDefaultColor}
                        onChange={(e) => setLinkDefaultColor(e.target.value)}
                        className="h-7 w-10 rounded cursor-pointer border"
                        data-testid="input-link-default-color"
                      />
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            <div className="pt-2 border-t space-y-2">
              <Button
                className="w-full"
                onClick={handleUpdateGraph}
                disabled={isGraphLoading}
                data-testid="button-update-graph"
              >
                {isGraphLoading ? "Updating..." : "Update Graph"}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleResetCamera}
                data-testid="button-reset-camera"
              >
                Reset Camera
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleZoomToFit}
                data-testid="button-zoom-fit"
              >
                Zoom to Fit
              </Button>
            </div>
          </div>
        )}

        {contextMenu && (() => {
          const ctxAccount = allSocialAccounts.find(a => a.id === contextMenu.accountId);
          const ctxName = ctxAccount ? (ctxAccount.currentProfile?.nickname || ctxAccount.username) : 'Unknown';
          const isInSingleHighlight = graphMode === 'single-highlight' && singleHighlightAccountId === contextMenu.accountId;
          const isInMultiHighlight = graphMode === 'multi-highlight' && multiHighlightAccountIds.includes(contextMenu.accountId);
          const isHighlighted = isInSingleHighlight || isInMultiHighlight;
          return (
            <div
              className="fixed bg-popover border rounded-md shadow-lg py-1 z-[100] min-w-[180px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
              data-testid="context-menu"
            >
              <button
                className="w-full text-left px-3 py-1.5 text-sm font-medium hover-elevate"
                onClick={() => {
                  setSelectedAccountId(contextMenu.accountId);
                  setContextMenu(null);
                }}
                data-testid="context-menu-name"
              >
                {ctxName}
              </button>
              <div className="border-t my-1" />
              <button
                className="w-full text-left px-3 py-1.5 text-sm hover-elevate"
                onClick={() => {
                  if (graphMode === 'multi-highlight') {
                    if (!multiHighlightAccountIds.includes(contextMenu.accountId)) {
                      setMultiHighlightAccountIds(prev => [...prev, contextMenu.accountId]);
                    }
                  } else if (graphMode === 'single-highlight' && singleHighlightAccountId) {
                    setGraphMode('multi-highlight');
                    setMultiHighlightAccountIds([singleHighlightAccountId, contextMenu.accountId]);
                    setSingleHighlightAccountId(null);
                  } else {
                    setGraphMode('single-highlight');
                    setSingleHighlightAccountId(contextMenu.accountId);
                  }
                  setContextMenu(null);
                }}
                data-testid="context-menu-highlight"
              >
                {graphMode === 'multi-highlight' || (graphMode === 'single-highlight' && singleHighlightAccountId) ? 'Add to Highlight' : 'Highlight'}
              </button>
              {isHighlighted && (
                <button
                  className="w-full text-left px-3 py-1.5 text-sm hover-elevate"
                  onClick={() => {
                    if (graphMode === 'single-highlight') {
                      setSingleHighlightAccountId(null);
                      setGraphMode('blob');
                      setMinConnections(3);
                    } else if (graphMode === 'multi-highlight') {
                      const remaining = multiHighlightAccountIds.filter(id => id !== contextMenu.accountId);
                      if (remaining.length === 0) {
                        setMultiHighlightAccountIds([]);
                        setGraphMode('blob');
                        setMinConnections(3);
                      } else if (remaining.length === 1) {
                        setMultiHighlightAccountIds([]);
                        setGraphMode('single-highlight');
                        setSingleHighlightAccountId(remaining[0]);
                      } else {
                        setMultiHighlightAccountIds(remaining);
                      }
                    }
                    setContextMenu(null);
                  }}
                  data-testid="context-menu-remove-highlight"
                >
                  Remove from Highlight
                </button>
              )}
              <button
                className="w-full text-left px-3 py-1.5 text-sm hover-elevate"
                onClick={() => {
                  setGraphMode('blob');
                  setMinConnections(3);
                  setColorScheme('distance');
                  setColorSchemeAccountId(contextMenu.accountId);
                  setContextMenu(null);
                }}
                data-testid="context-menu-distance-from"
              >
                Distance From
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
