import { useEffect, useRef, useState } from "react";
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { SocialAccount, SocialAccountType } from "@shared/schema";

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
  const [limitExtras, setLimitExtras] = useState(false);
  const [maxExtras, setMaxExtras] = useState(20);
  const [highlightedAccountId, setHighlightedAccountId] = useState<string | null>(null);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const extrasSteps = [5, 10, 20, 50, 100];

  const { data: socialAccounts } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
  });

  const { data: socialAccountTypes } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  const allSocialAccounts = socialAccounts || [];

  const typeColorMap = new Map<string, string>();
  if (socialAccountTypes) {
    socialAccountTypes.forEach(t => {
      if (t.color) typeColorMap.set(t.id, t.color);
    });
  }

  const uniqueConnectionCounts = new Map<string, number>();
  const allAccountIds = new Set(allSocialAccounts.map(a => a.id));
  allSocialAccounts.forEach(account => {
    const connectedPeers = new Set<string>();
    if (account.following) {
      account.following.forEach(id => {
        if (allAccountIds.has(id)) connectedPeers.add(id);
      });
    }
    allSocialAccounts.forEach(other => {
      if (other.following && other.following.includes(account.id)) {
        connectedPeers.add(other.id);
      }
    });
    uniqueConnectionCounts.set(account.id, connectedPeers.size);
  });

  let filteredSocialAccounts = allSocialAccounts;

  if (hideOrphans) {
    filteredSocialAccounts = filteredSocialAccounts.filter(account => {
      return (uniqueConnectionCounts.get(account.id) || 0) > 0;
    });
  }

  if (minTwoConnections) {
    filteredSocialAccounts = filteredSocialAccounts.filter(account => {
      return (uniqueConnectionCounts.get(account.id) || 0) >= 2;
    });
  }

  if (limitExtras && !minTwoConnections) {
    const safeIds = new Set<string>();
    const extraIds = new Set<string>();
    filteredSocialAccounts.forEach(account => {
      const count = uniqueConnectionCounts.get(account.id) || 0;
      if (count >= 2) {
        safeIds.add(account.id);
      } else {
        extraIds.add(account.id);
      }
    });

    const claimedExtras = new Set<string>();
    const filteredIds = new Set(filteredSocialAccounts.map(a => a.id));

    const directConnections = new Map<string, Set<string>>();
    filteredSocialAccounts.forEach(account => {
      const peers = new Set<string>();
      if (account.following) {
        account.following.forEach(id => {
          if (filteredIds.has(id)) peers.add(id);
        });
      }
      filteredSocialAccounts.forEach(other => {
        if (other.following && other.following.includes(account.id)) {
          peers.add(other.id);
        }
      });
      directConnections.set(account.id, peers);
    });

    const sortedSafeIds = Array.from(safeIds).sort();
    sortedSafeIds.forEach(safeId => {
      const peers = directConnections.get(safeId) || new Set();
      const sortedPeers = Array.from(peers).sort();
      let claimed = 0;
      sortedPeers.forEach(peerId => {
        if (claimed >= maxExtras) return;
        if (extraIds.has(peerId) && !claimedExtras.has(peerId)) {
          claimedExtras.add(peerId);
          claimed++;
        }
      });
    });

    filteredSocialAccounts = filteredSocialAccounts.filter(account => {
      return safeIds.has(account.id) || claimedExtras.has(account.id);
    });
  }

  useEffect(() => {
    if (!graphRef.current) return;
    if (!filteredSocialAccounts.length) return;

    const accountIds = new Set(filteredSocialAccounts.map(a => a.id));

    let nodes: GraphNode[] = filteredSocialAccounts.map(account => {
      const typeColor = account.typeId ? typeColorMap.get(account.typeId) : null;
      return {
        id: account.id,
        name: account.nickname || account.username,
        type: 'social-account' as const,
        color: typeColor || '#10b981',
        val: 10,
      };
    });

    let links: GraphLink[] = [];
    const mutualPairs = new Set<string>();

    filteredSocialAccounts.forEach(account => {
      if (account.following) {
        account.following.forEach(followedId => {
          if (!accountIds.has(followedId)) return;

          const followedAccount = filteredSocialAccounts.find(a => a.id === followedId);
          const isMutual = followedAccount?.following?.includes(account.id) || false;

          if (isMutual) {
            const pairKey = [account.id, followedId].sort().join('-');
            if (mutualPairs.has(pairKey)) return;
            mutualPairs.add(pairKey);

            links.push({
              source: account.id,
              target: followedId,
              type: 'follows' as const,
              color: '#6366f1',
              mutual: true,
            });
          } else {
            links.push({
              source: account.id,
              target: followedId,
              type: 'follows' as const,
              color: '#6b7280',
              mutual: false,
            });
          }
        });
      }
    });

    if (highlightedAccountId) {
      const connectedIds = new Set<string>([highlightedAccountId]);

      filteredSocialAccounts.forEach(account => {
        if (account.following?.includes(highlightedAccountId)) {
          connectedIds.add(account.id);
        }
      });

      const highlightedAccount = filteredSocialAccounts.find(a => a.id === highlightedAccountId);
      if (highlightedAccount?.following) {
        highlightedAccount.following.forEach(id => {
          if (accountIds.has(id)) connectedIds.add(id);
        });
      }

      nodes = nodes.filter(node => connectedIds.has(node.id));
      links = links.filter(link => {
        const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;
        return connectedIds.has(sourceId) && connectedIds.has(targetId);
      });
    }

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

      fgRef.current = fg;
    } else {
      fgRef.current.graphData(gData);
    }

    return () => {
      if (fgRef.current) {
        fgRef.current._destructor();
        fgRef.current = null;
      }
      materialCacheRef.current.forEach(m => m.dispose());
      materialCacheRef.current.clear();
    };
  }, [filteredSocialAccounts, socialAccountTypes, navigate, highlightedAccountId, limitExtras, maxExtras]);

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

  const searchAccounts = filteredSocialAccounts;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
        <div>
          <h1 className="text-sm md:text-2xl font-semibold" data-testid="text-page-title">
            3D Social Account Graph
          </h1>
        </div>
        <div className="flex items-center gap-2">
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
                          ? searchAccounts.find(a => a.id === highlightedAccountId)
                            ? (searchAccounts.find(a => a.id === highlightedAccountId)!.nickname || searchAccounts.find(a => a.id === highlightedAccountId)!.username)
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
                            {searchAccounts.map((account) => (
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
