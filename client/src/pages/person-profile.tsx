import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Mail, Phone, ArrowLeft, Edit, Plus, GitBranch, StickyNote, CalendarDays, ImageIcon } from "lucide-react";
import { GraphTriangleIcon } from "@/components/icons/graph-triangle-icon";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PersonWithRelations, Note, Interaction } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { AddNoteDialog } from "@/components/add-note-dialog";
import { AddInteractionDialog } from "@/components/add-interaction-dialog";
import { EditPersonDialog } from "@/components/edit-person-dialog";
import { AddRelationshipDialog } from "@/components/add-relationship-dialog";
import { RelationshipsTab } from "@/components/relationships-tab";
import { PersonGroupsTab } from "@/components/person-groups-tab";
import { PersonSocialAccountsChips } from "@/components/person-social-accounts-chips";
import { PersonTagsChips } from "@/components/person-tags-chips";
import { PersonFlowTab } from "@/components/person-flow-tab";
import { PersonPhotosTab } from "@/components/person-photos-tab";
import { AddSocialAccountDialog } from "@/components/add-social-account-dialog";
import { getInitials } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export default function PersonProfile() {
  const { id } = useParams<{ id: string }>();
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const [isAddNoteOpen, setIsAddNoteOpen] = useState(false);
  const [isAddInteractionOpen, setIsAddInteractionOpen] = useState(false);
  const [isEditPersonOpen, setIsEditPersonOpen] = useState(false);
  const [isAddRelationshipOpen, setIsAddRelationshipOpen] = useState(false);
  const [isAddSocialAccountOpen, setIsAddSocialAccountOpen] = useState(false);
  const photoFileInputRef = useRef<HTMLInputElement>(null);

  const { data: facialIntelligenceData } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/prm-face/facial-intelligence"],
  });
  const facialIntelligenceEnabled = facialIntelligenceData?.enabled ?? false;

  const params = new URLSearchParams(window.location.search);
  const from = params.get('from');
  const groupId = params.get('groupId');

  const handleBack = () => {
    if (from === 'graph') {
      navigate('/graph');
    } else if (from === 'graph-3d' || from === 'social-graph-3d') {
      navigate('/social-graph-3d?view=person');
    } else if (from === 'group' && groupId) {
      navigate(`/group/${groupId}`);
    } else {
      navigate('/');
    }
  };

  const { data: person, isLoading, isError, error } = useQuery<PersonWithRelations>({
    queryKey: ["/api/people", id],
    enabled: !!id,
  });

  const addPhotoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch("/api/prm-face/img/add", { method: "POST", body: formData });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Failed to upload photo");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Photo uploaded", description: "Photo added to facial recognition database." });
      if (id) queryClient.invalidateQueries({ queryKey: ["/api/prm-face/person-photos", id] });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const linkSocialAccountMutation = useMutation({
    mutationFn: async ({ personId, newAccountId, existingUuids }: { personId: string; newAccountId: string; existingUuids: string[] }) => {
      return await apiRequest("PATCH", `/api/people/${personId}`, {
        socialAccountUuids: [...existingUuids, newAccountId],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts/by-ids"] });
      toast({
        title: "Success",
        description: "Social account linked to this person",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to link social account",
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
        <h2 className="text-2xl font-semibold mb-2">Failed to load person</h2>
        <p className="text-muted-foreground mb-6">
          {error?.message || "An error occurred while fetching this person"}
        </p>
        <Button onClick={handleBack} data-testid="button-back-to-list-error">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>
    );
  }

  if (!person) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
        <h2 className="text-2xl font-semibold mb-2">Person not found</h2>
        <p className="text-muted-foreground mb-6">
          The person you're looking for doesn't exist.
        </p>
        <Button onClick={handleBack} data-testid="button-back-to-list">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="mb-3"
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex items-start gap-6">
          <Avatar className="w-24 h-24">
            {person.imageUrl && (
              <AvatarImage src={person.imageUrl} alt={`${person.firstName} ${person.lastName}`} />
            )}
            <AvatarFallback className="text-2xl">
              {getInitials(person.firstName, person.lastName)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1">
            <div className="flex items-start justify-between gap-4 mb-1">
              <div>
                <h1 className="text-3xl font-semibold mb-1" data-testid="text-person-name">
                  {person.firstName} {person.lastName}
                </h1>
                {(person.company || person.title) && (
                  <div className="flex items-center gap-1 text-lg text-muted-foreground">
                    {person.title && <span data-testid="text-person-title">{person.title}</span>}
                    {person.title && person.company && <span>•</span>}
                    {person.company && <span data-testid="text-person-company">{person.company}</span>}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" data-testid="button-add-menu">
                      <Plus className="h-4 w-4" />
                      Add
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setIsAddRelationshipOpen(true)} data-testid="menu-item-add-relationship">
                      <GitBranch className="h-4 w-4" />
                      Relationship
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setIsAddNoteOpen(true)} data-testid="menu-item-add-note">
                      <StickyNote className="h-4 w-4" />
                      Note
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setIsAddInteractionOpen(true)} data-testid="menu-item-add-interaction">
                      <CalendarDays className="h-4 w-4" />
                      Interaction
                    </DropdownMenuItem>
                    {facialIntelligenceEnabled && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => photoFileInputRef.current?.click()}
                          disabled={addPhotoMutation.isPending}
                          data-testid="menu-item-add-photo"
                        >
                          <ImageIcon className="h-4 w-4" />
                          Photo
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => navigate(`/social-graph-3d?view=person&selected=${person.id}`)}
                      data-testid="button-view-in-graph"
                      aria-label="Open in graph"
                    >
                      <GraphTriangleIcon className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open in graph</TooltipContent>
                </Tooltip>
                <Button
                  variant="outline"
                  onClick={() => setIsEditPersonOpen(true)}
                  data-testid="button-edit-person"
                >
                  <Edit className="h-4 w-4" />
                  Edit
                </Button>
              </div>
            </div>

            <PersonSocialAccountsChips
              personId={person.id}
              socialAccountUuids={person.socialAccountUuids || []}
              onUpdate={() => {
                queryClient.invalidateQueries({
                  queryKey: ["/api/people", person.id],
                });
              }}
            />
            <div className="mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAddSocialAccountOpen(true)}
                data-testid="button-add-social-account"
              >
                <Plus className="h-4 w-4" />
                Add Social Account
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
              {person.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a
                    href={`mailto:${person.email}`}
                    className="hover:underline"
                    data-testid="link-email"
                  >
                    {person.email}
                  </a>
                </div>
              )}
              {person.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <a
                    href={`tel:${person.phone}`}
                    className="hover:underline"
                    data-testid="link-phone"
                  >
                    {person.phone}
                  </a>
                </div>
              )}
            </div>

            <PersonTagsChips personId={person.id} tags={person.tags || []} />
          </div>
        </div>
      </div>

      <Tabs defaultValue="flow" className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b px-6">
          <TabsList className="h-12 bg-transparent p-0 flex-nowrap touch-scroll">
            <TabsTrigger
              value="flow"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-flow"
            >
              Flow
            </TabsTrigger>
            <TabsTrigger
              value="relationships"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-relationships"
            >
              Relationships
            </TabsTrigger>
            <TabsTrigger
              value="groups"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-groups"
            >
              Groups
            </TabsTrigger>
            {facialIntelligenceEnabled && (
              <TabsTrigger
                value="photos"
                className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
                data-testid="tab-photos"
              >
                Photos
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto">
          <TabsContent value="flow" className="mt-0 h-full">
            <PersonFlowTab
              personId={person.id}
              onAddNote={() => setIsAddNoteOpen(true)}
              onAddInteraction={() => setIsAddInteractionOpen(true)}
              onSelectNote={() => {}}
              onSelectInteraction={() => {}}
            />
          </TabsContent>

          <TabsContent value="relationships" className="mt-0 h-full">
            <RelationshipsTab
              relationships={person.relationships}
              personId={person.id}
              personName={`${person.firstName} ${person.lastName}`.trim()}
              onAddRelationship={() => setIsAddRelationshipOpen(true)}
            />
          </TabsContent>

          <TabsContent value="groups" className="mt-0 h-full">
            <PersonGroupsTab
              personId={person.id}
              personGroups={person.groups}
            />
          </TabsContent>

          {facialIntelligenceEnabled && (
            <TabsContent value="photos" className="mt-0 h-full">
              <PersonPhotosTab personId={person.id} />
            </TabsContent>
          )}
        </div>
      </Tabs>

      <AddNoteDialog
        open={isAddNoteOpen}
        onOpenChange={setIsAddNoteOpen}
        personId={person.id}
      />
      <AddInteractionDialog
        open={isAddInteractionOpen}
        onOpenChange={setIsAddInteractionOpen}
        personId={person.id}
      />
      <AddRelationshipDialog
        open={isAddRelationshipOpen}
        onOpenChange={setIsAddRelationshipOpen}
        personId={person.id}
        existingRelationships={person.relationships}
      />
      <EditPersonDialog
        open={isEditPersonOpen}
        onOpenChange={setIsEditPersonOpen}
        person={person}
        onDelete={() => navigate("/people")}
      />
      <AddSocialAccountDialog
        open={isAddSocialAccountOpen}
        onOpenChange={setIsAddSocialAccountOpen}
        onAccountCreated={(account) => {
          if (account?.id && person?.id) {
            linkSocialAccountMutation.mutate({
              personId: person.id,
              newAccountId: account.id,
              existingUuids: person.socialAccountUuids || [],
            });
          }
        }}
      />
      <input
        ref={photoFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="input-add-photo"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) addPhotoMutation.mutate(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
