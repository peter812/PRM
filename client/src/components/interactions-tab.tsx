import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2, Phone, Mail, Video, Calendar, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Interaction, Person, Group, InteractionType } from "@shared/schema";
import { format } from "date-fns";
import { Link } from "wouter";

interface InteractionsTabProps {
  interactions: Interaction[];
  personId?: string;
  groupId?: string;
  onAddInteraction: () => void;
}

export function InteractionsTab({
  interactions,
  personId,
  groupId,
  onAddInteraction,
}: InteractionsTabProps) {
  const { toast } = useToast();

  const { data: allPeople = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  const { data: allGroups = [] } = useQuery<Group[]>({
    queryKey: ["/api/groups"],
  });

  const { data: interactionTypes = [] } = useQuery<InteractionType[]>({
    queryKey: ["/api/interaction-types"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (interactionId: string) => {
      return await apiRequest("DELETE", `/api/interactions/${interactionId}`, undefined);
    },
    onSuccess: (_data, interactionId) => {
      // Find the deleted interaction to get all involved entities
      const deletedInteraction = interactions.find((i) => i.id === interactionId);
      
      // Invalidate queries for all involved people
      if (deletedInteraction?.peopleIds) {
        deletedInteraction.peopleIds.forEach((id) => {
          queryClient.invalidateQueries({ queryKey: ["/api/people", id] });
        });
      }
      
      // Invalidate queries for all involved groups
      if (deletedInteraction?.groupIds) {
        deletedInteraction.groupIds.forEach((id) => {
          queryClient.invalidateQueries({ queryKey: ["/api/groups", id] });
        });
      }
      
      // Also invalidate the current context (person or group)
      if (personId) {
        queryClient.invalidateQueries({ queryKey: ["/api/people", personId] });
      }
      if (groupId) {
        queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      }
      
      toast({
        title: "Success",
        description: "Interaction deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete interaction",
        variant: "destructive",
      });
    },
  });

  const sortedInteractions = [...interactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const getTypeIcon = (typeName: string) => {
    const lowerName = typeName.toLowerCase();
    if (lowerName.includes("call")) return Phone;
    if (lowerName.includes("email")) return Mail;
    if (lowerName.includes("meeting")) return Video;
    return Calendar;
  };

  const getPeopleForInteraction = (interaction: Interaction) => {
    return interaction.peopleIds
      .map((id) => allPeople.find((p) => p.id === id))
      .filter((p): p is Person => !!p);
  };

  const getGroupsForInteraction = (interaction: Interaction) => {
    if (!interaction.groupIds) return [];
    return interaction.groupIds
      .map((id) => allGroups.find((g) => g.id === id))
      .filter((g): g is Group => !!g);
  };

  const getInteractionType = (typeId: string | null) => {
    if (!typeId) return null;
    return interactionTypes.find((t) => t.id === typeId);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Interactions</h2>
        <Button onClick={onAddInteraction} size="sm" data-testid="button-add-interaction">
          <Plus className="h-4 w-4" />
          Add Interaction
        </Button>
      </div>

      {sortedInteractions.length > 0 ? (
        <div className="relative">
          <div className="absolute left-[7px] top-0 bottom-0 w-0.5 bg-border" />
          <div className="space-y-6">
            {sortedInteractions.map((interaction) => {
              const interactionType = getInteractionType(interaction.typeId);
              const TypeIcon = interactionType ? getTypeIcon(interactionType.name) : Calendar;
              const people = getPeopleForInteraction(interaction);
              const groups = getGroupsForInteraction(interaction);
              const typeColor = interactionType?.color || "#6b7280";

              return (
                <div key={interaction.id} className="relative pl-8" data-testid={`card-interaction-${interaction.id}`}>
                  <div 
                    className="absolute left-0 top-1.5 w-4 h-4 rounded-full border-4 border-background" 
                    style={{ backgroundColor: typeColor }}
                  />
                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {interactionType && (
                          <Badge
                            className="border"
                            style={{
                              backgroundColor: `${typeColor}15`,
                              color: typeColor,
                              borderColor: `${typeColor}40`,
                            }}
                          >
                            <TypeIcon className="h-3 w-3 mr-1" />
                            {interactionType.name}
                          </Badge>
                        )}
                        <span className="text-sm text-muted-foreground">
                          {format(new Date(interaction.date), "MMM d, yyyy 'at' h:mm a")}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMutation.mutate(interaction.id)}
                        disabled={deleteMutation.isPending}
                        className="h-8 text-destructive hover:text-destructive"
                        data-testid={`button-delete-interaction-${interaction.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {interaction.title && (
                      <h3 className="text-lg font-medium mb-2" data-testid={`text-interaction-title-${interaction.id}`}>
                        {interaction.title}
                      </h3>
                    )}

                    {people.length > 0 && (
                      <div className="mb-3 flex items-center gap-2 flex-wrap">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">With:</span>
                        {people.map((person, idx) => (
                          <span key={person.id} className="text-sm">
                            <Link href={`/person/${person.id}`} className="text-primary hover:underline">
                              {person.firstName} {person.lastName}
                            </Link>
                            {idx < people.length - 1 && <span className="text-muted-foreground">, </span>}
                          </span>
                        ))}
                      </div>
                    )}

                    {groups.length > 0 && (
                      <div className="mb-3 flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-muted-foreground">Groups:</span>
                        {groups.map((group) => (
                          <Link key={group.id} href={`/group/${group.id}`}>
                            <Badge
                              variant="outline"
                              className="cursor-pointer"
                              style={{
                                borderColor: group.color || "#888",
                                color: group.color || "#888",
                              }}
                            >
                              {group.name}
                            </Badge>
                          </Link>
                        ))}
                      </div>
                    )}

                    <p className="text-base whitespace-pre-wrap" data-testid={`text-interaction-description-${interaction.id}`}>
                      {interaction.description}
                    </p>
                    
                    {interaction.imageUrl && (
                      <div className="mt-4">
                        <img
                          src={interaction.imageUrl}
                          alt="Interaction attachment"
                          className="rounded-md max-w-md w-full border"
                          data-testid={`img-interaction-${interaction.id}`}
                        />
                      </div>
                    )}
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Calendar className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium mb-2">No interactions yet</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm">
            Track meetings, calls, emails, and other interactions with this person
          </p>
          <Button onClick={onAddInteraction} data-testid="button-add-interaction-empty">
            <Plus className="h-4 w-4" />
            Add Interaction
          </Button>
        </div>
      )}
    </div>
  );
}
