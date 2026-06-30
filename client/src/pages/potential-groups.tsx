import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Network, Users, Play, Loader2, Sparkles, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";
import type { Person, SocialAccount } from "@shared/schema";

interface PotentialGroupResult {
  suggestedName: string;
  memberIds: string[];
  density: number;
  globalDensity: number;
  densityRatio: number;
  internalEdgesCount: number;
}

interface AnalysisTaskResponse {
  status: "pending" | "in_progress" | "completed" | "failed";
  progress: number;
  progressMessage: string;
  results: PotentialGroupResult[];
}

export default function PotentialGroupsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Settings state
  const [entityType, setEntityType] = useState<"people" | "social_accounts">("people");
  const [linkDefinition, setLinkDefinition] = useState<"any" | "mutual" | "family">("any");
  const [minGroupSize, setMinGroupSize] = useState<number>(3);
  const [minDensityMultiplier, setMinDensityMultiplier] = useState<number>(1.5);

  // Task running state
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);

  // Dialog/Modal state for creating a group
  const [selectedResult, setSelectedResult] = useState<PotentialGroupResult | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#8b5cf6");
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());

  // Fetch all people and social accounts for rendering details/names
  const { data: peopleList } = useQuery<Person[]>({
    queryKey: ["/api/people"],
    enabled: entityType === "people" || selectedResult !== null,
  });

  const { data: socialAccountsList } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
    enabled: entityType === "social_accounts" || selectedResult !== null,
  });

  // Task execution query
  const { data: taskStatus } = useQuery<AnalysisTaskResponse>({
    queryKey: ["/api/potential-groups/results", currentTaskId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/potential-groups/results/${currentTaskId}`);
      return res.json();
    },
    enabled: !!currentTaskId,
    refetchInterval: (query) => {
      const data = query.state.data as AnalysisTaskResponse | undefined;
      if (!data || data.status === "completed" || data.status === "failed") {
        return false;
      }
      return 1500; // poll every 1.5s
    },
  });

  // Mutator to trigger analysis task
  const runAnalysisMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/potential-groups/analyze", {
        entityType,
        linkDefinition: entityType === "social_accounts" && linkDefinition === "family" ? "mutual" : linkDefinition,
        minGroupSize,
        minDensityMultiplier,
      });
      return res.json() as Promise<{ taskId: string }>;
    },
    onSuccess: (data) => {
      setCurrentTaskId(data.taskId);
      toast({
        title: "Analysis started",
        description: "Scanning network connections to find clusters...",
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to start analysis",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Mutator to create group
  const createGroupMutation = useMutation({
    mutationFn: async (payload: { name: string; color: string; members: string[] }) => {
      const res = await apiRequest("POST", "/api/potential-groups/create", payload);
      return res.json() as Promise<{ success: boolean; groupId: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({
        title: "Group created",
        description: `Successfully created "${newGroupName}" with ${selectedMemberIds.size} members.`,
      });
      setSelectedResult(null);
      navigate(`/group/${data.groupId}`);
    },
    onError: (err) => {
      toast({
        title: "Failed to create group",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Auto reset link definition if changing entity types
  useEffect(() => {
    if (entityType === "social_accounts" && linkDefinition === "family") {
      setLinkDefinition("mutual");
    }
  }, [entityType]);

  const handleOpenPromoteDialog = (result: PotentialGroupResult) => {
    setSelectedResult(result);
    setNewGroupName(result.suggestedName);
    setNewGroupColor("#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0"));
    setSelectedMemberIds(new Set(result.memberIds));
  };

  const handleToggleMember = (id: string) => {
    const updated = new Set(selectedMemberIds);
    if (updated.has(id)) {
      if (updated.size > 2) { // Require at least 2 members
        updated.delete(id);
      } else {
        toast({
          title: "Cannot remove member",
          description: "A group must have at least 2 members.",
          variant: "destructive",
        });
      }
    } else {
      updated.add(id);
    }
    setSelectedMemberIds(updated);
  };

  const handleCreateGroup = () => {
    if (!newGroupName.trim()) {
      return toast({
        title: "Group name is required",
        variant: "destructive",
      });
    }
    createGroupMutation.mutate({
      name: newGroupName.trim(),
      color: newGroupColor,
      members: Array.from(selectedMemberIds),
    });
  };

  const getNodeDetails = (id: string) => {
    if (entityType === "people") {
      const person = peopleList?.find(p => p.id === id);
      return person ? { name: `${person.firstName} ${person.lastName}`, image: person.imageUrl } : { name: "Unknown", image: null };
    } else {
      const acc = socialAccountsList?.find(a => a.id === id);
      return acc ? { name: `@${acc.username}`, image: null } : { name: "Unknown", image: null };
    }
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="border-b px-6 py-4 bg-background/50 sticky top-0 z-10 backdrop-blur-xl">
        <Button variant="ghost" size="sm" onClick={() => navigate("/groups")} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Groups
        </Button>
        <div className="flex items-center gap-3">
          <Sparkles className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-semibold">Find Potential Groups</h1>
            <p className="text-muted-foreground">Discover closely connected communities using graph clustering algorithms</p>
          </div>
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1 border-primary/20 shadow-md">
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <Network className="h-5 w-5 text-primary" />
              Clustering Parameters
            </CardTitle>
            <CardDescription>Configure target entities and edge filters</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="entity-type">Target Scope</Label>
              <Select value={entityType} onValueChange={(val: any) => setEntityType(val)}>
                <SelectTrigger id="entity-type">
                  <SelectValue placeholder="Select scope..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="people">People Network</SelectItem>
                  <SelectItem value="social_accounts">Social Accounts Network</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="link-definition">Link Type</Label>
              <Select value={linkDefinition} onValueChange={(val: any) => setLinkDefinition(val)}>
                <SelectTrigger id="link-definition">
                  <SelectValue placeholder="Select link type..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any connection (Loose)</SelectItem>
                  <SelectItem value="mutual">Mutual connections (Strong)</SelectItem>
                  {entityType === "people" && (
                    <SelectItem value="family">Family/Lineage only</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label>Min Group Size: {minGroupSize}</Label>
              </div>
              <Slider
                min={2}
                max={10}
                step={1}
                value={[minGroupSize]}
                onValueChange={(val) => setMinGroupSize(val[0])}
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label>Min Density Multiplier: {minDensityMultiplier}x</Label>
              </div>
              <Slider
                min={1.0}
                max={5.0}
                step={0.1}
                value={[minDensityMultiplier]}
                onValueChange={(val) => setMinDensityMultiplier(val[0])}
              />
              <p className="text-xs text-muted-foreground">
                Only suggest clusters that are at least this many times more dense than the entire network.
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              disabled={runAnalysisMutation.isPending || (currentTaskId !== null && taskStatus?.status !== "completed" && taskStatus?.status !== "failed")}
              onClick={() => runAnalysisMutation.mutate()}
            >
              {runAnalysisMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Run Clustering Analysis
                </>
              )}
            </Button>
          </CardFooter>
        </Card>

        <div className="lg:col-span-2 space-y-6">
          {currentTaskId === null ? (
            <Card className="flex flex-col items-center justify-center p-12 text-center h-[400px] border-dashed">
              <Network className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <CardTitle className="text-lg font-medium text-muted-foreground">No analysis run yet</CardTitle>
              <p className="text-sm text-muted-foreground max-w-sm mt-2">
                Adjust parameters on the left and run the analysis to discover potential groups.
              </p>
            </Card>
          ) : taskStatus?.status === "pending" || taskStatus?.status === "in_progress" ? (
            <Card className="p-12 flex flex-col items-center justify-center text-center h-[400px]">
              <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
              <CardTitle className="text-lg mb-2">Analyzing Network...</CardTitle>
              <p className="text-sm text-muted-foreground mb-6">{taskStatus.progressMessage || "Calculating community structures..."}</p>
              <div className="w-full max-w-md space-y-2">
                <Progress value={taskStatus.progress} className="h-2 w-full" />
                <span className="text-xs text-muted-foreground">{taskStatus.progress}% complete</span>
              </div>
            </Card>
          ) : taskStatus?.status === "failed" ? (
            <Card className="p-12 flex flex-col items-center justify-center text-center h-[400px] border-destructive/20">
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                <ArrowLeft className="h-8 w-8 text-destructive rotate-45" />
              </div>
              <CardTitle className="text-lg text-destructive mb-2">Analysis Failed</CardTitle>
              <p className="text-sm text-muted-foreground max-w-md">
                An error occurred during clustering. Make sure you have enough connected accounts or relationships in your network.
              </p>
            </Card>
          ) : taskStatus?.results && taskStatus.results.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {taskStatus.results.map((result, idx) => (
                <Card key={idx} className="flex flex-col hover-elevate transition-all border border-muted">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start gap-2">
                      <CardTitle className="text-lg font-semibold line-clamp-2 leading-snug">
                        {result.suggestedName}
                      </CardTitle>
                      <Badge className="bg-primary/20 text-primary border-none shrink-0">
                        {result.densityRatio.toFixed(1)}x density
                      </Badge>
                    </div>
                    <CardDescription className="text-xs">
                      Contains {result.memberIds.length} connected entities
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 pb-4">
                    <div className="flex flex-wrap gap-2 items-center max-h-24 overflow-auto py-1">
                      {result.memberIds.slice(0, 8).map(mId => {
                        const info = getNodeDetails(mId);
                        return (
                          <div key={mId} className="flex items-center gap-1.5 bg-muted px-2 py-1 rounded-full text-xs">
                            {info.image && (
                              <Avatar className="w-4 h-4">
                                <AvatarImage src={info.image} />
                                <AvatarFallback className="text-[8px]">{getInitials(info.name)}</AvatarFallback>
                              </Avatar>
                            )}
                            <span className="font-medium truncate max-w-24">{info.name}</span>
                          </div>
                        );
                      })}
                      {result.memberIds.length > 8 && (
                        <Badge variant="outline" className="text-xs">
                          +{result.memberIds.length - 8} more
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <Button variant="outline" className="w-full border-primary/30 hover:bg-primary/10" onClick={() => handleOpenPromoteDialog(result)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Accept as Group
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="flex flex-col items-center justify-center p-12 text-center h-[400px]">
              <Users className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <CardTitle className="text-lg font-medium text-muted-foreground">No groups discovered</CardTitle>
              <p className="text-sm text-muted-foreground max-w-sm mt-2">
                No clusters matching your size and density constraints were found in the selected scope. Try lowering the density multiplier.
              </p>
            </Card>
          )}
        </div>
      </div>

      {selectedResult && (
        <Dialog open={selectedResult !== null} onOpenChange={(open) => !open && setSelectedResult(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-xl">Create Group from Analysis</DialogTitle>
              <DialogDescription>
                Promote this clustered community into a real group. You can adjust the name, color, and members list.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="group-name">Group Name</Label>
                <Input
                  id="group-name"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Enter group name..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="group-color">Theme Color</Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="group-color"
                    type="color"
                    value={newGroupColor}
                    onChange={(e) => setNewGroupColor(e.target.value)}
                    className="w-12 h-10 p-1 cursor-pointer"
                  />
                  <span className="text-sm font-mono uppercase">{newGroupColor}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Members ({selectedMemberIds.size} selected)</Label>
                <div className="border rounded-md max-h-48 overflow-y-auto p-2 space-y-1">
                  {selectedResult.memberIds.map(mId => {
                    const info = getNodeDetails(mId);
                    const isSelected = selectedMemberIds.has(mId);
                    return (
                      <div
                        key={mId}
                        onClick={() => handleToggleMember(mId)}
                        className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors text-sm ${isSelected ? 'bg-primary/10' : 'hover:bg-muted'}`}
                      >
                        <div className="flex items-center gap-2">
                          {info.image && (
                            <Avatar className="w-6 h-6">
                              <AvatarImage src={info.image} />
                              <AvatarFallback className="text-[10px]">{getInitials(info.name)}</AvatarFallback>
                            </Avatar>
                          )}
                          <span className="font-medium">{info.name}</span>
                        </div>
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/30'}`}>
                          {isSelected && <Check className="h-3 w-3" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setSelectedResult(null)}>Cancel</Button>
              <Button onClick={handleCreateGroup} disabled={createGroupMutation.isPending}>
                {createGroupMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Group"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
