import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Settings, X } from "lucide-react";
import { useLocation } from "wouter";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
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
import type { SocialAccount, SocialGraphData } from "@shared/schema";

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
  const [minTwoConnections, setMinTwoConnections] = useState(false);
  const [limitExtras, setLimitExtras] = useState(true);
  const [maxExtras, setMaxExtras] = useState(20);
  const [highlightedAccountId, setHighlightedAccountId] = useState<string | null>(null);
  const [colorScheme, setColorScheme] = useState<'type' | 'distance' | 'connections'>('type');
  const [colorSchemeAccountId, setColorSchemeAccountId] = useState<string | null>(null);
  const [distanceSearchOpen, setDistanceSearchOpen] = useState(false);
  const [distanceSearchQuery, setDistanceSearchQuery] = useState('');
  const [connectionsColorMax, setConnectionsColorMax] = useState('#ef4444');
  const [connectionsColorMin, setConnectionsColorMin] = useState('#3b0764');
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [graphMode, setGraphMode] = useState<'default' | 'blob'>('default');
  const [blobMergeMultiplier, setBlobMergeMultiplier] = useState(0.5);
  const [blobForceMultiplier, setBlobForceMultiplier] = useState(2);

  const extrasSteps = [5, 10, 20, 50, 100];
  const mergeMultiplierSteps = [0, 0.15, 0.3, 0.5, 0.75, 1];

  const [appliedSettings, setAppliedSettings] = useState({
    hideOrphans,
    minTwoConnections,
    limitExtras,
    maxExtras,
    highlightedAccountId,
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
      minTwoConnections,
      limitExtras,
      maxExtras,
      highlightedAccountId,
      mode: graphMode,
      blobMergeMultiplier,
    });
  };

  const { data: socialAccounts } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
  });

  const allSocialAccounts = socialAccounts || [];

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

  useEffect(() => {
    if (!graphRef.current) return;
    if (!graphData || !graphData.nodes.length) return;

    const computeNodeColor = (n: SocialGraphData['nodes'][0]): string => {
      if (colorScheme === 'type') {
        return n.typeColor;
      }
      if (colorScheme === 'connections') {
        const counts = graphData.nodes.map(node => node.connectionCount);
        const maxCount = Math.max(...counts, 1);
        const minCount = Math.min(...counts, 0);
        const range = maxCount - minCount || 1;
        const normalized = (n.connectionCount - minCount) / range;
        return interpolateColor(connectionsColorMin, connectionsColorMax, normalized);
      }
      if (colorScheme === 'distance') {
        const targetId = colorSchemeAccountId;
        if (!targetId || !graphData.nodes.find(node => node.id === targetId)) {
          return n.typeColor;
        }
        const adjacency = new Map<string, Set<string>>();
        graphData.nodes.forEach(node => adjacency.set(node.id, new Set()));
        graphData.links.forEach(l => {
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
        const dist = distances.get(n.id);
        const distanceColors: Record<number, string> = { 0: '#ef4444', 1: '#22c55e', 2: '#3b82f6' };
        if (dist !== undefined && dist in distanceColors) return distanceColors[dist];
        return '#9ca3af';
      }
      return n.typeColor;
    };

    const nodes: GraphNode[] = graphData.nodes.map(n => {
      let label = n.name;
      if (n.mergedNames && n.mergedNames.length > 0) {
        label = `${n.name} (+${n.mergedNames.length} merged)`;
      }
      return {
        id: n.id,
        name: label,
        type: 'social-account' as const,
        color: computeNodeColor(n),
        val: graphMode === 'blob' ? (n.size - 50 + 1) * n.val : n.val,
      };
    });

    const linkMutualColor = '#6366f1';
    const linkDefaultColor = '#6b7280';

    const links: GraphLink[] = graphData.links.map(l => ({
      source: typeof l.source === 'string' ? l.source : (l.source as any).id,
      target: typeof l.target === 'string' ? l.target : (l.target as any).id,
      type: 'follows' as const,
      color: l.mutual ? linkMutualColor : linkDefaultColor,
      mutual: l.mutual,
    }));

    const gData = { nodes, links };

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
        .nodeColor('color')
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
          navigate(`/social-accounts/${node.id}?from=social-graph-3d`);
        })
        .onNodeHover((node: any) => {
          graphRef.current!.style.cursor = node ? 'pointer' : 'default';
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
      } catch (_) {}


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
      } catch (_) {}
    }

    return () => {
      if (fgRef.current) {
        fgRef.current._destructor();
        fgRef.current = null;
      }
      materialCacheRef.current.forEach(m => m.dispose());
      materialCacheRef.current.clear();
    };
  }, [graphData, navigate, colorScheme, colorSchemeAccountId, connectionsColorMin, connectionsColorMax, interpolateColor, graphMode, blobForceMultiplier]);

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

      <div className="flex-1 relative">
        <div ref={graphRef} className="w-full h-full" data-testid="canvas-social-graph-3d" />

        {isOptionsOpen && (
          <div className="absolute top-4 right-4 w-80 bg-background border rounded-lg shadow-lg p-4 space-y-4 z-50">
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

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Graph Mode</Label>
                <div className="flex items-center gap-1" data-testid="mode-selector">
                  <Button
                    variant={graphMode === 'default' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setGraphMode('default')}
                    data-testid="button-mode-default"
                  >
                    Default
                  </Button>
                  <Button
                    variant={graphMode === 'blob' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setGraphMode('blob')}
                    data-testid="button-mode-blob"
                  >
                    Blob
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

              <div className="space-y-2">
                <Label>Highlight Account</Label>
                <div className="relative">
                  {highlightedAccountId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute left-0 top-0 h-full z-10 hover:bg-transparent"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHighlightedAccountId(null);
                      }}
                      data-testid="button-clear-account-highlight"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                  <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left font-normal"
                        style={{ paddingLeft: highlightedAccountId ? '2.5rem' : undefined }}
                        data-testid="button-account-search"
                      >
                        {highlightedAccountId
                          ? allSocialAccounts.find(a => a.id === highlightedAccountId)
                            ? (allSocialAccounts.find(a => a.id === highlightedAccountId)!.nickname || allSocialAccounts.find(a => a.id === highlightedAccountId)!.username)
                            : 'Select account...'
                          : 'Select account...'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search accounts..." />
                        <CommandList>
                          <CommandEmpty>No account found.</CommandEmpty>
                          <CommandGroup>
                            {allSocialAccounts.map((account) => (
                              <CommandItem
                                key={account.id}
                                value={`${account.username} ${account.nickname || ''}`}
                                onSelect={() => {
                                  setHighlightedAccountId(account.id);
                                  setSearchOpen(false);
                                }}
                                data-testid={`option-account-${account.id}`}
                              >
                                {account.nickname || account.username}
                                {account.nickname && (
                                  <span className="ml-1 text-muted-foreground">@{account.username}</span>
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

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
                                return account ? (account.nickname || account.username) : 'Select account...';
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
                                (a.nickname && a.nickname.toLowerCase().includes(query))
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
                                      {account.nickname || account.username}
                                      {account.nickname && (
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
                    <div className="text-xs text-muted-foreground space-y-1 pt-1">
                      <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: '#ef4444' }} />Selected account</div>
                      <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: '#22c55e' }} />Directly linked</div>
                      <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: '#3b82f6' }} />2nd degree</div>
                      <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: '#9ca3af' }} />Other</div>
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

              <div className="flex items-center justify-between">
                <Label htmlFor="hide-orphans">Hide Orphans</Label>
                <Switch
                  id="hide-orphans"
                  checked={hideOrphans}
                  onCheckedChange={setHideOrphans}
                  data-testid="switch-hide-orphans"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="min-two-connections">2+ Connections</Label>
                <Switch
                  id="min-two-connections"
                  checked={minTwoConnections}
                  onCheckedChange={setMinTwoConnections}
                  data-testid="switch-min-two-connections"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="limit-extras" className={minTwoConnections ? "text-muted-foreground" : ""}>
                  Limit Extras
                </Label>
                <Switch
                  id="limit-extras"
                  checked={limitExtras}
                  onCheckedChange={setLimitExtras}
                  disabled={minTwoConnections}
                  data-testid="switch-limit-extras"
                />
              </div>

              {limitExtras && !minTwoConnections && (
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

              <div className="pt-4 border-t space-y-2">
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
          </div>
        )}
      </div>
    </div>
  );
}
