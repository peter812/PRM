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
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SocialAccountType } from "@shared/schema";

export default function SocialAccountTypesList() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<SocialAccountType | null>(null);
  const [typeToDelete, setTypeToDelete] = useState<SocialAccountType | null>(null);
  const [editedName, setEditedName] = useState("");
  const [editedColor, setEditedColor] = useState("");
  const { toast } = useToast();

  const { data: socialAccountTypes, isLoading } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; color: string }) => {
      return apiRequest("POST", "/api/social-account-types", data);
    },
    onSuccess: () => {
      setIsCreateDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/social-account-types"] });
      toast({
        title: "Social account type created",
        description: "The new social account type has been added.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create social account type",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<{ name: string; color: string }> }) => {
      return apiRequest("PATCH", `/api/social-account-types/${id}`, data);
    },
    onSuccess: () => {
      setEditingType(null);
      queryClient.invalidateQueries({ queryKey: ["/api/social-account-types"] });
      toast({
        title: "Social account type updated",
        description: "The social account type has been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update social account type",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (typeId: string) => {
      return apiRequest("DELETE", `/api/social-account-types/${typeId}`);
    },
    onSuccess: () => {
      setTypeToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["/api/social-account-types"] });
      toast({
        title: "Social account type deleted",
        description: "The social account type has been removed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete social account type",
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
        color: editedColor,
      },
    });
  };

  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeColor, setNewTypeColor] = useState("#3b82f6");

  const handleCreateType = () => {
    if (!newTypeName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a name for the social account type",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      name: newTypeName,
      color: newTypeColor,
    });
    setNewTypeName("");
    setNewTypeColor("#3b82f6");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-3 md:px-6 py-2 md:py-4">
        <div className="flex items-center justify-between gap-2 md:gap-4 mb-2 md:mb-4">
          <h1 className="text-3xl font-semibold" data-testid="text-page-title">
            Social Account Types
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
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : socialAccountTypes && socialAccountTypes.length > 0 ? (
          <div className="space-y-3">
            {socialAccountTypes.map((type) => (
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
                      setEditedColor(type.color);
                    }}
                    data-testid={`button-color-${type.id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <button
                      className="text-lg font-medium text-left hover:text-primary transition-colors"
                      onClick={() => {
                        setEditingType(type);
                        setEditedName(type.name);
                        setEditedColor(type.color);
                      }}
                      data-testid={`button-name-${type.id}`}
                    >
                      {type.name}
                    </button>
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
            <h3 className="text-lg font-medium mb-2">No social account types yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              Get started by creating your first social account type
            </p>
            <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-add-type-empty">
              <Plus className="h-4 w-4" />
              Add Type
            </Button>
          </div>
        )}
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Social Account Type</DialogTitle>
            <DialogDescription>
              Add a new social account type with a name and color.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                placeholder="e.g., Instagram, Twitter, TikTok"
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

      <Dialog open={!!editingType} onOpenChange={(open) => !open && setEditingType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Social Account Type</DialogTitle>
            <DialogDescription>
              Update the name or color for this social account type.
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

      <AlertDialog open={!!typeToDelete} onOpenChange={(open) => !open && setTypeToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Social Account Type</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{typeToDelete?.name}"? Social accounts using this type will have their type reference removed. This action cannot be undone.
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
