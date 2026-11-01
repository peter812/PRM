import { formatPersonName, personInitials } from "@shared/person-name";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useParams, useLocation, useSearch } from "wouter";
import { ArrowLeft, Loader2, Edit2, Trash2, Plus, Download, ExternalLink, FileText, CheckCircle2, ImageIcon, Info, GitCompare, ChevronDown, MessageSquare, RefreshCw, Users, MapPin, Calendar, Layers, AtSign, Lock, Globe, ScanFace, Star, Ban } from "lucide-react";
import { GraphTriangleIcon } from "@/components/icons/graph-triangle-icon";
import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNoFaceToggle } from "@/components/no-face-account";
import { useBannedActionToggle } from "@/components/banned-action-toggle";
import { BANNED_ACTION_LABELS, type BannedAction } from "@shared/banned-actions";
import { TRACKING_KIND_LABEL, type TrackingKind } from "@shared/interest-level";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  requestExtraction,
  ExtensionUnavailableError,
  EXTENSION_ID_SETTING,
  EXTENSION_MAX_RECORDS_SETTING,
  DEFAULT_MAX_RECORDS,
  type ExtractAction,
} from "@/lib/extension-bridge";
import { getInitials, safeJsonParse } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import type { SocialAccountWithCurrentProfile, Person, SocialAccountType, SocialAccountPost, SocialAccountHistoryEntry, TrackingJob, PrimaryAddress } from "@shared/schema";
import { withImageSize } from "@shared/image-size";

