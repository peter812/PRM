import { useState, useEffect } from "react";
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
  sex?: string;
}

interface FamilyMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personId: string;
  personName?: string;
  connection?: {
    id: string;
    type: "parent" | "child" | "spouse";
    roleLabel: string;
    lineageType?: "biological" | "adoptive" | "step";
    status?: "married" | "partner" | "divorced" | "ex_partner";
    person: {
      id: string;
      firstName: string;
      lastName: string;
      imageUrl?: string | null;
    };
  } | null;
  suggestedRole?: string;
  onSuccess?: () => void;
}

export function FamilyMemberDialog({
  open,
  onOpenChange,
  personId,
  personName,
  connection,
  suggestedRole,
  onSuccess,
}: FamilyMemberDialogProps) {
  const isEdit = !!connection;
  const { toast } = useToast();
  const [mode, setMode] = useState<"link" | "create">("link");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [connectionType, setConnectionType] = useState<"parent" | "spouse" | "child">("parent");
  
  // Details
  const [lineageType, setLineageType] = useState<"biological" | "adoptive" | "step">("biological");
  const [partnershipStatus, setPartnershipStatus] = useState<"married" | "partner" | "divorced" | "ex_partner">("married");
  
  // New Person form
  const [newPerson, setNewPerson] = useState({ firstName: "", lastName: "" });
  const [newPersonSex, setNewPersonSex] = useState<string>("unknown");

  const { data: people = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      if (isEdit && connection) {
        setConnectionType(connection.type);
        setSelectedPersonId(connection.person.id);
        if (connection.type === "spouse") {
          setPartnershipStatus(connection.status || "married");
        } else {
          setLineageType(connection.lineageType || "biological");
        }
      } else {
        setMode("link");
        setSearchTerm("");
        setSelectedPersonId(null);
        
        let defaultConnType: "parent" | "spouse" | "child" = "parent";
        if (suggestedRole) {
          const role = suggestedRole.toLowerCase();
          if (role.includes("spouse") || role.includes("partner") || role.includes("husband") || role.includes("wife")) {
            defaultConnType = "spouse";
          } else if (role.includes("child") || role.includes("son") || role.includes("daughter")) {
            defaultConnType = "child";
          } else if (role.includes("parent") || role.includes("father") || role.includes("mother")) {
            defaultConnType = "parent";
          }
        }
        
        setConnectionType(defaultConnType);
        setLineageType("biological");
        setPartnershipStatus("married");
        setNewPerson({ firstName: "", lastName: "" });
        setNewPersonSex("unknown");
      }
    }
  }, [open, isEdit, connection, suggestedRole]);

  const filteredPeople = searchTerm.trim()
    ? people.filter((p) => {
        const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
        return fullName.includes(searchTerm.toLowerCase()) && p.id !== personId;
      })
    : people.filter((p) => p.id !== personId);

  const createPersonMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string; sex: string }) => {
      const res = await apiRequest("POST", "/api/people", data);
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      let targetPersonId = selectedPersonId;

      if (!isEdit && mode === "create") {
        if (!newPerson.firstName.trim()) return;
        const created = await createPersonMutation.mutateAsync({
          firstName: newPerson.firstName.trim(),
          lastName: newPerson.lastName.trim(),
          sex: newPersonSex,
        });
        targetPersonId = created.id;
      }

      if (!targetPersonId) throw new Error("Please select or create a person");

      if (isEdit && connection) {
        if (connection.type === "spouse") {
          await apiRequest("PATCH", `/api/family/partnerships/${connection.id}`, {
            status: partnershipStatus,
          });
        } else {
          await apiRequest("PATCH", `/api/family/lineage/${connection.id}`, {
            lineageType,
          });
        }
      } else {
        // Create new
        if (connectionType === "parent") {
          await apiRequest("POST", "/api/family/lineage", {
            childId: personId,
            parentId: targetPersonId,
            lineageType,
          });
        } else if (connectionType === "child") {
          await apiRequest("POST", "/api/family/lineage", {
            childId: targetPersonId,
            parentId: personId,
            lineageType,
          });
        } else {
          await apiRequest("POST", "/api/family/partnerships", {
            person1Id: personId,
            person2Id: targetPersonId,
            status: partnershipStatus,
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", personId] });
      queryClient.invalidateQueries({ queryKey: [`/api/people/${personId}/family`] });
      queryClient.invalidateQueries({ queryKey: ["/api/family-tree"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({
        title: "Success",
        description: isEdit
          ? "Family connection updated successfully"
          : "Family member added successfully",
      });
      onSuccess?.();
      handleClose();
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message || "Failed to save family connection",
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    onOpenChange(false);
  };

  const isSaving = saveMutation.isPending || createPersonMutation.isPending;
  const canSave = isEdit || (mode === "link" && selectedPersonId) || (mode === "create" && newPerson.firstName.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Family Connection" : "Add Family Member"}</DialogTitle>
          {!isEdit && personName && (
            <p className="text-sm text-muted-foreground">
              Add a family member connection for <span className="font-medium">{personName}</span>
            </p>
          )}
        </DialogHeader>

        {!isEdit && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Connection Type</Label>
              <Select
                value={connectionType}
                onValueChange={(val) => setConnectionType(val as any)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="parent">Parent</SelectItem>
                  <SelectItem value="spouse">Spouse / Partner</SelectItem>
                  <SelectItem value="child">Child</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as "link" | "create")}
              className="flex gap-4 pt-1"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="link" id="fam-mode-link" />
                <Label htmlFor="fam-mode-link" className="cursor-pointer">Link existing person</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="create" id="fam-mode-create" />
                <Label htmlFor="fam-mode-create" className="cursor-pointer">Create new person</Label>
              </div>
            </RadioGroup>
          </div>
        )}

        {isEdit && connection && (
          <div className="flex items-center gap-3 p-3 bg-muted rounded-md mb-2">
            <Avatar className="h-9 w-9">
              {connection.person.imageUrl && <AvatarImage src={connection.person.imageUrl} />}
              <AvatarFallback className="text-sm">
                {getInitials(connection.person.firstName, connection.person.lastName)}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="text-sm font-semibold">
                {connection.person.firstName} {connection.person.lastName}
              </div>
              <div className="text-xs text-muted-foreground capitalize">
                {connection.type === "spouse" ? "Spouse/Partner" : connection.type} Connection
              </div>
            </div>
          </div>
        )}

        {!isEdit && mode === "link" && (
          <div className="space-y-3 pt-2">
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
          </div>
        )}

        {!isEdit && mode === "create" && (
          <div className="space-y-3 pt-2">
            <div>
              <Label htmlFor="fam-firstName">First Name *</Label>
              <Input
                id="fam-firstName"
                value={newPerson.firstName}
                onChange={(e) => setNewPerson((p) => ({ ...p, firstName: e.target.value }))}
                placeholder="First name"
              />
            </div>
            <div>
              <Label htmlFor="fam-lastName">Last Name</Label>
              <Input
                id="fam-lastName"
                value={newPerson.lastName}
                onChange={(e) => setNewPerson((p) => ({ ...p, lastName: e.target.value }))}
                placeholder="Last name"
              />
            </div>
            <div>
              <Label htmlFor="fam-sex">Sex</Label>
              <Select value={newPersonSex} onValueChange={setNewPersonSex}>
                <SelectTrigger id="fam-sex">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">Unknown</SelectItem>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="space-y-3 border-t pt-3 mt-1">
          {connectionType === "spouse" ? (
            <div>
              <Label>Relationship Status</Label>
              <Select
                value={partnershipStatus}
                onValueChange={(val) => setPartnershipStatus(val as any)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="married">Married / Spouse</SelectItem>
                  <SelectItem value="partner">Partner / Significant Other</SelectItem>
                  <SelectItem value="divorced">Divorced / Ex-Spouse</SelectItem>
                  <SelectItem value="ex_partner">Ex-Partner</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label>Lineage Type</Label>
              <Select
                value={lineageType}
                onValueChange={(val) => setLineageType(val as any)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="biological">Biological</SelectItem>
                  <SelectItem value="adoptive">Adoptive</SelectItem>
                  <SelectItem value="step">Step</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-4 border-t mt-2">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!canSave || isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {isEdit ? "Save Changes" : "Save Connection"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
