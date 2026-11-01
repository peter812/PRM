import { formatPersonName, personInitials } from "@shared/person-name";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Mail, Phone, Home, ArrowLeft, Edit, Plus, GitBranch, StickyNote, CalendarDays, ImageIcon, ScanFace, GraduationCap, Briefcase, ChevronDown } from "lucide-react";
import { useState, useRef, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PersonWithRelations, Note, Interaction } from "@shared/schema";
import { formatPhoneNumberForDisplay, getTruePeopleSearchUrl } from "@shared/phone-utils";
import { queryClient } from "@/lib/queryClient";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { PersonSocialAccountsChips } from "@/components/person-social-accounts-chips";
import { PersonTagsChips } from "@/components/person-tags-chips";
import { PersonPhotosOverview, PersonPhotosTab } from "@/components/person-photos-tab";
import { OUTDATED_TEXT, OutdatedBadge, PersonAddresses } from "@/components/person-addresses";
import { mapHref } from "@/lib/map-shared";
import type { ReferenceProbe } from "@/components/reference-matches-dialog";
import { AiBackendNotes } from "@/components/ai-backend-notes";
import { ProfileSkeleton } from "@/components/profile-skeleton";
import { withImageSize } from "@shared/image-size";

// Only the Home tab renders on first paint; dialogs and the other tabs load on demand.
const FamilyTreeTab = lazy(() =>
  import("@/components/family-tree-tab").then((module) => ({
    default: module.FamilyTreeTab,
  }))
);
const MessagesTab = lazy(() => import("@/components/messages-tab").then((m) => ({ default: m.MessagesTab })));
const RelationshipsTab = lazy(() => import("@/components/relationships-tab").then((m) => ({ default: m.RelationshipsTab })));
const PersonGroupsTab = lazy(() => import("@/components/person-groups-tab").then((m) => ({ default: m.PersonGroupsTab })));
const PersonFlowTab = lazy(() => import("@/components/person-flow-tab").then((m) => ({ default: m.PersonFlowTab })));
const AddNoteDialog = lazy(() => import("@/components/add-note-dialog").then((m) => ({ default: m.AddNoteDialog })));
const InteractionDialog = lazy(() => import("@/components/interaction-dialog").then((m) => ({ default: m.InteractionDialog })));
const PersonDialog = lazy(() => import("@/components/person-dialog").then((m) => ({ default: m.PersonDialog })));
const RelationshipDialog = lazy(() => import("@/components/relationship-dialog").then((m) => ({ default: m.RelationshipDialog })));
const AdditionalInfoDialog = lazy(() => import("@/components/additional-info-dialog").then((m) => ({ default: m.AdditionalInfoDialog })));
const ChoosePersonImageDialog = lazy(() => import("@/components/choose-person-image-dialog").then((m) => ({ default: m.ChoosePersonImageDialog })));
const ReferenceMatchesDialog = lazy(() => import("@/components/reference-matches-dialog").then((m) => ({ default: m.ReferenceMatchesDialog })));

