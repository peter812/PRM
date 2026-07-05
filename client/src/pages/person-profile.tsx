import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Mail, Phone, ArrowLeft, Edit, Plus, GitBranch, StickyNote, CalendarDays, ImageIcon, Info, GraduationCap, Briefcase } from "lucide-react";
import { GraphTriangleIcon } from "@/components/icons/graph-triangle-icon";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { PersonWithRelations, Note, Interaction } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { AddNoteDialog } from "@/components/add-note-dialog";
import { InteractionDialog } from "@/components/interaction-dialog";
import { PersonDialog } from "@/components/person-dialog";
import { AdditionalInfoDialog } from "@/components/additional-info-dialog";
import { RelationshipDialog } from "@/components/relationship-dialog";
import { RelationshipsTab } from "@/components/relationships-tab";
import { PersonGroupsTab } from "@/components/person-groups-tab";
import { PersonSocialAccountsChips } from "@/components/person-social-accounts-chips";
import { PersonTagsChips } from "@/components/person-tags-chips";
import { PersonFlowTab } from "@/components/person-flow-tab";
import { PersonPhotosTab } from "@/components/person-photos-tab";
import { FamilyTreeTab } from "@/components/family-tree-tab";
import { SocialAccountDialog } from "@/components/social-account-dialog";
import { useToast } from "@/hooks/use-toast";
import { getInitials } from "@/lib/utils";
import { MessagesTab } from "@/components/messages-tab";

