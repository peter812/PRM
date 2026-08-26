import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, Users, RefreshCw, ExternalLink, ShieldCheck, AtSign, User, Sparkles, Plus, Share2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";
import type { SocialAccountWithCurrentProfile } from "@shared/schema";

export interface PersonCrowdMemberDetail {
  id: string;
  entityType?: "person";
  firstName: string;
  lastName: string;
  imageUrl: string | null;
  company: string | null;
  title: string | null;
  connectionStrength: number;
}

export interface SocialAccountCrowdMemberDetail {
  id: string;
  entityType?: "social_account";
  username: string;
  platform?: string;
  nickname: string | null;
  imageUrl: string | null;
  connectionStrength: number;
  ownerPersonId: string | null;
  ownerPersonName: string | null;
}

export type CrowdMemberDetail = PersonCrowdMemberDetail | SocialAccountCrowdMemberDetail;

interface TaskProgressResponse {
  status: "pending" | "in_progress" | "completed" | "failed";
  progress: number;
  progressMessage: string;
}

interface CrowdTabProps {
  groupId: string;
  centerAccountId: string | null;
  crowdLastCalculatedAt: string | null;
  crowdMode?: string | null;
  crowdFollowThreshold?: number | null;
  onNavigateToSocialTab?: () => void;
}

