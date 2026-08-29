import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  Network,
  Users,
  Play,
  Loader2,
  Sparkles,
  Plus,
  Check,
  Sliders,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";

interface MemberPreview {
  id: string;
  username: string;
  nickname?: string | null;
  imageUrl?: string | null;
  bioSummary?: string | null;
}

interface PotentialGroupResult {
  id: string;
  suggestedName: string;
  memberIds: string[];
  memberCount: number;
  memberPreviews: MemberPreview[];
  topKeywords: string[];
  cohesionScore: number;
  density: number;
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
  const [entityType, setEntityType] = useState<"people" | "social_accounts">("social_accounts");
  const [strategy, setStrategy] = useState<"hybrid" | "co_following" | "network_modularity" | "bio_keywords">("hybrid");
  const [linkDefinition, setLinkDefinition] = useState<"any" | "mutual" | "family">("any");
  const [minGroupSize, setMinGroupSize] = useState<number>(3);
  const [maxGroupSize, setMaxGroupSize] = useState<number>(50);
  const [resolution, setResolution] = useState<number>(1.0);

  // Task running state
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);

  // Dialog/Modal state for creating a group
  const [selectedResult, setSelectedResult] = useState<PotentialGroupResult | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#8b5cf6");
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());

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
      return 1200; // poll every 1.2s
    },
  });

  // Mutator to trigger analysis task
  const runAnalysisMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/potential-groups/analyze", {
        entityType,
        strategy,
        linkDefinition: entityType === "social_accounts" && linkDefinition === "family" ? "mutual" : linkDefinition,
        minGroupSize,
        maxGroupSize,
        resolution,
      });
      return res.json() as Promise<{ taskId: string }>;
    },
    onSuccess: (data) => {
      setCurrentTaskId(data.taskId);
      toast({
        title: "Analysis started",
        description: "Scanning multi-signal graph connections to discover groups...",
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
    mutationFn: async (payload: { name: string; color: string; members: string[]; entityType: string }) => {
      const res = await apiRequest("POST", "/api/potential-groups/create", payload);
      return res.json() as Promise<{ success: boolean; groupId: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      toast({
        title: "Group created",
        description: `Successfully created "${newGroupName}" with ${selectedMemberIds.size} members.`,
      });
      setSelectedResult(null);
      navigate(`/group/${data.groupId}${entityType === "social_accounts" ? "?tab=social" : ""}`);
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
  }, [entityType, linkDefinition]);

  const handleOpenPromoteDialog = (result: PotentialGroupResult) => {
    setSelectedResult(result);
    setNewGroupName(result.suggestedName);
    setNewGroupColor("#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0"));
    setSelectedMemberIds(new Set(result.memberIds));
  };

  const handleToggleMember = (id: string) => {
    const updated = new Set(selectedMemberIds);
    if (updated.has(id)) {
      if (updated.size > 2) {
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
      entityType,
    });
  };

  return (
    <TooltipProvider>
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
              <p className="text-muted-foreground">
                Discover communities and social circles using multi-signal graph algorithms & modularity detection
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Clustering Controls */}
          <Card className="lg:col-span-1 border-primary/20 shadow-md h-fit">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl flex items-center gap-2">
                <Sliders className="h-5 w-5 text-primary" />
                Discovery Engine
              </CardTitle>
              <CardDescription>Configure clustering signals & granularity</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="entity-type">Target Scope</Label>
                <Select value={entityType} onValueChange={(val: any) => setEntityType(val)}>
                  <SelectTrigger id="entity-type">
                    <SelectValue placeholder="Select scope..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="social_accounts">Social Accounts Network (25K+)</SelectItem>
                    <SelectItem value="people">People Network Profiles</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {entityType === "social_accounts" ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="strategy">Clustering Strategy</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-pointer" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        Select which network signals to prioritize when grouping accounts.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Select value={strategy} onValueChange={(val: any) => setStrategy(val)}>
                    <SelectTrigger id="strategy">
                      <SelectValue placeholder="Select strategy..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hybrid">
                        ✨ Smart Multi-Signal (Recommended)
                      </SelectItem>
                      <SelectItem value="co_following">
                        👥 Shared Interests & Audience (Co-Follows)
                      </SelectItem>
                      <SelectItem value="network_modularity">
                        🌐 Direct Network Modularity (Louvain)
                      </SelectItem>
                      <SelectItem value="bio_keywords">
                        🏷️ Bio & Topic Keyword Clusters
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {strategy === "hybrid" && "Combines direct follows, shared followings, post co-mentions, and bio keywords."}
                    {strategy === "co_following" && "Clusters accounts that follow the same creators or peers (bipartite projection)."}
                    {strategy === "network_modularity" && "Maximizes modularity on direct and mutual follower connections."}
                    {strategy === "bio_keywords" && "Groups accounts sharing professional keywords, hashtags, and niche interests."}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="link-definition">Relationship Type</Label>
                  <Select value={linkDefinition} onValueChange={(val: any) => setLinkDefinition(val)}>
                    <SelectTrigger id="link-definition">
                      <SelectValue placeholder="Select link type..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any connection (Loose)</SelectItem>
                      <SelectItem value="mutual">Mutual connections (Strong)</SelectItem>
                      <SelectItem value="family">Family / Lineage only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <Label>Granularity (Resolution): {resolution.toFixed(1)}x</Label>
                  <span className="text-xs text-muted-foreground">
                    {resolution <= 0.7 ? "Broad Circles" : resolution >= 1.5 ? "Tight Subgroups" : "Balanced"}
                  </span>
                </div>
                <Slider
                  min={0.4}
                  max={2.5}
                  step={0.1}
                  value={[resolution]}
                  onValueChange={(val) => setResolution(val[0])}
                />
                <p className="text-xs text-muted-foreground">
                  Lower values discover larger communities; higher values split them into tight, specific friend circles.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <Label className="text-xs">Min Size: {minGroupSize}</Label>
                  <Slider
                    min={2}
                    max={12}
                    step={1}
                    value={[minGroupSize]}
                    onValueChange={(val) => setMinGroupSize(val[0])}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Max Size: {maxGroupSize}</Label>
                  <Slider
                    min={15}
                    max={100}
                    step={5}
                    value={[maxGroupSize]}
                    onValueChange={(val) => setMaxGroupSize(val[0])}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="pt-2">
              <Button
                className="w-full"
                disabled={
                  runAnalysisMutation.isPending ||
                  (currentTaskId !== null &&
                    taskStatus?.status !== "completed" &&
                    taskStatus?.status !== "failed")
                }
                onClick={() => runAnalysisMutation.mutate()}
              >
                {runAnalysisMutation.isPending ||
                (currentTaskId !== null &&
                  taskStatus?.status !== "completed" &&
                  taskStatus?.status !== "failed") ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Analyzing Network...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Discover Potential Groups
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>

          {/* Right Column: Results Grid */}
          <div className="lg:col-span-2 space-y-6">
            {currentTaskId === null ? (
              <Card className="flex flex-col items-center justify-center p-12 text-center h-[420px] border-dashed">
                <Network className="h-16 w-16 text-muted-foreground/30 mb-4" />
                <CardTitle className="text-lg font-medium text-muted-foreground">
                  Ready to discover groups
                </CardTitle>
                <p className="text-sm text-muted-foreground max-w-sm mt-2">
                  Select your preferred clustering strategy on the left and click "Discover Potential Groups" to analyze your 25K+ accounts.
                </p>
              </Card>
            ) : taskStatus?.status === "pending" || taskStatus?.status === "in_progress" ? (
              <Card className="p-12 flex flex-col items-center justify-center text-center h-[420px]">
                <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
                <CardTitle className="text-lg mb-2">Analyzing Network Signals...</CardTitle>
                <p className="text-sm text-muted-foreground mb-6">
                  {taskStatus.progressMessage || "Calculating Louvain community structures across graph..."}
                </p>
                <div className="w-full max-w-md space-y-2">
                  <Progress value={taskStatus.progress} className="h-2 w-full" />
                  <span className="text-xs text-muted-foreground">{taskStatus.progress}% complete</span>
                </div>
              </Card>
            ) : taskStatus?.status === "failed" ? (
              <Card className="p-12 flex flex-col items-center justify-center text-center h-[420px] border-destructive/20">
                <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                  <ArrowLeft className="h-8 w-8 text-destructive rotate-45" />
                </div>
                <CardTitle className="text-lg text-destructive mb-2">Analysis Failed</CardTitle>
                <p className="text-sm text-muted-foreground max-w-md">
                  An error occurred during clustering. Try using the Smart Multi-Signal strategy with a lower resolution setting.
                </p>
              </Card>
            ) : taskStatus?.results && taskStatus.results.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Discovered Groups ({taskStatus.results.length})
                  </h2>
                  <Badge variant="outline" className="text-xs">
                    Louvain Modularity
                  </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {taskStatus.results.map((result, idx) => (
                    <Card
                      key={result.id || idx}
                      className="flex flex-col hover-elevate transition-all border border-muted/80 shadow-sm"
                    >
                      <CardHeader className="pb-2.5">
                        <div className="flex justify-between items-start gap-2">
                          <CardTitle className="text-base font-semibold line-clamp-2 leading-snug">
                            {result.suggestedName}
                          </CardTitle>
                          <Badge className="bg-primary/15 text-primary hover:bg-primary/20 border-none shrink-0 text-xs">
                            {result.cohesionScore}% Cohesion
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap pt-1">
                          <span className="text-xs text-muted-foreground font-medium">
                            {result.memberCount} members
                          </span>
                          {result.topKeywords && result.topKeywords.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              {result.topKeywords.slice(0, 3).map((kw) => (
                                <Badge
                                  key={kw}
                                  variant="secondary"
                                  className="text-[10px] py-0 px-1.5 font-normal"
                                >
                                  #{kw}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </CardHeader>

                      <CardContent className="flex-1 pb-3">
                        <div className="flex flex-wrap gap-1.5 items-center max-h-24 overflow-y-auto py-1">
                          {(result.memberPreviews || []).slice(0, 10).map((member) => (
                            <Tooltip key={member.id}>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1.5 bg-muted/60 hover:bg-muted px-2 py-1 rounded-full text-xs cursor-default transition-colors">
                                  {member.imageUrl ? (
                                    <Avatar className="w-4 h-4">
                                      <AvatarImage src={member.imageUrl} />
                                      <AvatarFallback className="text-[8px]">
                                        {getInitials(member.username)}
                                      </AvatarFallback>
                                    </Avatar>
                                  ) : null}
                                  <span className="font-medium truncate max-w-24">
                                    @{member.username}
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">
                                <p className="font-semibold">@{member.username}</p>
                                {member.nickname && <p className="text-muted-foreground">{member.nickname}</p>}
                                {member.bioSummary && <p className="text-[11px] max-w-xs mt-1">{member.bioSummary}</p>}
                              </TooltipContent>
                            </Tooltip>
                          ))}
                          {result.memberCount > 10 && (
                            <Badge variant="outline" className="text-xs">
                              +{result.memberCount - 10} more
                            </Badge>
                          )}
                        </div>
                      </CardContent>

                      <CardFooter className="pt-0 pb-3">
                        <Button
                          variant="outline"
                          className="w-full border-primary/30 hover:bg-primary/10 text-xs font-medium"
                          onClick={() => handleOpenPromoteDialog(result)}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1.5" />
                          Accept as Group
                        </Button>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              </div>
            ) : (
              <Card className="flex flex-col items-center justify-center p-12 text-center h-[420px]">
                <Users className="h-16 w-16 text-muted-foreground/30 mb-4" />
                <CardTitle className="text-lg font-medium text-muted-foreground">
                  No groups discovered
                </CardTitle>
                <p className="text-sm text-muted-foreground max-w-sm mt-2">
                  No clusters matched your current parameters. Try switching to the <strong>Smart Multi-Signal</strong> strategy or lowering the resolution slider to discover broader circles.
                </p>
              </Card>
            )}
          </div>
        </div>

        {/* Promote Group Modal */}
        {selectedResult && (
          <Dialog
            open={selectedResult !== null}
            onOpenChange={(open) => !open && setSelectedResult(null)}
          >
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-xl">Create Group from Cluster</DialogTitle>
                <DialogDescription>
                  Promote this discovered community into an active group. You can customize the name, color, and included members.
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
                  <div className="flex items-center justify-between">
                    <Label>Members ({selectedMemberIds.size} selected)</Label>
                    <span className="text-xs text-muted-foreground">Click to toggle membership</span>
                  </div>
                  <div className="border rounded-md max-h-56 overflow-y-auto p-2 space-y-1">
                    {(selectedResult.memberPreviews || []).map((m) => {
                      const isSelected = selectedMemberIds.has(m.id);
                      return (
                        <div
                          key={m.id}
                          onClick={() => handleToggleMember(m.id)}
                          className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors text-sm ${
                            isSelected ? "bg-primary/10" : "hover:bg-muted opacity-60"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {m.imageUrl ? (
                              <Avatar className="w-6 h-6">
                                <AvatarImage src={m.imageUrl} />
                                <AvatarFallback className="text-[10px]">
                                  {getInitials(m.username)}
                                </AvatarFallback>
                              </Avatar>
                            ) : null}
                            <div>
                              <span className="font-medium">@{m.username}</span>
                              {m.nickname && (
                                <span className="text-xs text-muted-foreground ml-1.5">
                                  ({m.nickname})
                                </span>
                              )}
                            </div>
                          </div>
                          <div
                            className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                              isSelected
                                ? "bg-primary border-primary text-primary-foreground"
                                : "border-muted-foreground/30"
                            }`}
                          >
                            {isSelected && <Check className="h-3 w-3" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setSelectedResult(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateGroup}
                  disabled={createGroupMutation.isPending}
                >
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
    </TooltipProvider>
  );
}