export default function PersonProfile() {
  const { id } = useParams<{ id: string }>();
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const [isAddNoteOpen, setIsAddNoteOpen] = useState(false);
  const [isAddInteractionOpen, setIsAddInteractionOpen] = useState(false);
  const [isEditPersonOpen, setIsEditPersonOpen] = useState(false);
  const [isEditAdditionalOpen, setIsEditAdditionalOpen] = useState(false);
  const [isAddRelationshipOpen, setIsAddRelationshipOpen] = useState(false);
  const [isAddSocialAccountOpen, setIsAddSocialAccountOpen] = useState(false);
  const [isAccountInfoOpen, setIsAccountInfoOpen] = useState(false);
  const photoFileInputRef = useRef<HTMLInputElement>(null);

  const { data: facialIntelligenceData } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/prm-face/facial-intelligence"],
  });
  const facialIntelligenceEnabled = facialIntelligenceData?.enabled ?? false;

  const { data: settings } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings"],
  });
  const imagesTabEnabled = settings?.images_tab_enabled !== "false";
  const showPhotosTab = facialIntelligenceEnabled && imagesTabEnabled;

  const params = new URLSearchParams(window.location.search);
  const from = params.get('from');
  const groupId = params.get('groupId');

  const handleBack = () => {
    if (from === 'graph') {
      navigate('/graph');
    } else if (from === 'graph-3d' || from === 'social-graph-3d') {
      navigate('/social-graph-3d?view=person');
    } else if (from === 'family-tree') {
      navigate('/family-tree');
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
                  {person.maidenName && (
                    <span className="text-muted-foreground font-normal text-xl ml-2">
                      (née {person.maidenName})
                    </span>
                  )}
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
                    {showPhotosTab && (
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setIsAccountInfoOpen(true)}
                      data-testid="button-account-info"
                      aria-label="Account info"
                    >
                      <Info className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Account info</TooltipContent>
                </Tooltip>
                <Button
                  variant="outline"
                  onClick={() => setIsEditAdditionalOpen(true)}
                  data-testid="button-edit-additional-info"
                  className="flex items-center gap-1"
                >
                  <GraduationCap className="h-4 w-4" />
                  Edit Education & Career
                </Button>
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
            <TabsTrigger
              value="messages"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-messages"
            >
              Messages
            </TabsTrigger>
            <TabsTrigger
              value="education-career"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-education-career"
            >
              Education & Career
            </TabsTrigger>
            {showPhotosTab && (
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



          <TabsContent value="tree" className="mt-0 h-full">
            <FamilyTreeTab
              personId={person.id}
              personName={`${person.firstName} ${person.lastName}`.trim()}
            />
          </TabsContent>

          <TabsContent value="groups" className="mt-0 h-full">
            <PersonGroupsTab
              personId={person.id}
              personGroups={person.groups}
            />
          </TabsContent>

          <TabsContent value="messages" className="mt-0 h-full p-6 overflow-auto">
            <MessagesTab personId={person.id} />
          </TabsContent>

          <TabsContent value="education-career" className="mt-0 h-full p-6 overflow-auto">
            <div className="max-w-3xl space-y-6">
              
              {/* Education Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2 border-b pb-2 text-foreground/80">
                  <GraduationCap className="h-5 w-5 text-primary" />
                  Education
                </h3>
                
                {/* High School */}
                {person.schooling?.highSchool && (
                  <div className="flex flex-col gap-1 pl-7">
                    <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">High School</span>
                    <span className="text-sm font-medium" data-testid="highschool-value">{person.schooling.highSchool}</span>
                  </div>
                )}

                {/* Colleges */}
                {person.schooling?.colleges && person.schooling.colleges.length > 0 ? (
                  <div className="space-y-3 pl-7">
                    <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider text-[10px] block">Colleges & Degrees</span>
                    <div className="grid gap-3">
                      {person.schooling.colleges.map((col: any, idx: number) => (
                        <div key={idx} className="border-l-2 border-primary/20 pl-3 py-0.5" data-testid="college-item">
                          <div className="font-semibold text-sm">{col.name}</div>
                          <div className="text-sm text-muted-foreground">{col.degree}</div>
                          {(col.startDate || col.endDate) && (
                            <div className="text-xs text-muted-foreground/80 mt-0.5">
                              {col.startDate || "—"} - {col.endDate || "—"}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Additional Schooling */}
                {person.schooling?.additionalSchooling && person.schooling.additionalSchooling.length > 0 ? (
                  <div className="space-y-3 pl-7">
                    <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider text-[10px] block">Additional Schooling</span>
                    <div className="grid gap-3">
                      {person.schooling.additionalSchooling.map((sch: any, idx: number) => (
                        <div key={idx} className="border-l-2 border-primary/20 pl-3 py-0.5" data-testid="additional-schooling-item">
                          <div className="font-semibold text-sm">{sch.name}</div>
                          {sch.course && <div className="text-sm text-muted-foreground">{sch.course}</div>}
                          {(sch.startDate || sch.endDate) && (
                            <div className="text-xs text-muted-foreground/80 mt-0.5">
                              {sch.startDate || "—"} - {sch.endDate || "—"}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Empty State Education */}
                {!person.schooling?.highSchool && 
                 (!person.schooling?.colleges || person.schooling.colleges.length === 0) && 
                 (!person.schooling?.additionalSchooling || person.schooling.additionalSchooling.length === 0) && (
                  <div className="text-sm text-muted-foreground italic pl-7">No educational details recorded.</div>
                )}
              </div>

              {/* Career / Jobs Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2 border-b pb-2 text-foreground/80">
                  <Briefcase className="h-5 w-5 text-primary" />
                  Career & Employment
                </h3>

                {person.jobs && person.jobs.length > 0 ? (
                  <div className="space-y-4 pl-7">
                    {person.jobs.map((job: any, idx: number) => (
                      <div key={idx} className="border-l-2 border-primary/20 pl-3 py-0.5" data-testid="job-item">
                        <div className="font-semibold text-sm">{job.company}</div>
                        <div className="text-sm text-muted-foreground">{job.position}</div>
                        {(job.startDate || job.endDate) && (
                          <div className="text-xs text-muted-foreground/80 mt-0.5">
                            {job.startDate || "—"} - {job.endDate || "—"}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground italic pl-7">No employment history recorded.</div>
                )}
              </div>

            </div>
          </TabsContent>

          {showPhotosTab && (
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
        existingRelationships={person.relationships}
      />
      <PersonDialog
        open={isEditPersonOpen}
        onOpenChange={setIsEditPersonOpen}
        person={person}
        onDelete={() => navigate("/people")}
      />
      <AdditionalInfoDialog
        open={isEditAdditionalOpen}
        onOpenChange={setIsEditAdditionalOpen}
        person={person}
      />
      <SocialAccountDialog
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

      {/* Account Info Dialog */}
      <Dialog open={isAccountInfoOpen} onOpenChange={setIsAccountInfoOpen}>
        <DialogContent className="max-w-sm" data-testid="dialog-account-info">
          <DialogHeader>
            <DialogTitle>Account Info</DialogTitle>
            <DialogDescription>
              Technical metadata for {person?.firstName} {person?.lastName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Created</span>
                <span className="text-right font-medium" data-testid="info-created-at">
                  {person?.createdAt ? new Date(person.createdAt).toLocaleString() : "—"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">ID</span>
                <span className="text-right font-medium font-mono text-xs" data-testid="info-person-id">
                  {person?.id || "—"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">ELO Score</span>
                <span className="text-right font-medium" data-testid="info-elo-score">
                  {person?.eloScore ?? "—"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">ELO Ranking</span>
                <Badge
                  variant={person?.eloRankable === 1 ? "default" : "destructive"}
                  className={person?.eloRankable === 1 ? "bg-green-600 hover:bg-green-700" : ""}
                  data-testid="info-elo-rankable"
                >
                  {person?.eloRankable === 1 ? "Rankable" : "Not Rankable"}
                </Badge>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Sex</span>
                <Badge
                  variant="secondary"
                  data-testid="info-sex"
                >
                  {person?.sex ? person.sex.charAt(0).toUpperCase() + person.sex.slice(1) : "Unknown"}
                </Badge>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