export function CrowdTab({
  groupId,
  centerAccountId,
  crowdLastCalculatedAt,
  crowdMode = "social_accounts",
  crowdFollowThreshold = 5,
  onNavigateToSocialTab,
}: CrowdTabProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const activeCrowdMode = crowdMode || "social_accounts";
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number>(crowdFollowThreshold ?? 5);

  useEffect(() => {
    if (typeof crowdFollowThreshold === "number") {
      setThreshold(crowdFollowThreshold);
    }
  }, [crowdFollowThreshold]);

  // Fetch group social accounts to find center account info
  const { data: groupAccounts = [], isLoading: isAccountsLoading } = useQuery<SocialAccountWithCurrentProfile[]>({
    queryKey: ["/api/groups", groupId, "social-accounts"],
    queryFn: async () => {
      const res = await fetch(`/api/groups/${groupId}/social-accounts`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch group social accounts");
      return res.json();
    },
  });

  // Queries
  const { data: crowdMembers, isLoading: isCrowdLoading } = useQuery<CrowdMemberDetail[]>({
    queryKey: ["/api/groups", groupId, "crowd"],
    enabled: !!centerAccountId,
  });

  // Task execution query
  const { data: taskStatus } = useQuery<TaskProgressResponse>({
    queryKey: ["/api/potential-groups/results", currentTaskId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/potential-groups/results/${currentTaskId}`);
      return res.json();
    },
    enabled: !!currentTaskId,
    refetchInterval: (query) => {
      const data = query.state.data as TaskProgressResponse | undefined;
      if (!data || data.status === "completed" || data.status === "failed") {
        return false;
      }
      return 1500;
    },
  });

  // Track task complete to invalidate queries
  if (taskStatus?.status === "completed" && currentTaskId) {
    setCurrentTaskId(null);
    queryClient.invalidateQueries({ queryKey: [`/api/groups/${groupId}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "crowd"] });
    toast({
      title: "Recalculation complete",
      description: "Successfully updated crowd list.",
    });
  } else if (taskStatus?.status === "failed" && currentTaskId) {
    setCurrentTaskId(null);
    toast({
      title: "Recalculation failed",
      description: "An error occurred during calculation.",
      variant: "destructive",
    });
  }

  const updateCrowdModeMutation = useMutation({
    mutationFn: async (mode: "social_accounts" | "person_profiles") => {
      const res = await apiRequest("PATCH", `/api/groups/${groupId}`, {
        crowdMode: mode,
      });
      return res.json();
    },
    onSuccess: (_, mode) => {
      queryClient.invalidateQueries({ queryKey: [`/api/groups/${groupId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "crowd"] });
      toast({
        title: "Crowd mode updated",
        description: `Switched to ${mode === "social_accounts" ? "Social Account Only" : "Person Profiles"}. Recalculate crowd to refresh the list.`,
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to update crowd mode",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const updateThresholdMutation = useMutation({
    mutationFn: async (newThreshold: number) => {
      const res = await apiRequest("PATCH", `/api/groups/${groupId}`, {
        crowdFollowThreshold: newThreshold,
      });
      return res.json();
    },
    onSuccess: (_, newThreshold) => {
      queryClient.invalidateQueries({ queryKey: [`/api/groups/${groupId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "crowd"] });
      toast({
        title: "Threshold updated",
        description: `Crowd membership threshold set to ${newThreshold}+ followers. Recalculate crowd to update membership.`,
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to update threshold",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const recalculateCrowdMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/groups/${groupId}/calculate-crowd`);
      return res.json() as Promise<{ taskId: string }>;
    },
    onSuccess: (data) => {
      setCurrentTaskId(data.taskId);
      toast({
        title: "Recalculation queued",
        description: "Calculation is running in the background...",
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to recalculate crowd",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Find linked center account details from group accounts
  const centerAccount = groupAccounts.find((a) => a.id === centerAccountId);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Mode & Threshold Configuration Card */}
      <Card className="border-muted bg-card shadow-sm divide-y divide-border">
        {/* Mode Switcher */}
        <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Crowd Calculation Mode
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {activeCrowdMode === "social_accounts"
                ? "Social Account Only: Computes crowds across individual social media handles (new feature)"
                : "Person Profiles: Aggregates multiple social handles by individual person profile (legacy mode)"}
            </p>
          </div>

          <Tabs
            value={activeCrowdMode}
            onValueChange={(val) => updateCrowdModeMutation.mutate(val as "social_accounts" | "person_profiles")}
            className="w-full sm:w-auto"
          >
            <TabsList className="grid grid-cols-2 w-full sm:w-auto h-9">
              <TabsTrigger value="social_accounts" className="text-xs flex items-center gap-1.5 px-3">
                <AtSign className="h-3.5 w-3.5" />
                Social Account Only
              </TabsTrigger>
              <TabsTrigger value="person_profiles" className="text-xs flex items-center gap-1.5 px-3">
                <User className="h-3.5 w-3.5" />
                Person Profile
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>

        {/* Membership Threshold Slider */}
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                Crowd Membership Rule (Follows Threshold)
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Must follow at least <strong>{threshold}</strong> {threshold === 1 ? "follower" : "followers"} of this group's Center Account to be included in the crowd.
              </p>
            </div>
            <Badge variant="secondary" className="self-start sm:self-auto font-mono text-xs px-2.5 py-1 bg-primary/10 text-primary border border-primary/20">
              {threshold}+ mutual {threshold === 1 ? "follower" : "followers"} {threshold === 5 ? "(Default)" : ""}
            </Badge>
          </div>

          <div className="pt-2 px-1 space-y-2">
            <Slider
              value={[threshold]}
              min={1}
              max={6}
              step={1}
              onValueChange={([val]) => setThreshold(val)}
              onValueCommit={([val]) => updateThresholdMutation.mutate(val)}
              className="w-full"
              data-testid="slider-crowd-threshold"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground font-mono px-0.5">
              <span className={threshold === 1 ? "text-primary font-bold" : ""}>1</span>
              <span className={threshold === 2 ? "text-primary font-bold" : ""}>2</span>
              <span className={threshold === 3 ? "text-primary font-bold" : ""}>3</span>
              <span className={threshold === 4 ? "text-primary font-bold" : ""}>4</span>
              <span className={threshold === 5 ? "text-primary font-bold" : ""}>5 (Default)</span>
              <span className={threshold === 6 ? "text-primary font-bold" : ""}>6</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Onboarding View: No Center Account Linked */}
      {!centerAccountId ? (
        <Card className="border-dashed border-primary/25 shadow-sm bg-muted/5">
          <CardHeader className="text-center pb-3">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
              <Share2 className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl">Center Account Required</CardTitle>
            <CardDescription className="max-w-md mx-auto">
              Crowd calculation analyzes followers of a designated <strong>Center Account</strong>.
              All social accounts are managed in the <strong>Social Accounts</strong> section, where you can add accounts and set 1 account as the Center Account.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center pt-2 pb-6">
            <Button
              onClick={onNavigateToSocialTab}
              className="flex items-center gap-2"
              data-testid="button-goto-social-accounts"
            >
              <Plus className="h-4 w-4" />
              Manage Social Accounts
            </Button>
            {groupAccounts.length > 0 && (
              <p className="text-xs text-muted-foreground mt-3">
                This group has {groupAccounts.length} social account{groupAccounts.length > 1 ? "s" : ""}. Designate 1 as the Center Account in the Social Accounts tab.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        /* Active View: Center Account Linked */
        <div className="space-y-6">
          <Card className="shadow-sm border-muted">
            <CardContent className="pt-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <Avatar className="w-16 h-16 border-2 border-primary/20">
                  {centerAccount?.currentProfile?.imageUrl && (
                    <AvatarImage src={centerAccount.currentProfile.imageUrl} alt={centerAccount.username} />
                  )}
                  <AvatarFallback className="bg-primary/5 text-lg text-primary font-medium">
                    {getInitials(centerAccount?.currentProfile?.nickname || centerAccount?.username || "C")}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="text-lg font-semibold flex items-center gap-1.5">
                    {centerAccount?.currentProfile?.nickname || (centerAccount ? `@${centerAccount.username}` : "Center Account")}
                    <Badge variant="default" className="text-xs uppercase px-2 font-normal bg-amber-500 hover:bg-amber-600 text-white">
                      Center Account
                    </Badge>
                  </h3>
                  {centerAccount && (
                    <p className="text-sm text-muted-foreground">@{centerAccount.username}</p>
                  )}
                  {crowdLastCalculatedAt && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Last calculated: {new Date(crowdLastCalculatedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {onNavigateToSocialTab && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-9"
                    onClick={onNavigateToSocialTab}
                    data-testid="button-change-center-account"
                  >
                    Change Center Account
                  </Button>
                )}

                <Button
                  className="flex items-center gap-2"
                  disabled={recalculateCrowdMutation.isPending || !!currentTaskId}
                  onClick={() => recalculateCrowdMutation.mutate()}
                  data-testid="button-recalculate-crowd"
                >
                  <RefreshCw className={`h-4 w-4 ${currentTaskId ? "animate-spin" : ""}`} />
                  Recalculate Crowd
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Active Task Progress Bar */}
          {currentTaskId && taskStatus && (
            <Card className="border-primary/20 shadow-sm p-4 space-y-3 bg-primary/5">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium text-primary flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {taskStatus.progressMessage || "Calculating crowd membership..."}
                </span>
                <span className="text-xs font-mono">{taskStatus.progress}%</span>
              </div>
              <Progress value={taskStatus.progress} className="h-2 w-full bg-muted-foreground/10" />
            </Card>
          )}

          {/* Crowd List */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Crowd Members ({crowdMembers?.length || 0})
              </h2>
              <Badge variant="outline" className="text-xs capitalize">
                Mode: {activeCrowdMode === "social_accounts" ? "Social Accounts Only" : "Person Profiles (Legacy)"}
              </Badge>
            </div>

            {isCrowdLoading ? (
              <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-2" />
                Loading crowd members...
              </div>
            ) : crowdMembers && crowdMembers.length > 0 ? (
              <Card className="divide-y border border-muted shadow-sm">
                {crowdMembers.map((member) => {
                  const isSocial = "username" in member;

                  if (isSocial) {
                    const saMember = member as SocialAccountCrowdMemberDetail;
                    return (
                      <div key={saMember.id} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar className="w-10 h-10">
                            {saMember.imageUrl && <AvatarImage src={saMember.imageUrl} />}
                            <AvatarFallback className="bg-primary/5 text-sm">
                              {getInitials(saMember.nickname || saMember.username)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold text-sm truncate">
                                {saMember.nickname || `@${saMember.username}`}
                              </h4>
                              {saMember.nickname && (
                                <span className="text-xs text-muted-foreground truncate">@{saMember.username}</span>
                              )}
                              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                                {saMember.platform || "Instagram"}
                              </Badge>
                            </div>
                            {saMember.ownerPersonName && (
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                Linked person:{" "}
                                <button
                                  className="text-primary hover:underline font-medium"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (saMember.ownerPersonId) navigate(`/person/${saMember.ownerPersonId}`);
                                  }}
                                >
                                  {saMember.ownerPersonName}
                                </button>
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <Badge variant="secondary" className="text-xs flex items-center gap-1 font-normal bg-muted">
                            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                            Follows {saMember.connectionStrength} followers
                          </Badge>
                        </div>
                      </div>
                    );
                  }

                  const pMember = member as PersonCrowdMemberDetail;
                  return (
                    <div key={pMember.id} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar className="w-10 h-10">
                          {pMember.imageUrl && <AvatarImage src={pMember.imageUrl} />}
                          <AvatarFallback className="bg-primary/5 text-sm">
                            {getInitials(`${pMember.firstName} ${pMember.lastName}`)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <h4 className="font-semibold text-sm truncate">
                            {pMember.firstName} {pMember.lastName}
                          </h4>
                          <p className="text-xs text-muted-foreground truncate">
                            {pMember.title ? `${pMember.title} at ` : ""}{pMember.company || "No company"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <Badge variant="secondary" className="text-xs flex items-center gap-1 font-normal bg-muted">
                          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                          Follows {pMember.connectionStrength} followers
                        </Badge>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(`/person/${pMember.id}`)}>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </Card>
            ) : (
              <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed h-48">
                <Users className="h-10 w-10 text-muted-foreground/30 mb-2" />
                <CardTitle className="text-sm font-medium text-muted-foreground">No crowd members found</CardTitle>
                <p className="text-xs text-muted-foreground max-w-sm mt-1">
                  Queue crowd calculation to scan follows and build the crowd list under the selected mode.
                </p>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
