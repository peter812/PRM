import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, Loader2 } from "lucide-react";
import { getInitials } from "@/lib/utils";

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  imageUrl?: string | null;
  company?: string | null;
  title?: string | null;
}

interface FamilyTreePersonSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (personId: string) => void;
  required?: boolean;
}

export function FamilyTreePersonSelector({
  open,
  onOpenChange,
  onSelect,
  required = false,
}: FamilyTreePersonSelectorProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  const { data: people = [], isLoading } = useQuery<Person[]>({
    queryKey: ["/api/people"],
    enabled: open,
  });

  const filteredPeople = searchTerm.trim()
    ? people.filter((p) => {
        const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
        return fullName.includes(searchTerm.toLowerCase());
      })
    : people;

  const handleConfirm = () => {
    if (selectedPersonId) {
      onSelect(selectedPersonId);
      onOpenChange(false);
      setSearchTerm("");
      setSelectedPersonId(null);
    }
  };

  const handleOpenChange = (value: boolean) => {
    if (!value && required) return;
    onOpenChange(value);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select a Person</DialogTitle>
          <DialogDescription>
            Search for a person to view their family tree.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Type a name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
            data-testid="input-person-search"
          />
        </div>

        <div className="max-h-64 overflow-y-auto border rounded-md">
          {isLoading ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredPeople.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No people found
            </div>
          ) : (
            filteredPeople.slice(0, 50).map((person) => (
              <button
                key={person.id}
                className={`flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-accent transition-colors ${
                  selectedPersonId === person.id ? "bg-accent" : ""
                }`}
                onClick={() => setSelectedPersonId(person.id)}
                data-testid={`person-option-${person.id}`}
              >
                <Avatar className="h-8 w-8">
                  {person.imageUrl && (
                    <AvatarImage src={person.imageUrl} alt={`${person.firstName} ${person.lastName}`} />
                  )}
                  <AvatarFallback className="text-xs">
                    {getInitials(person.firstName, person.lastName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {person.firstName} {person.lastName}
                  </div>
                  {(person.title || person.company) && (
                    <div className="text-xs text-muted-foreground truncate">
                      {[person.title, person.company].filter(Boolean).join(" • ")}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        <Button
          onClick={handleConfirm}
          disabled={!selectedPersonId}
          className="w-full"
          data-testid="button-view-family-tree"
        >
          View Family Tree
        </Button>
      </DialogContent>
    </Dialog>
  );
}
