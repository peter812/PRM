import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Edit, Network } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Group, Person, Interaction } from "@shared/schema";
import { GroupDialog } from "@/components/group-dialog";
import { MembersTab } from "@/components/members-tab";
import { InteractionsTab } from "@/components/interactions-tab";
import { InteractionDialog } from "@/components/interaction-dialog";
import { CrowdTab } from "@/components/crowd-tab";
import { GroupSocialAccountsTab } from "@/components/group-social-accounts-tab";
import { getInitials } from "@/lib/utils";

type GroupWithMembers = Group & {
  memberDetails: Person[];
  interactions?: Interaction[];
};

export default function GroupProfile() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [isEditGroupOpen, setIsEditGroupOpen] = useState(false);
  const [isAddInteractionOpen, setIsAddInteractionOpen] = useState(false);

  const { data: group, isLoading, isError, error } = useQuery<GroupWithMembers>({
    queryKey: ["/api/groups", id],
    enabled: !!id,
  });

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
        <h2 className="text-2xl font-semibold mb-2">Failed to load group</h2>
        <p className="text-muted-foreground mb-6">
          {error?.message || "An error occurred while fetching this group"}
        </p>
        <Button onClick={() => navigate("/groups")} data-testid="button-back-to-list-error">
          <ArrowLeft className="h-4 w-4" />
          Back to Groups
        </Button>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
        <h2 className="text-2xl font-semibold mb-2">Group not found</h2>
        <p className="text-muted-foreground mb-6">
          The group you're looking for doesn't exist.
        </p>
        <Button onClick={() => navigate("/groups")} data-testid="button-back-to-list">
          <ArrowLeft className="h-4 w-4" />
          Back to Groups
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/groups")}
          className="mb-6"
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex items-start gap-6">
          <Avatar
            className="w-24 h-24"
            style={{ borderColor: group.color, borderWidth: "3px" }}
          >
            {group.imageUrl && <AvatarImage src={group.imageUrl} alt={group.name} />}
            <AvatarFallback
              style={{ backgroundColor: `${group.color}20` }}
              className="text-2xl"
            >
              {getInitials(group.name)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h1 className="text-3xl font-semibold mb-2" data-testid="text-group-name">
                  {group.name}
                </h1>
                <div className="flex items-center gap-3 text-lg text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: group.color }}
                      data-testid="color-indicator"
                    />
                    <span data-testid="text-member-count">
                      {group.members?.length || 0} members
                    </span>
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => navigate(`/social-graph-3d?view=person&highlightGroup=${group.id}`)}
                data-testid="button-view-in-graph"
              >
                <Network className="h-4 w-4" />
                View in Graph
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsEditGroupOpen(true)}
                data-testid="button-edit-group"
              >
                <Edit className="h-4 w-4" />
                Edit
              </Button>
            </div>

            {group.type && group.type.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {group.type.map((type, idx) => (
                  <Badge key={idx} variant="secondary">
                    {type}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="members" className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b px-6">
          <TabsList className="h-12 bg-transparent p-0">
            <TabsTrigger
              value="members"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-members"
            >
              Members
            </TabsTrigger>
            <TabsTrigger
              value="interactions"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-interactions"
            >
              Interactions
            </TabsTrigger>
            <TabsTrigger
              value="social"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-social-accounts"
            >
              Social Accounts
            </TabsTrigger>
            <TabsTrigger
              value="crowd"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-crowd"
            >
              Crowd
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto">
          <TabsContent value="members" className="mt-0 h-full">
            <MembersTab members={group.memberDetails || []} groupId={group.id} />
          </TabsContent>
          <TabsContent value="interactions" className="mt-0 h-full">
            <InteractionsTab
              interactions={group.interactions || []}
              groupId={group.id}
              onAddInteraction={() => setIsAddInteractionOpen(true)}
            />
          </TabsContent>
          <TabsContent value="social" className="mt-0 h-full">
            <GroupSocialAccountsTab groupId={group.id} />
          </TabsContent>
          <TabsContent value="crowd" className="mt-0 h-full">
            <CrowdTab
              groupId={group.id}
              centerAccountId={group.centerAccountId || null}
              crowdLastCalculatedAt={group.crowdLastCalculatedAt ? new Date(group.crowdLastCalculatedAt).toISOString() : null}
            />
          </TabsContent>
        </div>
      </Tabs>

      <GroupDialog
        open={isEditGroupOpen}
        onOpenChange={setIsEditGroupOpen}
        group={group}
      />

      <InteractionDialog
        open={isAddInteractionOpen}
        onOpenChange={setIsAddInteractionOpen}
        personId=""
      />
    </div>
  );
}
