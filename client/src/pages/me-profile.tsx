import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Mail, Phone, ArrowLeft, Edit, Plus, GitBranch, StickyNote, CalendarDays, ImageIcon, GraduationCap, Briefcase, ChevronDown } from "lucide-react";
import { useState, useRef, lazy, Suspense } from "react";
import { MessagesTab } from "@/components/messages-tab";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PersonWithRelations, Note, Interaction } from "@shared/schema";
import { formatPhoneNumberForDisplay, getTruePeopleSearchUrl } from "@shared/schema";
import { queryClient } from "@/lib/queryClient";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { AddNoteDialog } from "@/components/add-note-dialog";
import { InteractionDialog } from "@/components/interaction-dialog";
import { PersonDialog } from "@/components/person-dialog";
import { RelationshipDialog } from "@/components/relationship-dialog";
import { RelationshipsTab } from "@/components/relationships-tab";
import { PersonGroupsTab } from "@/components/person-groups-tab";
import { AdditionalInfoDialog } from "@/components/additional-info-dialog";
import { PersonSocialAccountsChips } from "@/components/person-social-accounts-chips";
import { PersonTagsChips } from "@/components/person-tags-chips";
import { PersonFlowTab } from "@/components/person-flow-tab";
import { PersonPhotosTab } from "@/components/person-photos-tab";
import { getInitials } from "@/lib/utils";

const FamilyTreeTab = lazy(() =>
  import("@/components/family-tree-tab").then((module) => ({
    default: module.FamilyTreeTab,
  }))
);

