import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Edit } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Group, Person, Interaction } from "@shared/schema";
import { EditGroupDialog } from "@/components/edit-group-dialog";
import { MembersTab } from "@/components/members-tab";
import { InteractionsTab } from "@/components/interactions-tab";
import { AddInteractionDialog } from "@/components/add-interaction-dialog";

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

  const getInitials = (name: string) => {
    const words = name.split(" ");
    if (words.length >= 2) {
      return `${words[0][0]}${words[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

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
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto">
          <TabsContent value="members" className="mt-0 h-full">
            <MembersTab members={group.memberDetails || []} groupId={group.id} />
          </TabsContent>
          <TabsContent value="interactions" className="mt-0 h-full">
            <InteractionsTab
              interactions={group.interactions || []}
              personId=""
              onAddInteraction={() => setIsAddInteractionOpen(true)}
            />
          </TabsContent>
        </div>
      </Tabs>

      <EditGroupDialog
        open={isEditGroupOpen}
        onOpenChange={setIsEditGroupOpen}
        group={group}
      />

      <AddInteractionDialog
        open={isAddInteractionOpen}
        onOpenChange={setIsAddInteractionOpen}
        personId=""
      />
    </div>
  );
}
