import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Settings, X, Filter, Palette, Users } from "lucide-react";
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
import type { SocialAccount, SocialAccountType, SocialAccountWithCurrentProfile, SocialGraphData, Group } from "@shared/schema";
import PersonGraphView from "./person-graph-view";
import {
  EXTRAS_STEPS,
  MERGE_MULTIPLIER_STEPS,
  getInitialGraphSettings,
} from "@/lib/social-graph-defaults";

type ViewMode = 'person' | 'social' | 'hybrid';

function parseGraphUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('view');
  const view: ViewMode = raw === 'person' || raw === 'hybrid' ? raw : 'social';
  return {
    view,
    selected: params.get('selected'),
  };
}

function buildGraphUrl(view: ViewMode, selected: string | null): string {
  const params = new URLSearchParams(window.location.search);
  params.set('view', view);
  if (selected) {
    params.set('selected', selected);
  } else {
    params.delete('selected');
  }
  const qs = params.toString();
  return `/social-graph-3d${qs ? `?${qs}` : ''}`;
}

function syncGraphUrl(view: ViewMode, selected: string | null, mode: 'push' | 'replace' = 'replace') {
  const newUrl = buildGraphUrl(view, selected);
  if (window.location.pathname + window.location.search !== newUrl) {
    if (mode === 'push') {
      window.history.pushState(null, '', newUrl);
    } else {
      window.history.replaceState(null, '', newUrl);
    }
  }
}

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
  const initial = parseGraphUrl();
  const [viewMode, setViewModeState] = useState<ViewMode>(initial.view);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    initial.view === 'social' ? initial.selected : null
  );
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(
    initial.view === 'person' ? initial.selected : null
  );

  const setViewMode = useCallback(
    (v: ViewMode, selected?: string | null) => {
      setViewModeState(v);
      if (v === 'person') {
        const target = selected !== undefined ? selected : selectedPersonId;
        setSelectedPersonId(target);
        syncGraphUrl(v, target, 'push');
      } else if (v === 'social') {
        const target = selected !== undefined ? selected : selectedAccountId;
        setSelectedAccountId(target);
        syncGraphUrl(v, target, 'push');
      } else {
        // hybrid: preserve existing selections, just sync view in URL.
        syncGraphUrl(v, null, 'push');
      }
    },
    [selectedPersonId, selectedAccountId]
  );

  // Mirror selection changes from inside views into the URL via push so
  // the browser back button restores the previous selection.
  useEffect(() => {
    if (viewMode === 'hybrid') return;
    const next = viewMode === 'person' ? selectedPersonId : selectedAccountId;
    syncGraphUrl(viewMode, next, 'push');
  }, [viewMode, selectedAccountId, selectedPersonId]);

  // React to browser back/forward by re-reading URL into state.
  useEffect(() => {
    const onPop = () => {
      const parsed = parseGraphUrl();
      setViewModeState(parsed.view);
      if (parsed.view === 'person') {
        setSelectedPersonId(parsed.selected);
      } else {
        setSelectedAccountId(parsed.selected);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return (
    <>
      <ViewModeHeaderControl viewMode={viewMode} setViewMode={setViewMode} />
      {viewMode === 'person' ? (
        <PersonGraphView
          viewMode={viewMode}
          setViewMode={setViewMode}
          selectedPersonId={selectedPersonId}
          setSelectedPersonId={setSelectedPersonId}
        />
      ) : viewMode === 'hybrid' ? (
        <div
          className="flex h-full w-full items-center justify-center p-6"
          data-testid="placeholder-hybrid-view"
        >
          <Card className="max-w-md p-6 text-center space-y-3">
            <h2 className="text-lg font-semibold">Hybrid view is coming soon</h2>
            <p className="text-sm text-muted-foreground">
              We're working on a unified hybrid graph that shows people and their
              social accounts together. For now, choose Person or Social Account.
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setViewMode('person')}
                data-testid="button-switch-person"
              >
                Open Person view
              </Button>
              <Button
                onClick={() => setViewMode('social')}
                data-testid="button-switch-social"
              >
                Open Social view
              </Button>
            </div>
          </Card>
        </div>
      ) : (
        <SocialGraphContent
          viewMode={viewMode}
          setViewMode={setViewMode}
          selectedAccountId={selectedAccountId}
          setSelectedAccountId={setSelectedAccountId}
        />
      )}
    </>
  );
}

interface ViewModeHeaderControlProps {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode, selected?: string | null) => void;
}

function ViewModeHeaderControl({ viewMode, setViewMode }: ViewModeHeaderControlProps) {
  // Portal the view-mode dropdown into the app's top-bar contextual-actions
  // slot so it sits next to the page title regardless of which view we render.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.getElementById('header-contextual-actions'));
  }, []);
  if (!host) return null;
  return createPortal(
    <Select
      value={viewMode}
      onValueChange={(v) => {
        if (v === 'person' || v === 'social' || v === 'hybrid') {
          setViewMode(v as ViewMode);
        }
      }}
    >
      <SelectTrigger
        className="h-8 w-[180px]"
        data-testid="select-view-mode"
        aria-label="Graph view mode"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="person" data-testid="option-view-person">
          Person
        </SelectItem>
        <SelectItem value="social" data-testid="option-view-social">
          Social Account
        </SelectItem>
        <SelectItem value="hybrid" disabled data-testid="option-view-hybrid">
          Hybrid (coming soon)
        </SelectItem>
      </SelectContent>
    </Select>,
    host,
  );
}

