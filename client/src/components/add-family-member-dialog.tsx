import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Search, Loader2 } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getInitials } from "@/lib/utils";

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  imageUrl?: string | null;
  company?: string | null;
  title?: string | null;
}

interface FamilyRelType {
  value: string;
  label: string;
  category: string;
  inverse: string;
}

interface AddFamilyMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relatedPersonId: string;
  relatedPersonName?: string;
  suggestedRole?: string;
  onSuccess?: () => void;
}

export function AddFamilyMemberDialog({
  open,
  onOpenChange,
  relatedPersonId,
  relatedPersonName,
  suggestedRole,
  onSuccess,
}: AddFamilyMemberDialogProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"link" | "create">("link");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [relationshipType, setRelationshipType] = useState(suggestedRole ?? "");
  const [newPerson, setNewPerson] = useState({ firstName: "", lastName: "", birthday: "" });
  const [gender, setGender] = useState("unspecified");

  const { data: people = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
    enabled: open,
  });

  const { data: typesData } = useQuery<{ types: FamilyRelType[] }>({
    queryKey: ["/api/family-relationships/types"],
    enabled: open,
  });

  const types = typesData?.types ?? [];

  const filteredPeople = searchTerm.trim()
    ? people.filter((p) => {
        const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
        return fullName.includes(searchTerm.toLowerCase()) && p.id !== relatedPersonId;
      })
    : people.filter((p) => p.id !== relatedPersonId);

  const createPersonMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string; birthday?: string; gender?: string }) => {
      const res = await apiRequest("POST", "/api/people", data);
      return res.json();
    },
  });

  const createRelationshipMutation = useMutation({
    mutationFn: async (data: { fromPersonId: string; toPersonId: string; familyRelationshipType: string }) => {
      const res = await apiRequest("POST", "/api/family-relationships", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/family-tree"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({ title: "Family member added", description: "The family relationship has been created." });
      onSuccess?.();
      handleClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to add family member", variant: "destructive" });
    },
  });

  const handleClose = () => {
    setMode("link");
    setSearchTerm("");
    setSelectedPersonId(null);
    setRelationshipType(suggestedRole ?? "");
    setNewPerson({ firstName: "", lastName: "", birthday: "" });
    setGender("unspecified");
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!relationshipType) return;

    let targetPersonId = selectedPersonId;

    if (mode === "create") {
      if (!newPerson.firstName.trim()) return;
      try {
        const created = await createPersonMutation.mutateAsync({
          firstName: newPerson.firstName.trim(),
          lastName: newPerson.lastName.trim(),
          birthday: newPerson.birthday || undefined,
          gender: gender !== "unspecified" ? gender : undefined,
        });
        targetPersonId = created.id;
      } catch {
        return;
      }
    }

    if (!targetPersonId) return;

    createRelationshipMutation.mutate({
      fromPersonId: targetPersonId,
      toPersonId: relatedPersonId,
      familyRelationshipType: relationshipType,
    });
  };

  const isSubmitting = createPersonMutation.isPending || createRelationshipMutation.isPending;
  const canSubmit = relationshipType && ((mode === "link" && selectedPersonId) || (mode === "create" && newPerson.firstName.trim()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Family Member</DialogTitle>
          {relatedPersonName && (
            <p className="text-sm text-muted-foreground">
              Adding {suggestedRole ? formatRole(suggestedRole) : "family member"} for{" "}
              <span className="font-medium">{relatedPersonName}</span>
            </p>
          )}
        </DialogHeader>

        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as "link" | "create")}
          className="flex gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="link" id="mode-link" />
            <Label htmlFor="mode-link">Link existing person</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="create" id="mode-create" />
            <Label htmlFor="mode-create">Create new person</Label>
          </div>
        </RadioGroup>

        {mode === "link" && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search people..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-48 overflow-y-auto border rounded-md">
              {filteredPeople.slice(0, 30).map((person) => (
                <button
                  key={person.id}
                  className={`flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-accent transition-colors ${
                    selectedPersonId === person.id ? "bg-accent" : ""
                  }`}
                  onClick={() => setSelectedPersonId(person.id)}
                >
                  <Avatar className="h-7 w-7">
                    {person.imageUrl && <AvatarImage src={person.imageUrl} />}
                    <AvatarFallback className="text-xs">
                      {getInitials(person.firstName, person.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm truncate">
                    {person.firstName} {person.lastName}
                  </span>
                </button>
              ))}
              {filteredPeople.length === 0 && (
                <div className="p-3 text-center text-sm text-muted-foreground">No people found</div>
              )}
            </div>
          </>
        )}

        {mode === "create" && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                value={newPerson.firstName}
                onChange={(e) => setNewPerson((p) => ({ ...p, firstName: e.target.value }))}
                placeholder="First name"
              />
            </div>
            <div>
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={newPerson.lastName}
                onChange={(e) => setNewPerson((p) => ({ ...p, lastName: e.target.value }))}
                placeholder="Last name"
              />
            </div>
            <div>
              <Label htmlFor="birthday">Birthday</Label>
              <Input
                id="birthday"
                type="date"
                value={newPerson.birthday}
                onChange={(e) => setNewPerson((p) => ({ ...p, birthday: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="gender">Gender</Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unspecified">Unspecified</SelectItem>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div>
          <Label>Relationship Type *</Label>
          <Select value={relationshipType} onValueChange={setRelationshipType}>
            <SelectTrigger>
              <SelectValue placeholder="Select relationship..." />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Add to Tree
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatRole(role: string): string {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
