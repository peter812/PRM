import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Loader2, Edit2, Trash2, Plus, ExternalLink, Upload, FileText, CheckCircle2, UserPlus, Heart, MessageCircle, ImageIcon, Info, GitCompare } from "lucide-react";
import { GraphTriangleIcon } from "@/components/icons/graph-triangle-icon";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { isValidHexColor } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import type { SocialAccountWithCurrentProfile, Person, SocialAccountType, SocialAccountPost, SocialProfileVersion } from "@shared/schema";
import { Link } from "wouter";
import { SocialAccountDialog } from "@/components/social-account-dialog";
import { LinkFollowingAccountsDialog } from "@/components/link-following-accounts-dialog";
import { PersonDialog } from "@/components/person-dialog";
import { PostDialog } from "@/components/post-dialog";
import { PostDetailDialog } from "@/components/post-detail-dialog";
import { SiInstagram } from "react-icons/si";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export default function SocialAccountProfile() {
  const { uuid } = useParams<{ uuid: string }>();
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isLinkFollowingOpen, setIsLinkFollowingOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isCreatePersonOpen, setIsCreatePersonOpen] = useState(false);
  const [selectedInstagramFile, setSelectedInstagramFile] = useState<File | null>(null);
  const [instagramImportType, setInstagramImportType] = useState<"followers" | "following">("followers");
  const [isAddPostOpen, setIsAddPostOpen] = useState(false);
  const [isEditPostOpen, setIsEditPostOpen] = useState(false);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [isPostDetailOpen, setIsPostDetailOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<SocialAccountPost | null>(null);
  const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false);

  const { data: account, isLoading, isError, error } = useQuery<SocialAccountWithCurrentProfile>({
    queryKey: ["/api/social-accounts", uuid],
    enabled: !!uuid,
  });

  const { data: owner } = useQuery<Person>({
    queryKey: account?.ownerUuid ? [`/api/people/${account.ownerUuid}`] : [],
    enabled: !!account?.ownerUuid,
  });

  const { data: user } = useQuery<{ id: number; username: string; personId: string }>({
    queryKey: ["/api/user"],
  });

  const { data: mePerson } = useQuery<Person>({
    queryKey: user?.personId ? [`/api/people/${user.personId}`] : [],
    enabled: !!user?.personId,
  });

  const { data: socialAccountTypes } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  type PaginatedAccounts = { items: SocialAccountWithCurrentProfile[]; total: number; page: number; limit: number };

  const {
    data: followersData,
    fetchNextPage: fetchNextFollowersPage,
    hasNextPage: hasMoreFollowers,
    isFetchingNextPage: isFetchingMoreFollowers,
  } = useInfiniteQuery<PaginatedAccounts>({
    queryKey: ["/api/social-accounts", uuid, "followers"],
    queryFn: async ({ pageParam }) => {
      const res = await fetch(`/api/social-accounts/${uuid}/followers?page=${pageParam}&limit=20`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch followers");
      return res.json();
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = (lastPage.page - 1) * lastPage.limit + lastPage.items.length;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
    enabled: !!uuid,
  });

  const {
    data: followingData,
    fetchNextPage: fetchNextFollowingPage,
    hasNextPage: hasMoreFollowing,
    isFetchingNextPage: isFetchingMoreFollowing,
  } = useInfiniteQuery<PaginatedAccounts>({
    queryKey: ["/api/social-accounts", uuid, "following"],
    queryFn: async ({ pageParam }) => {
      const res = await fetch(`/api/social-accounts/${uuid}/following?page=${pageParam}&limit=20`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch following");
      return res.json();
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = (lastPage.page - 1) * lastPage.limit + lastPage.items.length;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
    enabled: !!uuid,
  });

  const followers = followersData?.pages.flatMap((p) => p.items) ?? [];
  const followersTotal = followersData?.pages[0]?.total ?? 0;
  const followingList = followingData?.pages.flatMap((p) => p.items) ?? [];
  const followingTotal = followingData?.pages[0]?.total ?? 0;

  // Query posts for this social account
  const { data: posts } = useQuery<SocialAccountPost[]>({
    queryKey: ["/api/social-accounts", uuid, "posts"],
    enabled: !!uuid,
  });

  // Query profile versions for info dialog
  const { data: profileVersions } = useQuery<SocialProfileVersion[]>({
    queryKey: ["/api/social-accounts", uuid, "profile-versions"],
    queryFn: async () => {
      const res = await fetch(`/api/social-accounts/${uuid}/profile-versions`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch profile versions");
      return res.json();
    },
    enabled: !!uuid && isInfoDialogOpen,
  });

  const linkPersonMutation = useMutation({
    mutationFn: async ({ personId, socialAccountId, existingUuids }: { personId: string; socialAccountId: string; existingUuids: string[] }) => {
      return await apiRequest("PATCH", `/api/people/${personId}`, {
        socialAccountUuids: [...existingUuids, socialAccountId],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", uuid] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({
        title: "Success",
        description: "Person linked to this account",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to link person to account",
        variant: "destructive",
      });
    },
  });

  const updateNotesMutation = useMutation({
    mutationFn: async (newNotes: string) => {
      return await apiRequest("PATCH", `/api/social-accounts/${uuid}`, {
        notes: newNotes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", uuid] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"], exact: false });
      toast({
        title: "Success",
        description: "Notes updated successfully",
      });
      setIsEditingNotes(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update notes",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", `/api/social-accounts/${uuid}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"], exact: false });
      toast({
        title: "Success",
        description: "Social account deleted successfully",
      });
      navigate("/social-accounts");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete social account",
        variant: "destructive",
      });
    },
  });

  const deletePostMutation = useMutation({
    mutationFn: async (postId: string) => {
      return await apiRequest("DELETE", `/api/social-account-posts/${postId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", uuid, "posts"] });
      toast({
        title: "Success",
        description: "Post deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete post",
        variant: "destructive",
      });
    },
  });

  const summarizePostMutation = useMutation({
    mutationFn: async (postId: string) => {
      await apiRequest("POST", `/api/social-account-posts/${postId}/summarize`);
    },
    onSuccess: () => {
      toast({
        title: "Summarization Scheduled",
        description: "A background task has been scheduled to generate a summary for this post.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", uuid, "posts"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to schedule summarization",
        variant: "destructive",
      });
    },
  });

  const importInstagramMutation = useMutation({
    mutationFn: async ({ file, accountId, importType }: { file: File; accountId: string; importType: "followers" | "following" }) => {
      const formData = new FormData();
      formData.append("csv", file);
      formData.append("accountId", accountId);
      formData.append("importType", importType);

      const response = await fetch("/api/import-instagram", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to import Instagram data");
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", uuid] });

      toast({
        title: "Instagram Import Successful",
        description: `Successfully imported ${data.imported} accounts${data.updated > 0 ? ` (${data.updated} updated)` : ""}${data.skippedRows > 0 ? ` (${data.skippedRows} rows skipped due to formatting issues)` : ""}`,
      });

      setSelectedInstagramFile(null);
      const fileInput = document.getElementById("modal-instagram-file-input") as HTMLInputElement;
      if (fileInput) {
        fileInput.value = "";
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Instagram Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleInstagramFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".csv")) {
        toast({
          title: "Invalid File",
          description: "Please select a CSV file",
          variant: "destructive",
        });
        return;
      }
      setSelectedInstagramFile(file);
    }
  };

  const handleInstagramImport = () => {
    if (selectedInstagramFile && account?.id) {
      importInstagramMutation.mutate({
        file: selectedInstagramFile,
        accountId: account.id,
        importType: instagramImportType,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b px-6 py-4">
          <Skeleton className="h-8 w-32 mb-6" />
          <div className="flex items-start gap-6">
            <Skeleton className="w-24 h-24 rounded-full" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
          <ArrowLeft className="h-8 w-8 text-destructive" />
        </div>
        <h2 className="text-2xl font-semibold mb-2">Failed to load social account</h2>
        <p className="text-muted-foreground mb-6">
          {error?.message || "An error occurred while fetching this social account"}
        </p>
        <Button onClick={() => navigate("/social-accounts")} data-testid="button-back-to-list-error">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
        <h2 className="text-2xl font-semibold mb-2">Social account not found</h2>
        <p className="text-muted-foreground mb-6">
          The social account you're looking for doesn't exist.
        </p>
        <Button onClick={() => navigate("/social-accounts")} data-testid="button-back-to-list">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>
    );
  }

  const isFollowingYou = mePerson?.socialAccountUuids?.some((meId) =>
    account.latestState?.followers?.includes(meId)
  );

  const accountType = account.typeId 
    ? socialAccountTypes?.find(t => t.id === account.typeId) 
    : null;

  const getInitials = (username: string) => {
    if (username.length >= 2) {
      return username.slice(0, 2).toUpperCase();
    }
    return username.slice(0, 1).toUpperCase();
  };

  const formatDateTime = (dateInput: Date | string | null | undefined): string => {
    if (!dateInput) return "—";
    const date = new Date(dateInput);
    return date.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatYearMonth = (dateInput: Date | string | null | undefined): string => {
    if (!dateInput) return "—";
    const date = new Date(dateInput);
    return date.toLocaleString([], { year: "numeric", month: "long" });
  };

  const getImageLastChangedAt = (): Date | null => {
    if (!profileVersions || profileVersions.length === 0) return null;
    const sorted = [...profileVersions].sort(
      (a, b) => new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime()
    );
    let lastImageChangeDate: Date | null = null;
    let prevImageUrl: string | null | undefined = undefined;
    for (const v of sorted) {
      if (prevImageUrl === undefined) {
        if (v.imageUrl) lastImageChangeDate = new Date(v.detectedAt);
        prevImageUrl = v.imageUrl;
      } else if (v.imageUrl !== prevImageUrl) {
        lastImageChangeDate = new Date(v.detectedAt);
        prevImageUrl = v.imageUrl;
      }
    }
    return lastImageChangeDate;
  };

  const getMostRecentImportDate = (): Date | null => {
    const dates = [account.latestImportFollowers, account.latestImportFollowing]
      .filter(Boolean)
      .map((d) => new Date(d!));
    if (dates.length === 0) return null;
    return dates.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
  };

  const getMostRecentActionDate = (): Date | null => {
    const candidates = [
      account.lastScrapedAt,
      account.latestImportFollowers,
      account.latestImportFollowing,
      account.latestState?.updatedAt,
    ]
      .filter(Boolean)
      .map((d) => new Date(d!));
    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Top Section */}
      <div className="border-b px-6 py-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/social-accounts")}
          className="mb-6"
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex items-start gap-6">
          <Avatar className="w-24 h-24">
            {account.currentProfile?.imageUrl && (
              <AvatarImage src={account.currentProfile?.imageUrl} alt={account.username} />
            )}
            <AvatarFallback className="text-2xl">
              {getInitials(account.username)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-start gap-3 flex-wrap">
                <h1 className="text-3xl font-bold" data-testid="text-account-username">
                  {account.username}
                </h1>
                {accountType && (
                  <Link href={`/social-accounts?type=${accountType.id}`}>
                    <Badge 
                      variant="outline" 
                      className="cursor-pointer"
                      style={isValidHexColor(accountType.color) ? { borderColor: accountType.color, color: accountType.color } : undefined}
                      data-testid="badge-account-type"
                    >
                      {accountType.name}
                    </Badge>
                  </Link>
                )}
                {isFollowingYou && (
                  <Badge variant="secondary" data-testid="badge-follows-you">
                    Follows you
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setIsInfoDialogOpen(true)}
                      data-testid="button-account-info"
                      aria-label="Social account info"
                    >
                      <Info className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Social account info</TooltipContent>
                </Tooltip>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => window.open(account.currentProfile?.accountUrl ?? undefined, "_blank")}
                  data-testid="button-goto-profile"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
                {accountType?.name?.toLowerCase() === "instagram" && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setIsImportDialogOpen(true)}
                    data-testid="button-import-instagram"
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => navigate(`/social-graph-3d?view=social&selected=${account.id}`)}
                      data-testid="button-open-in-graph"
                      aria-label="Open in graph"
                    >
                      <GraphTriangleIcon className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open in graph</TooltipContent>
                </Tooltip>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setIsEditDialogOpen(true)}
                  data-testid="button-edit-account"
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  data-testid="button-delete-account"
                  className="text-destructive hover:text-destructive"
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {account.currentProfile?.nickname && (
              <p className="text-lg text-muted-foreground mb-1" data-testid="text-account-nickname">
                {account.currentProfile?.nickname}
              </p>
            )}

            <div className="flex flex-col gap-1 text-sm text-muted-foreground mb-4">
              {account.internalAccountCreationDate && (
                <div data-testid="text-account-created-date">
                  Imported on: {(() => {
                    const date = new Date(account.internalAccountCreationDate);
                    const now = new Date();
                    const diffMs = now.getTime() - date.getTime();
                    const diffHrs = diffMs / (1000 * 60 * 60);
                    const isWithin24Hrs = diffHrs < 24;
                    const isMoreThanYear = now.getFullYear() - date.getFullYear() >= 1;

                    if (isWithin24Hrs) {
                      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
                    } else if (isMoreThanYear) {
                      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
                    } else {
                      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                    }
                  })()} ({account.internalAccountCreationType})
                </div>
              )}
              {account.latestImportFollowers && (
                <div data-testid="text-account-latest-followers">
                  Latest followers import: {(() => {
                    const date = new Date(account.latestImportFollowers);
                    const now = new Date();
                    const diffMs = now.getTime() - date.getTime();
                    const diffHrs = diffMs / (1000 * 60 * 60);
                    const isWithin24Hrs = diffHrs < 24;
                    const isMoreThanYear = now.getFullYear() - date.getFullYear() >= 1;

                    if (isWithin24Hrs) {
                      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
                    } else if (isMoreThanYear) {
                      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
                    } else {
                      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                    }
                  })()}
                </div>
              )}
              {account.latestImportFollowing && (
                <div data-testid="text-account-latest-following">
                  Latest following import: {(() => {
                    const date = new Date(account.latestImportFollowing);
                    const now = new Date();
                    const diffMs = now.getTime() - date.getTime();
                    const diffHrs = diffMs / (1000 * 60 * 60);
                    const isWithin24Hrs = diffHrs < 24;
                    const isMoreThanYear = now.getFullYear() - date.getFullYear() >= 1;

                    if (isWithin24Hrs) {
                      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
                    } else if (isMoreThanYear) {
                      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
                    } else {
                      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                    }
                  })()}
                </div>
              )}
            </div>

            {account.ownerUuid ? (
              <div className="text-sm">
                <span className="text-muted-foreground">Linked to: </span>
                {owner ? (
                  <Link href={`/person/${owner.id}`}>
                    <a className="text-primary hover:underline font-medium" data-testid="link-owner">
                      {owner.firstName} {owner.lastName}
                    </a>
                  </Link>
                ) : (
                  <span className="text-muted-foreground" data-testid="text-owner-loading">Loading...</span>
                )}
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCreatePersonOpen(true)}
                data-testid="button-create-person"
              >
                <UserPlus className="h-4 w-4" />
                Create Person
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs Section */}
      <div className="flex-1 overflow-auto">
        <Tabs defaultValue="follow" className="w-full">
          <div className="border-b px-6">
            <TabsList className="h-12 bg-transparent p-0 flex-nowrap touch-scroll" data-testid="tabs-social-account">
              <TabsTrigger
                value="follow"
                className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
                data-testid="tab-follow"
              >
                Follow
              </TabsTrigger>
              <TabsTrigger
                value="posts"
                className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
                data-testid="tab-posts"
              >
                Posts
              </TabsTrigger>
              <TabsTrigger
                value="summary"
                className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
                data-testid="tab-summary"
              >
                AI Summary
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Follow Tab */}
          <TabsContent value="follow" className="mt-0">
            <div className="px-6 py-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Followers Column */}
              <Card className="p-4">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h3 className="text-lg font-semibold" data-testid="text-followers-header">
                    Followers ({account.latestState?.followerCount || 0})
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsCompareOpen(true)}
                    data-testid="button-compare-followers-following"
                  >
                    <GitCompare className="h-4 w-4" />
                  </Button>
                </div>
                {followers.length > 0 ? (
                  <div className="space-y-2">
                    {followers.map((followerAccount) => (
                      <div
                        key={followerAccount.id}
                        className="flex items-center gap-3 p-2 rounded-md hover-elevate"
                        data-testid={`card-follower-${followerAccount.id}`}
                      >
                        <Avatar className="w-8 h-8">
                          {followerAccount.currentProfile?.imageUrl && (
                            <AvatarImage src={followerAccount.currentProfile?.imageUrl} alt={followerAccount.username} />
                          )}
                          <AvatarFallback className="text-xs">
                            {getInitials(followerAccount.username)}
                          </AvatarFallback>
                        </Avatar>
                        <Link
                          href={`/social-accounts/${followerAccount.id}`}
                          className="text-sm font-medium hover:underline"
                          data-testid={`link-follower-${followerAccount.id}`}
                        >
                          {followerAccount.username}
                        </Link>
                      </div>
                    ))}
                    {hasMoreFollowers && (
                      <div className="pt-2 flex flex-col items-center gap-1">
                        <p className="text-xs text-muted-foreground" data-testid="text-followers-loaded">
                          Showing {followers.length} of {followersTotal}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fetchNextFollowersPage()}
                          disabled={isFetchingMoreFollowers}
                          data-testid="button-load-more-followers"
                        >
                          {isFetchingMoreFollowers ? (
                            <><Loader2 className="h-3 w-3 animate-spin mr-1" />Loading...</>
                          ) : (
                            "Load more"
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No followers yet</p>
                )}
              </Card>

              {/* Following Column */}
              <Card className="p-4">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h3 className="text-lg font-semibold" data-testid="text-following-header">
                    Following ({account.latestState?.followingCount || 0})
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsLinkFollowingOpen(true)}
                    data-testid="button-add-following"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {followingList.length > 0 ? (
                  <div className="space-y-2">
                    {followingList.map((followingAccount) => (
                      <div
                        key={followingAccount.id}
                        className="flex items-center gap-3 p-2 rounded-md hover-elevate"
                        data-testid={`card-following-${followingAccount.id}`}
                      >
                        <Avatar className="w-8 h-8">
                          {followingAccount.currentProfile?.imageUrl && (
                            <AvatarImage src={followingAccount.currentProfile?.imageUrl} alt={followingAccount.username} />
                          )}
                          <AvatarFallback className="text-xs">
                            {getInitials(followingAccount.username)}
                          </AvatarFallback>
                        </Avatar>
                        <Link
                          href={`/social-accounts/${followingAccount.id}`}
                          className="text-sm font-medium hover:underline"
                          data-testid={`link-following-${followingAccount.id}`}
                        >
                          {followingAccount.username}
                        </Link>
                      </div>
                    ))}
                    {hasMoreFollowing && (
                      <div className="pt-2 flex flex-col items-center gap-1">
                        <p className="text-xs text-muted-foreground" data-testid="text-following-loaded">
                          Showing {followingList.length} of {followingTotal}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fetchNextFollowingPage()}
                          disabled={isFetchingMoreFollowing}
                          data-testid="button-load-more-following"
                        >
                          {isFetchingMoreFollowing ? (
                            <><Loader2 className="h-3 w-3 animate-spin mr-1" />Loading...</>
                          ) : (
                            "Load more"
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Not following anyone yet</p>
                )}
              </Card>
            </div>

            {/* Notes Section */}
            <div>
              <div className="flex items-start justify-between gap-4 mb-3">
                <h2 className="text-lg font-semibold" data-testid="text-notes-header">
                  Notes
                </h2>
                {!isEditingNotes && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setNotes(account.currentProfile?.bio || "");
                      setIsEditingNotes(true);
                    }}
                    data-testid="button-edit-notes"
                  >
                    Edit
                  </Button>
                )}
              </div>

              {isEditingNotes ? (
                <div className="space-y-3">
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add notes about this social account..."
                    className="min-h-32"
                    data-testid="textarea-notes"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => updateNotesMutation.mutate(notes)}
                      disabled={updateNotesMutation.isPending}
                      size="sm"
                      data-testid="button-save-notes"
                    >
                      {updateNotesMutation.isPending && (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      )}
                      Save
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setIsEditingNotes(false)}
                      size="sm"
                      data-testid="button-cancel-notes"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {account.currentProfile?.bio ? (
                    <p data-testid="text-notes-content" className="whitespace-pre-wrap">
                      {account.currentProfile?.bio}
                    </p>
                  ) : (
                    <p className="italic">No notes added yet</p>
                  )}
                </div>
              )}
            </div>
            </div>
          </TabsContent>

          {/* Posts Tab */}
          <TabsContent value="posts" className="mt-0">
            <div className="px-6 py-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold">Posts ({posts?.length || 0})</h2>
                <Button
                  size="sm"
                  onClick={() => setIsAddPostOpen(true)}
                  data-testid="button-add-post"
                >
                  <Plus className="h-4 w-4" />
                  Add Post
                </Button>
              </div>

              {posts && posts.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {posts.map((post) => {
                    let images: string[] = [];
                    try {
                      images = post.content ? JSON.parse(post.content) : [];
                    } catch {
                      images = [];
                    }
                    const firstImage = images[0] || null;

                    return (
                      <Card
                        key={post.id}
                        className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => {
                          setSelectedPost(post);
                          setIsPostDetailOpen(true);
                        }}
                        data-testid={`card-post-${post.id}`}
                      >
                        {/* Image thumbnail */}
                        <div className="aspect-square bg-muted relative overflow-hidden">
                          {firstImage ? (
                            <img
                              src={firstImage}
                              alt="Post thumbnail"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
                            </div>
                          )}
                          {images.length > 1 && (
                            <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                              {images.length}
                            </div>
                          )}
                          {post.isDeleted && (
                            <div className="absolute top-2 left-2">
                              <Badge variant="destructive" className="text-xs">Deleted</Badge>
                            </div>
                          )}
                        </div>

                        {/* Post info */}
                        <div className="p-3">
                          {post.description && (
                            <p className="text-sm line-clamp-2 mb-2">
                              {post.description}
                            </p>
                          )}
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Heart className="h-3 w-3" />
                              {post.likeCount}
                            </span>
                            <span className="flex items-center gap-1">
                              <MessageCircle className="h-3 w-3" />
                              {post.commentCount}
                            </span>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">No posts yet</p>
                  <p className="text-xs mt-1">Click "Add Post" to create the first post</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Summary Tab */}
          <TabsContent value="summary" className="mt-0">
            <div className="px-6 py-6 max-w-4xl mx-auto space-y-6">
              <div className="flex items-center justify-between border-b pb-4 mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Profile Activity Summary</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    AI-generated summaries of posts and activities for this profile.
                  </p>
                </div>
                {owner?.isWatched ? (
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 flex gap-1 items-center px-3 py-1 text-xs">
                    <CheckCircle2 className="h-3 w-3" /> Watch List Active
                  </Badge>
                ) : (
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground mb-1">Watch List is disabled for this person.</p>
                    <Link to={`/people/${account.ownerUuid}`}>
                      <Button size="sm" variant="outline" className="text-xs">
                        Enable Watch List
                      </Button>
                    </Link>
                  </div>
                )}
              </div>

              {posts && posts.some(p => p.summary) ? (
                <div className="space-y-6 relative before:absolute before:inset-y-0 before:left-4 before:w-[2px] before:bg-border">
                  {posts
                    .filter(p => p.summary)
                    .map((post) => {
                      let images: string[] = [];
                      try {
                        images = post.content ? JSON.parse(post.content) : [];
                      } catch {
                        images = [];
                      }
                      const firstImage = images[0] || null;

                      return (
                        <div key={post.id} className="relative pl-10 flex gap-4 items-start group">
                          {/* Timeline node */}
                          <div className="absolute left-2.5 top-2.5 w-3.5 h-3.5 rounded-full border-2 border-primary bg-background group-hover:scale-110 transition-transform" />

                          <Card className="flex-1 p-5 shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex gap-4 items-start flex-col sm:flex-row">
                              {firstImage && (
                                <div className="w-full sm:w-24 aspect-square bg-muted rounded overflow-hidden flex-shrink-0 border">
                                  <img src={firstImage} alt="Post thumbnail" className="w-full h-full object-cover" />
                                </div>
                              )}
                              <div className="flex-1 space-y-2">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="text-sm font-medium text-muted-foreground">
                                    {post.postedAt ? new Date(post.postedAt).toLocaleDateString(undefined, {
                                      year: 'numeric',
                                      month: 'long',
                                      day: 'numeric'
                                    }) : "Unknown Date"}
                                  </span>
                                  {post.summaryToolingVersion && (
                                    <Badge variant="secondary" className="font-mono text-[10px] scale-90 origin-right">
                                      {post.summaryToolingVersion}
                                    </Badge>
                                  )}
                                </div>

                                <p className="text-base text-foreground leading-relaxed">
                                  {post.summary}
                                </p>

                                {post.description && (
                                  <details className="text-xs text-muted-foreground cursor-pointer mt-2">
                                    <summary className="hover:text-foreground">View Original Caption</summary>
                                    <p className="mt-2 p-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap">
                                      {post.description}
                                    </p>
                                  </details>
                                )}

                                <div className="flex items-center justify-end gap-2 pt-2 border-t mt-3">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-xs h-8 text-muted-foreground hover:text-foreground"
                                    onClick={() => summarizePostMutation.mutate(post.id)}
                                    disabled={summarizePostMutation.isPending}
                                  >
                                    Regenerate Summary
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </Card>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="text-center py-16 border-2 border-dashed rounded-lg">
                  <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-40" />
                  <h3 className="text-lg font-medium">No Summaries Yet</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto mt-1">
                    {owner?.isWatched
                      ? "Summaries are automatically generated in the background when new posts are imported. You can also manually trigger them below."
                      : "Put this person on your Watch List to enable automatic post tracking and AI-generated activity summaries."}
                  </p>
                  {owner?.isWatched && posts && posts.length > 0 && (
                    <div className="mt-6 space-y-3">
                      <p className="text-xs text-muted-foreground">Select a post to trigger a manual summary:</p>
                      <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
                        {posts.slice(0, 5).map((p, idx) => (
                          <Button
                            key={p.id}
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            onClick={() => summarizePostMutation.mutate(p.id)}
                            disabled={summarizePostMutation.isPending}
                          >
                            Post {idx + 1} ({p.postedAt ? new Date(p.postedAt).toLocaleDateString() : "unknown"})
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <SocialAccountDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        account={account}
      />

      <LinkFollowingAccountsDialog
        open={isLinkFollowingOpen}
        onOpenChange={setIsLinkFollowingOpen}
        accountUuid={uuid!}
        linkedAccountIds={account.latestState?.following || []}
      />

      <Dialog open={isImportDialogOpen} onOpenChange={(open) => {
        setIsImportDialogOpen(open);
        if (!open) {
          setSelectedInstagramFile(null);
          importInstagramMutation.reset();
          const fileInput = document.getElementById("modal-instagram-file-input") as HTMLInputElement;
          if (fileInput) {
            fileInput.value = "";
          }
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SiInstagram className="h-5 w-5" />
              Instagram Import
            </DialogTitle>
            <DialogDescription>
              Import followers or following data for {account.username}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="modal-import-type-toggle" className="text-base font-medium">
                  Import Type
                </Label>
                <p className="text-sm text-muted-foreground">
                  {instagramImportType === "followers" ? "Import accounts that follow you" : "Import accounts you follow"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={instagramImportType === "followers" ? "text-foreground font-medium" : "text-muted-foreground"}>
                  Followers
                </span>
                <Switch
                  id="modal-import-type-toggle"
                  checked={instagramImportType === "following"}
                  onCheckedChange={(checked) => setInstagramImportType(checked ? "following" : "followers")}
                  data-testid="switch-modal-import-type"
                />
                <span className={instagramImportType === "following" ? "text-foreground font-medium" : "text-muted-foreground"}>
                  Following
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="modal-instagram-file-input">Select CSV File</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="modal-instagram-file-input"
                  type="file"
                  accept=".csv"
                  onChange={handleInstagramFileChange}
                  disabled={importInstagramMutation.isPending}
                  data-testid="input-modal-instagram-file"
                  className="cursor-pointer"
                />
              </div>
              {selectedInstagramFile && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span data-testid="text-modal-selected-filename">{selectedInstagramFile.name}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleInstagramImport}
                disabled={!selectedInstagramFile || importInstagramMutation.isPending}
                data-testid="button-modal-import-instagram"
                className="gap-2"
              >
                {importInstagramMutation.isPending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import {instagramImportType === "followers" ? "Followers" : "Following"}
                  </>
                )}
              </Button>

              {selectedInstagramFile && !importInstagramMutation.isPending && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedInstagramFile(null);
                    const fileInput = document.getElementById("modal-instagram-file-input") as HTMLInputElement;
                    if (fileInput) {
                      fileInput.value = "";
                    }
                  }}
                  data-testid="button-modal-clear-file"
                >
                  Clear
                </Button>
              )}
            </div>

            {importInstagramMutation.isSuccess && importInstagramMutation.data && (
              <div className="rounded-md bg-primary/10 border border-primary/20 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium" data-testid="text-modal-import-success">
                      Instagram Import Complete
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Imported {importInstagramMutation.data.imported} account{importInstagramMutation.data.imported !== 1 ? "s" : ""}
                      {importInstagramMutation.data.updated > 0 && (
                        <span className="ml-1">
                          ({importInstagramMutation.data.updated} updated)
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <PersonDialog
        open={isCreatePersonOpen}
        onOpenChange={setIsCreatePersonOpen}
        onPersonCreated={(person) => {
          if (person?.id && account?.id) {
            linkPersonMutation.mutate({
              personId: person.id,
              socialAccountId: account.id,
              existingUuids: person.socialAccountUuids ?? [],
            });
          }
        }}
      />

      <PostDialog
        open={isAddPostOpen}
        onOpenChange={setIsAddPostOpen}
        socialAccountId={uuid!}
      />

      {selectedPost && (
        <>
          <PostDetailDialog
            open={isPostDetailOpen}
            onOpenChange={setIsPostDetailOpen}
            post={selectedPost}
            onEdit={() => {
              setIsPostDetailOpen(false);
              setIsEditPostOpen(true);
            }}
            onDelete={() => {
              deletePostMutation.mutate(selectedPost.id);
              setSelectedPost(null);
            }}
          />

          <PostDialog
            open={isEditPostOpen}
            onOpenChange={setIsEditPostOpen}
            post={selectedPost}
            socialAccountId={uuid!}
          />
        </>
      )}

      {/* Social Account Info Dialog */}
      <Dialog open={isInfoDialogOpen} onOpenChange={setIsInfoDialogOpen}>
        <DialogContent className="max-w-sm" data-testid="dialog-account-info">
          <DialogHeader>
            <DialogTitle>Social account info</DialogTitle>
            <DialogDescription>
              Account history and timeline details for @{account?.username}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Account created</span>
                <span className="text-right font-medium" data-testid="info-account-created">
                  {formatYearMonth(account?.internalAccountCreationDate)}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">First imported</span>
                <span className="text-right font-medium" data-testid="info-first-imported">
                  {formatDateTime(account?.internalAccountCreationDate)}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Most recent import</span>
                <span className="text-right font-medium" data-testid="info-latest-import">
                  {formatDateTime(getMostRecentImportDate())}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Most recent action</span>
                <span className="text-right font-medium" data-testid="info-latest-action">
                  {formatDateTime(getMostRecentActionDate())}
                </span>
              </div>
              <div className="border-t pt-3 flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Profile image updated</span>
                <span className="text-right font-medium" data-testid="info-image-updated">
                  {profileVersions
                    ? formatDateTime(getImageLastChangedAt())
                    : "Loading…"}
                </span>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Differences Modal */}
      <Dialog open={isCompareOpen} onOpenChange={setIsCompareOpen}>
        <DialogContent className="max-w-lg" data-testid="dialog-compare-followers-following">
          <DialogHeader>
            <DialogTitle>Differences</DialogTitle>
            <DialogDescription>
              Accounts that only follow you or only that you follow.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 pt-1 max-h-[60vh] overflow-y-auto pr-1">
            {(() => {
              const followingIds = new Set(followingList.map((a) => a.id));
              const followerIds = new Set(followers.map((a) => a.id));
              const followersOnly = followers.filter((a) => !followingIds.has(a.id));
              const followingOnly = followingList.filter((a) => !followerIds.has(a.id));
              return (
                <>
                  <div>
                    <p className="text-sm font-semibold mb-2" data-testid="text-followers-only-heading">
                      Followers only ({followersOnly.length})
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">They follow you, but you don't follow them back.</p>
                    {followersOnly.length > 0 ? (
                      <div className="space-y-1">
                        {followersOnly.map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center gap-3 p-2 rounded-md hover-elevate"
                            data-testid={`card-followers-only-${a.id}`}
                          >
                            <Avatar className="w-8 h-8">
                              {a.currentProfile?.imageUrl && (
                                <AvatarImage src={a.currentProfile.imageUrl} alt={a.username} />
                              )}
                              <AvatarFallback className="text-xs">
                                {getInitials(a.username)}
                              </AvatarFallback>
                            </Avatar>
                            <Link
                              href={`/social-accounts/${a.id}`}
                              className="text-sm font-medium hover:underline"
                              onClick={() => setIsCompareOpen(false)}
                              data-testid={`link-followers-only-${a.id}`}
                            >
                              {a.username}
                            </Link>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">None</p>
                    )}
                  </div>

                  <div className="border-t pt-5">
                    <p className="text-sm font-semibold mb-2" data-testid="text-following-only-heading">
                      Following only ({followingOnly.length})
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">You follow them, but they don't follow you back.</p>
                    {followingOnly.length > 0 ? (
                      <div className="space-y-1">
                        {followingOnly.map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center gap-3 p-2 rounded-md hover-elevate"
                            data-testid={`card-following-only-${a.id}`}
                          >
                            <Avatar className="w-8 h-8">
                              {a.currentProfile?.imageUrl && (
                                <AvatarImage src={a.currentProfile.imageUrl} alt={a.username} />
                              )}
                              <AvatarFallback className="text-xs">
                                {getInitials(a.username)}
                              </AvatarFallback>
                            </Avatar>
                            <Link
                              href={`/social-accounts/${a.id}`}
                              className="text-sm font-medium hover:underline"
                              onClick={() => setIsCompareOpen(false)}
                              data-testid={`link-following-only-${a.id}`}
                            >
                              {a.username}
                            </Link>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">None</p>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
