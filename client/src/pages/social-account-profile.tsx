import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import type { SocialAccount, Person } from "@shared/schema";
import { Link } from "wouter";

export default function SocialAccountProfile() {
  const { uuid } = useParams<{ uuid: string }>();
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [isEditingNotes, setIsEditingNotes] = useState(false);

  const { data: account, isLoading, isError, error } = useQuery<SocialAccount>({
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

  const updateNotesMutation = useMutation({
    mutationFn: async (newNotes: string) => {
      return await apiRequest("PATCH", `/api/social-accounts/${uuid}`, {
        notes: newNotes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", uuid] });
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
    account.followers?.includes(meId)
  );

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
            {account.imageUrl && (
              <AvatarImage src={account.imageUrl} alt={account.username} />
            )}
            <AvatarFallback className="text-2xl">
              {getInitials(account.username)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1">
            <div className="flex items-start gap-3 mb-4">
              <h1 className="text-3xl font-semibold" data-testid="text-account-username">
                {account.username}
              </h1>
              {isFollowingYou && (
                <Badge variant="secondary" data-testid="badge-follows-you">
                  Follows you
                </Badge>
              )}
            </div>

            <a
              href={account.accountUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:underline mb-4 block"
              data-testid="link-account-url"
            >
              {account.accountUrl}
            </a>

            {owner && (
              <div className="text-sm">
                <span className="text-muted-foreground">Linked to: </span>
                <Link href={`/person/${owner.id}`}>
                  <a className="text-primary hover:underline font-medium" data-testid="link-owner">
                    {owner.firstName} {owner.lastName}
                  </a>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mid Section - Editable Notes */}
      <div className="border-b px-6 py-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h2 className="text-lg font-semibold" data-testid="text-notes-header">
            Notes
          </h2>
          {!isEditingNotes && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setNotes(account.notes || "");
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
            {account.notes ? (
              <p data-testid="text-notes-content" className="whitespace-pre-wrap">
                {account.notes}
              </p>
            ) : (
              <p className="italic">No notes added yet</p>
            )}
          </div>
        )}
      </div>

      {/* Lower Section - Two Columns */}
      <div className="flex-1 overflow-auto">
        <div className="px-6 py-6 grid grid-cols-2 gap-6">
          {/* Followers Column */}
          <div>
            <h3 className="text-lg font-semibold mb-4" data-testid="text-followers-header">
              Followers ({account.followers?.length || 0})
            </h3>
            {account.followers && account.followers.length > 0 ? (
              <div className="space-y-2">
                {account.followers.map((followerId) => (
                  <Card key={followerId} className="p-3" data-testid={`card-follower-${followerId}`}>
                    <p className="text-sm text-muted-foreground" data-testid={`text-follower-id-${followerId}`}>
                      {followerId}
                    </p>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No followers yet</p>
            )}
          </div>

          {/* Following Column */}
          <div>
            <h3 className="text-lg font-semibold mb-4" data-testid="text-following-header">
              Following ({account.following?.length || 0})
            </h3>
            {account.following && account.following.length > 0 ? (
              <div className="space-y-2">
                {account.following.map((followingId) => (
                  <Card key={followingId} className="p-3" data-testid={`card-following-${followingId}`}>
                    <p className="text-sm text-muted-foreground" data-testid={`text-following-id-${followingId}`}>
                      {followingId}
                    </p>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">Not following anyone yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
