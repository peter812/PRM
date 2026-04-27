import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ForceGraph3D from "3d-force-graph";
import { Button } from "@/components/ui/button";
import { Settings, X } from "lucide-react";
import { useLocation } from "wouter";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { getInitials } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { PersonGraphData } from "@shared/schema";

interface GraphNode {
  id: string;
  name: string;
  type: "person" | "group";
  color?: string;
  val?: number;
}

interface GraphLink {
  source: string | { id: string };
  target: string | { id: string };
  type: "relationship" | "group-member";
  color?: string;
}

interface PositionedNode {
  id: string;
  x?: number;
  y?: number;
  z?: number;
}

interface ForceGraphInstance {
  graphData: {
    (data: { nodes: GraphNode[]; links: GraphLink[] }): ForceGraphInstance;
    (): { nodes: PositionedNode[]; links: GraphLink[] };
  };
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
  onNodeClick: (cb: (node: GraphNode) => void) => ForceGraphInstance;
  onNodeHover: (cb: (node: GraphNode | null) => void) => ForceGraphInstance;
  d3AlphaDecay: (n: number) => ForceGraphInstance;
  d3VelocityDecay: (n: number) => ForceGraphInstance;
  warmupTicks: (n: number) => ForceGraphInstance;
  cooldownTime: (n: number) => ForceGraphInstance;
  cameraPosition: (
    pos: { x: number; y: number; z: number },
    look: { x: number; y: number; z: number },
    ms: number
  ) => ForceGraphInstance;
  zoomToFit: (ms: number, padding: number) => ForceGraphInstance;
  _destructor: () => void;
}

interface PersonGraphViewProps {
  viewMode: "person" | "social";
  setViewMode: (v: "person" | "social", selected?: string | null) => void;
  selectedPersonId: string | null;
  setSelectedPersonId: (id: string | null) => void;
}

function getLinkEndpointId(endpoint: string | { id: string }): string {
  return typeof endpoint === "string" ? endpoint : endpoint.id;
}

