import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Mail, Phone, Building2, Briefcase, ArrowLeft, Plus, Edit } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PersonWithRelations } from "@shared/schema";
import { AddNoteDialog } from "@/components/add-note-dialog";
import { AddInteractionDialog } from "@/components/add-interaction-dialog";
import { EditPersonDialog } from "@/components/edit-person-dialog";
import { AddRelationshipDialog } from "@/components/add-relationship-dialog";
import { NotesTab } from "@/components/notes-tab";
import { InteractionsTab } from "@/components/interactions-tab";
import { RelationshipsTab } from "@/components/relationships-tab";
import { PersonGroupsTab } from "@/components/person-groups-tab";

export default function PersonProfile() {
  const { id } = useParams<{ id: string }>();
  const [location, navigate] = useLocation();
  const [isAddNoteOpen, setIsAddNoteOpen] = useState(false);
  const [isAddInteractionOpen, setIsAddInteractionOpen] = useState(false);
  const [isEditPersonOpen, setIsEditPersonOpen] = useState(false);
  const [isAddRelationshipOpen, setIsAddRelationshipOpen] = useState(false);

  // Parse query parameters to determine where to navigate back to
  const params = new URLSearchParams(window.location.search);
  const from = params.get('from');
  const groupId = params.get('groupId');

  const handleBack = () => {
    if (from === 'graph') {
      navigate('/graph');
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

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="mb-6"
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
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h1 className="text-3xl font-semibold mb-2" data-testid="text-person-name">
                  {person.firstName} {person.lastName}
                </h1>
                {(person.company || person.title) && (
                  <div className="flex items-center gap-2 text-lg text-muted-foreground">
                    {person.title && <span data-testid="text-person-title">{person.title}</span>}
                    {person.title && person.company && <span>•</span>}
                    {person.company && <span data-testid="text-person-company">{person.company}</span>}
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                onClick={() => setIsEditPersonOpen(true)}
                data-testid="button-edit-person"
              >
                <Edit className="h-4 w-4" />
                Edit
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            {person.tags && person.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {person.tags.map((tag, idx) => (
                  <Badge key={idx} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="notes" className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b px-6">
          <TabsList className="h-12 bg-transparent p-0">
            <TabsTrigger
              value="notes"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-notes"
            >
              Notes
            </TabsTrigger>
            <TabsTrigger
              value="interactions"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-interactions"
            >
              Interactions
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
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto">
          <TabsContent value="notes" className="mt-0 h-full">
            <NotesTab
              notes={person.notes}
              personId={person.id}
              onAddNote={() => setIsAddNoteOpen(true)}
            />
          </TabsContent>

          <TabsContent value="interactions" className="mt-0 h-full">
            <InteractionsTab
              interactions={person.interactions}
              personId={person.id}
              onAddInteraction={() => setIsAddInteractionOpen(true)}
            />
          </TabsContent>

          <TabsContent value="relationships" className="mt-0 h-full">
            <RelationshipsTab
              relationships={person.relationships}
              personId={person.id}
              onAddRelationship={() => setIsAddRelationshipOpen(true)}
            />
          </TabsContent>

          <TabsContent value="groups" className="mt-0 h-full">
            <PersonGroupsTab
              personId={person.id}
              personGroups={person.groups}
            />
          </TabsContent>
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
      />
      <EditPersonDialog
        open={isEditPersonOpen}
        onOpenChange={setIsEditPersonOpen}
        person={person}
        onDelete={() => navigate("/people")}
      />
    </div>
  );
}
