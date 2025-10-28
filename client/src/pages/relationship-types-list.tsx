import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { RelationshipType } from "@shared/schema";

export default function RelationshipTypesList() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<RelationshipType | null>(null);
  const [typeToDelete, setTypeToDelete] = useState<RelationshipType | null>(null);
  const [editedName, setEditedName] = useState("");
  const [editedNotes, setEditedNotes] = useState("");
  const [editedColor, setEditedColor] = useState("");
  const [editedValue, setEditedValue] = useState(50);
  const { toast } = useToast();

  const { data: relationshipTypes, isLoading } = useQuery<RelationshipType[]>({
    queryKey: ["/api/relationship-types"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; color: string; value: number; notes: string }) => {
      return apiRequest("POST", "/api/relationship-types", data);
    },
    onSuccess: () => {
      setIsCreateDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/relationship-types"] });
      toast({
        title: "Relationship type created",
        description: "The new relationship type has been added.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create relationship type",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<{ name: string; color: string; value: number; notes: string }> }) => {
      return apiRequest("PATCH", `/api/relationship-types/${id}`, data);
    },
    onSuccess: () => {
      setEditingType(null);
      queryClient.invalidateQueries({ queryKey: ["/api/relationship-types"] });
      toast({
        title: "Relationship type updated",
        description: "The relationship type has been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update relationship type",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (typeId: string) => {
      return apiRequest("DELETE", `/api/relationship-types/${typeId}`);
    },
    onSuccess: () => {
      setTypeToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["/api/relationship-types"] });
      toast({
        title: "Relationship type deleted",
        description: "The relationship type has been removed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete relationship type",
        variant: "destructive",
      });
    },
  });

  const handleSaveEdit = () => {
    if (!editingType) return;
    updateMutation.mutate({
      id: editingType.id,
      data: {
        name: editedName,
        notes: editedNotes,
        color: editedColor,
        value: editedValue,
      },
    });
  };

  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeNotes, setNewTypeNotes] = useState("");
  const [newTypeColor, setNewTypeColor] = useState("#3b82f6");
  const [newTypeValue, setNewTypeValue] = useState(50);

  const handleCreateType = () => {
    if (!newTypeName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a name for the relationship type",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      name: newTypeName,
      color: newTypeColor,
      value: newTypeValue,
      notes: newTypeNotes,
    });
    setNewTypeName("");
    setNewTypeNotes("");
    setNewTypeColor("#3b82f6");
    setNewTypeValue(50);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h1 className="text-3xl font-semibold" data-testid="text-page-title">
            Relationship Types
          </h1>
          <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-add-type">
            <Plus className="h-4 w-4" />
            Add Type
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-4 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-1/3" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : relationshipTypes && relationshipTypes.length > 0 ? (
          <div className="space-y-3">
            {relationshipTypes.map((type) => (
              <Card
                key={type.id}
                className="p-4 hover-elevate transition-all"
                data-testid={`card-type-${type.id}`}
              >
                <div className="flex items-center gap-4">
                  <button
                    className="w-8 h-8 rounded-full flex-shrink-0 border-2 border-border cursor-pointer hover-elevate"
                    style={{ backgroundColor: type.color }}
                    onClick={() => {
                      setEditingType(type);
                      setEditedName(type.name);
                      setEditedNotes(type.notes || "");
                      setEditedColor(type.color);
                      setEditedValue(type.value);
                    }}
                    data-testid={`button-color-${type.id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <button
                      className="text-lg font-medium text-left hover:text-primary transition-colors"
                      onClick={() => {
                        setEditingType(type);
                        setEditedName(type.name);
                        setEditedNotes(type.notes || "");
                        setEditedColor(type.color);
                      }}
                      data-testid={`button-name-${type.id}`}
                    >
                      {type.name}
                    </button>
                    {type.notes && (
                      <button
                        className="text-sm text-muted-foreground mt-1 block text-left hover:text-foreground transition-colors"
                        onClick={() => {
                          setEditingType(type);
                          setEditedName(type.name);
                          setEditedNotes(type.notes || "");
                          setEditedColor(type.color);
                        }}
                        data-testid={`button-notes-${type.id}`}
                      >
                        {type.notes}
                      </button>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setTypeToDelete(type)}
                    data-testid={`button-delete-${type.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Plus className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">No relationship types yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              Get started by creating your first relationship type
            </p>
            <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-add-type-empty">
              <Plus className="h-4 w-4" />
              Add Type
            </Button>
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Relationship Type</DialogTitle>
            <DialogDescription>
              Add a new relationship type with a name, color, and optional notes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                placeholder="e.g., Friend, Colleague, Family"
                data-testid="input-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="color">Color</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="color"
                  type="color"
                  value={newTypeColor}
                  onChange={(e) => setNewTypeColor(e.target.value)}
                  className="w-20 h-10 p-1"
                  data-testid="input-color"
                />
                <Input
                  type="text"
                  value={newTypeColor}
                  onChange={(e) => setNewTypeColor(e.target.value)}
                  placeholder="#3b82f6"
                  className="flex-1"
                  data-testid="input-color-text"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="value">Value (1-255)</Label>
              <Input
                id="value"
                type="number"
                min="1"
                max="255"
                value={newTypeValue}
                onChange={(e) => setNewTypeValue(parseInt(e.target.value) || 50)}
                placeholder="50"
                data-testid="input-value"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                value={newTypeNotes}
                onChange={(e) => setNewTypeNotes(e.target.value)}
                placeholder="Additional notes about this relationship type..."
                rows={3}
                data-testid="textarea-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)} data-testid="button-cancel-create">
              Cancel
            </Button>
            <Button onClick={handleCreateType} disabled={createMutation.isPending} data-testid="button-save-create">
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingType} onOpenChange={(open) => !open && setEditingType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Relationship Type</DialogTitle>
            <DialogDescription>
              Update the name, color, or notes for this relationship type.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                data-testid="input-edit-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-color">Color</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="edit-color"
                  type="color"
                  value={editedColor}
                  onChange={(e) => setEditedColor(e.target.value)}
                  className="w-20 h-10 p-1"
                  data-testid="input-edit-color"
                />
                <Input
                  type="text"
                  value={editedColor}
                  onChange={(e) => setEditedColor(e.target.value)}
                  className="flex-1"
                  data-testid="input-edit-color-text"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-value">Value (1-255)</Label>
              <Input
                id="edit-value"
                type="number"
                min="1"
                max="255"
                value={editedValue}
                onChange={(e) => setEditedValue(parseInt(e.target.value) || 50)}
                data-testid="input-edit-value"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea
                id="edit-notes"
                value={editedNotes}
                onChange={(e) => setEditedNotes(e.target.value)}
                rows={3}
                data-testid="textarea-edit-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingType(null)} data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={updateMutation.isPending} data-testid="button-save-edit">
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!typeToDelete} onOpenChange={(open) => !open && setTypeToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Relationship Type</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{typeToDelete?.name}"? Existing relationships using this type will have their type reference removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (typeToDelete) {
                  deleteMutation.mutate(typeToDelete.id);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