/** A row of /tagged-posts: the post, who posted it, and when this account's tab showed it. */
type TaggedPost = SocialAccountPost & {
  poster: { id: string; username: string; imageUrl: string | null };
  tag: { firstSeenAt: string; removedSeenAt: string | null };
};
import { Link } from "wouter";
import { OUTDATED_TEXT, OutdatedBadge } from "@/components/person-addresses";
import { SocialAccountDialog } from "@/components/social-account-dialog";
import { ChangeUsernameDialog } from "@/components/change-username-dialog";
import { LinkFollowingAccountsDialog } from "@/components/link-following-accounts-dialog";
import { PersonDialog } from "@/components/person-dialog";
import { LinkPersonDialog } from "@/components/link-person-dialog";
import { PostDialog } from "@/components/post-dialog";
const PostDetailDialog = lazy(() =>
  import("@/components/post-detail-dialog").then((m) => ({
    default: m.PostDetailDialog,
  }))
);
import { SocialPostsGrid } from "@/components/social-posts-grid";
import { ProfilePhotoDialog } from "@/components/profile-photo-dialog";
import { SiInstagram } from "react-icons/si";
import { SocialPlatformIcon } from "@/components/social-platform-icon";
import { MessagesTab } from "@/components/messages-tab";
import { StoriesTab } from "@/components/stories-tab";
import { NotesList } from "@/pages/notes";
import { SocialAccountHistoryTab } from "@/components/social-account-history-tab";
import { InsightsTab } from "@/components/insights-tab";
import { AccountOsintCard } from "@/components/osint-results";
import { AccountSummaryCard, SocialAccountSummaryTab } from "@/components/account-summary";
import { ConnectionsTab } from "@/components/connections-tab";
import { SocialAccountRow } from "@/components/social-account-row";
import { AccountTracking } from "@/components/account-tracking";
import { AccountFacesTab, accountFacesPending, invalidateAccountFaces, useAccountFaceCounts } from "@/components/account-faces-tab";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function SocialAccountProfile() {
  const { uuid } = useParams<{ uuid: string }>();
  const [location, navigate] = useLocation();
  // The path alone misses a ?postId change on this same page, e.g. from the history tab.
  const search = useSearch();
  const { toast } = useToast();
  const VALID_TABS = ["account", "follow", "posts", "tagged", "stories", "faces", "messages", "connections", "history", "insights", "summary"];

  const getTabFromSearch = () => {
    if (typeof window === "undefined") return "account";
    // Notes has its own path, /social-accounts/:uuid/notes, rather than ?tab=.
    if (window.location.pathname.endsWith("/notes")) return "notes";
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (tabParam && VALID_TABS.includes(tabParam)) {
      return tabParam;
    }
    return "account";
  };

  const [activeTab, setActiveTab] = useState(getTabFromSearch);

  useEffect(() => {
    const tab = getTabFromSearch();
    if (tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [location]);

  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    const params = new URLSearchParams(window.location.search);
    if (newTab === "account" || newTab === "notes") {
      params.delete("tab");
    } else {
      params.set("tab", newTab);
    }
    const searchStr = params.toString();
    const path = `/social-accounts/${uuid}${newTab === "notes" ? "/notes" : ""}`;
    window.history.replaceState(null, "", `${path}${searchStr ? `?${searchStr}` : ""}`);
  };
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isChangeUsernameOpen, setIsChangeUsernameOpen] = useState(false);
  const [isLinkFollowingOpen, setIsLinkFollowingOpen] = useState(false);
  const [isCreatePersonOpen, setIsCreatePersonOpen] = useState(false);
  const [isLinkPersonOpen, setIsLinkPersonOpen] = useState(false);
  const [isEditPostOpen, setIsEditPostOpen] = useState(false);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [isPostDetailOpen, setIsPostDetailOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<SocialAccountPost | null>(null);
  const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const postIdParam = params.get("postId");
    if (postIdParam && (!selectedPost || selectedPost.id !== postIdParam)) {
      fetch(`/api/social-account-posts/${postIdParam}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((post) => {
          if (post) {
            setSelectedPost(post);
            setIsPostDetailOpen(true);
            if (post.postType === "story" && activeTab !== "stories") {
              handleTabChange("stories");
            } else if (post.postType !== "story" && activeTab !== "posts") {
              handleTabChange("posts");
            }
          }
        })
        .catch(console.error);
    }
  }, [location, search, selectedPost?.id, activeTab]);

  const { data: account, isLoading, isError, error } = useQuery<SocialAccountWithCurrentProfile & { bioMentions?: { id: string; username: string }[] }>({
    queryKey: ["/api/social-accounts", uuid],
    enabled: !!uuid,
  });

  const accountId = account?.id ?? uuid;

  const [profileImgSrc, setProfileImgSrc] = useState<string | null | undefined>(undefined);
  const [profilePhotoOpen, setProfilePhotoOpen] = useState(false);
  const noFace = useNoFaceToggle(invalidateAccountFaces);
  const bans = useBannedActionToggle();

  useEffect(() => {
    setProfileImgSrc(account?.currentProfile?.imageUrl ?? null);
  }, [account?.currentProfile?.imageUrl]);

  const { data: owner } = useQuery<Person & { primaryAddress?: PrimaryAddress }>({
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

  const facesPending = accountFacesPending(useAccountFaceCounts(account?.id).data);
  const { data: appSettings } = useQuery<Record<string, string | null>>({
    queryKey: ["/api/settings"],
  });

  /**
   * Hand an extraction to the Chrome extension. It opens the profile in a
   * background tab, scrapes it, and posts the result to the Extension Imports
   * page for review — none of which we wait on here.
   */
  const handleExtract = async (action: ExtractAction) => {
    const username = account?.username;
    if (!username) return;

    const actionLabel = action === "graph" ? "followers & following" : action === "account" ? "account info" : action;

    try {
      await requestExtraction(
        appSettings?.[EXTENSION_ID_SETTING] ?? "",
        action,
        username,
        Number(appSettings?.[EXTENSION_MAX_RECORDS_SETTING]) || DEFAULT_MAX_RECORDS,
      );
      toast({
        title: "Extraction Started",
        description: actionLabel
          ? `The extension is extracting ${actionLabel} for @${username}. The result will appear under Extension Imports.`
          : `The extension is extracting @${username}. The result will appear under Extension Imports.`,
      });
    } catch (err) {
      const unavailable = err instanceof ExtensionUnavailableError;
      toast({
        title: unavailable ? "Extension Unavailable" : "Extraction Refused",
        description: (err as Error).message,
        variant: "destructive",
      });
      if (unavailable) navigate("/settings/chrome-extension");
    }
  };

  /** Queue a PRM Stories check; it runs on the importer's next tracking run. */
  const queueTracking = useMutation({
    mutationFn: (kind: TrackingKind) => apiRequest("POST", `/api/social-accounts/${account!.id}/tracking-jobs`, { kind }),
    onSuccess: (_r, kind) => {
      queryClient.invalidateQueries({ queryKey: [`/api/social-accounts/${account!.id}/tracking-jobs`] });
      toast({ title: "Queued", description: `${TRACKING_KIND_LABEL[kind]} was sent to PRM Stories.` });
    },
    onError: (e: Error) => toast({ title: "Not queued", description: e.message, variant: "destructive" }),
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
      const res = await fetch(`/api/social-accounts/${uuid}/followers?page=${pageParam}&limit=20`);
      if (!res.ok) throw new Error("Failed to fetch followers");
      return res.json();
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = (lastPage.page - 1) * lastPage.limit + lastPage.items.length;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
    enabled: !!uuid && activeTab === "follow",
  });

  const {
    data: followingData,
    fetchNextPage: fetchNextFollowingPage,
    hasNextPage: hasMoreFollowing,
    isFetchingNextPage: isFetchingMoreFollowing,
  } = useInfiniteQuery<PaginatedAccounts>({
    queryKey: ["/api/social-accounts", uuid, "following"],
    queryFn: async ({ pageParam }) => {
      const res = await fetch(`/api/social-accounts/${uuid}/following?page=${pageParam}&limit=20`);
      if (!res.ok) throw new Error("Failed to fetch following");
      return res.json();
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = (lastPage.page - 1) * lastPage.limit + lastPage.items.length;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
    enabled: !!uuid && activeTab === "follow",
  });

  // Full follower/following id lists for membership checks and the link dialog
  const { data: followIds } = useQuery<{ followerIds: string[]; followingIds: string[] }>({
    queryKey: ["/api/social-accounts", accountId, "follow-ids"],
    queryFn: async () => {
      const res = await fetch(`/api/social-accounts/${accountId}/follow-ids`);
      if (!res.ok) throw new Error("Failed to fetch follow ids");
      return res.json();
    },
    enabled: !!accountId,
  });

  const followers = followersData?.pages.flatMap((p) => p.items) ?? [];
  const followersTotal = followersData?.pages[0]?.total ?? 0;
  const followingList = followingData?.pages.flatMap((p) => p.items) ?? [];
  const followingTotal = followingData?.pages[0]?.total ?? 0;

  // Posts, for the posts tab and the overview card.
  const { data: allPosts, isLoading: isPostsLoading } = useQuery<SocialAccountPost[]>({
    queryKey: ["/api/social-accounts", uuid, "posts?includeDeleted=true"],
    enabled: !!uuid && (activeTab === "account" || activeTab === "posts" || isPostDetailOpen),
  });
  // Stories come on their own, for the stories tab and the overview card.
  const { data: storyPosts } = useQuery<SocialAccountPost[]>({
    queryKey: ["/api/social-accounts", uuid, "posts?postType=story&includeDeleted=true"],
    enabled: !!uuid && (activeTab === "account" || activeTab === "stories"),
  });
  type PostSortOption = "newest" | "oldest" | "popular";
  const [postSort, setPostSort] = useState<PostSortOption>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const s = params.get("postSort") || params.get("sort");
      if (s === "oldest" || s === "popular") return s;
    }
    return "newest";
  });

  const handleSortChange = (newSort: PostSortOption) => {
    setPostSort(newSort);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (newSort === "newest") {
        params.delete("postSort");
        params.delete("sort");
      } else {
        params.set("postSort", newSort);
      }
      const searchStr = params.toString();
      const newUrl = `${window.location.pathname}${searchStr ? `?${searchStr}` : ""}`;
      window.history.replaceState(null, "", newUrl);
    }
  };

  const getPostTime = (p: SocialAccountPost): number => {
    const raw = p.postedAt ?? p.createdAt;
    if (!raw) return 0;
    const time = new Date(raw).getTime();
    return isNaN(time) ? 0 : time;
  };

  // Stories share the table with posts (post_type "story") but get their own tab.
  // By default, posts are ordered newest first.
  const posts = useMemo(() => {
    const raw = allPosts?.filter((p) => p.postType !== "story") ?? [];
    return [...raw].sort((a, b) => {
      const diff = getPostTime(b) - getPostTime(a);
      if (diff !== 0) return diff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [allPosts]);

  const sortPosts = <T extends SocialAccountPost>(list: T[]) =>
    [...list].sort((a, b) => {
      if (postSort === "oldest") {
        const diff = getPostTime(a) - getPostTime(b);
        if (diff !== 0) return diff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      if (postSort === "popular") {
        const likeDiff = (b.likeCount ?? 0) - (a.likeCount ?? 0);
        if (likeDiff !== 0) return likeDiff;
        return getPostTime(b) - getPostTime(a);
      }
      // default: newest
      const diff = getPostTime(b) - getPostTime(a);
      if (diff !== 0) return diff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  const sortedPosts = useMemo(() => sortPosts(posts), [posts, postSort]);

  // Tagged posts (tagged-posts-plan.md): other accounts' posts that tag this one, removed tags included.
  const taggedKey = ["/api/social-accounts", uuid, "tagged-posts?includeRemoved=true&includeDeleted=true"];
  const { data: taggedData, isLoading: isTaggedLoading } = useQuery<TaggedPost[]>({
    queryKey: taggedKey,
    enabled: !!uuid && activeTab === "tagged",
  });
  const taggedPosts = taggedData ?? [];
  const sortedTaggedPosts = useMemo(() => sortPosts(taggedPosts), [taggedData, postSort]);

  const openPost = (post: SocialAccountPost) => {
    setSelectedPost(post);
    setIsPostDetailOpen(true);
  };

  // The slide of a post this account is tagged in (mentionedAccounts), else the first.
  const taggedSlide = (post: SocialAccountPost) => {
    const username = account?.username?.toLowerCase();
    const mentions = safeJsonParse<{ imageIndex: number; accounts?: string[] }[]>(post.mentionedAccounts, []);
    return mentions.find((m) => m.accounts?.some((u) => u.toLowerCase() === username))?.imageIndex ?? 0;
  };

  const postSortSelect = (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Sort:</span>
      <Select value={postSort} onValueChange={(val: PostSortOption) => handleSortChange(val)}>
        <SelectTrigger className="h-8 w-[160px] text-xs" data-testid="select-post-sort">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="newest" data-testid="select-item-sort-newest">Newest</SelectItem>
          <SelectItem value="oldest" data-testid="select-item-sort-oldest">Oldest</SelectItem>
          <SelectItem value="popular" data-testid="select-item-sort-popular">Most Popular</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  const stories = storyPosts ?? [];

  // Tracking jobs query to detect when a posts check is queued or running
  const jobsKey = [`/api/social-accounts/${accountId}/tracking-jobs`];
  const { data: trackingJobs } = useQuery<TrackingJob[]>({
    queryKey: jobsKey,
    enabled: !!accountId && (activeTab === "account" || activeTab === "posts" || activeTab === "stories" || activeTab === "tagged"),
    refetchInterval: (query) => {
      const data = query.state.data as TrackingJob[] | undefined;
      const hasOpen = data?.some((j) => j.status === "queued" || j.status === "running");
      return hasOpen ? 2_000 : 30_000;
    },
  });

  const isPostsQueued = trackingJobs?.some(
    (j) => j.kind === "posts" && (j.status === "queued" || j.status === "running")
  );

  // A scan delivers posts and highlight stories too, so either kind finishing refreshes them.
  const isPostsWorkOpen = trackingJobs?.some(
    (j) => (j.kind === "posts" || j.kind === "scan") && (j.status === "queued" || j.status === "running")
  );
  const isTaggedQueued = trackingJobs?.some((j) => j.kind === "tagged" && (j.status === "queued" || j.status === "running"));
  const prevTaggedQueuedRef = useRef(false);
  useEffect(() => {
    if (prevTaggedQueuedRef.current && !isTaggedQueued) queryClient.invalidateQueries({ queryKey: taggedKey });
    prevTaggedQueuedRef.current = !!isTaggedQueued;
  }, [isTaggedQueued, uuid]);

  const prevPostsWorkOpenRef = useRef(false);
  useEffect(() => {
    if (prevPostsWorkOpenRef.current && !isPostsWorkOpen) {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", uuid, "posts?includeDeleted=true"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", uuid, "posts?postType=story&includeDeleted=true"] });
    }
    prevPostsWorkOpenRef.current = !!isPostsWorkOpen;
  }, [isPostsWorkOpen, uuid]);

  const retrievePostsMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/social-accounts/${accountId}/tracking-jobs`, { kind: "posts" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobsKey });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", uuid, "posts?includeDeleted=true"] });
      toast({
        title: "Queued",
        description: "A posts check will run on the next tracking run.",
      });
    },
    onError: (e: Error) => {
      toast({
        title: "Could not retrieve posts",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const retrieveTaggedMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/social-accounts/${accountId}/tracking-jobs`, { kind: "tagged" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobsKey });
      toast({ title: "Queued", description: "A tagged posts check will run on the next tracking run." });
    },
    onError: (e: Error) => {
      toast({ title: "Could not retrieve tagged posts", description: e.message, variant: "destructive" });
    },
  });
  const retrieveTaggedButton = (
    <Button
      size="sm"
      onClick={() => retrieveTaggedMutation.mutate()}
      disabled={retrieveTaggedMutation.isPending || isTaggedQueued}
      data-testid="button-retrieve-tagged"
    >
      {retrieveTaggedMutation.isPending || isTaggedQueued ? (
        <>
          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          {isTaggedQueued ? "Tagged Queued" : "Queuing..."}
        </>
      ) : (
        <>
          <Download className="h-4 w-4 mr-1.5" />
          Retrieve Tagged Posts
        </>
      )}
    </Button>
  );

  // Recent journal entries, for the "profile image updated" line in the info dialog
  const { data: recentHistory } = useQuery<{ items: SocialAccountHistoryEntry[] }>({
    queryKey: ["/api/social-accounts", uuid, "history", "recent"],
    queryFn: async () => {
      const res = await fetch(`/api/social-accounts/${uuid}/history?kind=direct&page=1&limit=100`);
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    },
    enabled: !!uuid && isInfoDialogOpen,
  });

  const linkPersonMutation = useMutation({
    mutationFn: async ({ personId, socialAccountId, existingUuids }: { personId: string; socialAccountId: string; existingUuids: string[] }) => {
      await apiRequest("PATCH", `/api/social-accounts/${socialAccountId}`, {
        ownerUuid: personId,
      });
      return await apiRequest("PATCH", `/api/people/${personId}`, {
        socialAccountUuids: Array.from(new Set([...existingUuids, socialAccountId])),
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

  // By the account's id, not the route param: the page also opens by username, which PATCH doesn't resolve.
  // A refetch already in flight would land the old value over the optimistic one, so it's cancelled first.
  const starMutation = useMutation({
    mutationFn: (isStarred: boolean) =>
      apiRequest("PATCH", `/api/social-accounts/${account!.id}`, { isStarred }),
    onMutate: async (isStarred: boolean) => {
      await queryClient.cancelQueries({ queryKey: ["/api/social-accounts", uuid], exact: true });
      queryClient.setQueryData(["/api/social-accounts", uuid], (old: any) => old && { ...old, isStarred });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"], exact: false });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update star", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", `/api/social-accounts/${accountId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"], exact: false });
      toast({
        title: "Success",
        description: "Social account deleted successfully",
      });
      setIsDeleteDialogOpen(false);
      navigate("/social-accounts");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete social account",
        variant: "destructive",
      });
      setIsDeleteDialogOpen(false);
    },
  });

  const deletePostMutation = useMutation({
    mutationFn: async (postId: string) => {
      return await apiRequest("DELETE", `/api/social-account-posts/${postId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", uuid, "posts?includeDeleted=true"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", uuid, "posts?postType=story&includeDeleted=true"] });
      queryClient.invalidateQueries({ queryKey: taggedKey });
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

  if (isLoading) {
    return (
      <div className="flex flex-col h-full overflow-hidden" data-testid="skeleton-social-account">
        {/* Top bar */}
        <div className="border-b px-4 py-2 flex items-center justify-between shrink-0 bg-card/40">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Tab sidebar */}
          <div className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r bg-card/25 flex flex-col justify-between">
            <div className="p-3 space-y-1">
              <Skeleton className="h-9 w-full rounded-md" />
              {[16, 12, 14, 20, 24, 14, 16, 18].map((w, i) => (
                <div key={i} className="h-9 px-3 flex items-center">
                  <Skeleton className="h-3.5" style={{ width: `${w * 4}px` }} />
                </div>
              ))}
            </div>
            <div className="hidden md:block p-4 border-t bg-muted/15 space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-2.5 w-20" />
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-28" />
                </div>
              ))}
            </div>
          </div>

          {/* Account tab */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex flex-col lg:flex-row gap-6 items-start">
              <div className="flex-1 space-y-6 w-full min-w-0">
                <div className="space-y-2">
                  <Skeleton className="h-8 w-1/3" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 rounded-md" />
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {["aspect-square", "aspect-[9/16]"].map((aspect) => (
                    <Card key={aspect} className="p-4 space-y-3 shadow-none">
                      <Skeleton className="h-4 w-24" />
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className={`${aspect} rounded-md w-full`} />
                        ))}
                      </div>
                    </Card>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Skeleton className="h-14 rounded-lg" />
                  <Skeleton className="h-14 rounded-lg" />
                </div>
                <Skeleton className="h-28 w-full rounded-lg" />
              </div>
              <div className="w-full lg:w-80 shrink-0 space-y-4">
                <Skeleton className="aspect-square w-full rounded-2xl" />
                <Skeleton className="h-8 w-full rounded-md" />
                <Skeleton className="h-72 w-full rounded-lg" />
              </div>
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
    followIds?.followerIds?.includes(meId)
  );

  const accountType = account.typeId 
    ? socialAccountTypes?.find(t => t.id === account.typeId) 
    : null;

  const cleanUsername = account.username ? account.username.replace(/^@/, "") : "";
  const directInstagramUrl = account.currentProfile?.accountUrl?.includes("instagram.com")
    ? (account.currentProfile.accountUrl.startsWith("http") ? account.currentProfile.accountUrl : `https://${account.currentProfile.accountUrl}`)
    : `https://www.instagram.com/${cleanUsername}/`;


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

  // The journal already says which entries changed the image, so this is the
  // newest of those rather than a walk over every stored version.
  const getImageLastChangedAt = (): Date | null => {
    // A resolution upgrade of the same picture ("improved") is not a change of picture.
    const entry = recentHistory?.items.find(
      (e) => e.profileFieldsChanged.includes("image") && e.imageChange !== "improved",
    );
    return entry ? new Date(entry.detectedAt) : null;
  };

  const getMostRecentImport = () => {
    const imports: { date: Date; type: string }[] = [];
    if (account.latestImportFollowers) {
      imports.push({ date: new Date(account.latestImportFollowers), type: "followers" });
    }
    if (account.latestImportFollowing) {
      imports.push({ date: new Date(account.latestImportFollowing), type: "following" });
    }
    if (account.lastScrapedAt) {
      imports.push({ date: new Date(account.lastScrapedAt), type: "scraped" });
    }
    if (account.internalAccountCreationDate) {
      imports.push({
        date: new Date(account.internalAccountCreationDate),
        type: account.internalAccountCreationType || "import",
      });
    }
    if (imports.length === 0) return null;
    return imports.sort((a, b) => b.date.getTime() - a.date.getTime())[0];
  };

  const mostRecentImport = getMostRecentImport();

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
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact Top-Bar Header */}
      <div className="border-b px-4 py-2 flex items-center justify-between shrink-0 bg-card/40 backdrop-blur-md z-10">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/social-accounts")}
            className="h-8 w-8 rounded-full shrink-0"
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          {activeTab !== "account" && (
            <a
              href={directInstagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open direct Instagram page"
              className="hover:opacity-80 transition-opacity shrink-0"
              data-testid="link-header-profile-avatar"
            >
              <Avatar className="w-9 h-9">
                {account.currentProfile?.imageUrl && (
                  <AvatarImage
                    src={withImageSize(account.currentProfile.imageUrl, 64)}
                    alt={account.username}
                  />
                )}
                <AvatarFallback className="text-xs">
                  {getInitials(account.username)}
                </AvatarFallback>
              </Avatar>
            </a>
          )}

          <div className="min-w-0">
            <h1 className="text-sm font-bold truncate leading-none flex items-center gap-1.5" data-testid="text-account-username">
              <span>{account.username}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-yellow-500 hover:text-yellow-600 shrink-0"
                onClick={() => starMutation.mutate(!account.isStarred)}
                title={account.isStarred ? "Unstar" : "Star"}
                data-testid="button-star-account"
              >
                <Star className={`h-3.5 w-3.5 ${account.isStarred ? "fill-current" : ""}`} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-foreground shrink-0"
                asChild
                data-testid="button-external-instagram"
              >
                <a
                  href={directInstagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="Open direct Instagram page"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="sr-only">Open direct Instagram page</span>
                </a>
              </Button>
              {accountType && (
                <Link href={`/social-accounts?type=${accountType.id}`}>
                  <SocialPlatformIcon type={accountType} className="cursor-pointer" />
                </Link>
              )}
              {isFollowingYou && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 leading-none" data-testid="badge-follows-you">
                  Follows you
                </Badge>
              )}
            </h1>
            {account.currentProfile?.nickname && (
              <p className="text-xs text-muted-foreground truncate leading-none mt-1" data-testid="text-account-nickname">
                {account.currentProfile?.nickname}
              </p>
            )}
          </div>
        </div>

        {/* Consolidated Actions Dropdown Menu */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => navigate(`/ai-chat-demo?socialAccount=${account.id}`)} data-testid="button-chat-about-account">
            <MessageSquare className="h-3.5 w-3.5" />
            Chat about account
          </Button>
          <Button variant="outline" size="sm" className="px-2" onClick={() => setIsInfoDialogOpen(true)} aria-label="Account info" title="Account info" data-testid="button-account-info">
            <Info className="h-3.5 w-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1" data-testid="button-actions-menu">
                Actions
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => setIsEditDialogOpen(true)} data-testid="button-edit-account">
                <Edit2 className="h-4 w-4 mr-2" />
                Edit Account
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsChangeUsernameOpen(true)} data-testid="button-change-username">
                <AtSign className="h-4 w-4 mr-2" />
                Change Username
              </DropdownMenuItem>
              {account.currentProfile?.accountUrl && (
                <DropdownMenuItem onClick={() => window.open(account.currentProfile?.accountUrl ?? undefined, "_blank")} data-testid="button-goto-profile">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {accountType?.name ? `See on ${accountType.name}` : "See on Platform"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => navigate(`/social-graph-3d?view=social&selected=${account.id}`)} data-testid="button-open-in-graph">
                <GraphTriangleIcon className="h-4 w-4 mr-2" />
                Open in Graph
              </DropdownMenuItem>
              <DropdownMenuItem disabled={noFace.isPending} onClick={() => noFace.toggle(account)} data-testid="button-toggle-no-face">
                <ScanFace className="h-4 w-4 mr-2" />
                {account.noFace ? "Match faces again" : "Has no face"}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-testid="button-bans-menu">
                  <Ban className="h-4 w-4 mr-2" />
                  Processing bans
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  {(Object.keys(BANNED_ACTION_LABELS) as BannedAction[]).map((action) => {
                    const banned = account.bannedActions.includes(action);
                    return (
                      <DropdownMenuCheckboxItem
                        key={action}
                        checked={banned}
                        disabled={bans.isPending}
                        onSelect={() => bans.set(account, action, !banned)}
                        data-testid={`button-ban-${action}`}
                      >
                        {BANNED_ACTION_LABELS[action]}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {accountType?.name?.toLowerCase() === "instagram" && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger data-testid="button-update-menu">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Update
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-52">
                    <DropdownMenuItem disabled={queueTracking.isPending} onClick={() => queueTracking.mutate("scan")} data-testid="button-update-general">
                      <Info className="h-4 w-4 mr-2" />
                      General
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={queueTracking.isPending} onClick={() => queueTracking.mutate("highlights")} data-testid="button-update-stories">
                      <Layers className="h-4 w-4 mr-2" />
                      Stories
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={queueTracking.isPending} onClick={() => queueTracking.mutate("follows")} data-testid="button-update-follow">
                      <Users className="h-4 w-4 mr-2" />
                      Follow
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={() => setIsDeleteDialogOpen(true)} 
                className="text-destructive hover:text-destructive focus:bg-destructive/10"
                data-testid="button-delete-account"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Account
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {noFace.dialog}
          {bans.dialog}
        </div>
      </div>

      {/* Main Content Area with Left Sidebar Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Side Navigation Menu */}
        <div className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r bg-card/25 flex flex-col justify-between overflow-y-auto">
          <div className="p-3">
            <TabsList className="flex flex-col items-stretch justify-start h-auto bg-transparent p-0 gap-1" data-testid="tabs-social-account">
              <TabsTrigger
                value="account"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-account"
              >
                Account
              </TabsTrigger>
              <TabsTrigger
                value="follow"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-follow"
              >
                Follow
              </TabsTrigger>
              <TabsTrigger
                value="posts"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-posts"
              >
                Posts
              </TabsTrigger>
              <TabsTrigger
                value="tagged"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-tagged"
              >
                Tagged
              </TabsTrigger>
              <TabsTrigger
                value="stories"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-stories"
              >
                Stories
              </TabsTrigger>
              <TabsTrigger
                value="faces"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0 flex items-center justify-between"
                data-testid="tab-faces"
              >
                <span>Faces</span>
                {facesPending > 0 && (
                  <span className="text-[10px] font-medium rounded-full bg-primary/15 text-primary px-1.5 py-0.5" title="Faces waiting for a decision">{facesPending}</span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="messages"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-messages"
              >
                Messages
              </TabsTrigger>
              <TabsTrigger
                value="notes"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-notes"
              >
                Notes
              </TabsTrigger>
              <TabsTrigger
                value="connections"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-connections"
              >
                Connections
              </TabsTrigger>
              <TabsTrigger
                value="history"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-history"
              >
                History
              </TabsTrigger>
              <TabsTrigger
                value="insights"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-insights"
              >
                Insights
              </TabsTrigger>
              <TabsTrigger
                value="summary"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0 flex items-center justify-between"
                data-testid="tab-summary"
              >
                <span>Summary</span>
                {account.aiSummaryInvalidated && (
                  <span className="h-2 w-2 rounded-full bg-amber-500" title="Summary out of date" />
                )}
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        {/* Selected Tab Content Pane */}
        <div className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden">
          {/* Account Tab Dashboard */}
          <TabsContent value="account" className="mt-0 flex-1 overflow-y-auto p-6 space-y-6">
            <div className="flex flex-col lg:flex-row gap-6 items-start">
              {/* Left/Main Column: Overview Summary Panels */}
              <div className="flex-1 space-y-6 w-full min-w-0">
                {/* Profile Brief */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-2xl font-bold" data-testid="text-account-title">
                      {account.currentProfile?.nickname || account.username}
                    </h2>
                    {accountType && (
                      <Link href={`/social-accounts?type=${accountType.id}`}>
                        <SocialPlatformIcon type={accountType} className="cursor-pointer [&_svg]:h-5 [&_svg]:w-5" />
                      </Link>
                    )}
                    {isFollowingYou && (
                      <Badge variant="secondary" className="text-xs" data-testid="badge-account-main-follows-you">
                        Follows you
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-muted-foreground" data-testid="text-account-main-username">
                      @{account.username}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground hover:text-foreground shrink-0"
                      asChild
                      data-testid="button-profile-brief-external-instagram"
                    >
                      <a
                        href={directInstagramUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Open direct Instagram page"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span className="sr-only">Open direct Instagram page</span>
                      </a>
                    </Button>
                  </div>
                  {account.currentProfile?.bio && (
                    <p className="text-sm text-foreground/80 whitespace-pre-wrap pt-1" data-testid="text-account-bio-summary">
                      {account.currentProfile.bio}
                    </p>
                  )}
                  {!!account.bioMentions?.length && (
                    <div className="flex flex-wrap gap-1.5 pt-1" data-testid="bio-mentions">
                      {account.bioMentions.map((m) => (
                        <Link key={m.id} href={`/social-accounts/${m.id}`}>
                          <Badge variant="secondary" className="cursor-pointer text-xs gap-1" data-testid={`chip-bio-mention-${m.username}`}>
                            <AtSign className="h-3 w-3" />
                            {m.username}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quick Actions Action Areas */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Button 
                    variant="outline" 
                    className="h-20 flex flex-col gap-1.5 items-center justify-center text-xs" 
                    onClick={() => setIsEditDialogOpen(true)}
                    data-testid="action-btn-edit-account"
                  >
                    <Edit2 className="h-4 w-4 text-primary" />
                    Edit Account
                  </Button>
                  <Button 
                    variant="outline" 
                    className="h-20 flex flex-col gap-1.5 items-center justify-center text-xs" 
                    onClick={() => retrievePostsMutation.mutate()}
                    disabled={retrievePostsMutation.isPending || isPostsQueued}
                    data-testid="action-btn-retrieve-posts"
                  >
                    {retrievePostsMutation.isPending || isPostsQueued ? (
                      <Loader2 className="h-4 w-4 text-primary animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 text-primary" />
                    )}
                    {isPostsQueued ? "Posts Queued" : "Retrieve Posts"}
                  </Button>
                  <Button 
                    variant="outline" 
                    className="h-20 flex flex-col gap-1.5 items-center justify-center text-xs" 
                    onClick={() => navigate(`/social-graph-3d?view=social&selected=${account.id}`)}
                    data-testid="action-btn-open-graph"
                  >
                    <GraphTriangleIcon className="h-4 w-4 text-primary" />
                    Open in Graph
                  </Button>
                  <Button 
                    variant="outline" 
                    className="h-20 flex flex-col gap-1.5 items-center justify-center text-xs" 
                    onClick={() => setIsInfoDialogOpen(true)}
                    data-testid="action-btn-account-info"
                  >
                    <Info className="h-4 w-4 text-primary" />
                    Account Info
                  </Button>
                </div>

                {/* Summaries: Posts & Stories side by side */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-4 space-y-3 shadow-none">
                  <h3 className="font-semibold text-sm flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      Posts ({posts?.length || 0})
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => handleTabChange("posts")} className="text-[11px] h-6 px-2 text-primary hover:text-primary">View all</Button>
                  </h3>
                  {isPostsLoading ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="aspect-square rounded-md w-full" />
                      ))}
                    </div>
                  ) : posts && posts.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {posts.slice(0, 4).map((post) => {
                        let images: string[] = [];
                        try {
                          images = post.content ? JSON.parse(post.content) : [];
                        } catch {
                          images = [];
                        }
                        const firstImage = images[0] || null;

                        return (
                          <div
                            key={post.id}
                            className="aspect-square rounded-md border bg-muted overflow-hidden relative cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => {
                              setSelectedPost(post);
                              setIsPostDetailOpen(true);
                            }}
                          >
                            {firstImage ? (
                              <img src={withImageSize(firstImage, 360)} alt="Post thumbnail" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                              </div>
                            )}
                            {post.description && (
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 text-[10px] text-white truncate">
                                {post.description}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No posts recorded.</p>
                  )}
                </Card>

                <Card className="p-4 space-y-3 shadow-none">
                  <h3 className="font-semibold text-sm flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      Stories ({stories?.length || 0})
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleTabChange("stories")}
                      className="text-[11px] h-6 px-2 text-primary hover:text-primary"
                      data-testid="button-view-all-stories"
                    >
                      View all
                    </Button>
                  </h3>
                  {stories && stories.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {stories.slice(0, 4).map((story) => {
                        let images: string[] = [];
                        try {
                          images = story.content ? JSON.parse(story.content) : [];
                        } catch {
                          images = [];
                        }
                        const firstImage = images[0] || null;

                        return (
                          <div
                            key={story.id}
                            className="aspect-[9/16] rounded-md border bg-muted overflow-hidden relative cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => handleTabChange("stories")}
                            data-testid={`overview-story-${story.id}`}
                          >
                            {firstImage ? (
                              <img src={withImageSize(firstImage, 360)} alt="Story thumbnail" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                              </div>
                            )}
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1 text-[10px] text-white truncate">
                              {story.postedAt ? new Date(story.postedAt).toLocaleDateString() : ""}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No stories recorded yet.</p>
                  )}
                </Card>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                  <AccountOsintCard socialAccountId={account.id} />
                  <AccountSummaryCard
                    socialAccountId={account.id}
                    onOpenSummaryTab={() => handleTabChange("summary")}
                  />
                </div>

                {/* Summaries: Activity & Import Info */}
                <Card className="p-4 space-y-3 shadow-none">
                  <h3 className="font-semibold text-sm flex items-center justify-between">
                    <span>Activity &amp; Import History</span>
                    <Button variant="ghost" size="sm" onClick={() => setIsInfoDialogOpen(true)} className="text-[11px] h-6 px-2 text-primary hover:text-primary">Details</Button>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase font-bold tracking-wider">Account Creation</span>
                      <p className="font-medium" data-testid="text-details-creation-date">{formatYearMonth(account.joinedAt)}</p>
                      <p className="text-[11px] text-muted-foreground">Reported by Instagram</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase font-bold tracking-wider">First Import</span>
                      <p className="font-medium" data-testid="text-details-first-import">{formatDateTime(account.internalAccountCreationDate)}</p>
                      <p className="text-[11px] text-muted-foreground">Type: {account.internalAccountCreationType || "User"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground block mb-0.5 text-[10px] uppercase font-bold tracking-wider">Most Recent Import</span>
                      <p className="font-medium" data-testid="text-details-most-recent-import">{formatDateTime(mostRecentImport?.date ?? null)}</p>
                      <p className="text-[11px] text-muted-foreground">Type: {mostRecentImport?.type ?? "—"}</p>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Right Column: Large Profile Picture & Details */}
              <div className="w-full lg:w-80 shrink-0 space-y-4">
                {/* Large Profile Image */}
                <a
                  href={directInstagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative aspect-square w-full rounded-2xl border bg-muted overflow-hidden group shadow-sm block cursor-pointer"
                  data-testid="link-account-profile-image"
                  title="Open Instagram profile"
                >
                  {profileImgSrc ? (
                    <img
                      src={withImageSize(profileImgSrc, "max")}
                      alt={account.username}
                      onError={() => setProfileImgSrc(null)}
                      className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl font-bold bg-primary/10 text-primary">
                      {getInitials(account.username)}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Button variant="secondary" size="sm" className="pointer-events-none gap-1.5 shadow" data-testid="button-goto-instagram">
                      <SiInstagram className="h-4 w-4" />
                      Go to Instagram
                    </Button>
                  </div>
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5"
                  onClick={() => setProfilePhotoOpen(true)}
                  data-testid="button-profile-photo"
                >
                  <ScanFace className="h-4 w-4" />
                  Profile picture &amp; faces
                </Button>
                <ProfilePhotoDialog accountId={account.id} username={account.username} open={profilePhotoOpen} onOpenChange={setProfilePhotoOpen} />

                {/* Account Details Card */}
                <Card className="p-4 space-y-3 text-xs shadow-none">
                  <h3 className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider block">Account Details</h3>
                  <div className="space-y-2.5">
                    {/* Username */}
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Username</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground" data-testid="text-details-username">@{account.username}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 text-muted-foreground hover:text-foreground shrink-0"
                          asChild
                          data-testid="button-details-external-instagram"
                        >
                          <a
                            href={directInstagramUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Open direct Instagram page"
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span className="sr-only">Open direct Instagram page</span>
                          </a>
                        </Button>
                      </div>
                    </div>

                    {/* Display name */}
                    {account.currentProfile?.nickname && (
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Display Name</span>
                        <span className="text-foreground" data-testid="text-details-display-name">{account.currentProfile.nickname}</span>
                      </div>
                    )}

                    {/* Account type */}
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Account Type</span>
                      <span className="text-foreground inline-flex items-center gap-1.5" data-testid="text-details-account-type">{accountType && <SocialPlatformIcon type={accountType} />}{accountType?.name || "Unknown"}</span>
                    </div>

                    {/* Status (Public / Private) */}
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Status</span>
                      <div className="flex items-center gap-1.5 mt-0.5" data-testid="text-details-privacy-status">
                        {account.isPrivate === true ? (
                          <>
                            <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            <span className="text-foreground font-medium">Private</span>
                          </>
                        ) : account.isPrivate === false ? (
                          <>
                            <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-foreground">Public</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Unknown</span>
                        )}
                      </div>
                    </div>

                    {/* No face: organisation account, never matched to faces */}
                    {account.noFace && (
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Faces</span>
                        <div className="flex items-center gap-1.5 mt-0.5" data-testid="text-details-no-face">
                          <ScanFace className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-foreground">Not matched (no single owner)</span>
                        </div>
                      </div>
                    )}

                    {account.bannedActions.length > 0 && (
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Processing bans</span>
                        <div className="flex items-center gap-1.5 mt-0.5" data-testid="text-details-banned-actions">
                          <Ban className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-foreground">{account.bannedActions.map((a) => BANNED_ACTION_LABELS[a as BannedAction] ?? a).join(", ")}</span>
                        </div>
                      </div>
                    )}

                    {/* External Profile Link */}
                    {account.currentProfile?.accountUrl && (
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase font-semibold block">External URL</span>
                        <div className="flex items-center gap-1.5 truncate mt-0.5">
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <a
                            href={account.currentProfile.accountUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline truncate text-primary font-medium"
                            data-testid="link-external-account"
                          >
                            {account.currentProfile.accountUrl.replace(/^https?:\/\/(www\.)?/, '')}
                          </a>
                        </div>
                      </div>
                    )}

                    {/* Location */}
                    {owner?.primaryAddress && (
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Location</span>
                        <div className={`flex items-start gap-1.5 mt-0.5 ${owner.primaryAddress.outdated ? OUTDATED_TEXT : "text-foreground"}`}>
                          <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <span className="break-words">
                            {owner.primaryAddress.address}
                            {owner.primaryAddress.outdated && <OutdatedBadge />}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Interest level + Edit tracking (Instagram only) */}
                    {accountType?.name?.toLowerCase() === "instagram" && <AccountTracking account={account} uuid={uuid} />}
                  </div>

                  {/* Linked Person Section */}
                  <div className="border-t pt-3 space-y-2">
                    <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider block">Linked Person</span>
                    {account.ownerUuid ? (
                      owner ? (
                        <div className="flex items-center gap-2.5 p-2 rounded-md bg-muted/40 border">
                          <Avatar className="w-8 h-8 shrink-0">
                            {owner.imageUrl && (
                              <AvatarImage src={owner.imageUrl} alt={formatPersonName(owner)} />
                            )}
                            <AvatarFallback className="text-xs">
                              {personInitials(owner)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <Link href={`/person/${owner.id}`}>
                              <a className="text-primary font-medium hover:underline block truncate text-xs">
                                {formatPersonName(owner)}
                              </a>
                            </Link>
                            {(owner.title || owner.company) && (
                              <p className="text-[11px] text-muted-foreground truncate">
                                {owner.title} {owner.title && owner.company && "•"} {owner.company}
                              </p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic">Loading owner...</span>
                      )
                    ) : (
                      <p className="text-muted-foreground italic text-xs">No person linked</p>
                    )}

                    {/* 2 Buttons: Link and Create */}
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-xs h-8"
                        onClick={() => setIsLinkPersonOpen(true)}
                        data-testid="button-link-person-details"
                      >
                        Link
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-xs h-8"
                        onClick={() => setIsCreatePersonOpen(true)}
                        data-testid="button-create-person-details"
                      >
                        Create
                      </Button>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Follow Tab */}
          <TabsContent value="follow" className="mt-0 flex-1 min-h-0 overflow-y-auto">
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
                      <SocialAccountRow
                        key={followerAccount.id}
                        id={followerAccount.id}
                        username={followerAccount.username}
                        imageUrl={followerAccount.imageUrl}
                        testIdPrefix="follower"
                      />
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
                    onClick={() => handleExtract("graph")}
                    data-testid="button-update-following"
                    className="gap-1.5"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Update
                  </Button>
                </div>
                {followingList.length > 0 ? (
                  <div className="space-y-2">
                    {followingList.map((followingAccount) => (
                      <SocialAccountRow
                        key={followingAccount.id}
                        id={followingAccount.id}
                        username={followingAccount.username}
                        imageUrl={followingAccount.imageUrl}
                        testIdPrefix="following"
                      />
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
            </div>
          </TabsContent>

          {/* Posts Tab */}
          <TabsContent value="posts" className="mt-0 flex-1 min-h-0 overflow-y-auto">
            <div className="px-6 py-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div className="flex flex-wrap items-center gap-4">
                  <h2 className="text-lg font-semibold">Posts ({posts?.length || 0})</h2>
                  {postSortSelect}
                </div>
                <Button
                  size="sm"
                  onClick={() => retrievePostsMutation.mutate()}
                  disabled={retrievePostsMutation.isPending || isPostsQueued}
                  data-testid="button-retrieve-posts"
                >
                  {retrievePostsMutation.isPending || isPostsQueued ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      {isPostsQueued ? "Posts Queued" : "Queuing..."}
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-1.5" />
                      Retrieve Posts
                    </>
                  )}
                </Button>
              </div>

              <SocialPostsGrid
                posts={sortedPosts}
                isLoading={isPostsLoading}
                accountId={accountId}
                onOpen={openPost}
                empty={
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="rounded-full bg-muted/60 p-4 mb-4">
                      <ImageIcon className="h-10 w-10 text-muted-foreground/50" />
                    </div>
                    <h3 className="text-base font-medium text-foreground mb-1">No posts imported yet</h3>
                    <p className="text-xs text-muted-foreground max-w-sm mb-4">
                      Retrieve all posts in high quality from this account.
                    </p>
                    <Button
                      onClick={() => retrievePostsMutation.mutate()}
                      disabled={retrievePostsMutation.isPending || isPostsQueued}
                      data-testid="button-import-now"
                    >
                      {retrievePostsMutation.isPending || isPostsQueued ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                          {isPostsQueued ? "Queued" : "Queuing..."}
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4 mr-1.5" />
                          Import now
                        </>
                      )}
                    </Button>
                  </div>
                }
              />
            </div>
          </TabsContent>

          {/* Tagged Tab: posts other accounts made that tag this one, each marked with its poster */}
          <TabsContent value="tagged" className="mt-0 flex-1 min-h-0 overflow-y-auto">
            <div className="px-6 py-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div className="flex flex-wrap items-center gap-4">
                  <h2 className="text-lg font-semibold">Tagged posts ({taggedPosts.length})</h2>
                  {postSortSelect}
                </div>
                {retrieveTaggedButton}
              </div>
              <SocialPostsGrid
                posts={sortedTaggedPosts}
                isLoading={isTaggedLoading}
                accountId={accountId}
                onOpen={openPost}
                dimmed={(post) => Boolean(post.tag.removedSeenAt)}
                coverIndex={taggedSlide}
                renderByline={(post) => (
                  <Link
                    href={`/social-accounts/${post.poster.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 mb-1.5 text-xs font-medium hover:underline min-w-0"
                    data-testid={`link-post-poster-${post.id}`}
                  >
                    <Avatar className="h-5 w-5">
                      {post.poster.imageUrl && <AvatarImage src={withImageSize(post.poster.imageUrl, 64)} alt="" />}
                      <AvatarFallback className="text-[9px]">{post.poster.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="truncate">@{post.poster.username}</span>
                    {post.tag.removedSeenAt && <span className="ml-auto shrink-0 text-[10px] font-normal text-muted-foreground">Tag removed</span>}
                  </Link>
                )}
                empty={
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="rounded-full bg-muted/60 p-4 mb-4">
                      <AtSign className="h-10 w-10 text-muted-foreground/50" />
                    </div>
                    <h3 className="text-base font-medium text-foreground mb-1">No tagged posts imported yet</h3>
                    <p className="text-xs text-muted-foreground max-w-sm mb-4">Retrieve the posts other accounts tagged this one in.</p>
                    {retrieveTaggedButton}
                  </div>
                }
              />
            </div>
          </TabsContent>

          {/* Messages Tab */}
          {/* Messages Tab */}
          <TabsContent value="stories" className="mt-0 flex-1 min-h-0 overflow-y-auto">
            <StoriesTab accountId={account.id} stories={stories} skipStories={account.skipStories} />
          </TabsContent>

          <TabsContent value="faces" className="mt-0 flex-1 min-h-0 overflow-y-auto">
            <AccountFacesTab accountId={account.id} />
          </TabsContent>

          <TabsContent value="messages" className="mt-0 flex-1 min-h-0">
            <MessagesTab socialAccountId={account.id} />
          </TabsContent>

          <TabsContent value="notes" className="mt-0 flex-1 min-h-0 overflow-y-auto p-6">
            <NotesList socialAccountId={account.id} />
          </TabsContent>
          <TabsContent value="connections" className="mt-0 flex-1 min-h-0 overflow-y-auto">
            <ConnectionsTab socialAccountId={account.id} />
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="mt-0 flex-1 min-h-0 overflow-y-auto">
            <SocialAccountHistoryTab
              socialAccountId={account.id}
              current={{
                username: account.username,
                nickname: account.nickname,
                bio: account.bio,
                location: account.location,
                imageUrl: account.imageUrl,
                joinedAt: account.joinedAt,
              }}
              canTrack={accountType?.name?.toLowerCase() === "instagram"}
            />
          </TabsContent>

          <TabsContent value="insights" className="mt-0 flex-1 min-h-0 overflow-y-auto">
            <InsightsTab socialAccountId={account.id} />
          </TabsContent>

          <TabsContent value="summary" className="mt-0 flex-1 min-h-0 overflow-y-auto data-[state=active]:flex flex-col">
            <SocialAccountSummaryTab socialAccountId={account.id} />
          </TabsContent>
        </div>
      </Tabs>

      <SocialAccountDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        account={account}
      />

      <ChangeUsernameDialog
        open={isChangeUsernameOpen}
        onOpenChange={setIsChangeUsernameOpen}
        account={account}
        accountType={accountType}
      />

      <LinkFollowingAccountsDialog
        open={isLinkFollowingOpen}
        onOpenChange={setIsLinkFollowingOpen}
        accountUuid={accountId}
        linkedAccountIds={followIds?.followingIds || []}
      />

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

      <LinkPersonDialog
        open={isLinkPersonOpen}
        onOpenChange={setIsLinkPersonOpen}
        socialAccountId={account.id}
        currentPersonId={account.ownerUuid}
      />

      {selectedPost && (
        <>
          {isPostDetailOpen && (
            <Suspense fallback={null}>
              <PostDetailDialog
                open={isPostDetailOpen}
                onOpenChange={(open) => {
                  setIsPostDetailOpen(open);
                  if (!open && typeof window !== "undefined") {
                    const params = new URLSearchParams(window.location.search);
                    if (params.has("postId")) {
                      params.delete("postId");
                      const searchStr = params.toString();
                      window.history.replaceState(null, "", `${window.location.pathname}${searchStr ? `?${searchStr}` : ""}`);
                    }
                  }
                }}
                post={selectedPost}
                initialImageIndex={activeTab === "tagged" ? taggedSlide(selectedPost) : 0}
                onEdit={() => {
                  setIsPostDetailOpen(false);
                  setIsEditPostOpen(true);
                }}
                onDelete={() => {
                  deletePostMutation.mutate(selectedPost.id);
                  setSelectedPost(null);
                }}
              />
            </Suspense>
          )}

          <PostDialog
            open={isEditPostOpen}
            onOpenChange={setIsEditPostOpen}
            post={selectedPost}
            socialAccountId={accountId}
          />
        </>
      )}

      {/* Social Account Info Dialog */}
      <Dialog open={isInfoDialogOpen} onOpenChange={setIsInfoDialogOpen}>
        <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto" data-testid="dialog-account-info">
          <DialogHeader>
            <DialogTitle>Social account info</DialogTitle>
            <DialogDescription>
              Account history and timeline details for @{account?.username}
            </DialogDescription>
          </DialogHeader>
          {account && (
            <div className="space-y-4 pt-1 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Account PK</span>
                <span className="text-right font-mono text-xs select-all break-all" data-testid="info-account-pk">
                  {account.instagramUserId ?? "—"}
                </span>
              </div>

              <div className="border-t pt-3 space-y-1.5" data-testid="section-listed-counts">
                <p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">Listed on Profile</p>
                <p className="text-xs text-muted-foreground italic">The totals the profile page itself shows.</p>
                {account.reportedFollowersCount == null && account.reportedFollowingCount == null ? (
                  <p className="text-muted-foreground italic">Not scraped yet</p>
                ) : (
                  <>
                    <div className="flex justify-between gap-4"><span className="text-muted-foreground">Followers</span><span className="font-medium">{account.reportedFollowersCount?.toLocaleString() ?? "—"}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-muted-foreground">Following</span><span className="font-medium">{account.reportedFollowingCount?.toLocaleString() ?? "—"}</span></div>
                  </>
                )}
              </div>

              <div className="border-t pt-3 space-y-1.5" data-testid="section-actual-counts">
                <p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">Captured in PRM</p>
                <p className="text-xs text-muted-foreground italic">Accounts PRM actually holds in each list.</p>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Followers</span>
                  <span className="font-medium">
                    {account.followersCount.toLocaleString()}
                    {account.reportedFollowersCount != null && account.followersCount < account.reportedFollowersCount && ` of ${account.reportedFollowersCount.toLocaleString()}`}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Following</span>
                  <span className="font-medium">
                    {account.followingCount.toLocaleString()}
                    {account.reportedFollowingCount != null && account.followingCount < account.reportedFollowingCount && ` of ${account.reportedFollowingCount.toLocaleString()}`}
                  </span>
                </div>
              </div>

              <div className="border-t pt-3 space-y-1.5">
                <p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">Import Status</p>
                <div className="flex justify-between gap-4" data-testid="text-account-created-date">
                  <span className="text-muted-foreground shrink-0">Imported</span>
                  <span className="text-right font-medium">{formatDateTime(account.internalAccountCreationDate)} ({account.internalAccountCreationType})</span>
                </div>
                {account.latestImportFollowers && (
                  <div className="flex justify-between gap-4" data-testid="text-account-latest-followers">
                    <span className="text-muted-foreground shrink-0">Followers</span>
                    <span className="text-right font-medium">{formatDateTime(account.latestImportFollowers)}</span>
                  </div>
                )}
                {account.latestImportFollowing && (
                  <div className="flex justify-between gap-4" data-testid="text-account-latest-following">
                    <span className="text-muted-foreground shrink-0">Following</span>
                    <span className="text-right font-medium">{formatDateTime(account.latestImportFollowing)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="space-y-4 pt-1 border-t">
            <div className="space-y-3 text-sm pt-3">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Account created</span>
                <span className="text-right font-medium" data-testid="info-account-created">
                  {formatYearMonth(account?.joinedAt)}
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
                  {formatDateTime(mostRecentImport?.date ?? null)}
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
                  {recentHistory
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
              const followingIds = new Set(followIds?.followingIds ?? []);
              const followerIds = new Set(followIds?.followerIds ?? []);
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
                          <SocialAccountRow
                            key={a.id}
                            id={a.id}
                            username={a.username}
                            imageUrl={a.imageUrl}
                            testIdPrefix="followers-only"
                            onNavigate={() => setIsCompareOpen(false)}
                          />
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
                          <SocialAccountRow
                            key={a.id}
                            id={a.id}
                            username={a.username}
                            imageUrl={a.imageUrl}
                            testIdPrefix="following-only"
                            onNavigate={() => setIsCompareOpen(false)}
                          />
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

      {/* Delete Account Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Social Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {account?.username}? This will permanently remove this account and unlink it from any associated people. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
