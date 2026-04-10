import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Loader2, Edit2, Trash2, Plus, ExternalLink, Upload, FileText, CheckCircle2, UserPlus, Heart, MessageCircle, ImageIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import type { SocialAccountWithCurrentProfile, Person, SocialAccountType, SocialAccountPost } from "@shared/schema";
import { Link } from "wouter";
import { EditSocialAccountDialog } from "@/components/edit-social-account-dialog";
import { LinkFollowingAccountsDialog } from "@/components/link-following-accounts-dialog";
import { AddPersonDialog } from "@/components/add-person-dialog";
import { AddPostDialog } from "@/components/add-post-dialog";
import { EditPostDialog } from "@/components/edit-post-dialog";
import { PostDetailDialog } from "@/components/post-detail-dialog";
import { SiInstagram } from "react-icons/si";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

function isValidHexColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color) || /^#[0-9A-Fa-f]{3}$/.test(color);
}

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
  const [isPostDetailOpen, setIsPostDetailOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<SocialAccountPost | null>(null);

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

  const { data: allSocialAccounts } = useQuery<SocialAccountWithCurrentProfile[]>({
    queryKey: ["/api/social-accounts"],
  });

  const { data: socialAccountTypes } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  // Query followers (accounts that have this account in their following list)
  const { data: followers } = useQuery<SocialAccountWithCurrentProfile[]>({
    queryKey: ["/api/social-accounts", uuid, "followers"],
    enabled: !!uuid,
  });

  // Query posts for this social account
  const { data: posts } = useQuery<SocialAccountPost[]>({
    queryKey: ["/api/social-accounts", uuid, "posts"],
    enabled: !!uuid,
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

  const importInstagramMutation = useMutation({
    mutationFn: async ({ file, accountId, importType }: { file: File; accountId: string; importType: "followers" | "following" }) => {
      const formData = new FormData();
      formData.append("csv", file);
      formData.append("accountId", accountId);
      formData.append("importType", importType);

      const response = await fetch("/api/import-instagram", {
        method: "POST",
        body: formData,
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
        <div className="border-b px-6 py-4 animate-pulse">
          <div className="h-8 w-32 bg-muted rounded mb-6" />
          <div className="flex items-start gap-6">
            <div className="w-24 h-24 rounded-full bg-muted" />
            <div className="flex-1 space-y-3">
              <div className="h-8 bg-muted rounded w-1/3" />
              <div className="h-4 bg-muted rounded w-1/4" />
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
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => window.open(account.currentProfile?.accountUrl, "_blank")}
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
            <TabsList className="w-full justify-start" data-testid="tabs-social-account">
              <TabsTrigger value="follow" data-testid="tab-follow">Follow</TabsTrigger>
              <TabsTrigger value="notes" data-testid="tab-notes">Notes</TabsTrigger>
              <TabsTrigger value="posts" data-testid="tab-posts">Posts</TabsTrigger>
            </TabsList>
          </div>

          {/* Follow Tab */}
          <TabsContent value="follow" className="mt-0">
            <div className="px-6 py-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Followers Column */}
              <Card className="p-4">
                <h3 className="text-lg font-semibold mb-4" data-testid="text-followers-header">
                  Followers ({account.latestState?.followerCount || 0})
                </h3>
                {followers && followers.length > 0 ? (
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
                {account.latestState?.following && account.latestState?.following.length > 0 ? (
                  <div className="space-y-2">
                    {account.latestState?.following.map((followingId) => {
                      const followingAccount = allSocialAccounts?.find(a => a.id === followingId);
                      return (
                        <div 
                          key={followingId} 
                          className="flex items-center justify-between gap-3 p-2 rounded-md hover-elevate"
                          data-testid={`card-following-${followingId}`}
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="w-8 h-8">
                              {followingAccount?.currentProfile?.imageUrl && (
                                <AvatarImage src={followingAccount.currentProfile?.imageUrl} alt={followingAccount.username} />
                              )}
                              <AvatarFallback className="text-xs">
                                {followingAccount ? getInitials(followingAccount.username) : "?"}
                              </AvatarFallback>
                            </Avatar>
                            {followingAccount ? (
                              <Link 
                                href={`/social-accounts/${followingAccount.id}`}
                                className="text-sm font-medium hover:underline"
                                data-testid={`link-following-${followingId}`}
                              >
                                {followingAccount.username}
                              </Link>
                            ) : (
                              <span className="text-sm text-muted-foreground">{followingId}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Not following anyone yet</p>
                )}
              </Card>
            </div>
          </TabsContent>

          {/* Notes Tab */}
          <TabsContent value="notes" className="mt-0">
            <div className="px-6 py-6">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
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
        </Tabs>
      </div>

      <EditSocialAccountDialog
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

      <AddPersonDialog
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

      <AddPostDialog
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

          <EditPostDialog
            open={isEditPostOpen}
            onOpenChange={setIsEditPostOpen}
            post={selectedPost}
            socialAccountId={uuid!}
          />
        </>
      )}
    </div>
  );
}
