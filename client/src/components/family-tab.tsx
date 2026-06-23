import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, MoreVertical, Edit2, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getInitials } from "@/lib/utils";
import { FamilyMemberDialog } from "./family-member-dialog";

interface FamilyMember {
  id: string;
  person: {
    id: string;
    firstName: string;
    lastName: string;
    imageUrl?: string | null;
    sex: string;
  };
  lineageType?: "biological" | "adoptive" | "step";
  status?: "married" | "partner" | "divorced" | "ex_partner";
  roleLabel: string;
}

interface FamilyData {
  parents: FamilyMember[];
  spouses: FamilyMember[];
  children: FamilyMember[];
}

interface FamilyTabProps {
  personId: string;
  personName: string;
}

export function FamilyTab({ personId, personName }: FamilyTabProps) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeConnection, setActiveConnection] = useState<any>(null);
  const [defaultType, setDefaultType] = useState<"parent" | "spouse" | "child">("parent");

  const { data: family, isLoading } = useQuery<FamilyData>({
    queryKey: [`/api/people/${personId}/family`],
  });

  const deleteMutation = useMutation({
    mutationFn: async (args: { id: string; type: "parent" | "spouse" | "child" }) => {
      const endpoint = args.type === "spouse" ? "partnerships" : "lineage";
      await apiRequest("DELETE", `/api/family/${endpoint}/${args.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/people/${personId}/family`] });
      queryClient.invalidateQueries({ queryKey: ["/api/family-tree"] });
      toast({
        title: "Connection removed",
        description: "The family connection has been deleted.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message || "Failed to remove connection",
        variant: "destructive",
      });
    },
  });

  const openAddDialog = (type: "parent" | "spouse" | "child") => {
    setActiveConnection(null);
    setDefaultType(type);
    setDialogOpen(true);
  };

  const openEditDialog = (member: FamilyMember, type: "parent" | "spouse" | "child") => {
    setActiveConnection({
      id: member.id,
      type,
      roleLabel: member.roleLabel,
      lineageType: member.lineageType,
      status: member.status,
      person: member.person,
    });
    setDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Loading family details...
      </div>
    );
  }

  const renderSection = (
    title: string,
    members: FamilyMember[],
    type: "parent" | "spouse" | "child"
  ) => {
    return (
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            {title} ({members.length})
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-primary"
            onClick={() => openAddDialog(type)}
            data-testid={`btn-add-${type}`}
          >
            <Plus className="h-3.5 w-3.5" />
            Add {type === "spouse" ? "Partner" : type}
          </Button>
        </div>

        {members.length === 0 ? (
          <div className="text-sm text-muted-foreground italic p-4 border border-dashed rounded-lg text-center bg-muted/30">
            No {title.toLowerCase()} recorded.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {members.map((member) => (
              <Card key={member.id} className="relative overflow-hidden group hover:border-primary/50 transition-colors">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <Link href={`/people/${member.person.id}`}>
                    <a className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80">
                      <Avatar className="h-10 w-10">
                        {member.person.imageUrl && <AvatarImage src={member.person.imageUrl} />}
                        <AvatarFallback className="text-sm">
                          {getInitials(member.person.firstName, member.person.lastName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">
                          {member.person.firstName} {member.person.lastName}
                        </div>
                        <Badge variant="secondary" className="mt-0.5 text-xs px-2 py-0">
                          {member.roleLabel}
                        </Badge>
                      </div>
                    </a>
                  </Link>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditDialog(member, type)}>
                        <Edit2 className="h-3.5 w-3.5 mr-2" />
                        Edit Connection
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => deleteMutation.mutate({ id: member.id, type })}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Remove Link
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-8 max-w-6xl mx-auto">
      {renderSection("Parents", family?.parents || [], "parent")}
      {renderSection("Spouses & Partners", family?.spouses || [], "spouse")}
      {renderSection("Children", family?.children || [], "child")}

      <FamilyMemberDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        personId={personId}
        personName={personName}
        connection={activeConnection}
        suggestedRole={defaultType}
      />
    </div>
  );
}
