import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Settings, X, Filter, Palette, Users, Gauge } from "lucide-react";
import { useLocation } from "wouter";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { SocialAccount, SocialAccountType, SocialAccountWithCurrentProfile, SocialGraphData, Group, Person } from "@shared/schema";
import PersonGraphView from "./person-graph-view";
import {
  EXTRAS_STEPS,
  MERGE_MULTIPLIER_STEPS,
  NODE_SEGMENT_STEPS,
  DENSE_THRESHOLD_STEPS,
  getInitialGraphSettings,
  resolveArrowsEnabled,
  resolveDenseEnabled,
  type DenseModeSetting,
  type LinkArrowMode,
} from "@/lib/social-graph-defaults";
import { GraphResourceCache, applyRendererPerfSettings } from "@/lib/graph-three-resources";
import { DenseGraphRenderer } from "@/lib/dense-graph-renderer";
import GraphLayoutWorker from "@/lib/graph-layout.worker?worker";
import type { LayoutRequest } from "@/lib/graph-layout.worker";

type ViewMode = 'person' | 'social' | 'hybrid';

/** Link endpoints arrive as ids but are rehydrated into node objects by d3. */
function linkEndId(endpoint: unknown): string {
  return typeof endpoint === 'string' ? endpoint : (endpoint as { id: string }).id;
}

function parseGraphUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('view');
  const view: ViewMode = raw === 'person' || raw === 'hybrid' ? raw : 'social';
  return {
    view,
    selected: params.get('selected'),
  };
}

/**
 * Build this page's URL for a view and selection, preserving every other query
 * param. `highlightGroup` / `groupId` are deliberately left alone: the crowd
 * highlight effect owns them, and group-profile and the person context menu
 * link in with them already set.
 */
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
  color: string;
  val: number;
  isCenter: boolean;
  isCrowd: boolean;
  /** Kept in the scene and in the simulation, but not drawn. */
  invisible: boolean;
  // Positions are carried across rebuilds so a filter or colour change does
  // not throw away a settled layout.
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

/**
 * Crowd colours are assigned by position rather than read off the group, so
 * every crowd on screen gets its own hue; past ten crowds the assignment wraps.
 *
 * Each palette covers the colour wheel in ten even steps, but the entries are
 * listed so that consecutive ones sit on opposite sides of it. Only crowds that
 * actually drew members are on screen, so the colours in play are usually a
 * sparse subset of the palette — in wheel order that subset can easily come out
 * as, say, teal next to cyan. Alternating halves keeps any run of neighbouring
 * indices far apart.
 */
const CROWD_PALETTES = {
  vivid: {
    label: 'Vivid Spectrum',
    colors: ['#e02424', '#14b8a6', '#f97316', '#06b6d4', '#eab308',
             '#3b82f6', '#84cc16', '#8b5cf6', '#22c55e', '#ec4899'],
  },
  pastel: {
    label: 'Soft Pastel',
    colors: ['#ff9aa8', '#8fdfe8', '#ffc48c', '#9dc0f5', '#f6e37a',
             '#b3a8f0', '#bfe884', '#d5a8ef', '#8ee9b8', '#f0a0cd'],
  },
  neon: {
    label: 'Neon Glow',
    colors: ['#ff1e3c', '#00f0ff', '#ff7a00', '#1f8cff', '#ffe814',
             '#6b3dff', '#6eff2b', '#c53dff', '#00ff87', '#ff2ea6'],
  },
} as const;

type CrowdPalette = keyof typeof CROWD_PALETTES;

const sameCrowdLegend = (a: CrowdLegendEntry[], b: CrowdLegendEntry[]): boolean =>
  a.length === b.length
  && a.every((e, i) => e.id === b[i].id && e.color === b[i].color && e.count === b[i].count);

/** The page background, which is also what the renderer clears to. */
const readBackgroundColor = (): string => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
  const [h, sat, l] = raw.split(' ').map(v => parseFloat(v));
  return `hsl(${h}, ${sat}%, ${l}%)`;
};

/** Arrow length per link. Mutual links never get one, and nor do undrawn links. */
const linkArrowLength = (link: any): number => (link.mutual || link.invisible ? 0 : 4);

const crowdColorAt = (palette: CrowdPalette, index: number): string => {
  const { colors } = CROWD_PALETTES[palette];
  return colors[index % colors.length];
};

/** One row of the on-canvas crowd key. */
interface CrowdLegendEntry {
  id: string;
  name: string;
  color: string;
  count: number;
}

interface GraphLink {
  source: string;
  target: string;
  type: 'follows';
  color: string;
  mutual?: boolean;
  isCrowdLink: boolean;
  /** Kept in the scene and in the simulation, but not drawn. */
  invisible: boolean;
  /** Stable handle used to find this link's line object when recolouring. */
  idx: number;
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