export default function MeProfile() {
  // ?tab= opens a tab directly, e.g. a message-chunk link to the Messages tab.
  const [activeTab, setActiveTab] = useState(() => new URLSearchParams(window.location.search).get("tab") || "home");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isAddNoteOpen, setIsAddNoteOpen] = useState(false);
  const [referenceProbe, setReferenceProbe] = useState<ReferenceProbe | null>(null);
  const [isAddInteractionOpen, setIsAddInteractionOpen] = useState(false);
  const [isEditPersonOpen, setIsEditPersonOpen] = useState(false);
  const [isAddRelationshipOpen, setIsAddRelationshipOpen] = useState(false);
  const [isEditAdditionalOpen, setIsEditAdditionalOpen] = useState(false);
  const [isChooseImageOpen, setIsChooseImageOpen] = useState(false);
  const photoFileInputRef = useRef<HTMLInputElement>(null);

  const { data: person, isLoading, isError, error } = useQuery<PersonWithRelations>({
    queryKey: ["/api/me"],
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
      if (person) queryClient.invalidateQueries({ queryKey: ["/api/image/query-person", person.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) return <ProfileSkeleton />;

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
                <AvatarImage src={person.imageUrl} alt={formatPersonName(person)} />
              )}
              <AvatarFallback className="text-xs">
                {personInitials(person)}
              </AvatarFallback>
            </Avatar>
          )}

          <div className="min-w-0">
            <h1 className="text-sm font-bold truncate leading-none" data-testid="text-person-name">
              {formatPersonName(person)}
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
              <DropdownMenuItem onClick={() => photoFileInputRef.current?.click()} data-testid="menu-item-add-photo">
                <ImageIcon className="h-4 w-4 mr-2" />
                Add Photo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setReferenceProbe({ personId: person.id })} data-testid="menu-item-find-references">
                <ScanFace className="h-4 w-4 mr-2" />
                Find in References
              </DropdownMenuItem>
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
              <TabsTrigger
                value="location"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-location"
              >
                Location
              </TabsTrigger>
              <TabsTrigger
                value="photos"
                className="justify-start px-3 py-2 text-left rounded-md w-full data-[state=active]:bg-muted data-[state=active]:text-foreground border-0"
                data-testid="tab-photos"
              >
                Photos
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        {/* Selected Tab Content Pane */}
        <div className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden">
          <Suspense fallback={<Skeleton className="w-full h-[400px]" />}>
          {/* Home Tab Dashboard */}
          <TabsContent value="home" className="mt-0 flex-1 overflow-y-auto p-6 space-y-6">
            <div className="flex flex-col lg:flex-row gap-6 items-start">
              {/* Left/Main Column: Overview Summary Panels */}
              <div className="flex-1 space-y-6 w-full min-w-0">
                {/* Profile Brief */}
                <div className="space-y-1">
                  <h2 className="text-2xl font-bold">{formatPersonName(person)}</h2>
                  {person.nickname && (
                    <p className="text-sm text-muted-foreground">Nickname: {person.nickname}</p>
                  )}
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
                              {formatPersonName(r.relatedPerson)}
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
                <Card className="p-4 space-y-3 shadow-none">
                  <h3 className="font-semibold text-sm flex items-center justify-between">
                    <span>Photos</span>
                    <Button variant="ghost" size="sm" onClick={() => setActiveTab("photos")} className="text-[11px] h-6 px-2 text-primary hover:text-primary">View all</Button>
                  </h3>
                  <PersonPhotosOverview personId={person.id} limit={4} />
                </Card>
              </div>

              {/* Right Column: Large Profile Picture & Contact details */}
              <div className="w-full lg:w-80 shrink-0 space-y-4">
                {/* Large Profile Image */}
                <div className="relative aspect-square w-full rounded-2xl border bg-muted overflow-hidden shadow-sm">
                  {person.imageUrl ? (
                    // LCP element. Size must match App.tsx's /me prefetch; lowercase
                    // fetchpriority because React 18 warns on the camelCase prop.
                    <img
                      src={withImageSize(person.imageUrl, 480)}
                      alt={formatPersonName(person)}
                      width={320}
                      height={320}
                      {...{ fetchpriority: "high" }}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl font-bold bg-primary/10 text-primary">
                      {personInitials(person)}
                    </div>
                  )}
                </div>
                <Button variant="outline" size="sm" className="w-full" onClick={() => setIsChooseImageOpen(true)} data-testid="button-choose-image">
                  Choose image
                </Button>

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
                    {person.primaryAddress && (
                      <div className={`flex items-start gap-2 ${person.primaryAddress.outdated ? OUTDATED_TEXT : ""}`}>
                        <Home className="h-4 w-4 shrink-0 mt-0.5" />
                        <span className="break-words">
                          <Link href={mapHref(person.id, person.primaryAddress.address)} className="hover:underline" title="Show on map">
                            {person.primaryAddress.address}
                          </Link>
                          {person.primaryAddress.outdated && <OutdatedBadge />}
                        </span>
                      </div>
                    )}
                    {!person.email && !person.phone && !person.primaryAddress && <span className="text-muted-foreground italic">No contact details set</span>}
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

                  <div className="border-t pt-3 empty:hidden">
                    <AiBackendNotes kind="people" id={person.id} />
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
                personName={formatPersonName(person)}
              />
            </Suspense>
          </TabsContent>

          <TabsContent value="groups" className="mt-0 flex-1 min-h-0 overflow-y-auto">
            <PersonGroupsTab
              personGroups={person.groups || []}
              personId={person.id}
              onUpdate={() => {
                queryClient.invalidateQueries({
                  queryKey: ["/api/me"],
                });
              }}
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

          <TabsContent value="location" className="mt-0 flex-1 min-h-0 p-6 overflow-y-auto">
            <PersonAddresses personId={person.id} />
          </TabsContent>

          <TabsContent value="photos" className="mt-0 flex-1 min-h-0 overflow-y-auto">
            <PersonPhotosTab personId={person.id} />
          </TabsContent>
          </Suspense>
        </div>
      </Tabs>

      <Suspense fallback={null}>
        {isAddNoteOpen && (
          <AddNoteDialog
            open={isAddNoteOpen}
            onOpenChange={setIsAddNoteOpen}
            personId={person.id}
          />
        )}
        {isAddInteractionOpen && (
          <InteractionDialog
            open={isAddInteractionOpen}
            onOpenChange={setIsAddInteractionOpen}
            personId={person.id}
          />
        )}
        {isAddRelationshipOpen && (
          <RelationshipDialog
            open={isAddRelationshipOpen}
            onOpenChange={setIsAddRelationshipOpen}
            personId={person.id}
          />
        )}
        {isEditPersonOpen && (
          <PersonDialog
            open={isEditPersonOpen}
            onOpenChange={setIsEditPersonOpen}
            person={person}
            onDelete={() => navigate("/people")}
          />
        )}
        {isEditAdditionalOpen && (
          <AdditionalInfoDialog
            open={isEditAdditionalOpen}
            onOpenChange={setIsEditAdditionalOpen}
            person={person}
          />
        )}
        {isChooseImageOpen && (
          <ChoosePersonImageDialog
            person={person}
            open={isChooseImageOpen}
            onOpenChange={setIsChooseImageOpen}
          />
        )}
        {referenceProbe && <ReferenceMatchesDialog probe={referenceProbe} onClose={() => setReferenceProbe(null)} />}
      </Suspense>
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
