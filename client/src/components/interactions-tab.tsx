import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Phone, Mail, Video, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Interaction } from "@shared/schema";
import { format } from "date-fns";

interface InteractionsTabProps {
  interactions: Interaction[];
  personId: number;
  onAddInteraction: () => void;
}

export function InteractionsTab({
  interactions,
  personId,
  onAddInteraction,
}: InteractionsTabProps) {
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async (interactionId: number) => {
      return await apiRequest("DELETE", `/api/interactions/${interactionId}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", String(personId)] });
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

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "call":
        return Phone;
      case "email":
        return Mail;
      case "meeting":
        return Video;
      default:
        return Calendar;
    }
  };

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case "call":
        return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
      case "email":
        return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20";
      case "meeting":
        return "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20";
      default:
        return "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20";
    }
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
              const TypeIcon = getTypeIcon(interaction.type);
              return (
                <div key={interaction.id} className="relative pl-8" data-testid={`card-interaction-${interaction.id}`}>
                  <div className="absolute left-0 top-1.5 w-4 h-4 rounded-full bg-primary border-4 border-background" />
                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex items-center gap-2">
                        <Badge
                          className={`${getTypeBadgeColor(interaction.type)} border capitalize`}
                        >
                          <TypeIcon className="h-3 w-3 mr-1" />
                          {interaction.type}
                        </Badge>
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
                    <p className="text-base whitespace-pre-wrap" data-testid={`text-interaction-description-${interaction.id}`}>
                      {interaction.description}
                    </p>
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
