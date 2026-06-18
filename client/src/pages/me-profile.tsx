import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Mail, Phone, ArrowLeft, Edit, Plus, GitBranch, StickyNote, CalendarDays, ImageIcon } from "lucide-react";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PersonWithRelations, Note, Interaction } from "@shared/schema";
import { queryClient } from "@/lib/queryClient";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { AddNoteDialog } from "@/components/add-note-dialog";
import { InteractionDialog } from "@/components/interaction-dialog";
import { PersonDialog } from "@/components/person-dialog";
import { RelationshipDialog } from "@/components/relationship-dialog";
import { RelationshipsTab } from "@/components/relationships-tab";
import { PersonGroupsTab } from "@/components/person-groups-tab";
import { PersonSocialAccountsChips } from "@/components/person-social-accounts-chips";
import { PersonTagsChips } from "@/components/person-tags-chips";
import { PersonFlowTab } from "@/components/person-flow-tab";
import { PersonPhotosTab } from "@/components/person-photos-tab";
import { FamilyTreeTab } from "@/components/family-tree-tab";
import { getInitials } from "@/lib/utils";

export default function MeProfile() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isAddNoteOpen, setIsAddNoteOpen] = useState(false);
  const [isAddInteractionOpen, setIsAddInteractionOpen] = useState(false);
  const [isEditPersonOpen, setIsEditPersonOpen] = useState(false);
  const [isAddRelationshipOpen, setIsAddRelationshipOpen] = useState(false);
  const photoFileInputRef = useRef<HTMLInputElement>(null);

  const { data: person, isLoading, isError, error } = useQuery<PersonWithRelations>({
    queryKey: ["/api/me"],
  });

  const { data: facialIntelligenceData } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/prm-face/facial-intelligence"],
  });
  const facialIntelligenceEnabled = facialIntelligenceData?.enabled ?? false;

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
      if (person) queryClient.invalidateQueries({ queryKey: ["/api/prm-face/person-photos", person.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
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
        <h2 className="text-2xl font-semibold mb-2">Failed to load your profile</h2>
        <p className="text-muted-foreground mb-6">
          {error?.message || "An error occurred while fetching your profile"}
        </p>
        <Button onClick={() => navigate("/")} data-testid="button-back-to-list-error">
          <ArrowLeft className="h-4 w-4" />
          Back to People
        </Button>
      </div>
    );
  }

  if (!person) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
        <h2 className="text-2xl font-semibold mb-2">Profile not found</h2>
        <p className="text-muted-foreground mb-6">
          Your profile entry doesn't exist.
        </p>
        <Button onClick={() => navigate("/")} data-testid="button-back-to-list">
          <ArrowLeft className="h-4 w-4" />
          Back to People
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-4 md:px-6 py-3">
        <div className="flex flex-col md:flex-row md:items-start gap-3 md:gap-6">
          <div className="flex items-center justify-between md:block">
            <Avatar className="w-20 h-20 md:w-24 md:h-24">
              {person.imageUrl && (
                <AvatarImage src={person.imageUrl} alt={`${person.firstName} ${person.lastName}`} />
              )}
              <AvatarFallback className="text-xl md:text-2xl">
                {getInitials(person.firstName, person.lastName)}
              </AvatarFallback>
            </Avatar>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditPersonOpen(true)}
              data-testid="button-edit-person-mobile"
              className="md:hidden"
            >
              <Edit className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1">
            <div className="md:hidden mb-2">
              <h1 className="text-2xl font-semibold" data-testid="text-person-name-mobile">
                {person.firstName} {person.lastName}
              </h1>
              {(person.company || person.title) && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  {person.title && <span>{person.title}</span>}
                  {person.title && person.company && <span>•</span>}
                  {person.company && <span>{person.company}</span>}
                </div>
              )}
            </div>

            <div className="hidden md:flex items-start justify-between gap-4 mb-1">
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
                  queryKey: ["/api/me"],
                });
              }}
            />

            <div className="flex flex-col md:grid md:grid-cols-2 gap-1 md:gap-2 mt-2">
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
            </div>

            <PersonTagsChips
              personId={person.id}
              tags={person.tags || []}
              onUpdate={() => {
                queryClient.invalidateQueries({
                  queryKey: ["/api/me"],
                });
              }}
            />
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
              value="tree"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-tree"
            >
              Tree
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
              onAddRelationship={() => setIsAddRelationshipOpen(true)}
            />
          </TabsContent>

          <TabsContent value="tree" className="mt-0 h-full">
            <FamilyTreeTab
              personId={person.id}
              personName={`${person.firstName} ${person.lastName}`.trim()}
            />
          </TabsContent>

          <TabsContent value="groups" className="mt-0 h-full">
            <PersonGroupsTab
              personGroups={person.groups || []}
              personId={person.id}
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
      <InteractionDialog
        open={isAddInteractionOpen}
        onOpenChange={setIsAddInteractionOpen}
        personId={person.id}
      />
      <RelationshipDialog
        open={isAddRelationshipOpen}
        onOpenChange={setIsAddRelationshipOpen}
        personId={person.id}
      />
      <PersonDialog
        open={isEditPersonOpen}
        onOpenChange={setIsEditPersonOpen}
        person={person}
        onDelete={() => navigate("/people")}
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