  // Mirror selection changes from inside views into the URL via push so the
  // browser back button restores the previous selection. The first run is the
  // exception: it only normalises the URL (a bare /social-graph-3d gains
  // `?view=social`), which is not something the user did, so it replaces
  // instead — otherwise every visit would open with a spare entry to back out of.
  const urlNormalisedRef = useRef(false);
  useEffect(() => {
    const isFirstRun = !urlNormalisedRef.current;
    urlNormalisedRef.current = true;
    if (viewMode === 'hybrid') return;
    const next = viewMode === 'person' ? selectedPersonId : selectedAccountId;
    syncGraphUrl(viewMode, next, isFirstRun ? 'replace' : 'push');
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
  // One shared geometry/material pool for every node and link in the scene.
  const resourcesRef = useRef<GraphResourceCache | null>(null);
  // Live three.js objects, so colour changes can swap materials in place
  // instead of rebuilding the graph and restarting the layout.
  const nodeObjMapRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const linkObjMapRef = useRef<Map<number, THREE.Line>>(new Map());
  // ── Dense path state ──────────────────────────────────────────────────────
  // Only populated while dense mode is on; the standard path leaves all of it
  // null. `positions` is kept so a filter change can seed the next layout from
  // the settled one, and so the crowd spheres have somewhere to read from.
  const denseRendererRef = useRef<DenseGraphRenderer | null>(null);
  const layoutWorkerRef = useRef<Worker | null>(null);
  const denseLayoutRef = useRef<{ indexById: Map<string, number>; positions: Float32Array | null }>({
    indexById: new Map(),
    positions: null,
  });
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
  const [centerPull, setCenterPull] = useState(1);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; accountId: string } | null>(null);
  const [showCrowds, setShowCrowds] = useState(true);
  const [crowdPalette, setCrowdPalette] = useState<CrowdPalette>('vivid');
  const [recolorNonCrowd, setRecolorNonCrowd] = useState(false);
  const [nonCrowdColor, setNonCrowdColor] = useState('#d1d5db');
  const [nonCrowdMode, setNonCrowdMode] = useState<'show' | 'hide' | 'invis'>('show');
  const hideNonCrowd = nonCrowdMode === 'hide';
  const invisNonCrowd = nonCrowdMode === 'invis';
  const [invisAllLinks, setInvisAllLinks] = useState(false);
  const [crowdSphereOpacity, setCrowdSphereOpacity] = useState(initialDefaults.crowdSphereOpacity ?? 0.15);
  const [includeMeAccounts, setIncludeMeAccounts] = useState(initialDefaults.includeMeAccounts ?? true);
  const [autoRotate, setAutoRotate] = useState(initialDefaults.autoRotate ?? false);
  const [antialias, setAntialias] = useState(initialDefaults.antialias);
  const [maxPixelRatio, setMaxPixelRatio] = useState(initialDefaults.maxPixelRatio);
  const [nodeSegments, setNodeSegments] = useState(initialDefaults.nodeSegments);
  const [linkArrowMode, setLinkArrowMode] = useState<LinkArrowMode>(initialDefaults.linkArrows);
  const [arrowAutoThreshold, setArrowAutoThreshold] = useState(initialDefaults.arrowAutoThreshold);
  const [denseModeSetting, setDenseModeSetting] = useState<DenseModeSetting>(initialDefaults.denseMode);
  const [denseModeThreshold, setDenseModeThreshold] = useState(initialDefaults.denseModeThreshold);
  const [renderedCounts, setRenderedCounts] = useState({ nodes: 0, links: 0 });
  const [crowdLegend, setCrowdLegend] = useState<CrowdLegendEntry[]>([]);
  const crowdSphereMeshesMapRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const [highlightedGroupId, setHighlightedGroupId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('highlightGroup') || new URLSearchParams(window.location.search).get('groupId')
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (highlightedGroupId) {
      params.set('highlightGroup', highlightedGroupId);
    } else {
      params.delete('highlightGroup');
      params.delete('groupId');
    }
    const newQs = params.toString();
    const newUrl = `${window.location.pathname}${newQs ? `?${newQs}` : ''}`;
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.replaceState(null, '', newUrl);
    }
  }, [highlightedGroupId]);

  const { data: groupsList } = useQuery<Group[]>({
    queryKey: ['/api/groups'],
  });

  const { data: peopleList } = useQuery<Person[]>({
    queryKey: ['/api/people'],
  });

  // A person carrying a `userId` is a "me" person — see the people schema.
  const mePersonIds = useMemo(
    () => new Set((peopleList || []).filter(p => p.userId != null).map(p => p.id)),
    [peopleList],
  );

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

  // Applying settings changes the query key, so without a placeholder the data
  // would be undefined for a commit — `hasGraphData` would flip false and
  // Effect A would destroy the renderer, taking the settled layout with it.
  const {
    data: graphData,
    isFetching: isGraphFetching,
    isPlaceholderData: isGraphPlaceholder,
  } = useQuery<SocialGraphData>({
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
    placeholderData: (prev) => prev,
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

  // Adjacency and id lookups are built once per payload. Without them the
  // colour and link passes below degrade into O(nodes x links) scans.
  const graphIndex = useMemo(() => {
    const nodeById = new Map<string, SocialGraphData['nodes'][number]>();
    const adjacency = new Map<string, Set<string>>();
    if (graphData) {
      for (const n of graphData.nodes) {
        nodeById.set(n.id, n);
        adjacency.set(n.id, new Set<string>());
      }
      for (const l of graphData.links) {
        const src = linkEndId(l.source);
        const tgt = linkEndId(l.target);
        adjacency.get(src)?.add(tgt);
        adjacency.get(tgt)?.add(src);
      }
    }
    return { nodeById, adjacency };
  }, [graphData]);

  // Decided from the payload rather than `renderedCounts`, which Effect B sets:
  // feeding a rendered count back into the choice of renderer would loop.
  const denseEnabled = resolveDenseEnabled(
    denseModeSetting,
    graphData?.nodes.length ?? 0,
    denseModeThreshold,
  );
  // The dense renderer draws links as plain segments, so it has nowhere to hang
  // an arrow head.
  const arrowsEnabled =
    !denseEnabled && resolveArrowsEnabled(linkArrowMode, renderedCounts.links, arrowAutoThreshold);

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

  const computeDistances = useCallback((targetId: string): Map<string, number> => {
    const cache = distanceCacheRef.current;
    if (cache.targetId === targetId && cache.graphDataRef === graphData) {
      return cache.distances;
    }
    const { adjacency } = graphIndex;
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
  }, [graphData, graphIndex]);

  const computeColorMap = useCallback(() => {
    if (!graphData || !graphData.nodes.length) return new Map<string, string>();

    const colorMap = new Map<string, string>();

    if (graphMode === 'multi-highlight' && multiHighlightAccountIds.length >= 2) {
      // One adjacency lookup per (node, highlight) pair rather than a full
      // link scan per pair.
      const highlighted = Array.from(new Set(multiHighlightAccountIds));
      const highlightedSet = new Set(highlighted);
      graphData.nodes.forEach(n => {
        if (highlightedSet.has(n.id)) {
          colorMap.set(n.id, multiHighlightColor);
          return;
        }
        const neighbours = graphIndex.adjacency.get(n.id);
        let matchCount = 0;
        if (neighbours) {
          for (const hId of highlighted) {
            if (neighbours.has(hId)) matchCount++;
          }
        }
        if (matchCount === highlighted.length) {
          colorMap.set(n.id, multiFollowsAllColor);
        } else if (matchCount === 1) {
          colorMap.set(n.id, multiFollowsOneColor);
        }
      });
      return colorMap;
    }

    if (graphMode === 'single-highlight' && singleHighlightAccountId && singleNodeColorScheme === 'follow-status') {
      // Collect the follow relationship for every neighbour of the highlighted
      // account in a single pass over the links.
      const relations = new Map<string, { mutual: boolean; outbound: boolean; inbound: boolean }>();
      for (const l of graphData.links) {
        const src = linkEndId(l.source);
        const tgt = linkEndId(l.target);
        const isOutbound = src === singleHighlightAccountId;
        const isInbound = tgt === singleHighlightAccountId;
        if (!isOutbound && !isInbound) continue;
        const otherId = isOutbound ? tgt : src;
        let entry = relations.get(otherId);
        if (!entry) {
          entry = { mutual: false, outbound: false, inbound: false };
          relations.set(otherId, entry);
        }
        if (l.mutual) {
          entry.mutual = true;
          continue;
        }
        if (isOutbound) entry.outbound = true;
        if (isInbound) entry.inbound = true;
      }
      graphData.nodes.forEach(n => {
        if (n.id === singleHighlightAccountId) {
          colorMap.set(n.id, '#ef4444');
          return;
        }
        const entry = relations.get(n.id);
        if (entry && (entry.mutual || (entry.outbound && entry.inbound))) {
          colorMap.set(n.id, singleLinkMutualColor);
        } else if (entry?.inbound) {
          colorMap.set(n.id, singleLinkFollowsYouColor);
        } else if (entry?.outbound) {
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
      // Spreading a large array into Math.max blows the argument limit, so
      // fold instead. Seeds match the previous Math.max(..., 1) / min(..., 0).
      let maxCount = 1;
      let minCount = 0;
      for (const node of graphData.nodes) {
        if (node.connectionCount > maxCount) maxCount = node.connectionCount;
        if (node.connectionCount < minCount) minCount = node.connectionCount;
      }
      const range = (maxCount - minCount) || 1;
      graphData.nodes.forEach(n => {
        const linear = (n.connectionCount - minCount) / range;
        const normalized = Math.sqrt(linear);
        colorMap.set(n.id, interpolateColor(connectionsColorMin, connectionsColorMax, normalized));
      });
    } else if (colorScheme === 'distance') {
      const distanceColors: Record<number, string> = { 0: distanceColorSelf, 1: distanceColorDirect, 2: distanceColor2nd };
      if (colorSchemeAccountId && graphIndex.nodeById.has(colorSchemeAccountId)) {
        const distancesMap = computeDistances(colorSchemeAccountId);
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
  }, [graphData, graphIndex, colorScheme, colorSchemeAccountId, connectionsColorMin, connectionsColorMax, interpolateColor, computeDistances, distanceColorSelf, distanceColorDirect, distanceColor2nd, distanceColorOther, graphMode, singleHighlightAccountId, singleNodeColorScheme, singleLinkMutualColor, singleLinkFollowsYouColor, singleLinkYouFollowColor, multiHighlightAccountIds, multiHighlightColor, multiFollowsAllColor, multiFollowsOneColor]);

  interface GraphVisuals {
    nodes: GraphNode[];
    links: GraphLink[];
    activeGroupIds: string[];
    crowdNodeIdsByGroup: Map<string, Set<string>>;
    crowdColorByGroup: Map<string, string>;
    crowdLegend: CrowdLegendEntry[];
  }

  // Values the render loop must read live rather than through a captured
  // closure, so tick callbacks stay correct without re-creating the graph.
  const crowdSphereOpacityRef = useRef(crowdSphereOpacity);
  crowdSphereOpacityRef.current = crowdSphereOpacity;
  const crowdColorByGroupRef = useRef<Map<string, string>>(new Map());
  const showCrowdsRef = useRef(showCrowds);
  showCrowdsRef.current = showCrowds;
  const blobForceMultiplierRef = useRef(blobForceMultiplier);
  blobForceMultiplierRef.current = blobForceMultiplier;
  const centerPullRef = useRef(centerPull);
  centerPullRef.current = centerPull;

  // The whole scene description, derived in one pass. Held in a ref so it only
  // runs when explicitly invoked (never on an incidental React re-render), and
  // so the rebuild and in-place recolour paths share one implementation.
  const buildVisualsRef = useRef<() => GraphVisuals>(null!);
  buildVisualsRef.current = (): GraphVisuals => {
    const empty: GraphVisuals = {
      nodes: [], links: [], activeGroupIds: [],
      crowdNodeIdsByGroup: new Map(), crowdColorByGroup: new Map(),
      crowdLegend: [],
    };
    if (!graphData || !graphData.nodes.length) return empty;

    const isAllCrowds = highlightedGroupId === 'all';
    const activeGroups: Group[] = isAllCrowds
      ? (groupsList || [])
      : (highlightedGroupId ? (groupsList?.filter(g => g.id === highlightedGroupId) || []) : []);
    // Assigned by position so no two crowds on screen share a hue. Built here
    // rather than at each point of use so the nodes, the links, the bounding
    // spheres and the legend all read the same map.
    const crowdColorByGroup = new Map(
      activeGroups.map((g, index) => [g.id, crowdColorAt(crowdPalette, index)] as const),
    );
    crowdColorByGroupRef.current = crowdColorByGroup;

    // Flatten every active group's membership arrays into id -> group lookups.
    // The previous `activeGroups.find(g => g.members.includes(id))` per node
    // and per link made this pass O(nodes x groups x members).
    type GroupHit = { group: Group; order: number };
    const centerAccountIds = new Set<string>();
    const memberGroupByPersonId = new Map<string, Group>();
    const crowdHitByAccountId = new Map<string, GroupHit>();
    const crowdHitByPersonId = new Map<string, GroupHit>();
    activeGroups.forEach((g, order) => {
      if (g.centerAccountId) centerAccountIds.add(g.centerAccountId);
      for (const personId of g.members || []) {
        if (!memberGroupByPersonId.has(personId)) memberGroupByPersonId.set(personId, g);
      }
      const isSocialMode = !g.crowdMode || g.crowdMode === "social_accounts";
      const target = isSocialMode ? crowdHitByAccountId : crowdHitByPersonId;
      for (const memberId of g.crowdMembers || []) {
        if (!target.has(memberId)) target.set(memberId, { group: g, order });
      }
    });

    // A "me" person's account follows nearly everyone, so it lands in every
    // crowd while the layout parks it in the middle of the graph — dragging each
    // crowd's centroid inward and inflating its radius until the bounding sphere
    // says nothing about where that crowd actually sits. Excluding it only
    // changes crowd membership; the account stays in the graph.
    const isExcludedFromCrowds = (ownerPersonId?: string | null): boolean =>
      !includeMeAccounts && !!ownerPersonId && mePersonIds.has(ownerPersonId);

    // `find` returned the earliest matching group; preserve that across the
    // two lookup maps by comparing their positions in activeGroups.
    const resolveCrowdGroup = (accountId: string, ownerPersonId?: string | null): Group | null => {
      if (isExcludedFromCrowds(ownerPersonId)) return null;
      const byAccount = crowdHitByAccountId.get(accountId);
      const byPerson = ownerPersonId ? crowdHitByPersonId.get(ownerPersonId) : undefined;
      if (!byAccount) return byPerson?.group ?? null;
      if (!byPerson) return byAccount.group;
      return (byAccount.order <= byPerson.order ? byAccount : byPerson).group;
    };

    const centerFollowers = new Set<string>();
    if (centerAccountIds.size > 0) {
      for (const l of graphData.links) {
        if (centerAccountIds.has(linkEndId(l.target))) centerFollowers.add(linkEndId(l.source));
      }
    }

    const colorMap = computeColorMap();

    /** Accounts no crowd, group or centre claimed — what the options act on. */
    const nonCrowdNodeIds = new Set<string>();

    // The dense renderer batches every node into one geometry with no per-point
    // visibility, so there the nearest thing to invisible is the clear colour.
    const denseInvisibleColor = denseEnabled && (invisNonCrowd || invisAllLinks)
      ? readBackgroundColor()
      : '';

    const nodes: GraphNode[] = graphData.nodes.map(n => {
      let label = n.name;
      if (n.mergedNames && n.mergedNames.length > 0) {
        label = `${n.name} (+${n.mergedNames.length} merged)`;
      }

      const isCenter = centerAccountIds.has(n.id);
      const matchingMemberGroup = n.ownerPersonId ? memberGroupByPersonId.get(n.ownerPersonId) : undefined;
      const isMember = !!matchingMemberGroup;
      const matchingCrowdGroup = resolveCrowdGroup(n.id, n.ownerPersonId);
      const isCrowd = !!matchingCrowdGroup;

      let color = colorMap.get(n.id) || n.typeColor;
      let isNonCrowd = false;
      if (activeGroups.length > 0) {
        if (isMember) {
          color = matchingMemberGroup?.color || "#8b5cf6";
        } else if (isCenter) {
          color = "#ec4899";
        } else if (matchingCrowdGroup && showCrowds) {
          color = crowdColorByGroup.get(matchingCrowdGroup.id) ?? color;
        } else {
          isNonCrowd = true;
          nonCrowdNodeIds.add(n.id);
          // Flatten what the crowd visuals did not claim, so the crowds read as
          // figure against ground rather than as more of the same.
          if (showCrowds && recolorNonCrowd) color = nonCrowdColor;
        }
      }

      const invisible = isNonCrowd && showCrowds && invisNonCrowd;
      if (invisible && denseEnabled) color = denseInvisibleColor;

      return {
        id: n.id,
        name: label,
        type: 'social-account' as const,
        color,
        val: graphMode === 'blob' ? (n.size - 50 + 1) * n.val : (isCenter ? 15 : (isMember ? 12 : (isCrowd && showCrowds ? 8 : n.val))),
        isCenter,
        isCrowd: isCrowd && showCrowds,
        invisible,
      };
    });

    const targetId = appliedSettings.singleHighlightAccountId;
    const isSingleMode = appliedSettings.mode === 'single-highlight' && targetId;

    const links: GraphLink[] = graphData.links.map((l, idx) => {
      const src = linkEndId(l.source);
      const tgt = linkEndId(l.target);

      const srcNode = graphIndex.nodeById.get(src);
      const matchingCrowdGroup = resolveCrowdGroup(src, srcNode?.ownerPersonId);
      const isSrcCrowd = !!matchingCrowdGroup;
      const isTgtCenterFollower = centerFollowers.has(tgt);

      const isCrowdLink = activeGroups.length > 0 && showCrowds && isSrcCrowd && isTgtCenterFollower;

      // Undrawn beats every colour rule below it, and a link is only as visible
      // as its ends — hiding an account has to take its connections with it, or
      // they hang in the air pointing at nothing. Settled before the chain so
      // an undrawn link never pays for a colour no one will see.
      const invisible = invisAllLinks
        || (showCrowds && invisNonCrowd && (nonCrowdNodeIds.has(src) || nonCrowdNodeIds.has(tgt)));

      let color: string;
      if (invisible) {
        // Nothing draws this on the standard path. The dense renderer has no
        // per-line visibility, so there it takes the clear colour instead.
        color = denseEnabled ? denseInvisibleColor : linkDefaultColor;
      } else if (isCrowdLink && matchingCrowdGroup) {
        color = crowdColorByGroup.get(matchingCrowdGroup.id) ?? linkDefaultColor;
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

      return { source: src, target: tgt, type: 'follows' as const, color, mutual: l.mutual, isCrowdLink, invisible, idx };
    });

    let filteredLinks = links;
    if (isSingleMode && !appliedSettings.singleShowFriendLinks) {
      filteredLinks = links.filter(l => l.source === targetId || l.target === targetId);
    }

    // Hiding means leaving them out of the scene entirely. The link filter
    // below then drops every link with a hidden end, which is what takes the
    // connections away along with the accounts.
    const drawnNodes = showCrowds && hideNonCrowd
      ? nodes.filter(n => !nonCrowdNodeIds.has(n.id))
      : nodes;

    const validNodeIds = new Set(drawnNodes.map(n => n.id));
    const validLinks = filteredLinks.filter(l => validNodeIds.has(l.source) && validNodeIds.has(l.target));

    // Crowd membership per group, resolved once here instead of re-filtering
    // every graph node against every group on every simulation tick.
    const crowdNodeIdsByGroup = new Map<string, Set<string>>();
    for (const g of activeGroups) {
      const ids = new Set<string>();
      const isSocialMode = !g.crowdMode || g.crowdMode === "social_accounts";
      if (isSocialMode) {
        for (const memberId of g.crowdMembers || []) {
          if (!validNodeIds.has(memberId)) continue;
          if (isExcludedFromCrowds(graphIndex.nodeById.get(memberId)?.ownerPersonId)) continue;
          ids.add(memberId);
        }
      } else if (g.crowdMembers?.length) {
        const memberSet = new Set(g.crowdMembers);
        for (const n of graphData.nodes) {
          if (!n.ownerPersonId || !memberSet.has(n.ownerPersonId)) continue;
          if (isExcludedFromCrowds(n.ownerPersonId)) continue;
          ids.add(n.id);
        }
      }
      crowdNodeIdsByGroup.set(g.id, ids);
    }

    return {
      nodes: drawnNodes,
      links: validLinks,
      activeGroupIds: activeGroups.map(g => g.id),
      crowdNodeIdsByGroup,
      crowdColorByGroup,
      // The key only lists crowds that actually drew members, so it never names
      // a colour the user cannot find on screen.
      crowdLegend: activeGroups
        .map(g => ({
          id: g.id,
          name: g.name,
          color: crowdColorByGroup.get(g.id) || '',
          count: crowdNodeIdsByGroup.get(g.id)?.size ?? 0,
        }))
        .filter(entry => entry.count > 0),
    };
  };

  // Rebuilt whenever the scene is rebuilt; invoked from the engine tick.
  const updateCrowdSpheresRef = useRef<() => void>(() => {});

  const applyChargeForce = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    try {
      const chargeForce = fg.d3Force('charge');
      if (chargeForce && typeof chargeForce.strength === 'function') {
        chargeForce.strength((node: any) => {
          const nodeVal = node.val || 10;
          const scale = 1 + (Math.sqrt(nodeVal / 10) - 1) * blobForceMultiplierRef.current;
          // Dividing rather than subtracting keeps 1 as the stock layout and
          // makes each step down a proportional loosening rather than a cliff.
          return (-30 * scale) / centerPullRef.current;
        });
      }
    } catch (_) { }
  }, []);

  // ── Effect A: create the renderer once ──────────────────────────────────
  // Only renderer-level settings force a rebuild here; data, colours, arrows
  // and forces are all pushed into the live instance by the effects below.
  //
  // Creation is gated on data existing. The library assigns its force layout
  // only on a graphData change but flips `engineRunning` on after every update,
  // so an instance created ahead of the first payload would start ticking
  // against an undefined layout as soon as any other effect set an accessor.
  // Gating here guarantees Effect B pushes real data in the same commit,
  // before Effects C-E touch the instance.
  const hasGraphData = !!graphData?.nodes.length;

  useEffect(() => {
    if (!graphRef.current || !hasGraphData) return;

    const resources = new GraphResourceCache();
    resourcesRef.current = resources;
    nodeObjMapRef.current.clear();
    linkObjMapRef.current.clear();

    const bgColor = readBackgroundColor();

    const fg = (ForceGraph3D as any)({
      controlType: 'orbit',
      rendererConfig: { antialias, alpha: true, powerPreference: 'high-performance' },
    })(graphRef.current)
      // Seed with an empty graph so the force layout exists from the start.
      // The library only assigns `state.layout` on a graphData change, but sets
      // `engineRunning = true` after *every* update — without this seed, any
      // accessor set before the first payload arrives starts the render loop
      // against an undefined layout.
      .graphData({ nodes: [], links: [] })
      .backgroundColor(bgColor)
      .nodeLabel('name')
      .nodeThreeObject((node: any) => {
        if (!node) return new THREE.Object3D();
        let obj: THREE.Object3D;
        if (node.isCenter) {
          const groupMesh = new THREE.Group();
          groupMesh.add(new THREE.Mesh(
            resources.sphereGeometry(6, nodeSegments),
            resources.basicMaterial(node.color || "#ec4899", { opacity: 0.5 }),
          ));
          groupMesh.add(new THREE.Mesh(
            resources.ringGeometry(7, 8, 32),
            resources.basicMaterial(node.color || "#ec4899", { doubleSided: true }),
          ));
          obj = groupMesh;
        } else {
          obj = new THREE.Mesh(
            resources.sphereGeometry(4, nodeSegments),
            resources.nodeMaterial(node.color || "#10b981", !!node.isCrowd),
          );
        }
        obj.userData.isCenter = !!node.isCenter;
        obj.visible = !node.invisible;
        nodeObjMapRef.current.set(node.id, obj);
        return obj;
      })
      .nodeVal('val')
      .enableNodeDrag(true)
      .enableNavigationControls(true)
      .showNavInfo(false)
      .linkThreeObject((link: any) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        const material = resources.lineMaterial(link.color || '#6b7280', !!link.isCrowdLink);
        const line = link.isCrowdLink
          ? new THREE.LineSegments(geometry, material)
          : new THREE.Line(geometry, material);
        // Both endpoints move every tick, so a bounding sphere would have to be
        // recomputed every frame to stay valid. Opting out of frustum culling
        // lets us skip that recompute entirely.
        line.frustumCulled = false;
        line.userData.dashed = !!link.isCrowdLink;
        line.visible = !link.invisible;
        if (typeof link.idx === 'number') linkObjMapRef.current.set(link.idx, line);
        return line;
      })
      .linkPositionUpdate((obj: any, coords: any) => {
        if (!coords || !coords.start || !coords.end) return false;
        const { start, end } = coords;
        if (typeof start.x !== 'number' || typeof end.x !== 'number') return false;
        const line = obj as THREE.Line;
        const positions = line?.geometry?.attributes?.position as THREE.BufferAttribute;
        if (!positions || !positions.array) return false;
        const arr = positions.array as Float32Array;
        arr[0] = start.x; arr[1] = start.y; arr[2] = start.z ?? 0;
        arr[3] = end.x;   arr[4] = end.y;   arr[5] = end.z ?? 0;
        positions.needsUpdate = true;
        // Only dashed crowd lines need line distances, and nothing needs a
        // bounding sphere now that culling is off — both were per-frame waste
        // paid once per link.
        if (line.userData.dashed) (line as any).computeLineDistances?.();
        return true;
      })
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalArrowColor((link: any) => link.color || '#6b7280')
      .linkCurvature(0)
      .onNodeClick((node: any) => {
        setSelectedAccountId(node.id);
        setContextMenu(null);
      })
      .onNodeHover((node: any) => {
        if (graphRef.current) graphRef.current.style.cursor = node ? 'pointer' : 'default';
      })
      .onNodeRightClick((node: any, event: MouseEvent) => {
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY, accountId: node.id });
      })
      .d3AlphaDecay(0.01)
      .d3VelocityDecay(0.3)
      .warmupTicks(100)
      .cooldownTime(15000);

    applyRendererPerfSettings(fg.renderer?.(), maxPixelRatio);

    // The bounding spheres only need to track the layout loosely, so recompute
    // them on every third tick and once more when the engine settles.
    let tick = 0;
    fg.onEngineTick(() => {
      if (++tick % 3 === 0) updateCrowdSpheresRef.current();
    });
    fg.onEngineStop(() => updateCrowdSpheresRef.current());

    // In dense mode the instance above is kept purely as a viewport: its own
    // graph stays empty (Effect B pushes nothing into it) so it contributes no
    // objects and no layout, while its camera, orbit controls, resize handling
    // and background all keep working. The scene gets our two batched objects
    // instead, driven by positions from the worker.
    let disposeDense = () => {};
    if (denseEnabled) {
      const denseRenderer = new DenseGraphRenderer(fg.scene(), fg.renderer());
      denseRendererRef.current = denseRenderer;

      const worker = new GraphLayoutWorker();
      layoutWorkerRef.current = worker;

      // The worker ticks faster than the display refreshes, so collapse every
      // message that arrived since the last frame into a single upload.
      let pending: Float32Array | null = null;
      let frame = 0;
      const applyPending = () => {
        frame = 0;
        const positions = pending;
        pending = null;
        if (!positions) return;
        denseLayoutRef.current.positions = positions;
        denseRenderer.applyPositions(positions);
        updateCrowdSpheresRef.current();
      };
      worker.onmessage = (event: MessageEvent<Float32Array>) => {
        pending = event.data;
        if (frame === 0) frame = requestAnimationFrame(applyPending);
      };

      disposeDense = () => {
        if (frame !== 0) cancelAnimationFrame(frame);
        worker.terminate();
        layoutWorkerRef.current = null;
        denseRenderer.dispose();
        denseRendererRef.current = null;
        denseLayoutRef.current = { indexById: new Map(), positions: null };
      };
    }

    fgRef.current = fg;

    return () => {
      disposeDense();
      crowdSphereMeshesMapRef.current.forEach(mesh => {
        fg.scene().remove(mesh);
        mesh.material && (mesh.material as THREE.Material).dispose();
      });
      crowdSphereMeshesMapRef.current.clear();
      nodeObjMapRef.current.clear();
      linkObjMapRef.current.clear();
      fg._destructor();
      fgRef.current = null;
      resources.dispose();
      resourcesRef.current = null;
    };
  }, [hasGraphData, antialias, maxPixelRatio, nodeSegments, denseEnabled]);

  // ── Effect B: push structural changes ───────────────────────────────────
  useEffect(() => {
    const fg = fgRef.current;
    // A placeholder payload predates the settings now driving buildVisuals, so
    // pushing it would rebuild from stale nodes and re-heat the layout twice
    // for a single update. Wait for the payload that matches.
    if (!fg || !graphData || !graphData.nodes.length || isGraphPlaceholder) return;

    const visuals = buildVisualsRef.current();

    // Carry settled positions across the rebuild so filter and crowd changes
    // nudge the layout rather than throwing it away and re-simulating.
    const previous = fg.graphData().nodes as any[];
    if (previous.length) {
      const prevById = new Map(previous.map((n: any) => [n.id, n]));
      for (const node of visuals.nodes) {
        const prev = prevById.get(node.id);
        if (!prev) continue;
        node.x = prev.x; node.y = prev.y; node.z = prev.z;
        node.vx = prev.vx; node.vy = prev.vy; node.vz = prev.vz;
        if (prev.fx !== undefined) node.fx = prev.fx;
        if (prev.fy !== undefined) node.fy = prev.fy;
        if (prev.fz !== undefined) node.fz = prev.fz;
      }
    }

    nodeObjMapRef.current.clear();
    linkObjMapRef.current.clear();

    // The two renderers keep positions in different places: the standard path
    // mutates these node objects in place, the dense path writes a flat array.
    // The crowd spheres only need a lookup, so they are given one either way.
    const nodeById = new Map(visuals.nodes.map(n => [n.id, n]));
    const positionOf = (id: string): { x: number; y: number; z: number } | null => {
      if (denseEnabled) {
        const { indexById, positions } = denseLayoutRef.current;
        const index = indexById.get(id);
        if (index === undefined || !positions) return null;
        const base = index * 3;
        return { x: positions[base], y: positions[base + 1], z: positions[base + 2] };
      }
      const node = nodeById.get(id) as any;
      if (!node || node.x === undefined || node.y === undefined || node.z === undefined) return null;
      return node;
    };
    const { activeGroupIds, crowdNodeIdsByGroup, crowdColorByGroup } = visuals;

    updateCrowdSpheresRef.current = () => {
      const graph = fgRef.current;
      const resources = resourcesRef.current;
      if (!graph || !resources) return;
      const meshes = crowdSphereMeshesMapRef.current;

      if (!showCrowdsRef.current || activeGroupIds.length === 0) {
        meshes.forEach(mesh => {
          graph.scene().remove(mesh);
          (mesh.material as THREE.Material).dispose();
        });
        meshes.clear();
        return;
      }

      const activeSet = new Set(activeGroupIds);
      meshes.forEach((mesh, gId) => {
        if (!activeSet.has(gId)) {
          graph.scene().remove(mesh);
          (mesh.material as THREE.Material).dispose();
          meshes.delete(gId);
        }
      });

      const dropMesh = (gId: string) => {
        const existing = meshes.get(gId);
        if (existing) {
          graph.scene().remove(existing);
          (existing.material as THREE.Material).dispose();
          meshes.delete(gId);
        }
      };

      for (const gId of activeGroupIds) {
        const memberIds = crowdNodeIdsByGroup.get(gId);
        if (!memberIds || memberIds.size === 0) {
          dropMesh(gId);
          continue;
        }

        let sumX = 0, sumY = 0, sumZ = 0, count = 0;
        const positioned: { x: number; y: number; z: number }[] = [];
        for (const id of Array.from(memberIds)) {
          const position = positionOf(id);
          if (!position) continue;
          positioned.push(position);
          sumX += position.x; sumY += position.y; sumZ += position.z;
          count++;
        }
        if (count === 0) {
          dropMesh(gId);
          continue;
        }

        const centroidX = sumX / count;
        const centroidY = sumY / count;
        const centroidZ = sumZ / count;

        const distances = positioned.map(n => {
          const dx = n.x - centroidX;
          const dy = n.y - centroidY;
          const dz = n.z - centroidZ;
          return Math.sqrt(dx * dx + dy * dy + dz * dz);
        });
        distances.sort((a, b) => a - b);
        const percentileIndex = Math.min(distances.length - 1, Math.floor(distances.length * 0.9));
        const radius = Math.max(15, distances[percentileIndex] || 15);
        const sphereColor = crowdColorByGroupRef.current.get(gId) || crowdColorAt(crowdPalette, 0);

        let mesh = meshes.get(gId);
        if (!mesh) {
          // The wireframe geometry is shared, but each sphere keeps its own
          // material because colour and opacity are mutated per group below.
          mesh = new THREE.Mesh(
            resources.sphereGeometry(1, 32),
            new THREE.MeshBasicMaterial({
              color: sphereColor,
              transparent: true,
              opacity: crowdSphereOpacityRef.current,
              wireframe: true,
            }),
          );
          graph.scene().add(mesh);
          meshes.set(gId, mesh);
        }

        mesh.position.set(centroidX, centroidY, centroidZ);
        mesh.scale.set(radius, radius, radius);
        (mesh.material as THREE.MeshBasicMaterial).color.set(sphereColor);
        (mesh.material as THREE.MeshBasicMaterial).opacity = crowdSphereOpacityRef.current;
      }
    };

    if (denseEnabled) {
      const denseRenderer = denseRendererRef.current;
      const worker = layoutWorkerRef.current;
      if (denseRenderer && worker) {
        const previous = denseLayoutRef.current;
        const index = denseRenderer.setGraph(visuals.nodes, visuals.links);

        // Carry settled positions over by id. Nodes the previous layout never
        // had stay NaN, which the worker reads as "place this one yourself".
        let seed: Float32Array | null = null;
        if (previous.positions && previous.indexById.size > 0) {
          seed = new Float32Array(index.nodeCount * 3).fill(NaN);
          index.indexById.forEach((nextIndex, id) => {
            const prevIndex = previous.indexById.get(id);
            if (prevIndex === undefined) return;
            const from = prevIndex * 3;
            const to = nextIndex * 3;
            seed![to] = previous.positions![from];
            seed![to + 1] = previous.positions![from + 1];
            seed![to + 2] = previous.positions![from + 2];
          });
        }

        denseLayoutRef.current = { indexById: index.indexById, positions: seed };
        const request: LayoutRequest = {
          type: 'init',
          nodeCount: index.nodeCount,
          links: index.linkPairs,
          vals: index.vals,
          chargeMultiplier: blobForceMultiplierRef.current,
          centerPull: centerPullRef.current,
          positions: seed,
        };
        worker.postMessage(request);
      }
    } else {
      fg.graphData({ nodes: visuals.nodes, links: visuals.links });
      applyChargeForce();
    }
    setRenderedCounts(prev =>
      prev.nodes === visuals.nodes.length && prev.links === visuals.links.length
        ? prev
        : { nodes: visuals.nodes.length, links: visuals.links.length }
    );

    setCrowdLegend(prev => sameCrowdLegend(prev, visuals.crowdLegend) ? prev : visuals.crowdLegend);
    updateCrowdSpheresRef.current();
  }, [
    graphData,
    graphIndex,
    graphMode,
    isGraphPlaceholder,
    highlightedGroupId,
    groupsList,
    showCrowds,
    hideNonCrowd,
    includeMeAccounts,
    mePersonIds,
    applyChargeForce,
    // Renderer rebuilds clear the object maps, so re-push the data afterwards.
    hasGraphData,
    antialias,
    maxPixelRatio,
    nodeSegments,
    denseEnabled,
  ]);

  // ── Effect C: recolour in place ─────────────────────────────────────────
  // Swapping cached materials on the existing objects avoids re-pushing
  // graphData, which would restart the force simulation for a colour tweak.
  useEffect(() => {
    const fg = fgRef.current;
    const resources = resourcesRef.current;
    if (!fg || !resources || !graphData || !graphData.nodes.length) return;

    // Crowd colours come from the palette, so unlike the other colour settings
    // this effect also has to reach the bounding spheres and the key. The
    // rebuild above refreshed the colour map the sphere pass reads.
    const visuals = buildVisualsRef.current();
    setCrowdLegend(prev => sameCrowdLegend(prev, visuals.crowdLegend) ? prev : visuals.crowdLegend);
    updateCrowdSpheresRef.current();

    if (denseEnabled) {
      denseRendererRef.current?.setColors(visuals.nodes, visuals.links);
      return;
    }

    if (nodeObjMapRef.current.size === 0) return;

    const liveNodes = fg.graphData().nodes as any[];
    const liveNodeById = new Map(liveNodes.map((n: any) => [n.id, n]));
    for (const node of visuals.nodes) {
      const live = liveNodeById.get(node.id);
      if (live) live.color = node.color;
      const obj = nodeObjMapRef.current.get(node.id);
      if (!obj) continue;
      obj.visible = !node.invisible;
      // A changed isCenter means the object's shape changed too; that only
      // happens on structural updates, which Effect B already handled.
      if (obj.userData.isCenter !== node.isCenter) continue;
      if (node.isCenter) {
        const [sphere, ring] = obj.children as THREE.Mesh[];
        if (sphere) sphere.material = resources.basicMaterial(node.color, { opacity: 0.5 });
        if (ring) ring.material = resources.basicMaterial(node.color, { doubleSided: true });
      } else {
        (obj as THREE.Mesh).material = resources.nodeMaterial(node.color, node.isCrowd);
      }
    }

    const linkVisualByIdx = new Map(visuals.links.map(l => [l.idx, l]));
    for (const link of visuals.links) {
      const line = linkObjMapRef.current.get(link.idx);
      if (!line) continue;
      line.material = resources.lineMaterial(link.color, link.isCrowdLink);
      line.visible = !link.invisible;
    }
    const liveLinks = fg.graphData().links as any[];
    for (const live of liveLinks) {
      const visual = linkVisualByIdx.get(live.idx);
      if (!visual) continue;
      live.color = visual.color;
      live.invisible = visual.invisible;
    }

    // Arrow meshes cache their colour internally, so nudge the accessor to make
    // the library re-read it. Custom link objects are left untouched by that
    // digest, so the lines above keep the materials just assigned.
    if (arrowsEnabled) {
      fg.linkDirectionalArrowColor((l: any) => l.color || '#6b7280');
      // An undrawn link must not leave its arrow behind. Arrow meshes cache
      // both accessors, so re-setting them is what forces the re-read.
      fg.linkDirectionalArrowLength(linkArrowLength);
    }
  }, [
    graphData,
    denseEnabled,
    computeColorMap,
    arrowsEnabled,
    crowdPalette,
    invisNonCrowd,
    invisAllLinks,
    recolorNonCrowd,
    nonCrowdColor,
    linkMutualColor,
    linkDefaultColor,
    singleLinkMutualColor,
    singleLinkFollowsYouColor,
    singleLinkYouFollowColor,
  ]);

  // ── Effect D: arrows ────────────────────────────────────────────────────
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.linkDirectionalArrowLength(arrowsEnabled ? linkArrowLength : () => 0);
  }, [arrowsEnabled, renderedCounts]);

  // ── Effect E: charge force ──────────────────────────────────────────────
  // Effect B already applies the force on every data push, so this only needs
  // to handle later slider changes. Skipping the initial run avoids an extra
  // library update, each of which tears down and rebuilds the drag controls.
  const chargeAppliedRef = useRef(false);
  useEffect(() => {
    if (!chargeAppliedRef.current) {
      chargeAppliedRef.current = true;
      return;
    }
    if (denseEnabled) {
      const request: LayoutRequest = { type: 'charge', chargeMultiplier: blobForceMultiplier, centerPull };
      layoutWorkerRef.current?.postMessage(request);
      return;
    }
    applyChargeForce();
    fgRef.current?.d3ReheatSimulation?.();
  }, [blobForceMultiplier, centerPull, applyChargeForce, denseEnabled]);

  useEffect(() => {
    crowdSphereMeshesMapRef.current.forEach((mesh) => {
      if (mesh.material) {
        (mesh.material as THREE.MeshBasicMaterial).opacity = crowdSphereOpacity;
      }
    });
  }, [crowdSphereOpacity]);

  useEffect(() => {
    if (!fgRef.current) return;
    const controls = (fgRef.current as any).controls?.();
    if (controls) {
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = 0.8;
    }
  }, [autoRotate]);

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
    const fg = fgRef.current;
    if (!fg) return;
    if (!denseEnabled) {
      fg.zoomToFit(1000, 50);
      return;
    }
    // The library's zoomToFit measures its own graph data, which dense mode
    // leaves empty on purpose, so frame the batched geometry's bounds instead.
    const bounds = denseRendererRef.current?.bounds();
    if (!bounds) return;
    const camera = fg.camera();
    const fov = ((camera?.fov ?? 75) * Math.PI) / 180;
    // The 1.1 leaves roughly the margin zoomToFit's padding argument gives.
    const distance = (bounds.radius * 1.1) / Math.tan(fov / 2);
    const direction = new THREE.Vector3().subVectors(camera.position, bounds.center).normalize();
    // Keep the current viewing angle unless the camera sits exactly on centre.
    if (direction.lengthSq() === 0) direction.set(0, 0, 1);
    fg.cameraPosition(direction.multiplyScalar(distance).add(bounds.center), bounds.center, 1000);
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
          {denseEnabled && (
            // Selection is the visible casualty of dense mode, so say so here
            // rather than leaving clicks to silently do nothing.
            <div className="flex items-center gap-1.5" data-testid="badge-dense-mode">
              <Badge variant="secondary">Dense mode &middot; selection off</Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setDenseModeSetting('off')}
                data-testid="button-leave-dense-mode"
              >
                Use standard
              </Button>
            </div>
          )}
          {isGraphFetching && (
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

        {/* One crowd needs no key — its colour is not telling the user anything
            they cannot already see. Two or more do. */}
        {showCrowds && crowdLegend.length > 1 && (
          <div
            className="absolute bottom-4 left-4 z-40 max-w-56 max-h-[45%] overflow-y-auto overscroll-contain bg-background/80 backdrop-blur-sm border rounded-lg shadow-lg px-3 py-2 space-y-1.5"
            data-testid="crowd-legend"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Crowds
            </p>
            {crowdLegend.map(entry => (
              <div
                key={entry.id}
                className="flex items-center gap-2 text-xs"
                data-testid={`crowd-legend-item-${entry.id}`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="truncate" title={`${entry.name} (${entry.count})`}>{entry.name}</span>
              </div>
            ))}
          </div>
        )}

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
                <TabsTrigger value="perf" className="flex-1 gap-1" data-testid="tab-perf">
                  <Gauge className="h-3.5 w-3.5" />
                  Perf
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

              <div className="pt-2 border-t space-y-3">
                <h4 className="font-semibold text-xs text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  Crowds Settings
                </h4>
                <div className="space-y-2">
                    <Label htmlFor="social-crowd-group-select" className="text-xs">Active Group</Label>
                    <Select
                      value={highlightedGroupId || "none"}
                      onValueChange={(val) => setHighlightedGroupId(val === "none" ? null : val)}
                    >
                      <SelectTrigger id="social-crowd-group-select" className="h-8" data-testid="select-crowd-group">
                        <SelectValue placeholder="Select group to visualize crowd..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No group (Crowds inactive)</SelectItem>
                        <SelectItem value="all" className="font-semibold text-primary">All Groups (Show all crowds)</SelectItem>
                        {groupsList?.map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.name} {g.crowdMembers && g.crowdMembers.length > 0 ? `(${g.crowdMembers.length} in crowd)` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {highlightedGroupId === "all" ? (() => {
                    const groupsWithCrowds = groupsList?.filter(g => g.crowdMembers && g.crowdMembers.length > 0) || [];
                    const totalCrowdMembers = groupsWithCrowds.reduce((sum, g) => sum + (g.crowdMembers?.length || 0), 0);
                    return (
                      <div className="text-xs text-muted-foreground bg-muted p-2 rounded flex justify-between items-center">
                        <span>Active crowds: <strong>{groupsWithCrowds.length} groups</strong></span>
                        <span>Total members: <strong>{totalCrowdMembers}</strong></span>
                      </div>
                    );
                  })() : highlightedGroupId ? (() => {
                    const selectedGroup = groupsList?.find((g) => g.id === highlightedGroupId);
                    if (!selectedGroup) return null;
                    if (!selectedGroup.centerAccountId) {
                      return (
                        <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 p-2 rounded">
                          This group has no Center Account configured.
                        </div>
                      );
                    }
                    if (!selectedGroup.crowdMembers || selectedGroup.crowdMembers.length === 0) {
                      return (
                        <div className="text-xs text-muted-foreground bg-muted p-2 rounded flex flex-col gap-1">
                          <span>No crowd members found for this group.</span>
                          <a
                            href={`/group/${selectedGroup.id}`}
                            className="text-primary hover:underline font-medium inline-block"
                          >
                            Configure or calculate on group page &rarr;
                          </a>
                        </div>
                      );
                    }
                    return (
                      <div className="text-xs text-muted-foreground bg-muted p-2 rounded flex justify-between items-center">
                        <span>Crowd members: <strong>{selectedGroup.crowdMembers.length}</strong></span>
                        {selectedGroup.crowdLastCalculatedAt && (
                          <span>{new Date(selectedGroup.crowdLastCalculatedAt).toLocaleDateString()}</span>
                        )}
                      </div>
                    );
                  })() : (
                    <p className="text-xs text-muted-foreground">
                      Select a group or &quot;All Groups&quot; to display crowd members and 3D bounding clouds.
                    </p>
                  )}

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
                  <div className="flex items-center justify-between">
                    <Label htmlFor="include-me-accounts" className="text-sm">
                      Include me user accounts
                    </Label>
                    <Switch
                      id="include-me-accounts"
                      checked={includeMeAccounts}
                      onCheckedChange={setIncludeMeAccounts}
                      data-testid="switch-include-me-accounts"
                    />
                  </div>
                )}
                {showCrowds && !includeMeAccounts && (
                  <p className="text-xs text-muted-foreground" data-testid="text-me-accounts-hint">
                    Your own accounts are left out of every crowd. They stay in the graph &mdash;
                    they just no longer pull each crowd&apos;s centre and radius toward the middle.
                  </p>
                )}
                {showCrowds && (
                  <div className="space-y-2">
                    <Label htmlFor="crowd-palette" className="text-xs">Crowd Palette</Label>
                    <Select value={crowdPalette} onValueChange={(val: CrowdPalette) => setCrowdPalette(val)}>
                      <SelectTrigger id="crowd-palette" className="h-8" data-testid="select-crowd-palette">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(CROWD_PALETTES) as CrowdPalette[]).map(key => (
                          <SelectItem key={key} value={key} data-testid={`option-crowd-palette-${key}`}>
                            <span className="flex items-center gap-2">
                              <span className="flex shrink-0 overflow-hidden rounded-sm">
                                {CROWD_PALETTES[key].colors.map(color => (
                                  <span key={color} className="w-1.5 h-3" style={{ backgroundColor: color }} />
                                ))}
                              </span>
                              {CROWD_PALETTES[key].label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Each crowd takes the next colour in the palette, so no two crowds on screen
                      share one. The key in the corner names them.
                    </p>
                  </div>
                )}
                {showCrowds && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="recolor-non-crowd" className="text-sm">
                        Recolor non-crowd accounts
                      </Label>
                      <Switch
                        id="recolor-non-crowd"
                        checked={recolorNonCrowd}
                        onCheckedChange={setRecolorNonCrowd}
                        data-testid="switch-recolor-non-crowd"
                      />
                    </div>
                    {recolorNonCrowd && (
                      <div className="flex items-center justify-between">
                        <Label className="text-sm text-muted-foreground">Non-crowd color</Label>
                        <input
                          type="color"
                          value={nonCrowdColor}
                          onChange={(e) => setNonCrowdColor(e.target.value)}
                          className="h-7 w-10 rounded cursor-pointer border"
                          data-testid="input-non-crowd-color"
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <Label htmlFor="hide-non-crowd" className="text-sm">
                        Hide non-crowd accounts
                      </Label>
                      <Switch
                        id="hide-non-crowd"
                        checked={hideNonCrowd}
                        onCheckedChange={(on) => setNonCrowdMode(on ? 'hide' : 'show')}
                        data-testid="switch-hide-non-crowd"
                      />
                    </div>
                    {hideNonCrowd && (
                      <p className="text-xs text-muted-foreground" data-testid="text-hide-non-crowd-hint">
                        Accounts outside every crowd leave the scene along with their links, so
                        the layout re-settles around the crowds that remain.
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <Label htmlFor="invis-non-crowd" className="text-sm">
                        Invis non-crowd accounts
                      </Label>
                      <Switch
                        id="invis-non-crowd"
                        checked={invisNonCrowd}
                        onCheckedChange={(on) => setNonCrowdMode(on ? 'invis' : 'show')}
                        data-testid="switch-invis-non-crowd"
                      />
                    </div>
                    {invisNonCrowd && (
                      <p className="text-xs text-muted-foreground" data-testid="text-invis-non-crowd-hint">
                        Those accounts and their links stay in the graph and keep pulling on the
                        layout &mdash; they are simply not drawn, so the crowds hold their places.
                      </p>
                    )}
                  </div>
                )}
                {showCrowds && (
                  <div className="space-y-2" data-testid="crowd-sphere-opacity-options">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Crowd Sphere Opacity</Label>
                      <span className="text-sm font-medium font-mono" data-testid="text-crowd-sphere-opacity-value">
                        {Math.round(crowdSphereOpacity * 100)}%
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      value={[Math.round(crowdSphereOpacity * 100)]}
                      onValueChange={(val) => setCrowdSphereOpacity(val[0] / 100)}
                      data-testid="slider-crowd-sphere-opacity"
                    />
                  </div>
                )}
                </div>
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
                                // Distance is measured by walking this graph's links, so an
                                // account that was filtered out of the graph has no distance to
                                // report and would silently leave every node on its type colour.
                                // Only offer accounts that are actually on screen.
                                const filtered = allSocialAccounts.filter(a =>
                                  graphIndex.nodeById.has(a.id) && (
                                    a.username.toLowerCase().includes(query) ||
                                    (a.currentProfile?.nickname && a.currentProfile?.nickname.toLowerCase().includes(query))
                                  )
                                ).slice(0, 50);
                                if (filtered.length === 0) {
                                  return (
                                    <CommandEmpty>
                                      No matching account in the current graph. Only the{' '}
                                      {renderedCounts.nodes} accounts drawn right now can be used
                                      &mdash; widen the filters to reach more.
                                    </CommandEmpty>
                                  );
                                }
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
                      {colorSchemeAccountId && !graphIndex.nodeById.has(colorSchemeAccountId) && (
                        // Reachable when the filters change under a selection, or when a saved
                        // default names an account this graph no longer draws.
                        <p className="text-xs text-muted-foreground" data-testid="text-distance-account-missing">
                          That account is not in the current graph, so every node keeps its type
                          colour. Pick one that is drawn, or widen the filters.
                        </p>
                      )}
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
                  <div className="flex items-center justify-between">
                    <Label htmlFor="invis-all-links" className="text-sm">
                      Invis all links
                    </Label>
                    <Switch
                      id="invis-all-links"
                      checked={invisAllLinks}
                      onCheckedChange={setInvisAllLinks}
                      data-testid="switch-invis-all-links"
                    />
                  </div>
                  {invisAllLinks && (
                    <p className="text-xs text-muted-foreground" data-testid="text-invis-all-links-hint">
                      Every link stays in the graph and keeps pulling the layout together &mdash;
                      none of them are drawn, so the colours below have nothing to tint.
                    </p>
                  )}
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

                <div className="pt-3 border-t space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="auto-rotate"
                      checked={autoRotate}
                      onCheckedChange={(checked) => setAutoRotate(!!checked)}
                      data-testid="checkbox-auto-rotate"
                    />
                    <Label htmlFor="auto-rotate" className="text-sm font-medium cursor-pointer">
                      Auto Rotate
                    </Label>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="perf" className="space-y-4" data-testid="tab-content-perf">
                <div className="text-xs text-muted-foreground bg-muted p-2 rounded flex justify-between items-center" data-testid="text-perf-counts">
                  <span>Nodes: <strong>{renderedCounts.nodes}</strong></span>
                  <span>Links: <strong>{renderedCounts.links}</strong></span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Center Pull</Label>
                    <span className="text-sm font-medium font-mono" data-testid="text-center-pull-value">
                      {Math.round(centerPull * 100)}%
                    </span>
                  </div>
                  <Slider
                    min={20}
                    max={100}
                    step={5}
                    value={[Math.round(centerPull * 100)]}
                    onValueChange={(v) => setCenterPull(v[0] / 100)}
                    data-testid="slider-center-pull"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Spread out</span>
                    <span>Default</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Turning this down pushes the nodes apart, so a graph that settles into one
                    dense knot opens up enough to read. It only changes how the layout spends its
                    space &mdash; nothing is added to or removed from the graph.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Dense Mode</Label>
                  <Select value={denseModeSetting} onValueChange={(v: DenseModeSetting) => setDenseModeSetting(v)}>
                    <SelectTrigger data-testid="select-dense-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto" data-testid="option-dense-auto">Auto</SelectItem>
                      <SelectItem value="on" data-testid="option-dense-on">Always on</SelectItem>
                      <SelectItem value="off" data-testid="option-dense-off">Always off</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Draws the whole graph in two batched passes and moves the layout onto a
                    background thread, which keeps very large scenes smooth. Nothing is clickable
                    while it is on &mdash; no hover labels, selection, context menu or dragging.{' '}
                    {denseModeSetting === 'auto'
                      ? (denseEnabled
                        ? `Currently on (${renderedCounts.nodes} nodes, at or over the ${denseModeThreshold} threshold).`
                        : `Currently off (${renderedCounts.nodes} nodes, under the ${denseModeThreshold} threshold).`)
                      : (denseEnabled ? 'Currently on.' : 'Currently off.')}
                  </p>
                </div>

                {denseModeSetting === 'auto' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground">Auto-on At</Label>
                      <span className="text-sm font-medium" data-testid="text-dense-threshold-value">{denseModeThreshold} nodes</span>
                    </div>
                    <Slider
                      value={[Math.max(0, DENSE_THRESHOLD_STEPS.indexOf(denseModeThreshold))]}
                      min={0}
                      max={DENSE_THRESHOLD_STEPS.length - 1}
                      step={1}
                      onValueChange={(v) => setDenseModeThreshold(DENSE_THRESHOLD_STEPS[v[0]])}
                      data-testid="slider-dense-threshold"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      {DENSE_THRESHOLD_STEPS.map(step => (
                        <span key={step}>{step}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2 pt-3 border-t">
                  <Label>Direction Arrows</Label>
                  <Select value={linkArrowMode} onValueChange={(v: LinkArrowMode) => setLinkArrowMode(v)}>
                    <SelectTrigger data-testid="select-link-arrows">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto" data-testid="option-arrows-auto">Auto</SelectItem>
                      <SelectItem value="on" data-testid="option-arrows-on">Always on</SelectItem>
                      <SelectItem value="off" data-testid="option-arrows-off">Always off</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Each one-way arrow is its own cone mesh and is re-aimed every frame &mdash; the
                    single most expensive thing in a dense graph.{' '}
                    {linkArrowMode === 'auto'
                      ? (arrowsEnabled
                        ? `Currently on (${renderedCounts.links} links, under the ${arrowAutoThreshold} threshold).`
                        : `Currently off (${renderedCounts.links} links, over the ${arrowAutoThreshold} threshold).`)
                      : (arrowsEnabled ? 'Currently on.' : 'Currently off.')}
                  </p>
                </div>

                {linkArrowMode === 'auto' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground">Auto-off Above</Label>
                      <span className="text-sm font-medium" data-testid="text-arrow-threshold-value">{arrowAutoThreshold} links</span>
                    </div>
                    <Slider
                      value={[arrowAutoThreshold]}
                      min={250}
                      max={10000}
                      step={250}
                      onValueChange={(v) => setArrowAutoThreshold(v[0])}
                      data-testid="slider-arrow-threshold"
                    />
                  </div>
                )}

                <div className="space-y-2 pt-3 border-t">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="perf-antialias">Antialiasing</Label>
                    <Switch
                      id="perf-antialias"
                      checked={antialias}
                      onCheckedChange={setAntialias}
                      data-testid="switch-antialias"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Smooths sphere and line edges. Turning it off helps most when the view is
                    filled with overlapping nodes. Changing this rebuilds the renderer.
                  </p>
                </div>

                <div className="space-y-2 pt-3 border-t">
                  <div className="flex items-center justify-between">
                    <Label>Max Pixel Ratio</Label>
                    <span className="text-sm font-medium" data-testid="text-pixel-ratio-value">{maxPixelRatio.toFixed(2)}x</span>
                  </div>
                  <Slider
                    value={[Math.round(maxPixelRatio * 100)]}
                    min={100}
                    max={200}
                    step={25}
                    onValueChange={(v) => setMaxPixelRatio(v[0] / 100)}
                    data-testid="slider-pixel-ratio"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>1x</span>
                    <span>1.25x</span>
                    <span>1.5x</span>
                    <span>1.75x</span>
                    <span>2x</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    2x matches the default. On a hi-DPI screen, dropping to 1x quarters the pixels
                    the GPU has to shade &mdash; usually a bigger win than antialiasing, at the cost
                    of a softer image.
                  </p>
                </div>

                <div className="space-y-2 pt-3 border-t">
                  <div className="flex items-center justify-between">
                    <Label>Node Detail</Label>
                    <span className="text-sm font-medium" data-testid="text-node-segments-value">{nodeSegments} segments</span>
                  </div>
                  <Slider
                    value={[Math.max(0, NODE_SEGMENT_STEPS.indexOf(nodeSegments))]}
                    min={0}
                    max={NODE_SEGMENT_STEPS.length - 1}
                    step={1}
                    onValueChange={(v) => setNodeSegments(NODE_SEGMENT_STEPS[v[0]])}
                    data-testid="slider-node-segments"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    {NODE_SEGMENT_STEPS.map(step => (
                      <span key={step}>{step}</span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Sphere subdivision for every node. 16 is the default; coarser spheres are hard
                    to tell apart at normal zoom and cut vertex count sharply.
                  </p>
                </div>
              </TabsContent>
            </Tabs>

            <div className="pt-2 border-t space-y-2">
              <Button
                className="w-full"
                onClick={handleUpdateGraph}
                disabled={isGraphFetching}
                data-testid="button-update-graph"
              >
                {isGraphFetching ? "Updating..." : "Update Graph"}
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