export default function PersonGraphView({
  viewMode,
  setViewMode,
  selectedPersonId,
  setSelectedPersonId,
}: PersonGraphViewProps) {
  const graphRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphInstance | null>(null);
  const [, navigate] = useLocation();

  const initParams = new URLSearchParams(window.location.search);
  const [showGroups, setShowGroups] = useState(() => initParams.get("showGroups") !== "false");
  const [hideOrphans, setHideOrphans] = useState(() => initParams.get("hideOrphans") !== "false");
  const [anonymizePeople, setAnonymizePeople] = useState(() => initParams.get("anonymize") === "true");
  const [highlightedPersonId, setHighlightedPersonId] = useState<string | null>(
    () => initParams.get("highlightPerson")
  );
  const [highlightedGroupId, setHighlightedGroupId] = useState<string | null>(
    () => initParams.get("highlightGroup")
  );
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const { data: graphData } = useQuery<PersonGraphData>({
    queryKey: ["/api/social-graph", "person"],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/social-graph", { view: "person" });
      return res.json();
    },
  });

  const { data: meData } = useQuery<{ id: string }>({
    queryKey: ["/api/me"],
    select: (data) => ({ id: data.id }),
  });

  const allPeople = graphData?.people || [];
  const groups = graphData?.groups || [];
  const relationships = graphData?.relationships || [];

  const people = hideOrphans
    ? allPeople.filter((person) => {
        const hasRelationship = relationships.some(
          (rel) => rel.fromPersonId === person.id || rel.toPersonId === person.id
        );
        const isInGroup = groups.some((group) => group.members.includes(person.id));
        return hasRelationship || isInGroup;
      })
    : allPeople;

  const selectedPerson = selectedPersonId
    ? allPeople.find((p) => p.id === selectedPersonId)
    : null;

  useEffect(() => {
    if (!graphRef.current) return;
    if (!people.length) return;

    let nodes: GraphNode[] = [
      ...people.map((p) => ({
        id: p.id,
        name:
          anonymizePeople && p.id !== meData?.id
            ? "Anonymous"
            : `${p.firstName} ${p.lastName}`,
        type: "person" as const,
        color: p.id === selectedPersonId ? "#ef4444" : "#6366f1",
        val: 10,
      })),
    ];

    if (showGroups) {
      groups.forEach((g) => {
        nodes.push({
          id: `group-${g.id}`,
          name: g.name,
          type: "group" as const,
          color: g.color || "#8b5cf6",
          val: 15,
        });
      });
    }

    let links: GraphLink[] = [
      ...relationships.map((r) => ({
        source: r.fromPersonId,
        target: r.toPersonId,
        type: "relationship" as const,
        color: r.typeColor || "#6b7280",
      })),
    ];

    if (showGroups) {
      groups.forEach((g) => {
        g.members.forEach((memberId) => {
          if (people.some((p) => p.id === memberId)) {
            links.push({
              source: `group-${g.id}`,
              target: memberId,
              type: "group-member" as const,
              color: g.color || "#8b5cf6",
            });
          }
        });
      });
    }

    if (highlightedPersonId) {
      const connectedPersonIds = new Set<string>([highlightedPersonId]);

      relationships.forEach((rel) => {
        if (rel.fromPersonId === highlightedPersonId) {
          connectedPersonIds.add(rel.toPersonId);
        } else if (rel.toPersonId === highlightedPersonId) {
          connectedPersonIds.add(rel.fromPersonId);
        }
      });

      const userGroupIds = new Set<string>();
      groups.forEach((group) => {
        if (group.members.includes(highlightedPersonId)) {
          userGroupIds.add(`group-${group.id}`);
        }
      });

      nodes = nodes.filter((node) => {
        if (node.type === "person") {
          return connectedPersonIds.has(node.id);
        } else {
          return userGroupIds.has(node.id);
        }
      });

      links = links.filter((link) => {
        const sourceId = getLinkEndpointId(link.source);
        const targetId = getLinkEndpointId(link.target);

        if (link.type === "relationship") {
          return connectedPersonIds.has(sourceId) && connectedPersonIds.has(targetId);
        } else {
          return userGroupIds.has(sourceId) && connectedPersonIds.has(targetId);
        }
      });
    }

    if (highlightedGroupId && !highlightedPersonId) {
      const group = groups.find((g) => g.id === highlightedGroupId);
      if (group) {
        const memberIds = new Set<string>(group.members);
        const groupNodeId = `group-${group.id}`;

        nodes = nodes.filter((node) => {
          if (node.type === "group") return node.id === groupNodeId;
          return memberIds.has(node.id);
        });

        links = links.filter((link) => {
          const sourceId = getLinkEndpointId(link.source);
          const targetId = getLinkEndpointId(link.target);

          if (link.type === "group-member") {
            return sourceId === groupNodeId && memberIds.has(targetId);
          }
          return memberIds.has(sourceId) && memberIds.has(targetId);
        });
      }
    }

    const gData = { nodes, links };

    const styles = getComputedStyle(document.documentElement);
    const backgroundHSL = styles.getPropertyValue("--background").trim();
    const values = backgroundHSL.split(" ").map((v) => parseFloat(v));
    const bgColor = `hsl(${values[0]}, ${values[1]}%, ${values[2]}%)`;

    if (!fgRef.current) {
      // The 3d-force-graph lib uses a Kapsule factory at runtime:
      // `ForceGraph3D({ opts })(element)`. Its bundled .d.ts only types the
      // constructor form, so we cast the factory call result to our local
      // typed surface to keep the rest of this file fully typed.
      const factory = ForceGraph3D as unknown as (
        opts: { controlType: string; rendererConfig: { antialias: boolean; alpha: boolean } }
      ) => (el: HTMLElement) => ForceGraphInstance;
      const fg = factory({
        controlType: "orbit",
        rendererConfig: { antialias: true, alpha: true },
      })(graphRef.current);

      fg
        .graphData(gData)
        .backgroundColor(bgColor)
        .nodeLabel("name")
        .nodeColor("color")
        .nodeVal("val")
        .linkColor("color")
        .linkOpacity(0.6)
        .linkWidth(2)
        .enableNodeDrag(true)
        .enableNavigationControls(true)
        .showNavInfo(false)
        .onNodeClick((node) => {
          if (node.type === "person") {
            setSelectedPersonId(node.id);
          } else if (node.type === "group") {
            const groupId = node.id.replace("group-", "");
            navigate(`/group/${groupId}?from=social-graph-3d`);
          }
        })
        .onNodeHover((node) => {
          if (graphRef.current) {
            graphRef.current.style.cursor = node ? "pointer" : "default";
          }
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
    };
  }, [
    people,
    groups,
    relationships,
    navigate,
    showGroups,
    highlightedPersonId,
    highlightedGroupId,
    anonymizePeople,
    meData?.id,
    selectedPersonId,
    setSelectedPersonId,
  ]);

  // Re-center camera on the currently selected person whenever it changes
  // (e.g. via cross-view chip navigation, URL deep-links, or popstate).
  // Retries briefly while the layout is still settling so the focus also
  // works on first mount.
  useEffect(() => {
    if (!selectedPersonId || !people.length) return;
    let cancelled = false;
    let attempts = 0;
    const tryFocus = () => {
      if (cancelled || !fgRef.current) return;
      const nodes = fgRef.current.graphData().nodes;
      const target = nodes.find((n) => n.id === selectedPersonId);
      if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') {
        if (attempts++ < 30) setTimeout(tryFocus, 100);
        return;
      }
      const tx = target.x;
      const ty = target.y;
      const tz = target.z ?? 0;
      const dist = 220;
      const distRatio = 1 + dist / Math.hypot(tx, ty, tz || 0.001);
      fgRef.current.cameraPosition(
        { x: tx * distRatio, y: ty * distRatio, z: tz * distRatio },
        { x: tx, y: ty, z: tz },
        900
      );
    };
    tryFocus();
    return () => { cancelled = true; };
  }, [selectedPersonId, people]);

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

  const linkedSocialBriefs = selectedPerson?.socialAccountBriefs ?? [];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
        <div>
          <h1
            className="text-sm md:text-2xl font-semibold flex items-center gap-2"
            data-testid="text-page-title"
          >
            Social Graph
            <span
              className="text-xs font-medium bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full"
              data-testid="text-node-count"
            >
              {people.length}
            </span>
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

      <div className="flex-1 relative overflow-hidden">
        {selectedPerson && (
          <div
            className="absolute top-4 left-4 w-72 max-h-[calc(100%-2rem)] overflow-y-auto bg-background/80 backdrop-blur-sm border rounded-lg shadow-lg z-50"
            data-testid="sidebar-person-info"
          >
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Person Info</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedPersonId(null)}
                  data-testid="button-close-sidebar"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-col items-center gap-3">
                <Avatar className="h-20 w-20">
                  {selectedPerson.imageUrl && (
                    <AvatarImage
                      src={selectedPerson.imageUrl}
                      alt={`${selectedPerson.firstName} ${selectedPerson.lastName}`}
                    />
                  )}
                  <AvatarFallback className="text-lg">
                    {getInitials(selectedPerson.firstName, selectedPerson.lastName)}
                  </AvatarFallback>
                </Avatar>
                <div className="text-center space-y-0.5">
                  <p className="font-medium" data-testid="text-sidebar-person-name">
                    {selectedPerson.firstName} {selectedPerson.lastName}
                  </p>
                  {selectedPerson.company && (
                    <p
                      className="text-sm text-muted-foreground"
                      data-testid="text-sidebar-person-company"
                    >
                      {selectedPerson.company}
                    </p>
                  )}
                </div>
              </div>

              {linkedSocialBriefs.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Social Accounts</Label>
                  <div
                    className="flex flex-col gap-1"
                    data-testid="chips-linked-social-accounts"
                  >
                    {linkedSocialBriefs.map((acc) => (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => setViewMode("social", acc.id)}
                        className="flex items-center gap-2 rounded-md border px-2 py-1 text-left hover-elevate"
                        data-testid={`chip-social-account-${acc.id}`}
                      >
                        <Avatar className="h-6 w-6">
                          {acc.imageUrl && (
                            <AvatarImage src={acc.imageUrl} alt={acc.username} />
                          )}
                          <AvatarFallback className="text-[10px]">
                            {acc.username.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm flex-1 truncate">@{acc.username}</span>
                        {acc.typeColor && (
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: acc.typeColor }}
                            data-testid={`dot-type-${acc.id}`}
                          />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 border-t">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    navigate(`/person/${selectedPerson.id}?from=social-graph-3d`)
                  }
                  data-testid="button-sidebar-view-profile"
                >
                  More
                </Button>
              </div>
            </div>
          </div>
        )}

        <div ref={graphRef} className="w-full h-full" data-testid="canvas-person-graph" />

        {isOptionsOpen && (
          <div className="absolute top-4 right-4 w-80 bg-background/80 backdrop-blur-sm border rounded-lg shadow-lg p-4 space-y-4 z-50">
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
                <Label>Highlight Person</Label>
                <div className="relative">
                  {highlightedPersonId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute left-0 top-0 h-full z-10 hover:bg-transparent"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHighlightedPersonId(null);
                      }}
                      data-testid="button-clear-highlight"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                  <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left font-normal"
                        style={{ paddingLeft: highlightedPersonId ? "2.5rem" : undefined }}
                        data-testid="button-person-search"
                      >
                        {highlightedPersonId
                          ? people.find((p) => p.id === highlightedPersonId)
                            ? `${people.find((p) => p.id === highlightedPersonId)!.firstName} ${
                                people.find((p) => p.id === highlightedPersonId)!.lastName
                              }`
                            : "Select person..."
                          : "Select person..."}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search people..." />
                        <CommandList>
                          <CommandEmpty>No person found.</CommandEmpty>
                          <CommandGroup>
                            {people
                              .filter((p) => p.id !== meData?.id)
                              .map((person) => (
                                <CommandItem
                                  key={person.id}
                                  value={`${person.firstName} ${person.lastName}`}
                                  onSelect={() => {
                                    setHighlightedPersonId(person.id);
                                    setSearchOpen(false);
                                  }}
                                  data-testid={`option-person-${person.id}`}
                                >
                                  {person.firstName} {person.lastName}
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
                <Label htmlFor="show-groups">Show Groups</Label>
                <Switch
                  id="show-groups"
                  checked={showGroups}
                  onCheckedChange={setShowGroups}
                  data-testid="switch-show-groups"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="anonymize">Anonymize People</Label>
                <Switch
                  id="anonymize"
                  checked={anonymizePeople}
                  onCheckedChange={setAnonymizePeople}
                  data-testid="switch-anonymize"
                />
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
