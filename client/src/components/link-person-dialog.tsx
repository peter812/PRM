import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, Check, Link2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";
import type { Person } from "@shared/schema";

interface LinkPersonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  socialAccountId: string;
  currentPersonId?: string | null;
}

export function LinkPersonDialog({
  open,
  onOpenChange,
  socialAccountId,
  currentPersonId,
}: LinkPersonDialogProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(currentPersonId || null);

  const { data: people = [], isLoading } = useQuery<Person[]>({
    queryKey: ["/api/people"],
    enabled: open,
  });

  const filteredPeople = people.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
    const email = (p.email || "").toLowerCase();
    const company = (p.company || "").toLowerCase();
    const title = (p.title || "").toLowerCase();
    return fullName.includes(q) || email.includes(q) || company.includes(q) || title.includes(q);
  });

  const linkMutation = useMutation({
    mutationFn: async (personId: string) => {
      const targetPerson = people.find((p) => p.id === personId);
      const existingUuids = targetPerson?.socialAccountUuids || [];

      // 1. Update social account owner
      await apiRequest("PATCH", `/api/social-accounts/${socialAccountId}`, {
        ownerUuid: personId,
      });

      // 2. Add social account to new owner's socialAccountUuids
      await apiRequest("PATCH", `/api/people/${personId}`, {
        socialAccountUuids: Array.from(new Set([...existingUuids, socialAccountId])),
      });

      // 3. If previous owner was different, remove social account from previous owner
      if (currentPersonId && currentPersonId !== personId) {
        const prevPerson = people.find((p) => p.id === currentPersonId);
        if (prevPerson) {
          const prevUuids = (prevPerson.socialAccountUuids || []).filter((id) => id !== socialAccountId);
          await apiRequest("PATCH", `/api/people/${currentPersonId}`, {
            socialAccountUuids: prevUuids,
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", socialAccountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({
        title: "Success",
        description: "Person linked to account successfully",
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to link person to account",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (selectedPersonId) {
      linkMutation.mutate(selectedPersonId);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setSearchQuery("");
          setSelectedPersonId(currentPersonId || null);
          onOpenChange(false);
        }
      }}
    >
      <DialogContent className="w-[95vw] max-w-sm md:max-w-md p-4 md:p-6 max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-base md:text-lg flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            Link Person to Account
          </DialogTitle>
          <DialogDescription className="text-xs md:text-sm">
            Select an existing person to link as the owner of this social account.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <div className="relative flex-shrink-0">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search people by name, title, or company..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs md:text-sm h-9"
              data-testid="input-search-link-person"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 min-h-[220px] max-h-[350px] pr-1">
            {isLoading ? (
              <div className="text-center py-8 text-xs text-muted-foreground">
                Loading people...
              </div>
            ) : filteredPeople.length > 0 ? (
              filteredPeople.map((person) => {
                const isSelected = selectedPersonId === person.id;
                const isCurrent = currentPersonId === person.id;

                return (
                  <Card
                    key={person.id}
                    className={`p-2.5 cursor-pointer transition-all border ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedPersonId(person.id)}
                    data-testid={`card-person-option-${person.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8 flex-shrink-0">
                        {person.imageUrl && (
                          <AvatarImage src={person.imageUrl} alt={`${person.firstName} ${person.lastName}`} />
                        )}
                        <AvatarFallback className="text-xs">
                          {getInitials(person.firstName, person.lastName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-xs md:text-sm truncate">
                            {person.firstName} {person.lastName}
                          </p>
                          {isCurrent && (
                            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                              Current
                            </span>
                          )}
                        </div>
                        {(person.title || person.company) && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {person.title} {person.title && person.company && "•"} {person.company}
                          </p>
                        )}
                      </div>
                      <div
                        className={`h-4 w-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-all ${
                          isSelected
                            ? "bg-primary border-primary"
                            : "border-muted-foreground/50"
                        }`}
                      >
                        {isSelected && (
                          <Check className="h-2.5 w-2.5 text-primary-foreground" />
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })
            ) : (
              <div className="text-center py-8 text-xs text-muted-foreground">
                No people found
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                setSelectedPersonId(currentPersonId || null);
                onOpenChange(false);
              }}
              data-testid="button-cancel-link-person"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!selectedPersonId || selectedPersonId === currentPersonId || linkMutation.isPending}
              data-testid="button-confirm-link-person"
            >
              {linkMutation.isPending ? "Linking..." : "Link Person"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
