import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, Users, RefreshCw, AlertCircle, ExternalLink, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";
import type { SocialAccountWithCurrentProfile } from "@shared/schema";

interface CrowdMemberDetail {
  id: string;
  firstName: string;
  lastName: string;
  imageUrl: string | null;
  company: string | null;
  title: string | null;
  connectionStrength: number;
}

interface TaskProgressResponse {
  status: "pending" | "in_progress" | "completed" | "failed";
  progress: number;
  progressMessage: string;
}

interface CrowdTabProps {
  groupId: string;
  centerAccountId: string | null;
  crowdLastCalculatedAt: string | null;
}

export function CrowdTab({ groupId, centerAccountId, crowdLastCalculatedAt }: CrowdTabProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);

  // Queries
  const { data: socialAccounts, isLoading: isAccountsLoading } = useQuery<SocialAccountWithCurrentProfile[]>({
    queryKey: ["/api/social-accounts"],
  });

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
    queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
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

  // Mutations
  const linkCenterAccountMutation = useMutation({
    mutationFn: async (accId: string) => {
      const res = await apiRequest("PATCH", `/api/groups/${groupId}`, {
        centerAccountId: accId || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      toast({
        title: "Center account updated",
        description: "Assigned center account for crowd analysis.",
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to update center account",
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

  const handleLinkCenterAccount = () => {
    if (!selectedAccountId) return;
    linkCenterAccountMutation.mutate(selectedAccountId);
  };

  const handleUnlinkCenterAccount = () => {
    linkCenterAccountMutation.mutate("");
  };

  // Find linked center account details
  const centerAccount = socialAccounts?.find(a => a.id === centerAccountId);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Onboarding View: No Center Account Linked */}
      {!centerAccountId ? (
        <Card className="border-dashed border-primary/20 shadow-md">
          <CardHeader>
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl">Assign Center Account</CardTitle>
            <CardDescription>
              Assign a social media account to act as the focal point for this group's crowd analysis. We will calculate the crowd based on people who follow this account's followers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="center-account-select">Select Social Account</Label>
              {isAccountsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading social accounts...
                </div>
              ) : socialAccounts && socialAccounts.length > 0 ? (
                <div className="flex gap-3">
                  <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                    <SelectTrigger id="center-account-select" className="w-full max-w-md">
                      <SelectValue placeholder="Choose a social media account..." />
                    </SelectTrigger>
                    <SelectContent>
                      {socialAccounts.map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.currentProfile?.nickname || acc.username} (@{acc.username})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleLinkCenterAccount} disabled={!selectedAccountId || linkCenterAccountMutation.isPending}>
                    {linkCenterAccountMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Link Account"}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-yellow-600 bg-yellow-50 dark:bg-yellow-950/20 p-3 rounded-md">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  No social accounts available. Please add some social accounts first.
                </div>
              )}
            </div>
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
                    {centerAccount?.currentProfile?.nickname || centerAccount?.username}
                    <Badge variant="outline" className="text-xs uppercase px-1.5 font-normal bg-muted">
                      Center Account
                    </Badge>
                  </h3>
                  <p className="text-sm text-muted-foreground">@{centerAccount?.username}</p>
                  {crowdLastCalculatedAt && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Last calculated: {new Date(crowdLastCalculatedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost" className="text-muted-foreground text-xs h-9 hover:bg-destructive/10 hover:text-destructive" onClick={handleUnlinkCenterAccount} disabled={linkCenterAccountMutation.isPending}>
                  Unlink Account
                </Button>

                <Button
                  className="flex items-center gap-2"
                  disabled={recalculateCrowdMutation.isPending || !!currentTaskId}
                  onClick={() => recalculateCrowdMutation.mutate()}
                >
                  <RefreshCw className={`h-4 w-4 ${currentTaskId ? 'animate-spin' : ''}`} />
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
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Crowd Members ({crowdMembers?.length || 0})
            </h2>

            {isCrowdLoading ? (
              <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-2" />
                Loading crowd members...
              </div>
            ) : crowdMembers && crowdMembers.length > 0 ? (
              <Card className="divide-y border border-muted shadow-sm">
                {crowdMembers.map((member) => (
                  <div key={member.id} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="w-10 h-10">
                        {member.imageUrl && <AvatarImage src={member.imageUrl} />}
                        <AvatarFallback className="bg-primary/5 text-sm">
                          {getInitials(`${member.firstName} ${member.lastName}`)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <h4 className="font-semibold text-sm truncate">
                          {member.firstName} {member.lastName}
                        </h4>
                        <p className="text-xs text-muted-foreground truncate">
                          {member.title ? `${member.title} at ` : ""}{member.company || "No company"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <Badge variant="secondary" className="text-xs flex items-center gap-1 font-normal bg-muted">
                        <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                        Follows {member.connectionStrength} followers
                      </Badge>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(`/person/${member.id}`)}>
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </Card>
            ) : (
              <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed h-48">
                <Users className="h-10 w-10 text-muted-foreground/30 mb-2" />
                <CardTitle className="text-sm font-medium text-muted-foreground">No crowd members found</CardTitle>
                <p className="text-xs text-muted-foreground max-w-sm mt-1">
                  Queue crowd calculation to scan follows and build the crowd list.
                </p>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
