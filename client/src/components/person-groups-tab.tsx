import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, X, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Group } from "@shared/schema";
import { Link } from "wouter";

interface PersonGroupsTabProps {
  personId: string;
  personGroups: Group[];
}

export function PersonGroupsTab({ personId, personGroups }: PersonGroupsTabProps) {
  const { toast } = useToast();
  const [isAddToGroupOpen, setIsAddToGroupOpen] = useState(false);

  const { data: allGroups = [] } = useQuery<Group[]>({
    queryKey: ["/api/groups"],
  });

  const personGroupIds = personGroups.map((g) => g.id);
  const availableGroups = allGroups.filter((g) => !personGroupIds.includes(g.id));

  const removeFromGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const group = allGroups.find((g) => g.id === groupId);
      if (!group) throw new Error("Group not found");
      
      const updatedMembers = (group.members || []).filter((id) => id !== personId);
      return await apiRequest("PATCH", `/api/groups/${groupId}`, {
        members: updatedMembers,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", personId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({
        title: "Success",
        description: "Removed from group successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove from group",
        variant: "destructive",
      });
    },
  });

  const addToGroupsMutation = useMutation({
    mutationFn: async (groupIds: string[]) => {
      const promises = groupIds.map(async (groupId) => {
        const group = allGroups.find((g) => g.id === groupId);
        if (!group) throw new Error("Group not found");
        
        const updatedMembers = [...(group.members || []), personId];
        return await apiRequest("PATCH", `/api/groups/${groupId}`, {
          members: updatedMembers,
        });
      });
      
      return await Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", personId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({
        title: "Success",
        description: "Added to groups successfully",
      });
      setIsAddToGroupOpen(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add to groups",
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Groups</h2>
          <Button onClick={() => setIsAddToGroupOpen(true)} size="sm" data-testid="button-add-to-groups">
            <Plus className="h-4 w-4" />
            Add to Group
          </Button>
        </div>

        {personGroups.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {personGroups.map((group) => (
              <Card
                key={group.id}
                className="p-4 hover-elevate"
                data-testid={`card-group-${group.id}`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <Link href={`/group/${group.id}`}>
                    <div className="flex items-center gap-3 cursor-pointer">
                      <div
                        className="w-10 h-10 rounded-md flex items-center justify-center"
                        style={{ backgroundColor: group.color }}
                      >
                        <Users className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium truncate hover:underline">{group.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {group.members?.length || 0} member{group.members?.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFromGroupMutation.mutate(group.id)}
                    disabled={removeFromGroupMutation.isPending}
                    className="h-8 text-destructive hover:text-destructive"
                    data-testid={`button-remove-from-group-${group.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {group.type && group.type.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {group.type.map((t, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">Not in any groups</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              Add this person to groups to organize your contacts
            </p>
            <Button onClick={() => setIsAddToGroupOpen(true)} data-testid="button-add-to-groups-empty">
              <Plus className="h-4 w-4" />
              Add to Group
            </Button>
          </div>
        )}
      </div>

      <AddToGroupsDialog
        open={isAddToGroupOpen}
        onOpenChange={setIsAddToGroupOpen}
        availableGroups={availableGroups}
        onAddToGroups={(ids) => addToGroupsMutation.mutate(ids)}
        isPending={addToGroupsMutation.isPending}
      />
    </>
  );
}

interface AddToGroupsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableGroups: Group[];
  onAddToGroups: (groupIds: string[]) => void;
  isPending: boolean;
}

function AddToGroupsDialog({
  open,
  onOpenChange,
  availableGroups,
  onAddToGroups,
  isPending,
}: AddToGroupsDialogProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const handleSubmit = () => {
    if (selectedIds.length > 0) {
      onAddToGroups(selectedIds);
      setSelectedIds([]);
      setSearchQuery("");
    }
  };

  const toggleSelection = (groupId: string) => {
    setSelectedIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  // Filter available groups based on search query
  const filteredGroups = availableGroups.filter((group) => {
    const query = searchQuery.toLowerCase();
    return (
      group.name.toLowerCase().includes(query) ||
      group.type?.some((t) => t.toLowerCase().includes(query))
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to Groups</DialogTitle>
          <DialogDescription>
            Select groups to add this person to ({selectedIds.length} selected)
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search groups by name or type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-groups"
          />
        </div>

        <ScrollArea className="h-96 border rounded-md p-3">
          <div className="space-y-2">
            {filteredGroups.map((group) => {
              const isSelected = selectedIds.includes(group.id);
              return (
                <div
                  key={group.id}
                  onClick={() => toggleSelection(group.id)}
                  className={`flex items-center gap-3 p-2 rounded-md cursor-pointer hover-elevate ${
                    isSelected ? "bg-primary/10" : ""
                  }`}
                  data-testid={`add-to-group-option-${group.id}`}
                >
                  <div
                    className="w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: group.color }}
                  >
                    <Users className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{group.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {group.members?.length || 0} member{group.members?.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {isSelected && (
                    <Badge variant="default" className="text-xs">
                      Selected
                    </Badge>
                  )}
                </div>
              );
            })}
            {availableGroups.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                This person is already in all groups
              </p>
            )}
            {availableGroups.length > 0 && filteredGroups.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No groups found matching "{searchQuery}"
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
              setSearchQuery("");
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
            {isPending ? "Adding..." : `Add to ${selectedIds.length} Group${selectedIds.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
