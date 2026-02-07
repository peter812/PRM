import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ForceGraph3D from "3d-force-graph";
import { Button } from "@/components/ui/button";
import { Settings, Grid2X2, X } from "lucide-react";
import { useLocation } from "wouter";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SocialAccount, SocialAccountType } from "@shared/schema";

interface GraphData {
  people: Array<{ id: string; firstName: string; lastName: string; company: string | null }>;
  relationships: Array<{ id: string; fromPersonId: string; toPersonId: string; typeColor: string | null }>;
  groups: Array<{ id: string; name: string; color: string; members: string[] }>;
}

interface GraphNode {
  id: string;
  name: string;
  type: 'person' | 'group' | 'social-account';
  color?: string;
  val?: number;
}

interface GraphLink {
  source: string;
  target: string;
  type: 'relationship' | 'group-member' | 'follows';
  color?: string;
  mutual?: boolean;
}

type GraphMode = 'people' | 'social-accounts';

export default function Graph3D() {
  const graphRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [, navigate] = useLocation();
  const [graphMode, setGraphMode] = useState<GraphMode>('people');
  const [showGroups, setShowGroups] = useState(true);
  const [hideOrphans, setHideOrphans] = useState(true);
  const [anonymizePeople, setAnonymizePeople] = useState(false);
  const [highlightedPersonId, setHighlightedPersonId] = useState<string | null>(null);
  const [highlightedAccountId, setHighlightedAccountId] = useState<string | null>(null);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [peopleSearchOpen, setPeopleSearchOpen] = useState(false);
  const [accountSearchOpen, setAccountSearchOpen] = useState(false);

  const { data: graphData } = useQuery<GraphData>({
    queryKey: ["/api/graph"],
    enabled: graphMode === 'people',
  });

  const { data: meData } = useQuery<{ id: string }>({
    queryKey: ["/api/me"],
    select: (data) => ({ id: data.id }),
  });

  const { data: socialAccounts } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
    enabled: graphMode === 'social-accounts',
  });

  const { data: socialAccountTypes } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
    enabled: graphMode === 'social-accounts',
  });

  const allPeople = graphData?.people || [];
  const groups = graphData?.groups || [];
  const relationships = graphData?.relationships || [];

  const people = hideOrphans
    ? allPeople.filter(person => {
        const hasRelationship = relationships.some(
          rel => rel.fromPersonId === person.id || rel.toPersonId === person.id
        );
        const isInGroup = groups.some(group => group.members.includes(person.id));
        return hasRelationship || isInGroup;
      })
    : allPeople;

  const allSocialAccounts = socialAccounts || [];

  const typeColorMap = new Map<string, string>();
  if (socialAccountTypes) {
    socialAccountTypes.forEach(t => {
      if (t.color) typeColorMap.set(t.id, t.color);
    });
  }

  const filteredSocialAccounts = hideOrphans
    ? allSocialAccounts.filter(account => {
        const hasFollowing = account.following && account.following.length > 0;
        const isFollowed = allSocialAccounts.some(
          other => other.following && other.following.includes(account.id)
        );
        return hasFollowing || isFollowed;
      })
    : allSocialAccounts;

  useEffect(() => {
    if (!graphRef.current) return;

    let nodes: GraphNode[] = [];
    let links: GraphLink[] = [];

    if (graphMode === 'people') {
      if (!people.length) return;

      nodes = [
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

      links = [
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

      if (highlightedPersonId) {
        const connectedPersonIds = new Set<string>([highlightedPersonId]);

        relationships.forEach(rel => {
          if (rel.fromPersonId === highlightedPersonId) {
            connectedPersonIds.add(rel.toPersonId);
          } else if (rel.toPersonId === highlightedPersonId) {
            connectedPersonIds.add(rel.fromPersonId);
          }
        });

        const userGroupIds = new Set<string>();
        groups.forEach(group => {
          if (group.members.includes(highlightedPersonId)) {
            userGroupIds.add(`group-${group.id}`);
          }
        });

        nodes = nodes.filter(node => {
          if (node.type === 'person') {
            return connectedPersonIds.has(node.id);
          } else {
            return userGroupIds.has(node.id);
          }
        });

        links = links.filter(link => {
          const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
          const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;

          if (link.type === 'relationship') {
            return connectedPersonIds.has(sourceId) && connectedPersonIds.has(targetId);
          } else {
            return userGroupIds.has(sourceId) && connectedPersonIds.has(targetId);
          }
        });
      }
    } else {
      if (!filteredSocialAccounts.length) return;

      const accountIds = new Set(filteredSocialAccounts.map(a => a.id));

      nodes = filteredSocialAccounts.map(account => {
        const typeColor = account.typeId ? typeColorMap.get(account.typeId) : null;
        return {
          id: account.id,
          name: account.nickname || account.username,
          type: 'social-account' as const,
          color: typeColor || '#10b981',
          val: 10,
        };
      });

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
    }

    const gData = {
      nodes,
      links,
    };

    const styles = getComputedStyle(document.documentElement);
    const backgroundHSL = styles.getPropertyValue('--background').trim();
    const values = backgroundHSL.split(' ').map(v => parseFloat(v));
    const bgColor = `hsl(${values[0]}, ${values[1]}%, ${values[2]}%)`;

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
          } else if (node.type === 'social-account') {
            navigate(`/social-accounts/${node.id}?from=graph-3d`);
          }
        })
        .onNodeHover((node: any) => {
          graphRef.current!.style.cursor = node ? 'pointer' : 'default';
        })
        .d3AlphaDecay(0.01)
        .d3VelocityDecay(0.3)
        .warmupTicks(100)
        .cooldownTime(15000);

      if (graphMode === 'social-accounts') {
        fg.linkDirectionalArrowLength((link: any) => link.mutual ? 0 : 4)
          .linkDirectionalArrowRelPos(1)
          .linkDirectionalArrowColor('color')
          .linkCurvature(0);
      }

      fgRef.current = fg;
    } else {
      if (graphMode === 'social-accounts') {
        fgRef.current
          .linkDirectionalArrowLength((link: any) => link.mutual ? 0 : 4)
          .linkDirectionalArrowRelPos(1)
          .linkDirectionalArrowColor('color')
          .linkCurvature(0);
      } else {
        fgRef.current
          .linkDirectionalArrowLength(0)
          .linkCurvature(0);
      }
      fgRef.current.graphData(gData);
    }

    return () => {
      if (fgRef.current) {
        fgRef.current._destructor();
        fgRef.current = null;
      }
    };
  }, [graphMode, people, groups, relationships, filteredSocialAccounts, socialAccountTypes, navigate, showGroups, highlightedPersonId, highlightedAccountId, anonymizePeople, meData?.id]);

  const handleModeChange = (mode: GraphMode) => {
    if (fgRef.current) {
      fgRef.current._destructor();
      fgRef.current = null;
    }
    setHighlightedPersonId(null);
    setHighlightedAccountId(null);
    setPeopleSearchOpen(false);
    setAccountSearchOpen(false);
    setGraphMode(mode);
  };

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

  const searchAccounts = filteredSocialAccounts;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
        <div>
          <h1 className="text-sm md:text-2xl font-semibold" data-testid="text-page-title">
            {graphMode === 'people' ? '3D Connection Graph' : '3D Social Account Graph'}
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
                <Select value={graphMode} onValueChange={(v) => handleModeChange(v as GraphMode)}>
                  <SelectTrigger data-testid="select-graph-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="people">People Graph</SelectItem>
                    <SelectItem value="social-accounts">Social Account Graph</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {graphMode === 'people' && (
                <>
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
                      <Popover open={peopleSearchOpen} onOpenChange={setPeopleSearchOpen}>
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
                                      setPeopleSearchOpen(false);
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
                </>
              )}

              {graphMode === 'social-accounts' && (
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
                    <Popover open={accountSearchOpen} onOpenChange={setAccountSearchOpen}>
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
                                    setAccountSearchOpen(false);
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