interface SocialGraphContentProps {
  viewMode: 'person' | 'social';
  setViewMode: (v: 'person' | 'social', selected?: string | null) => void;
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
}

function SocialGraphContent({
  viewMode,
  setViewMode,
  selectedAccountId,
  setSelectedAccountId,
}: SocialGraphContentProps) {
  const graphRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const materialCacheRef = useRef<Map<string, THREE.LineBasicMaterial>>(new Map());
  const [, navigate] = useLocation();

  // Load saved defaults once on first render. URL params (e.g. `?view=...`)
  // override these — see getInitialGraphSettings().
  const initialDefaultsRef = useRef(getInitialGraphSettings());
  const initialDefaults = initialDefaultsRef.current;

  const [hideOrphans, setHideOrphans] = useState(initialDefaults.hideOrphans);
  const [minConnections, setMinConnections] = useState(initialDefaults.minConnections);
  const [limitExtras, setLimitExtras] = useState(initialDefaults.limitExtras);
  const [maxExtras, setMaxExtras] = useState(initialDefaults.maxExtras);
  const [colorScheme, setColorScheme] = useState<'type' | 'distance' | 'connections'>(initialDefaults.colorScheme);
  const [colorSchemeAccountId, setColorSchemeAccountId] = useState<string | null>(initialDefaults.colorSchemeAccountId);
  const [distanceSearchOpen, setDistanceSearchOpen] = useState(false);
  const [distanceSearchQuery, setDistanceSearchQuery] = useState('');
  const [connectionsColorMax, setConnectionsColorMax] = useState(initialDefaults.connectionsColorMax);
  const [connectionsColorMin, setConnectionsColorMin] = useState(initialDefaults.connectionsColorMin);
  const [linkMutualColor, setLinkMutualColor] = useState(initialDefaults.linkMutualColor);
  const [linkDefaultColor, setLinkDefaultColor] = useState(initialDefaults.linkDefaultColor);
  const [distanceColorSelf, setDistanceColorSelf] = useState(initialDefaults.distanceColorSelf);
  const [distanceColorDirect, setDistanceColorDirect] = useState(initialDefaults.distanceColorDirect);
  const [distanceColor2nd, setDistanceColor2nd] = useState(initialDefaults.distanceColor2nd);
  const [distanceColorOther, setDistanceColorOther] = useState(initialDefaults.distanceColorOther);
  const [singleLinkMutualColor, setSingleLinkMutualColor] = useState(initialDefaults.singleLinkMutualColor);
  const [singleLinkFollowsYouColor, setSingleLinkFollowsYouColor] = useState(initialDefaults.singleLinkFollowsYouColor);
  const [singleLinkYouFollowColor, setSingleLinkYouFollowColor] = useState(initialDefaults.singleLinkYouFollowColor);
  const [singleNodeColorScheme, setSingleNodeColorScheme] = useState<'follow-status' | 'type'>(initialDefaults.singleNodeColorScheme);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [graphMode, setGraphMode] = useState<'default' | 'blob' | 'single-highlight' | 'multi-highlight'>(initialDefaults.defaultMode);
  const [singleHighlightAccountId, setSingleHighlightAccountId] = useState<string | null>(initialDefaults.defaultSingleAccountId);
  const [singleHighlightSearchOpen, setSingleHighlightSearchOpen] = useState(false);
  const [singleHighlightSearchQuery, setSingleHighlightSearchQuery] = useState('');
  const [singleShowFriendLinks, setSingleShowFriendLinks] = useState(initialDefaults.singleShowFriendLinks);
  const [singleRemoveExtras, setSingleRemoveExtras] = useState(initialDefaults.singleRemoveExtras);
  const [multiHighlightAccountIds, setMultiHighlightAccountIds] = useState<string[]>([]);
  const [multiHighlightSearchOpen, setMultiHighlightSearchOpen] = useState(false);
  const [multiHighlightSearchQuery, setMultiHighlightSearchQuery] = useState('');
  const [multiHighlightColor, setMultiHighlightColor] = useState(initialDefaults.multiHighlightColor);
  const [multiFollowsAllColor, setMultiFollowsAllColor] = useState(initialDefaults.multiFollowsAllColor);
  const [multiFollowsOneColor, setMultiFollowsOneColor] = useState(initialDefaults.multiFollowsOneColor);
  const [blobMergeMultiplier, setBlobMergeMultiplier] = useState(initialDefaults.blobMergeMultiplier);
  const [blobForceMultiplier, setBlobForceMultiplier] = useState(initialDefaults.blobForceMultiplier);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; accountId: string } | null>(null);
  const [showCrowds, setShowCrowds] = useState(true);
  const [minFollowIntersection, setMinFollowIntersection] = useState(5);
  const [crowdColorScheme, setCrowdColorScheme] = useState<'pastel' | 'emerald' | 'amber' | 'sky'>('pastel');
  const crowdSphereMeshRef = useRef<THREE.Mesh | null>(null);
  const [highlightedGroupId, setHighlightedGroupId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('highlightGroup')
  );

  const { data: groupsList } = useQuery<Group[]>({
    queryKey: ['/api/groups'],
  });

  const extrasSteps = EXTRAS_STEPS;
  const mergeMultiplierSteps = MERGE_MULTIPLIER_STEPS;

  const [appliedSettings, setAppliedSettings] = useState({
    hideOrphans,
    minConnections: 3,
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

  const { data: socialAccounts } = useQuery<SocialAccountWithCurrentProfile[]>({
    queryKey: ["/api/social-accounts"],
  });

  const { data: socialAccountTypes } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  const allSocialAccounts = socialAccounts || [];
  const selectedAccount = selectedAccountId ? allSocialAccounts.find(a => a.id === selectedAccountId) : null;
  const selectedAccountType = selectedAccount?.typeId && socialAccountTypes ? socialAccountTypes.find(t => t.id === selectedAccount.typeId) : null;

  // Owner info comes from the social-graph response payload — no extra round-trip.
  const selectedAccountNode = selectedAccountId
    ? graphData?.nodes.find(n => n.id === selectedAccountId)
    : null;
  const selectedAccountOwner = selectedAccountNode?.ownerPersonId
    ? {
        id: selectedAccountNode.ownerPersonId,
        name: selectedAccountNode.ownerName ?? '',
        imageUrl: selectedAccountNode.ownerImageUrl ?? null,
      }
    : null;

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

    if (graphMode === 'multi-highlight' && multiHighlightAccountIds.length >= 2) {
      const highlightedSet = new Set(multiHighlightAccountIds);
      graphData.nodes.forEach(n => {
        if (highlightedSet.has(n.id)) {
          colorMap.set(n.id, multiHighlightColor);
          return;
        }
        let matchCount = 0;
        highlightedSet.forEach(hId => {
          const connected = graphData.links.some(l => {
            const src = typeof l.source === 'string' ? l.source : (l.source as any).id;
            const tgt = typeof l.target === 'string' ? l.target : (l.target as any).id;
            return (src === n.id && tgt === hId) || (src === hId && tgt === n.id);
          });
          if (connected) matchCount++;
        });
        if (matchCount === highlightedSet.size) {
          colorMap.set(n.id, multiFollowsAllColor);
        } else if (matchCount === 1) {
          colorMap.set(n.id, multiFollowsOneColor);
        }
      });
      return colorMap;
    }

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
  }, [graphData, colorScheme, colorSchemeAccountId, connectionsColorMin, connectionsColorMax, interpolateColor, computeDistances, distanceColorSelf, distanceColorDirect, distanceColor2nd, distanceColorOther, graphMode, singleHighlightAccountId, singleNodeColorScheme, singleLinkMutualColor, singleLinkFollowsYouColor, singleLinkYouFollowColor, multiHighlightAccountIds, multiHighlightColor, multiFollowsAllColor, multiFollowsOneColor]);

  useEffect(() => {
    if (!graphRef.current || !graphData || !graphData.nodes.length) return;

    const group = highlightedGroupId ? groupsList?.find((g) => g.id === highlightedGroupId) : null;
    const centerAccountId = group?.centerAccountId;

    const crowdColorMap = {
      pastel: "#a7f3d0",
      emerald: "#10b981",
      amber: "#f59e0b",
      sky: "#0ea5e9",
    };
    const crowdColor = crowdColorMap[crowdColorScheme];

    const centerFollowers = new Set<string>();
    if (centerAccountId) {
      graphData.links.forEach(l => {
        const src = typeof l.source === 'string' ? l.source : (l.source as any).id;
        const tgt = typeof l.target === 'string' ? l.target : (l.target as any).id;
        if (tgt === centerAccountId) {
          centerFollowers.add(src);
        }
      });
    }

    const colorMap = computeColorMap();
    nodeColorMapRef.current = colorMap;

    const nodes: GraphNode[] = graphData.nodes.map(n => {
      let label = n.name;
      if (n.mergedNames && n.mergedNames.length > 0) {
        label = `${n.name} (+${n.mergedNames.length} merged)`;
      }

      const isCenter = n.id === centerAccountId;
      const isMember = n.ownerPersonId && group?.members?.includes(n.ownerPersonId) || false;
      const isCrowd = n.ownerPersonId && group?.crowdMembers?.includes(n.ownerPersonId) || false;

      let color = colorMap.get(n.id) || n.typeColor;
      if (highlightedGroupId && group) {
        if (isMember) {
          color = group.color || "#8b5cf6";
        } else if (isCenter) {
          color = "#ec4899";
        } else if (isCrowd && showCrowds) {
          color = crowdColor;
        }
      }

      return {
        id: n.id,
        name: label,
        type: 'social-account' as const,
        color,
        val: graphMode === 'blob' ? (n.size - 50 + 1) * n.val : (isCenter ? 15 : (isMember ? 12 : (isCrowd && showCrowds ? 8 : n.val))),
        isCenter,
        isCrowd: isCrowd && showCrowds,
      };
    });

    const targetId = appliedSettings.singleHighlightAccountId;
    const isSingleMode = appliedSettings.mode === 'single-highlight' && targetId;

    const links: GraphLink[] = graphData.links.map(l => {
      const src = typeof l.source === 'string' ? l.source : (l.source as any).id;
      const tgt = typeof l.target === 'string' ? l.target : (l.target as any).id;

      const srcNode = graphData.nodes.find(n => n.id === src);
      const isSrcCrowd = (srcNode?.ownerPersonId && group?.crowdMembers?.includes(srcNode.ownerPersonId)) || false;
      const isTgtCenterFollower = centerFollowers.has(tgt);
      
      const isCrowdLink = highlightedGroupId && showCrowds && isSrcCrowd && isTgtCenterFollower;

      let color: string;
      if (isCrowdLink) {
        color = crowdColor;
      } else if (isSingleMode && (src === targetId || tgt === targetId)) {
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
      return { source: src, target: tgt, type: 'follows' as const, color, mutual: l.mutual, isCrowdLink };
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

    const getMaterial = (color: string, dashed = false) => {
      const cache = materialCacheRef.current;
      const key = `${color}-${dashed}`;
      if (!cache.has(key)) {
        cache.set(key, dashed
          ? new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.8 })
          : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 })
        );
      }
      return cache.get(key)!;
    };

    const updateBoundingSphere = () => {
      if (!fgRef.current || !showCrowds || !group || !group.crowdMembers || group.crowdMembers.length === 0) {
        if (crowdSphereMeshRef.current) {
          fgRef.current.scene().remove(crowdSphereMeshRef.current);
          crowdSphereMeshRef.current = null;
        }
        return;
      }

      const graphNodes = fgRef.current.graphData().nodes as any[];
      const crowdNodes = graphNodes.filter(n => {
        const ownerId = graphData.nodes.find(dn => dn.id === n.id)?.ownerPersonId;
        return ownerId && group.crowdMembers?.includes(ownerId) && n.x !== undefined;
      });

      if (crowdNodes.length === 0) {
        if (crowdSphereMeshRef.current) {
          fgRef.current.scene().remove(crowdSphereMeshRef.current);
          crowdSphereMeshRef.current = null;
        }
        return;
      }

      let sumX = 0, sumY = 0, sumZ = 0;
      for (const n of crowdNodes) {
        sumX += n.x;
        sumY += n.y;
        sumZ += n.z;
      }
      const centroidX = sumX / crowdNodes.length;
      const centroidY = sumY / crowdNodes.length;
      const centroidZ = sumZ / crowdNodes.length;

      const distances = crowdNodes.map(n => {
        const dx = n.x - centroidX;
        const dy = n.y - centroidY;
        const dz = n.z - centroidZ;
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
      });
      distances.sort((a, b) => a - b);
      const percentileIndex = Math.min(distances.length - 1, Math.floor(distances.length * 0.9));
      const radius = Math.max(15, distances[percentileIndex] || 15);

      if (!crowdSphereMeshRef.current) {
        const geom = new THREE.SphereGeometry(1, 32, 32);
        const mat = new THREE.MeshBasicMaterial({
          color: crowdColor,
          transparent: true,
          opacity: 0.15,
          wireframe: true,
        });
        const mesh = new THREE.Mesh(geom, mat);
        fgRef.current.scene().add(mesh);
        crowdSphereMeshRef.current = mesh;
      }

      const mesh = crowdSphereMeshRef.current;
      mesh.position.set(centroidX, centroidY, centroidZ);
      mesh.scale.set(radius, radius, radius);
      (mesh.material as THREE.MeshBasicMaterial).color.set(crowdColor);
    };

    if (!fgRef.current) {
      const fg = (ForceGraph3D as any)({
        controlType: 'orbit',
        rendererConfig: { antialias: true, alpha: true },
      })(graphRef.current)
        .graphData(gData)
        .backgroundColor(bgColor)
        .nodeLabel('name')
        .nodeThreeObject((node: any) => {
          if (node.isCenter) {
            const groupMesh = new THREE.Group();
            const sphereMat = new THREE.MeshBasicMaterial({
              color: node.color || "#ec4899",
              transparent: true,
              opacity: 0.5,
            });
            const sphereMesh = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 16), sphereMat);
            groupMesh.add(sphereMesh);

            const ringMat = new THREE.MeshBasicMaterial({
              color: node.color || "#ec4899",
              side: THREE.DoubleSide,
            });
            const ringMesh = new THREE.Mesh(new THREE.RingGeometry(7, 8, 32), ringMat);
            groupMesh.add(ringMesh);
            return groupMesh;
          }

          const mat = new THREE.MeshLambertMaterial({
            color: node.color || "#10b981",
            transparent: node.isCrowd,
            opacity: node.isCrowd ? 0.6 : 1.0,
          });
          return new THREE.Mesh(new THREE.SphereGeometry(4, 16, 16), mat);
        })
        .nodeVal('val')
        .enableNodeDrag(true)
        .enableNavigationControls(true)
        .showNavInfo(false)
        .linkThreeObject((link: any) => {
          const positions = new Float32Array(6);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          const material = getMaterial(link.color || '#6b7280', link.isCrowdLink);
          return link.isCrowdLink 
            ? new THREE.LineSegments(geometry, material)
            : new THREE.Line(geometry, material);
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
          if ((line as any).computeLineDistances) {
            (line as any).computeLineDistances();
          }
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

      (fg as any).onEngineTick(updateBoundingSphere);
      (fg as any).onEngineStop(updateBoundingSphere);

      fgRef.current = fg;
    } else {
      fgRef.current.graphData(gData);
      setTimeout(updateBoundingSphere, 100);
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
        if (crowdSphereMeshRef.current) {
          fgRef.current.scene().remove(crowdSphereMeshRef.current);
          crowdSphereMeshRef.current = null;
        }
        fgRef.current._destructor();
        fgRef.current = null;
      }
      materialCacheRef.current.forEach(m => m.dispose());
      materialCacheRef.current.clear();
    };
  }, [graphData, navigate, graphMode, blobForceMultiplier, linkMutualColor, linkDefaultColor, singleLinkMutualColor, singleLinkFollowsYouColor, singleLinkYouFollowColor, highlightedGroupId, groupsList, showCrowds, crowdColorScheme, minFollowIntersection]);

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
                <Avatar
                  className="h-20 w-20"
                  style={selectedAccountType?.color ? { boxShadow: `0 0 0 2px ${selectedAccountType.color}` } : undefined}
                  data-testid="avatar-sidebar-account"
                >
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
                  <span data-testid="text-sidebar-followers">{selectedAccount.latestState?.followerCount || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Following</span>
                  <span data-testid="text-sidebar-following">{selectedAccount.latestState?.followingCount || 0}</span>
                </div>
                {selectedAccount.currentProfile?.bio && (
                  <div className="pt-2 border-t">
                    <span className="text-muted-foreground">Notes</span>
                    <p className="mt-1 text-xs" data-testid="text-sidebar-notes">{selectedAccount.currentProfile?.bio}</p>
                  </div>
                )}
              </div>
              {selectedAccountOwner && (
                <div className="space-y-2 pt-2 border-t">
                  <Label className="text-xs text-muted-foreground">Owner</Label>
                  <div className="flex flex-col gap-1" data-testid="chips-owner">
                    <button
                      type="button"
                      onClick={() => setViewMode('person', selectedAccountOwner.id)}
                      className="flex items-center gap-2 rounded-md border px-2 py-1 text-left hover-elevate"
                      data-testid={`chip-owner-${selectedAccountOwner.id}`}
                    >
                      <Avatar className="h-6 w-6">
                        {selectedAccountOwner.imageUrl && (
                          <AvatarImage src={selectedAccountOwner.imageUrl} alt={selectedAccountOwner.name} />
                        )}
                        <AvatarFallback className="text-[10px]">
                          {selectedAccountOwner.name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm flex-1 truncate">{selectedAccountOwner.name}</span>
                    </button>
                  </div>
                </div>
              )}
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
          <div className="absolute top-4 right-4 w-80 max-h-[calc(100%-2rem)] overflow-y-auto overscroll-contain bg-background/80 backdrop-blur-sm border rounded-lg shadow-lg p-4 space-y-3 z-50">
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
                  <div className="space-y-2" data-testid="multi-highlight-color-options">
                    <Label>Node Colors</Label>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground">Highlighted</Label>
                      <input type="color" value={multiHighlightColor} onChange={(e) => setMultiHighlightColor(e.target.value)} className="h-7 w-10 rounded cursor-pointer border" data-testid="input-multi-highlight-color" />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground">Follows all highlighted</Label>
                      <input type="color" value={multiFollowsAllColor} onChange={(e) => setMultiFollowsAllColor(e.target.value)} className="h-7 w-10 rounded cursor-pointer border" data-testid="input-multi-follows-all-color" />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground">Follows one highlighted</Label>
                      <input type="color" value={multiFollowsOneColor} onChange={(e) => setMultiFollowsOneColor(e.target.value)} className="h-7 w-10 rounded cursor-pointer border" data-testid="input-multi-follows-one-color" />
                    </div>
                  </div>
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

            <div className="pt-2 border-t space-y-3">
              <h4 className="font-semibold text-xs text-primary uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                Crowds Settings
              </h4>
              <div className="flex items-center justify-between">
                <Label htmlFor="show-crowds" className="text-sm">Show Crowds</Label>
                <Switch
                  id="show-crowds"
                  checked={showCrowds}
                  onCheckedChange={setShowCrowds}
                  data-testid="switch-show-crowds"
                />
              </div>
              {showCrowds && (
                <>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <Label>Min Follows</Label>
                      <span className="font-mono">{minFollowIntersection}</span>
                    </div>
                    <Slider
                      min={1}
                      max={15}
                      step={1}
                      value={[minFollowIntersection]}
                      onValueChange={(val) => setMinFollowIntersection(val[0])}
                      data-testid="slider-min-follow"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="crowd-color-scheme" className="text-xs">Crowd Color</Label>
                    <Select value={crowdColorScheme} onValueChange={(val: any) => setCrowdColorScheme(val)}>
                      <SelectTrigger id="crowd-color-scheme" className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pastel">Pastel Green</SelectItem>
                        <SelectItem value="emerald">Emerald</SelectItem>
                        <SelectItem value="amber">Amber</SelectItem>
                        <SelectItem value="sky">Sky Blue</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>

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
