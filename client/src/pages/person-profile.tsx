import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Mail, Phone, ArrowLeft, Edit, StickyNote, Users, Handshake, FolderOpen, MessageSquare } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { PersonWithRelations, CommunicationWithType } from "@shared/schema";
import { queryClient } from "@/lib/queryClient";
import { AddNoteDialog } from "@/components/add-note-dialog";
import { AddInteractionDialog } from "@/components/add-interaction-dialog";
import { EditPersonDialog } from "@/components/edit-person-dialog";
import { AddRelationshipDialog } from "@/components/add-relationship-dialog";
import { NotesTab } from "@/components/notes-tab";
import { InteractionsTab } from "@/components/interactions-tab";
import { RelationshipsTab } from "@/components/relationships-tab";
import { PersonGroupsTab } from "@/components/person-groups-tab";
import { PersonSocialAccountsChips } from "@/components/person-social-accounts-chips";
import { PersonTagsChips } from "@/components/person-tags-chips";
import { CommunicationsFlow } from "@/components/communications-flow";
import { AddCommunicationDialog } from "@/components/add-communication-dialog";
import { CommunicationDetailDialog } from "@/components/communication-detail-dialog";

export default function PersonProfile() {
  const { id } = useParams<{ id: string }>();
  const [location, navigate] = useLocation();
  const [isAddNoteOpen, setIsAddNoteOpen] = useState(false);
  const [isAddInteractionOpen, setIsAddInteractionOpen] = useState(false);
  const [isEditPersonOpen, setIsEditPersonOpen] = useState(false);
  const [isAddRelationshipOpen, setIsAddRelationshipOpen] = useState(false);
  const [isAddCommunicationOpen, setIsAddCommunicationOpen] = useState(false);
  const [selectedCommunication, setSelectedCommunication] = useState<CommunicationWithType | null>(null);

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
              <Button
                variant="outline"
                onClick={() => setIsEditPersonOpen(true)}
                data-testid="button-edit-person"
              >
                <Edit className="h-4 w-4" />
                Edit
              </Button>
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

      <div className="flex-1 overflow-auto px-6">
        <Accordion type="multiple" defaultValue={["notes", "flow"]} className="w-full">
          <AccordionItem value="notes">
            <AccordionTrigger data-testid="accordion-notes">
              <div className="flex items-center gap-2">
                <StickyNote className="h-4 w-4" />
                Notes ({person.notes?.length || 0})
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <NotesTab
                notes={person.notes}
                personId={person.id}
                onAddNote={() => setIsAddNoteOpen(true)}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="flow">
            <AccordionTrigger data-testid="accordion-flow">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Communications Flow ({person.communications?.length || 0})
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <CommunicationsFlow
                communications={person.communications || []}
                personId={person.id}
                onAddCommunication={() => setIsAddCommunicationOpen(true)}
                onSelectCommunication={(comm) => setSelectedCommunication(comm)}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="interactions">
            <AccordionTrigger data-testid="accordion-interactions">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Interactions ({person.interactions?.length || 0})
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <InteractionsTab
                interactions={person.interactions}
                personId={person.id}
                onAddInteraction={() => setIsAddInteractionOpen(true)}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="relationships">
            <AccordionTrigger data-testid="accordion-relationships">
              <div className="flex items-center gap-2">
                <Handshake className="h-4 w-4" />
                Relationships ({person.relationships?.length || 0})
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <RelationshipsTab
                relationships={person.relationships}
                personId={person.id}
                onAddRelationship={() => setIsAddRelationshipOpen(true)}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="groups">
            <AccordionTrigger data-testid="accordion-groups">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4" />
                Groups ({person.groups?.length || 0})
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <PersonGroupsTab
                personId={person.id}
                personGroups={person.groups}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

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
      <AddCommunicationDialog
        open={isAddCommunicationOpen}
        onOpenChange={setIsAddCommunicationOpen}
        personId={person.id}
      />
      <CommunicationDetailDialog
        open={!!selectedCommunication}
        onOpenChange={(open) => !open && setSelectedCommunication(null)}
        communication={selectedCommunication}
        personId={person.id}
      />
    </div>
  );
}