function PersonPhotosOverview({ personId, limit = 4 }: { personId: string; limit?: number }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/image/query-person-overview", personId, limit],
    queryFn: async () => {
      const res = await fetch(
        `/api/image/query-person?personUuid=${encodeURIComponent(personId)}&page=1&page_size=${limit}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch photos overview");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-2">
        {[...Array(limit)].map((_, i) => (
          <div key={i} className="aspect-square bg-muted animate-pulse rounded-md" />
        ))}
      </div>
    );
  }

  const images = data?.images ?? [];

  if (images.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No photos recorded.</p>;
  }

  return (
    <div className="grid grid-cols-4 gap-2">
      {images.map((img: any) => (
        <a
          key={img.image_uuid}
          href={img.image_url}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-md border aspect-square hover:opacity-90 transition-opacity bg-muted"
        >
          <img
            src={img.thumb_url || img.image_url}
            alt="Person thumbnail"
            className="w-full h-full object-cover"
          />
        </a>
      ))}
    </div>
  );
}

export default function MeProfile() {
  const [activeTab, setActiveTab] = useState("home");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isAddNoteOpen, setIsAddNoteOpen] = useState(false);
  const [isAddInteractionOpen, setIsAddInteractionOpen] = useState(false);
  const [isEditPersonOpen, setIsEditPersonOpen] = useState(false);
  const [isAddRelationshipOpen, setIsAddRelationshipOpen] = useState(false);
  const [isEditAdditionalOpen, setIsEditAdditionalOpen] = useState(false);
  const photoFileInputRef = useRef<HTMLInputElement>(null);

  const { data: person, isLoading, isError, error } = useQuery<PersonWithRelations>({
    queryKey: ["/api/me"],
  });

  const { data: facialIntelligenceData } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/prm-face/facial-intelligence"],
  });
  const facialIntelligenceEnabled = facialIntelligenceData?.enabled ?? false;

  const { data: settings } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings"],
  });
  const imagesTabEnabled = settings?.images_tab_enabled !== "false";
  const showPhotosTab = facialIntelligenceEnabled && imagesTabEnabled;

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
      if (person) queryClient.invalidateQueries({ queryKey: ["/api/image/query-person", person.id] });
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
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact Top-Bar Header */}
      <div className="border-b px-4 py-2 flex items-center justify-between shrink-0 bg-card/40 backdrop-blur-md z-10">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            className="h-8 w-8 rounded-full shrink-0"
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          {activeTab !== "home" && (
            <Avatar className="w-9 h-9 shrink-0">
              {person.imageUrl && (
                <AvatarImage src={person.imageUrl} alt={`${person.firstName} ${person.lastName}`} />
              )}
              <AvatarFallback className="text-xs">
                {getInitials(person.firstName, person.lastName)}
              </AvatarFallback>
            </Avatar>
          )}

          <div className="min-w-0">
            <h1 className="text-sm font-bold truncate leading-none" data-testid="text-person-name">
              {person.firstName} {person.lastName}
            </h1>
            {(person.title || person.company) && (
              <p className="text-xs text-muted-foreground truncate leading-none mt-1">
                {person.title} {person.title && person.company && "•"} {person.company}
              </p>
            )}
          </div>
        </div>

        {/* Consolidated Actions Dropdown Menu */}
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1" data-testid="button-actions-menu">
                Actions
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => setIsEditPersonOpen(true)} data-testid="button-edit-person">
                <Edit className="h-4 w-4 mr-2" />
                Edit Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setIsAddRelationshipOpen(true)} data-testid="menu-item-add-relationship">
                <GitBranch className="h-4 w-4 mr-2" />
                Add Relationship
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsAddNoteOpen(true)} data-testid="menu-item-add-note">
                <StickyNote className="h-4 w-4 mr-2" />
                Add Note
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsAddInteractionOpen(true)} data-testid="menu-item-add-interaction">
                <CalendarDays className="h-4 w-4 mr-2" />
                Add Interaction
              </DropdownMenuItem>
              {showPhotosTab && (
                <DropdownMenuItem onClick={() => photoFileInputRef.current?.click()} data-testid="menu-item-add-photo">
                  <ImageIcon className="h-4 w-4 mr-2" />
                  Add Photo
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main Content Area with Left Sidebar Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Side Navigation Menu */}
        <div className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r bg-card/25 flex flex-col justify-between overflow-y-auto">
          <div className="p-3">
            <TabsList className="flex flex-col items-stretch justify-start h-auto bg-transparent p-0 gap-1">
              <TabsTrigger
                value="home"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-home"
              >
                Home
              </TabsTrigger>
              <TabsTrigger
                value="flow"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-flow"
              >
                Flow
              </TabsTrigger>
              <TabsTrigger
                value="relationships"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-relationships"
              >
                Relationships
              </TabsTrigger>
              <TabsTrigger
                value="tree"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-tree"
              >
                Tree
              </TabsTrigger>
              <TabsTrigger
                value="groups"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-groups"
              >
                Groups
              </TabsTrigger>
              <TabsTrigger
                value="messages"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-messages"
              >
                Messages
              </TabsTrigger>
              <TabsTrigger
                value="education-career"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-education-career"
              >
                Education & Career
              </TabsTrigger>
              {showPhotosTab && (
                <TabsTrigger
                  value="photos"
                  className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                  data-testid="tab-photos"
                >
                  Photos
                </TabsTrigger>
              )}
            </TabsList>
          </div>
        </div>

        {/* Selected Tab Content Pane */}
        <div className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden">
          {/* Home Tab Dashboard */}
          <TabsContent value="home" className="mt-0 flex-1 overflow-y-auto p-6 space-y-6">
            <div className="flex flex-col lg:flex-row gap-6 items-start">
              {/* Left/Main Column: Overview Summary Panels */}
              <div className="flex-1 space-y-6 w-full min-w-0">
                {/* Profile Brief */}
                <div className="space-y-1">
                  <h2 className="text-2xl font-bold">{person.firstName} {person.lastName}</h2>
                  {person.maidenName && (
                    <p className="text-sm text-muted-foreground">Maiden Name: {person.maidenName}</p>
                  )}
                  {(person.title || person.company) && (
                    <p className="text-sm text-muted-foreground">
                      {person.title} {person.title && person.company && "at"} {person.company}
                    </p>
                  )}
                </div>

                {/* Quick Actions Action Areas */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Button variant="outline" className="h-20 flex flex-col gap-1.5 items-center justify-center text-xs" onClick={() => setIsEditPersonOpen(true)}>
                    <Edit className="h-4 w-4 text-primary" />
                    Edit Profile
                  </Button>
                  <Button variant="outline" className="h-20 flex flex-col gap-1.5 items-center justify-center text-xs" onClick={() => setIsAddRelationshipOpen(true)}>
                    <GitBranch className="h-4 w-4 text-primary" />
                    Add Relation
                  </Button>
                  <Button variant="outline" className="h-20 flex flex-col gap-1.5 items-center justify-center text-xs" onClick={() => setIsAddNoteOpen(true)}>
                    <StickyNote className="h-4 w-4 text-primary" />
                    Add Note
                  </Button>
                  <Button variant="outline" className="h-20 flex flex-col gap-1.5 items-center justify-center text-xs" onClick={() => setIsAddInteractionOpen(true)}>
                    <CalendarDays className="h-4 w-4 text-primary" />
                    Add Interaction
                  </Button>
                </div>

                {/* Summaries: Relationships & Groups */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Relationships Overview */}
                  <Card className="p-4 space-y-3 shadow-none">
                    <h3 className="font-semibold text-sm flex items-center justify-between">
                      <span>Relationships</span>
                      <Button variant="ghost" size="sm" onClick={() => setActiveTab("relationships")} className="text-[11px] h-6 px-2 text-primary hover:text-primary">View all</Button>
                    </h3>
                    {person.relationships && person.relationships.length > 0 ? (
                      <div className="space-y-2 text-xs">
                        {person.relationships.slice(0, 3).map((r: any, idx: number) => (
                          <div key={idx} className="flex justify-between border-b pb-1 last:border-0 last:pb-0">
                            <span className="font-medium text-foreground">
                              {r.relatedPerson?.firstName} {r.relatedPerson?.lastName}
                            </span>
                            <span className="text-muted-foreground">{r.type?.name || "Relation"}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No relationships recorded.</p>
                    )}
                  </Card>

                  {/* Groups Overview */}
                  <Card className="p-4 space-y-3 shadow-none">
                    <h3 className="font-semibold text-sm flex items-center justify-between">
                      <span>Groups</span>
                      <Button variant="ghost" size="sm" onClick={() => setActiveTab("groups")} className="text-[11px] h-6 px-2 text-primary hover:text-primary">View all</Button>
                    </h3>
                    {person.groups && person.groups.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {person.groups.slice(0, 4).map((g: any, idx: number) => (
                          <Badge key={idx} variant="secondary" className="text-[10px]">
                            {g.name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">Not in any groups.</p>
                    )}
                  </Card>
                </div>

                {/* Summaries: Education & Career */}
                <Card className="p-4 space-y-3 shadow-none">
                  <h3 className="font-semibold text-sm flex items-center justify-between">
                    <span>Education & Career</span>
                    <Button variant="ghost" size="sm" onClick={() => setActiveTab("education-career")} className="text-[11px] h-6 px-2 text-primary hover:text-primary">View all</Button>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-muted-foreground block mb-1 text-[10px] uppercase font-bold tracking-wider">Education</span>
                      {person.schooling?.highSchool || (person.schooling?.colleges && person.schooling.colleges.length > 0) ? (
                        <div className="space-y-1">
                          {person.schooling.highSchool && <p className="font-medium">{person.schooling.highSchool} (HS)</p>}
                          {person.schooling.colleges?.[0] && <p className="font-medium">{person.schooling.colleges[0].name}</p>}
                        </div>
                      ) : (
                        <p className="italic text-muted-foreground">No education history.</p>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground block mb-1 text-[10px] uppercase font-bold tracking-wider">Career & Employment</span>
                      {person.jobs && person.jobs.length > 0 ? (
                        <div>
                          <p className="font-medium">{person.jobs[0].company}</p>
                          <p className="text-muted-foreground text-[11px]">{person.jobs[0].position}</p>
                        </div>
                      ) : (
                        <p className="italic text-muted-foreground">No employment history.</p>
                      )}
                    </div>
                  </div>
                </Card>

                {/* Summaries: Photos */}
                {showPhotosTab && (
                  <Card className="p-4 space-y-3 shadow-none">
                    <h3 className="font-semibold text-sm flex items-center justify-between">
                      <span>Photos</span>
                      <Button variant="ghost" size="sm" onClick={() => setActiveTab("photos")} className="text-[11px] h-6 px-2 text-primary hover:text-primary">View all</Button>
                    </h3>
                    <PersonPhotosOverview personId={person.id} limit={4} />
                  </Card>
                )}
              </div>

              {/* Right Column: Large Profile Picture & Contact details */}
              <div className="w-full lg:w-80 shrink-0 space-y-4">
                {/* Large Profile Image */}
                <div className="relative aspect-square w-full rounded-2xl border bg-muted overflow-hidden group shadow-sm">
                  {person.imageUrl ? (
                    <img src={person.imageUrl} alt={`${person.firstName} ${person.lastName}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl font-bold bg-primary/10 text-primary">
                      {getInitials(person.firstName, person.lastName)}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Button variant="secondary" size="sm" onClick={() => setIsEditPersonOpen(true)}>
                      Change Image
                    </Button>
                  </div>
                </div>

                {/* Contact Details Card */}
                <Card className="p-4 space-y-3 text-xs shadow-none">
                  <h3 className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider block">Contact Details</h3>
                  <div className="space-y-2">
                    {person.email && (
                      <div className="flex items-center gap-2 truncate">
                        <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                        <a href={`mailto:${person.email}`} className="hover:underline truncate" data-testid="link-email">{person.email}</a>
                      </div>
                    )}
                    {person.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-[11px]">{formatPhoneNumberForDisplay(person.phone)}</span>
                      </div>
                    )}
                    {!person.email && !person.phone && <span className="text-muted-foreground italic">No email or phone set</span>}
                  </div>

                  <div className="border-t pt-3 space-y-2">
                    <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider block">Social Accounts</span>
                    <PersonSocialAccountsChips
                      personId={person.id}
                      socialAccountUuids={person.socialAccountUuids || []}
                      onUpdate={() => {
                        queryClient.invalidateQueries({
                          queryKey: ["/api/me"],
                        });
                      }}
                    />
                  </div>

                  <div className="border-t pt-3">
                    <span className="font-semibold text-[9px] text-muted-foreground uppercase tracking-wider block mb-1.5">Tags</span>
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
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="flow" className="mt-0 flex-1 min-h-0">
            <PersonFlowTab
              personId={person.id}
              onAddNote={() => setIsAddNoteOpen(true)}
              onAddInteraction={() => setIsAddInteractionOpen(true)}
              onSelectNote={() => {}}
              onSelectInteraction={() => {}}
            />
          </TabsContent>

          <TabsContent value="relationships" className="mt-0 flex-1 min-h-0 overflow-y-auto">
            <RelationshipsTab
              relationships={person.relationships}
              personId={person.id}
              onAddRelationship={() => setIsAddRelationshipOpen(true)}
            />
          </TabsContent>

          <TabsContent value="tree" className="mt-0 flex-1 min-h-0">
            <Suspense fallback={<Skeleton className="w-full h-[400px]" />}>
              <FamilyTreeTab
                personId={person.id}
                personName={`${person.firstName} ${person.lastName}`.trim()}
              />
            </Suspense>
          </TabsContent>

          <TabsContent value="groups" className="mt-0 flex-1 min-h-0 overflow-y-auto">
            <PersonGroupsTab
              personGroups={person.groups || []}
              personId={person.id}
            />
          </TabsContent>

          <TabsContent value="education-career" className="mt-0 flex-1 min-h-0 p-6 overflow-y-auto">
            <div className="max-w-3xl space-y-6">
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => setIsEditAdditionalOpen(true)}
                  data-testid="button-edit-additional-info"
                  className="flex items-center gap-1"
                >
                  <Edit className="h-4 w-4" />
                  Edit Education & Career
                </Button>
              </div>

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

          <TabsContent value="messages" className="mt-0 flex-1 min-h-0">
            <MessagesTab personId={person.id} />
          </TabsContent>

          {showPhotosTab && (
            <TabsContent value="photos" className="mt-0 flex-1 min-h-0">
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
      <AdditionalInfoDialog
        open={isEditAdditionalOpen}
        onOpenChange={setIsEditAdditionalOpen}
        person={person}
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
