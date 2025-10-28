import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, X, LayoutList, LayoutGrid, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Person } from "@shared/schema";
import { Link } from "wouter";

interface MembersTabProps {
  members: Person[];
  groupId: string;
}

type ViewMode = "list" | "wide";

export function MembersTab({ members, groupId }: MembersTabProps) {
  const { toast } = useToast();
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setViewMode("wide");
      } else {
        setViewMode("list");
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const { data: allPeople = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  const memberIds = members.map((m) => m.id);
  const availablePeople = allPeople.filter((p) => !memberIds.includes(p.id));

  const removeMemberMutation = useMutation({
    mutationFn: async (personId: string) => {
      const updatedMembers = memberIds.filter((id) => id !== personId);
      return await apiRequest("PATCH", `/api/groups/${groupId}`, {
        members: updatedMembers,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({
        title: "Success",
        description: "Member removed from group",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove member",
        variant: "destructive",
      });
    },
  });

  const addMembersMutation = useMutation({
    mutationFn: async (newMemberIds: string[]) => {
      const updatedMembers = [...memberIds, ...newMemberIds];
      return await apiRequest("PATCH", `/api/groups/${groupId}`, {
        members: updatedMembers,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({
        title: "Success",
        description: "Members added to group",
      });
      setIsAddMemberOpen(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add members",
        variant: "destructive",
      });
    },
  });

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  return (
    <>
      <div className="p-6">
        <div className="flex items-center justify-between gap-4 mb-6">
          <Button
            onClick={() => setIsAddMemberOpen(true)}
            size="sm"
            data-testid="button-add-members"
          >
            <Plus className="h-4 w-4" />
            Add Members
          </Button>

          <div className="flex items-center border rounded-md p-1">
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
              className="h-8"
              data-testid="button-view-list"
            >
              <LayoutList className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "wide" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("wide")}
              className="h-8"
              data-testid="button-view-wide"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {members.length > 0 ? (
          viewMode === "list" ? (
            <div className="space-y-3">
              {members.map((member) => (
                <Card
                  key={member.id}
                  className="p-4 hover-elevate transition-all"
                  data-testid={`card-member-${member.id}`}
                >
                  <div className="flex items-center gap-4">
                    <Link href={`/person/${member.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                      <Avatar className="w-12 h-12">
                        {member.imageUrl && (
                          <AvatarImage
                            src={member.imageUrl}
                            alt={`${member.firstName} ${member.lastName}`}
                          />
                        )}
                        <AvatarFallback>
                          {getInitials(member.firstName, member.lastName)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <h3
                          className="text-lg font-medium hover:underline cursor-pointer"
                          data-testid={`text-member-name-${member.id}`}
                        >
                          {member.firstName} {member.lastName}
                        </h3>
                        {(member.company || member.title) && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            {member.title && <span>{member.title}</span>}
                            {member.title && member.company && <span>•</span>}
                            {member.company && <span>{member.company}</span>}
                          </div>
                        )}
                      </div>
                    </Link>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMemberMutation.mutate(member.id)}
                      disabled={removeMemberMutation.isPending}
                      className="text-destructive hover:text-destructive"
                      data-testid={`button-remove-member-${member.id}`}
                    >
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {members.map((member) => (
                <Card
                  key={member.id}
                  className="p-6 hover-elevate transition-all relative"
                  data-testid={`card-member-${member.id}`}
                >
                  <Link href={`/person/${member.id}`}>
                    <div className="flex flex-col items-center text-center cursor-pointer">
                      <Avatar className="w-20 h-20 mb-4">
                        {member.imageUrl && (
                          <AvatarImage
                            src={member.imageUrl}
                            alt={`${member.firstName} ${member.lastName}`}
                          />
                        )}
                        <AvatarFallback className="text-xl">
                          {getInitials(member.firstName, member.lastName)}
                        </AvatarFallback>
                      </Avatar>

                      <h3
                        className="text-lg font-semibold mb-1 hover:underline"
                        data-testid={`text-member-name-${member.id}`}
                      >
                        {member.firstName} {member.lastName}
                      </h3>

                      {member.company && (
                        <p className="text-sm text-muted-foreground mb-1">
                          {member.company}
                        </p>
                      )}
                      {member.title && (
                        <p className="text-xs text-muted-foreground">{member.title}</p>
                      )}
                    </div>
                  </Link>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeMemberMutation.mutate(member.id)}
                    disabled={removeMemberMutation.isPending}
                    className="absolute bottom-2 left-2 text-destructive hover:text-destructive p-1 h-auto"
                    data-testid={`button-remove-member-${member.id}`}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </Card>
              ))}
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Plus className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">No members yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              Add people to this group to organize your contacts
            </p>
            <Button onClick={() => setIsAddMemberOpen(true)} data-testid="button-add-members-empty">
              <Plus className="h-4 w-4" />
              Add Members
            </Button>
          </div>
        )}
      </div>

      <AddMembersDialog
        open={isAddMemberOpen}
        onOpenChange={setIsAddMemberOpen}
        availablePeople={availablePeople}
        onAddMembers={(ids) => addMembersMutation.mutate(ids)}
        isPending={addMembersMutation.isPending}
      />
    </>
  );
}

interface AddMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availablePeople: Person[];
  onAddMembers: (memberIds: string[]) => void;
  isPending: boolean;
}

function AddMembersDialog({
  open,
  onOpenChange,
  availablePeople,
  onAddMembers,
  isPending,
}: AddMembersDialogProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const handleSubmit = () => {
    if (selectedIds.length > 0) {
      onAddMembers(selectedIds);
      setSelectedIds([]);
      setSearchQuery("");
    }
  };

  const toggleSelection = (personId: string) => {
    setSelectedIds((prev) =>
      prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId]
    );
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  // Filter available people based on search query
  const filteredPeople = availablePeople.filter((person) => {
    const query = searchQuery.toLowerCase();
    return (
      person.firstName.toLowerCase().includes(query) ||
      person.lastName.toLowerCase().includes(query) ||
      person.email?.toLowerCase().includes(query) ||
      person.company?.toLowerCase().includes(query) ||
      person.tags?.some((tag) => tag.toLowerCase().includes(query))
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Members</DialogTitle>
          <DialogDescription>
            Select people to add to this group ({selectedIds.length} selected)
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search people by name, company, email, or tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-members"
          />
        </div>

        <ScrollArea className="h-96 border rounded-md p-3">
          <div className="space-y-2">
            {filteredPeople.map((person) => {
              const isSelected = selectedIds.includes(person.id);
              return (
                <div
                  key={person.id}
                  onClick={() => toggleSelection(person.id)}
                  className={`flex items-center gap-3 p-2 rounded-md cursor-pointer hover-elevate ${
                    isSelected ? "bg-primary/10" : ""
                  }`}
                  data-testid={`add-member-option-${person.id}`}
                >
                  <Avatar className="w-8 h-8">
                    {person.imageUrl && (
                      <AvatarImage
                        src={person.imageUrl}
                        alt={`${person.firstName} ${person.lastName}`}
                      />
                    )}
                    <AvatarFallback className="text-xs">
                      {getInitials(person.firstName, person.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {person.firstName} {person.lastName}
                    </p>
                    {person.company && (
                      <p className="text-xs text-muted-foreground truncate">
                        {person.company}
                      </p>
                    )}
                  </div>
                  {isSelected && (
                    <Badge variant="default" className="text-xs">
                      Selected
                    </Badge>
                  )}
                </div>
              );
            })}
            {availablePeople.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                All people are already members of this group
              </p>
            )}
            {availablePeople.length > 0 && filteredPeople.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No people found matching "{searchQuery}"
              </p>
            )}
          </div>
        </ScrollArea>

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSelectedIds([]);
              onOpenChange(false);
            }}
            className="flex-1"
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || selectedIds.length === 0}
            className="flex-1"
            data-testid="button-add-selected"
          >
            {isPending ? "Adding..." : `Add ${selectedIds.length} Member${selectedIds.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
