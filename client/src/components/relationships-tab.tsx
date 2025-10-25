import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { RelationshipWithPerson } from "@shared/schema";

interface RelationshipsTabProps {
  relationships: RelationshipWithPerson[];
  personId: string;
  onAddRelationship: () => void;
}

export function RelationshipsTab({
  relationships,
  personId,
  onAddRelationship,
}: RelationshipsTabProps) {
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async (relationshipId: string) => {
      return await apiRequest("DELETE", `/api/relationships/${relationshipId}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", String(personId)] });
      toast({
        title: "Success",
        description: "Relationship deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete relationship",
        variant: "destructive",
      });
    },
  });

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case "friend":
        return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
      case "family":
        return "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20";
      case "colleague":
        return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20";
      case "client":
        return "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20";
      case "partner":
        return "bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-500/20";
      case "mentor":
        return "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20";
      default:
        return "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20";
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Relationships</h2>
        <Button onClick={onAddRelationship} size="sm" data-testid="button-add-relationship">
          <Plus className="h-4 w-4" />
          Add Relationship
        </Button>
      </div>

      {relationships && relationships.length > 0 ? (
        <div className="grid grid-cols-1 gap-4">
          {relationships.map((relationship) => (
            <Card
              key={relationship.id}
              className="p-4"
              data-testid={`card-relationship-${relationship.id}`}
            >
              <div className="flex items-start gap-4">
                <Avatar className="w-12 h-12">
                  <AvatarFallback>
                    {getInitials(
                      relationship.toPerson.firstName,
                      relationship.toPerson.lastName
                    )}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div>
                      <h3 className="text-lg font-medium" data-testid={`text-related-person-${relationship.id}`}>
                        {relationship.toPerson.firstName} {relationship.toPerson.lastName}
                      </h3>
                      {(relationship.toPerson.company || relationship.toPerson.title) && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          {relationship.toPerson.title && (
                            <span>{relationship.toPerson.title}</span>
                          )}
                          {relationship.toPerson.title && relationship.toPerson.company && (
                            <span>•</span>
                          )}
                          {relationship.toPerson.company && (
                            <span>{relationship.toPerson.company}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(relationship.id)}
                      disabled={deleteMutation.isPending}
                      className="h-8 text-destructive hover:text-destructive"
                      data-testid={`button-delete-relationship-${relationship.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <Badge
                    className={`${getLevelColor(relationship.level)} border capitalize mb-3`}
                  >
                    {relationship.level}
                  </Badge>

                  {relationship.notes && (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid={`text-relationship-notes-${relationship.id}`}>
                      {relationship.notes}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Users2 className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium mb-2">No relationships yet</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm">
            Connect this person with others in your network to track relationships
          </p>
          <Button onClick={onAddRelationship} data-testid="button-add-relationship-empty">
            <Plus className="h-4 w-4" />
            Add Relationship
          </Button>
        </div>
      )}
    </div>
  );
}
