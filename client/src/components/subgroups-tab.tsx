import { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Plus,
  Edit,
  Trash2,
  Users,
  ArrowRight,
  ArrowLeft,
  Search,
  X,
  Phone,
  Mail,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";
import type { SubGroup, Person } from "@shared/schema";
import { SubGroupDialog } from "@/components/subgroup-dialog";

interface SubGroupsTabProps {
  groupId: string;
  subGroups: SubGroup[];
  parentGroupMembers?: Person[];
  selectedSubGroupId?: string | null;
  onSelectSubGroup?: (id: string | null) => void;
}

export function SubGroupsTab({
  groupId,
  subGroups = [],
  parentGroupMembers = [],
  selectedSubGroupId,
  onSelectSubGroup,
}: SubGroupsTabProps) {
  const { toast } = useToast();
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
    selectedSubGroupId || null
  );

  useEffect(() => {
    if (selectedSubGroupId !== undefined) {
      setInternalSelectedId(selectedSubGroupId);
    }
  }, [selectedSubGroupId]);

  const activeSubGroupId = selectedSubGroupId !== undefined ? selectedSubGroupId : internalSelectedId;

  const handleSelectSubGroup = (id: string | null) => {
    setInternalSelectedId(id);
    onSelectSubGroup?.(id);
  };

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [subGroupToEdit, setSubGroupToEdit] = useState<SubGroup | null>(null);
  const [subGroupToDelete, setSubGroupToDelete] = useState<SubGroup | null>(null);
  const [isAddMembersOpen, setIsAddMembersOpen] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");

  const activeSubGroup = subGroups.find((sg) => sg.id === activeSubGroupId);

  const deleteMutation = useMutation({
    mutationFn: async (subGroupId: string) => {
      return await apiRequest("DELETE", `/api/subgroups/${subGroupId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "subgroups"] });
      setSubGroupToDelete(null);
      if (activeSubGroupId) {
        handleSelectSubGroup(null);
      }
      toast({
        title: "Sub group deleted",
        description: "The sub group has been removed successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete sub group",
        variant: "destructive",
      });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async ({ subGroupId, personId }: { subGroupId: string; personId: string }) => {
      const targetSg = subGroups.find((s) => s.id === subGroupId);
      if (!targetSg) return;
      const updatedMembers = (targetSg.members || []).filter((id) => id !== personId);
      return await apiRequest("PATCH", `/api/subgroups/${subGroupId}`, {
        members: updatedMembers,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "subgroups"] });
      toast({
        title: "Success",
        description: "Member removed from sub group",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove member",
        variant: "destructive",
      });
    },
  });

  const addMembersMutation = useMutation({
    mutationFn: async ({ subGroupId, newMemberIds }: { subGroupId: string; newMemberIds: string[] }) => {
      const targetSg = subGroups.find((s) => s.id === subGroupId);
      if (!targetSg) return;
      const updatedMembers = Array.from(new Set([...(targetSg.members || []), ...newMemberIds]));
      return await apiRequest("PATCH", `/api/subgroups/${subGroupId}`, {
        members: updatedMembers,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "subgroups"] });
      setIsAddMembersOpen(false);
      toast({
        title: "Success",
        description: "Members added to sub group",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add members",
        variant: "destructive",
      });
    },
  });

  // Map person ID to Person object for easy avatar preview
  const memberMap = useMemo(() => {
    const map = new Map<string, Person>();
    parentGroupMembers.forEach((p) => map.set(p.id, p));
    return map;
  }, [parentGroupMembers]);

  // Active sub group members
  const activeSubGroupMembers = useMemo(() => {
    if (!activeSubGroup) return [];
    return (activeSubGroup.members || [])
      .map((id) => memberMap.get(id))
      .filter(Boolean) as Person[];
  }, [activeSubGroup, memberMap]);

  const filteredActiveMembers = useMemo(() => {
    if (!memberSearchQuery.trim()) return activeSubGroupMembers;
    const q = memberSearchQuery.toLowerCase();
    return activeSubGroupMembers.filter(
      (m) =>
        m.firstName.toLowerCase().includes(q) ||
        m.lastName.toLowerCase().includes(q) ||
        m.company?.toLowerCase().includes(q) ||
        m.title?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q)
    );
  }, [activeSubGroupMembers, memberSearchQuery]);

  // If an active sub group is selected, render its detail view below the group menu
  if (activeSubGroup) {
    return (
      <div className="p-6">
        {/* Navigation & Header */}
        <div className="flex items-center justify-between gap-4 mb-6 pb-4 border-b">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSelectSubGroup(null)}
              className="gap-1.5"
              data-testid="button-back-to-all-subgroups"
            >
              <ArrowLeft className="h-4 w-4" />
              All Sub Groups
            </Button>
            <span className="text-muted-foreground text-sm">/</span>
            <div className="flex items-center gap-2">
              <span
                className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                style={{ backgroundColor: activeSubGroup.color }}
              />
              <h2 className="text-xl font-bold" data-testid="text-active-subgroup-name">
                {activeSubGroup.name}
              </h2>
            </div>
            <Badge variant="secondary" className="text-xs font-normal">
              <Users className="h-3 w-3 mr-1 inline" />
              {activeSubGroup.members?.length || 0} member{activeSubGroup.members?.length !== 1 ? "s" : ""}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSubGroupToEdit(activeSubGroup)}
              data-testid="button-edit-active-subgroup"
            >
              <Edit className="h-3.5 w-3.5 mr-1" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setSubGroupToDelete(activeSubGroup)}
              data-testid="button-delete-active-subgroup"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Delete
            </Button>
          </div>
        </div>

        {/* Member Search & Add Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search members in this sub group..."
              value={memberSearchQuery}
              onChange={(e) => setMemberSearchQuery(e.target.value)}
              className="pl-9 h-9"
              data-testid="input-search-subgroup-view-members"
            />
          </div>

          <Button
            onClick={() => setIsAddMembersOpen(true)}
            size="sm"
            data-testid="button-add-members-to-active-subgroup"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Members
          </Button>
        </div>

        {/* Member Roster */}
        {filteredActiveMembers.length > 0 ? (
          <div className="space-y-2.5">
            {filteredActiveMembers.map((member) => (
              <Card
                key={member.id}
                className="p-4 hover-elevate transition-all flex items-center justify-between gap-4"
                data-testid={`card-subgroup-member-${member.id}`}
              >
                <Link
                  href={`/person/${member.id}?from=group&groupId=${groupId}`}
                  className="flex items-center gap-3.5 flex-1 min-w-0"
                >
                  <Avatar className="w-10 h-10">
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
                      className="font-medium text-base hover:underline cursor-pointer truncate"
                      data-testid={`text-member-name-${member.id}`}
                    >
                      {member.firstName} {member.lastName}
                    </h3>
                    {(member.company || member.title) && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                        {member.title && <span>{member.title}</span>}
                        {member.title && member.company && <span>•</span>}
                        {member.company && <span>{member.company}</span>}
                      </div>
                    )}
                  </div>
                </Link>

                <div className="flex items-center gap-3">
                  {member.phone && (
                    <span className="hidden md:flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {member.phone}
                    </span>
                  )}
                  {member.email && (
                    <a
                      href={`mailto:${member.email}`}
                      className="hidden md:flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                    >
                      <Mail className="h-3 w-3" />
                      {member.email}
                    </a>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      removeMemberMutation.mutate({
                        subGroupId: activeSubGroup.id,
                        personId: member.id,
                      })
                    }
                    disabled={removeMemberMutation.isPending}
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    title="Remove from sub group"
                    data-testid={`button-remove-subgroup-member-${member.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center border rounded-lg border-dashed">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
              <Users className="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-1">
              {activeSubGroupMembers.length === 0
                ? "No members in this sub group"
                : "No members match your search"}
            </h3>
            <p className="text-sm text-muted-foreground mb-5 max-w-sm">
              {activeSubGroupMembers.length === 0
                ? "Assign people from the group to this sub group."
                : "Try searching with a different name, title, or email."}
            </p>
            {activeSubGroupMembers.length === 0 && (
              <Button
                onClick={() => setIsAddMembersOpen(true)}
                data-testid="button-add-members-empty"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add Members
              </Button>
            )}
          </div>
        )}

        {/* Edit Sub Group Dialog */}
        {subGroupToEdit && (
          <SubGroupDialog
            open={!!subGroupToEdit}
            onOpenChange={(open) => !open && setSubGroupToEdit(null)}
            groupId={groupId}
            subGroup={subGroupToEdit}
            parentGroupMembers={parentGroupMembers}
          />
        )}

        {/* Add Members to Sub Group Dialog */}
        <AddSubGroupMembersModal
          open={isAddMembersOpen}
          onOpenChange={setIsAddMembersOpen}
          currentMemberIds={activeSubGroup.members || []}
          parentGroupMembers={parentGroupMembers}
          onAddMembers={(ids) =>
            addMembersMutation.mutate({
              subGroupId: activeSubGroup.id,
              newMemberIds: ids,
            })
          }
          isPending={addMembersMutation.isPending}
        />

        {/* Delete Confirmation */}
        <AlertDialog
          open={!!subGroupToDelete}
          onOpenChange={(open) => !open && setSubGroupToDelete(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Sub Group</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{subGroupToDelete?.name}"? Members will remain in the group.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete-subgroup">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (subGroupToDelete) {
                    deleteMutation.mutate(subGroupToDelete.id);
                  }
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="button-confirm-delete-subgroup"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // Otherwise, render the list/grid of all sub groups inside the tab
  return (
    <>
      <div className="p-6">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-semibold">Sub Groups</h2>
            <p className="text-sm text-muted-foreground">
              Cohorts and teams organized within this group
            </p>
          </div>
          <Button
            onClick={() => setIsAddOpen(true)}
            size="sm"
            data-testid="button-add-subgroup"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Sub Group
          </Button>
        </div>

        {subGroups.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {subGroups.map((subGroup) => {
              const memberCount = subGroup.members?.length || 0;
              const previewMembers = (subGroup.members || [])
                .map((id) => memberMap.get(id))
                .filter(Boolean) as Person[];

              return (
                <Card
                  key={subGroup.id}
                  className="p-5 hover-elevate transition-all flex flex-col justify-between cursor-pointer"
                  style={{ borderLeftWidth: "4px", borderLeftColor: subGroup.color }}
                  onClick={() => handleSelectSubGroup(subGroup.id)}
                  data-testid={`card-subgroup-${subGroup.id}`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                          style={{ backgroundColor: subGroup.color }}
                          data-testid={`color-indicator-subgroup-${subGroup.id}`}
                        />
                        <h3
                          className="font-semibold text-base hover:underline truncate"
                          data-testid={`text-subgroup-name-${subGroup.id}`}
                        >
                          {subGroup.name}
                        </h3>
                      </div>

                      <div
                        className="flex items-center gap-1 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => setSubGroupToEdit(subGroup)}
                          data-testid={`button-edit-subgroup-${subGroup.id}`}
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setSubGroupToDelete(subGroup)}
                          data-testid={`button-delete-subgroup-${subGroup.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                      <Badge variant="secondary" className="text-xs font-normal">
                        <Users className="h-3 w-3 mr-1 inline" />
                        {memberCount} member{memberCount !== 1 ? "s" : ""}
                      </Badge>
                    </div>

                    {previewMembers.length > 0 && (
                      <div className="flex items-center -space-x-2 overflow-hidden mb-4 py-1">
                        {previewMembers.slice(0, 5).map((p) => (
                          <Avatar
                            key={p.id}
                            className="w-7 h-7 border-2 border-background ring-1 ring-border"
                          >
                            {p.imageUrl && (
                              <AvatarImage
                                src={p.imageUrl}
                                alt={`${p.firstName} ${p.lastName}`}
                              />
                            )}
                            <AvatarFallback className="text-[10px]">
                              {getInitials(p.firstName, p.lastName)}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {memberCount > 5 && (
                          <span className="flex items-center justify-center w-7 h-7 text-[10px] font-medium bg-muted border-2 border-background rounded-full">
                            +{memberCount - 5}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t mt-2 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7 gap-1 hover:text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectSubGroup(subGroup.id);
                      }}
                      data-testid={`button-view-subgroup-${subGroup.id}`}
                    >
                      View Sub Group
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center border rounded-lg border-dashed">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
              <Users className="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-1">No sub groups yet</h3>
            <p className="text-sm text-muted-foreground mb-5 max-w-sm">
              Break down this group into smaller teams, committees, or project cohorts.
            </p>
            <Button
              onClick={() => setIsAddOpen(true)}
              data-testid="button-add-subgroup-empty"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Sub Group
            </Button>
          </div>
        )}
      </div>

      <SubGroupDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        groupId={groupId}
        parentGroupMembers={parentGroupMembers}
      />

      {subGroupToEdit && (
        <SubGroupDialog
          open={!!subGroupToEdit}
          onOpenChange={(open) => !open && setSubGroupToEdit(null)}
          groupId={groupId}
          subGroup={subGroupToEdit}
          parentGroupMembers={parentGroupMembers}
        />
      )}

      <AlertDialog
        open={!!subGroupToDelete}
        onOpenChange={(open) => !open && setSubGroupToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Sub Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{subGroupToDelete?.name}"? Members will remain in the parent group. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-subgroup">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (subGroupToDelete) {
                  deleteMutation.mutate(subGroupToDelete.id);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-subgroup"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface AddSubGroupMembersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentMemberIds: string[];
  parentGroupMembers: Person[];
  onAddMembers: (memberIds: string[]) => void;
  isPending: boolean;
}

function AddSubGroupMembersModal({
  open,
  onOpenChange,
  currentMemberIds,
  parentGroupMembers,
  onAddMembers,
  isPending,
}: AddSubGroupMembersModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: allPeople = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
    enabled: open && parentGroupMembers.length === 0,
  });

  const candidatePeople = parentGroupMembers.length > 0 ? parentGroupMembers : allPeople;
  const availablePeople = candidatePeople.filter((p) => !currentMemberIds.includes(p.id));

  const filteredPeople = availablePeople.filter((person) => {
    const query = searchQuery.toLowerCase();
    return (
      person.firstName.toLowerCase().includes(query) ||
      person.lastName.toLowerCase().includes(query) ||
      person.email?.toLowerCase().includes(query) ||
      person.company?.toLowerCase().includes(query)
    );
  });

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSubmit = () => {
    if (selectedIds.length > 0) {
      onAddMembers(selectedIds);
      setSelectedIds([]);
      setSearchQuery("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Members to Sub Group</DialogTitle>
          <DialogDescription>
            Select people from this group to assign ({selectedIds.length} selected)
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search people..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-add-subgroup-modal-members"
          />
        </div>

        <ScrollArea className="h-72 border rounded-md p-2">
          <div className="space-y-1.5">
            {filteredPeople.map((person) => {
              const isSelected = selectedIds.includes(person.id);
              return (
                <div
                  key={person.id}
                  onClick={() => toggleSelection(person.id)}
                  className={`flex items-center gap-3 p-2 rounded-md cursor-pointer hover:bg-muted/60 transition-colors ${
                    isSelected ? "bg-primary/10 font-medium" : ""
                  }`}
                  data-testid={`option-add-subgroup-modal-member-${person.id}`}
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
                    <p className="text-sm">
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
                All group members are already in this sub group
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
            data-testid="button-cancel-add-subgroup-modal"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || selectedIds.length === 0}
            className="flex-1"
            data-testid="button-confirm-add-subgroup-modal"
          >
            {isPending
              ? "Adding..."
              : `Add ${selectedIds.length} Member${selectedIds.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
