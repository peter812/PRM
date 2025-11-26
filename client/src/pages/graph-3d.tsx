import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ForceGraph3D from "3d-force-graph";
import { Button } from "@/components/ui/button";
import { Settings, Grid2X2, Eye, EyeOff, X } from "lucide-react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface GraphData {
  people: Array<{ id: string; firstName: string; lastName: string; company: string | null }>;
  relationships: Array<{ id: string; fromPersonId: string; toPersonId: string; typeColor: string | null }>;
  groups: Array<{ id: string; name: string; color: string; members: string[] }>;
}

interface GraphNode {
  id: string;
  name: string;
  type: 'person' | 'group';
  color?: string;
  val?: number;
}

interface GraphLink {
  source: string;
  target: string;
  type: 'relationship' | 'group-member';
  color?: string;
}

export default function Graph3D() {
  const graphRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [, navigate] = useLocation();
  const [showGroups, setShowGroups] = useState(true);
  const [hideOrphans, setHideOrphans] = useState(false);
  const [anonymizePeople, setAnonymizePeople] = useState(false);
  const [highlightedPersonId, setHighlightedPersonId] = useState<string | null>(null);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const { data: graphData } = useQuery<GraphData>({
    queryKey: ["/api/graph"],
  });

  const { data: meData } = useQuery<{ id: string }>({
    queryKey: ["/api/me"],
    select: (data) => ({ id: data.id }),
  });

  const allPeople = graphData?.people || [];
  const groups = graphData?.groups || [];
  const relationships = graphData?.relationships || [];

  // Filter people if hideOrphans is enabled
  const people = hideOrphans 
    ? allPeople.filter(person => {
        const hasRelationship = relationships.some(
          rel => rel.fromPersonId === person.id || rel.toPersonId === person.id
        );
        const isInGroup = groups.some(group => group.members.includes(person.id));
        return hasRelationship || isInGroup;
      })
    : allPeople;

  useEffect(() => {
    if (!graphRef.current || !people.length) return;

    // Transform data for 3d-force-graph
    const nodes: GraphNode[] = [
      ...people.map(p => ({
        id: p.id,
        name: anonymizePeople && p.id !== meData?.id 
          ? "Anonymous" 
          : `${p.firstName} ${p.lastName}`,
        type: 'person' as const,
        color: '#6366f1',
        val: 10,
      })),
    ];

    if (showGroups) {
      groups.forEach(g => {
        nodes.push({
          id: `group-${g.id}`,
          name: g.name,
          type: 'group' as const,
          color: g.color || '#8b5cf6',
          val: 15,
        });
      });
    }

    const links: GraphLink[] = [
      ...relationships.map(r => ({
        source: r.fromPersonId,
        target: r.toPersonId,
        type: 'relationship' as const,
        color: r.typeColor || '#6b7280',
      })),
    ];

    if (showGroups) {
      groups.forEach(g => {
        g.members.forEach(memberId => {
          if (people.some(p => p.id === memberId)) {
            links.push({
              source: `group-${g.id}`,
              target: memberId,
              type: 'group-member' as const,
              color: g.color || '#8b5cf6',
            });
          }
        });
      });
    }

    // Filter nodes if highlighted
    let filteredNodes = nodes;
    let filteredLinks = links;

    if (highlightedPersonId) {
      const connectedPersonIds = new Set<string>([highlightedPersonId]);
      
      // Add connected people through relationships
      relationships.forEach(rel => {
        if (rel.fromPersonId === highlightedPersonId) {
          connectedPersonIds.add(rel.toPersonId);
        } else if (rel.toPersonId === highlightedPersonId) {
          connectedPersonIds.add(rel.fromPersonId);
        }
      });

      // Get groups the highlighted person is in
      const userGroupIds = new Set<string>();
      groups.forEach(group => {
        if (group.members.includes(highlightedPersonId)) {
          userGroupIds.add(`group-${group.id}`);
        }
      });

      filteredNodes = nodes.filter(node => {
        if (node.type === 'person') {
          return connectedPersonIds.has(node.id);
        } else {
          return userGroupIds.has(node.id);
        }
      });

      filteredLinks = links.filter(link => {
        const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;
        
        if (link.type === 'relationship') {
          return connectedPersonIds.has(sourceId) && connectedPersonIds.has(targetId);
        } else {
          return userGroupIds.has(sourceId) && connectedPersonIds.has(targetId);
        }
      });
    }

    const graphData = {
      nodes: filteredNodes,
      links: filteredLinks,
    };

    // Get theme colors
    const styles = getComputedStyle(document.documentElement);
    const backgroundHSL = styles.getPropertyValue('--background').trim();
    const values = backgroundHSL.split(' ').map(v => parseFloat(v));
    const bgColor = `hsl(${values[0]}, ${values[1]}%, ${values[2]}%)`;

    // Initialize or update graph
    if (!fgRef.current) {
      fgRef.current = ForceGraph3D({
        controlType: 'orbit',
        rendererConfig: { antialias: true, alpha: true },
      })(graphRef.current)
        .graphData(graphData)
        .backgroundColor(bgColor)
        .nodeLabel('name')
        .nodeColor('color')
        .nodeVal('val')
        .linkColor('color')
        .linkOpacity(0.6)
        .linkWidth(2)
        .enableNodeDrag(true)
        .enableNavigationControls(true)
        .showNavInfo(false)
        .onNodeClick((node: any) => {
          if (node.type === 'person') {
            navigate(`/person/${node.id}?from=graph-3d`);
          } else if (node.type === 'group') {
            const groupId = node.id.replace('group-', '');
            navigate(`/group/${groupId}?from=graph-3d`);
          }
        })
        .onNodeHover((node: any) => {
          graphRef.current!.style.cursor = node ? 'pointer' : 'default';
        })
        .d3AlphaDecay(0.01)
        .d3VelocityDecay(0.3)
        .warmupTicks(100)
        .cooldownTime(15000)
        .cameraPosition({ x: 0, y: 0, z: 1000 }, { x: 0, y: 0, z: 0 }, 0);
      
      setTimeout(() => {
        if (fgRef.current) {
          fgRef.current.zoomToFit(1000, 50);
        }
      }, 100);
    } else {
      fgRef.current.graphData(graphData);
    }

    return () => {
      if (fgRef.current) {
        fgRef.current._destructor();
        fgRef.current = null;
      }
    };
  }, [people, groups, relationships, navigate, showGroups, highlightedPersonId, anonymizePeople, meData?.id]);

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

  const searchPeople = people.filter(p => 
    p.id !== meData?.id && 
    `${p.firstName} ${p.lastName}`.toLowerCase().includes('')
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
        <div>
          <h1 className="text-sm md:text-2xl font-semibold" data-testid="text-page-title">
            3D Connection Graph
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => navigate('/graph')}
            data-testid="button-switch-to-2d"
          >
            <Grid2X2 className="h-4 w-4 mr-2" />
            2D View
          </Button>
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
        <div ref={graphRef} className="w-full h-full" data-testid="canvas-3d-graph" />
        
        {isOptionsOpen && (
          <div className="absolute top-4 right-4 w-80 bg-background border rounded-lg shadow-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Graph Options</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOptionsOpen(false)}
                data-testid="button-close-options"
              >
                ✕
              </Button>
            </div>

            <div className="space-y-4">
              {/* Person Highlight Search */}
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
                        style={{ paddingLeft: highlightedPersonId ? '2.5rem' : undefined }}
                        data-testid="button-person-search"
                      >
                        {highlightedPersonId
                          ? people.find(p => p.id === highlightedPersonId)
                            ? `${people.find(p => p.id === highlightedPersonId)!.firstName} ${people.find(p => p.id === highlightedPersonId)!.lastName}`
                            : 'Select person...'
                          : 'Select person...'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search people..." />
                        <CommandList>
                          <CommandEmpty>No person found.</CommandEmpty>
                          <CommandGroup>
                            {searchPeople.map((person) => (
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

              {/* Show Groups */}
              <div className="flex items-center justify-between">
                <Label htmlFor="show-groups">Show Groups</Label>
                <Switch
                  id="show-groups"
                  checked={showGroups}
                  onCheckedChange={setShowGroups}
                  data-testid="switch-show-groups"
                />
              </div>

              {/* Hide Orphans */}
              <div className="flex items-center justify-between">
                <Label htmlFor="hide-orphans">Hide Orphans</Label>
                <Switch
                  id="hide-orphans"
                  checked={hideOrphans}
                  onCheckedChange={setHideOrphans}
                  data-testid="switch-hide-orphans"
                />
              </div>

              {/* Anonymize People */}
              <div className="flex items-center justify-between">
                <Label htmlFor="anonymize">Anonymize People</Label>
                <Switch
                  id="anonymize"
                  checked={anonymizePeople}
                  onCheckedChange={setAnonymizePeople}
                  data-testid="switch-anonymize"
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
