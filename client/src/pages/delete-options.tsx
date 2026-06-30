import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, Trash2, Users, Network } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

export default function DeleteOptionsPage() {
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [confirmSliderValue, setConfirmSliderValue] = useState([0]);
  const [includeExamples, setIncludeExamples] = useState(false);

  const [isDeleteSocialsDialogOpen, setIsDeleteSocialsDialogOpen] = useState(false);
  const [confirmDeleteSocials, setConfirmDeleteSocials] = useState(false);

  const [isDeleteFamilyDialogOpen, setIsDeleteFamilyDialogOpen] = useState(false);
  const [confirmDeleteFamily, setConfirmDeleteFamily] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const resetDatabaseMutation = useMutation({
    mutationFn: async ({ includeExamples }: { includeExamples: boolean }) => {
      const response = await fetch("/api/reset-database", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ includeExamples }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to reset database");
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Database Reset Complete",
        description: "Your database has been reset successfully. You can now create a new account.",
      });

      setIsResetDialogOpen(false);
      setConfirmSliderValue([0]);
      setIncludeExamples(false);

      queryClient.invalidateQueries();

      setTimeout(() => {
        navigate("/welcome");
      }, 500);
    },
    onError: (error: Error) => {
      toast({
        title: "Reset Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteAllSocialAccountsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/social-accounts/delete-all", {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete social accounts");
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Social Accounts Deleted",
        description: `Successfully deleted ${data.deleted} social accounts.`,
      });

      setIsDeleteSocialsDialogOpen(false);
      setConfirmDeleteSocials(false);

      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleResetDatabase = () => {
    if (confirmSliderValue[0] === 100) {
      resetDatabaseMutation.mutate({ includeExamples });
    }
  };

  const handleDeleteAllSocialAccounts = () => {
    if (confirmDeleteSocials) {
      deleteAllSocialAccountsMutation.mutate();
    }
  };

  const deleteAllFamilyRelationshipsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/relationships/family", {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete family relationships");
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Family Relationships Deleted",
        description: `Successfully deleted ${data.deleted} family relationships.`,
      });

      setIsDeleteFamilyDialogOpen(false);
      setConfirmDeleteFamily(false);

      queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDeleteAllFamilyRelationships = () => {
    if (confirmDeleteFamily) {
      deleteAllFamilyRelationshipsMutation.mutate();
    }
  };

  const removeDuplicatesMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/social-accounts/remove-duplicates", {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to remove duplicate social accounts");
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Duplicate accounts cleaned",
        description: `Successfully removed ${data.deleted} duplicate social accounts.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Cleanup Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRemoveDuplicates = () => {
    removeDuplicatesMutation.mutate();
  };

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Delete Options</h1>
        <p className="text-muted-foreground">Manage destructive operations for your data</p>
      </div>

      <div className="space-y-6">
        {/* Card 1: Data Maintenance */}
        <Card className="border-orange-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-500 font-semibold text-lg">
              <Users className="h-5 w-5" />
              Data Maintenance
            </CardTitle>
            <CardDescription>
              Scan, clean, and optimize your database records
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-md border bg-card">
              <div className="space-y-1">
                <h4 className="font-semibold text-sm">Remove Duplicate Social Accounts</h4>
                <p className="text-xs text-muted-foreground max-w-md">
                  Merges profiles sharing the platform and username. Keeps the oldest account, updates contacts, and merges posts/history.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={handleRemoveDuplicates}
                disabled={removeDuplicatesMutation.isPending}
                className="border-orange-500/50 hover:bg-orange-500/10 hover:text-orange-500 shrink-0 self-start sm:self-center gap-2"
                data-testid="button-remove-duplicate-social-accounts"
              >
                {removeDuplicatesMutation.isPending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 text-orange-500" />
                    Remove Duplicates
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Danger Zone */}
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive font-semibold text-lg">
              <Trash2 className="h-5 w-5" />
              Danger Zone
            </CardTitle>
            <CardDescription className="text-destructive/80">
              Irreversible and highly destructive operations. Proceed with absolute caution.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            
            {/* Row 1: Remove All Social Accounts */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-md border border-destructive/10 bg-destructive/5">
              <div className="space-y-1">
                <h4 className="font-semibold text-sm text-destructive">Remove All Social Accounts</h4>
                <p className="text-xs text-muted-foreground max-w-md">
                  Permanently deletes all social profiles, social posts, follow relations, and linked contacts.
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => setIsDeleteSocialsDialogOpen(true)}
                className="shrink-0 self-start sm:self-center gap-2"
                data-testid="button-delete-all-social-accounts-trigger"
              >
                <Trash2 className="h-4 w-4" />
                Remove Social Accounts...
              </Button>
            </div>

            {/* Row 2: Remove All Family Relationships */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-md border border-destructive/10 bg-destructive/5">
              <div className="space-y-1">
                <h4 className="font-semibold text-sm text-destructive">Remove All Family Relationships</h4>
                <p className="text-xs text-muted-foreground max-w-md">
                  Permanently deletes all family tree associations. Custom categories (e.g. Friends, Colleagues) are unaffected.
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => setIsDeleteFamilyDialogOpen(true)}
                className="shrink-0 self-start sm:self-center gap-2"
                data-testid="button-delete-all-family-relationships-trigger"
              >
                <Network className="h-4 w-4" />
                Remove Family...
              </Button>
            </div>

            {/* Row 3: Reset Database */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-md border border-destructive/10 bg-destructive/5">
              <div className="space-y-1">
                <h4 className="font-semibold text-sm text-destructive">Reset Database</h4>
                <p className="text-xs text-muted-foreground max-w-md">
                  Removes all tables and reinstalls a fresh copy. Optionally seed mockup records for testing.
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => setIsResetDialogOpen(true)}
                className="shrink-0 self-start sm:self-center gap-2"
                data-testid="button-reset-database-trigger"
              >
                <AlertCircle className="h-4 w-4" />
                Reset Database...
              </Button>
            </div>

          </CardContent>
        </Card>
      </div>

      {/* Dialog: Delete Social Accounts */}
      <Dialog open={isDeleteSocialsDialogOpen} onOpenChange={(open) => {
        setIsDeleteSocialsDialogOpen(open);
        if (!open) setConfirmDeleteSocials(false);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Confirm Social Accounts Deletion
            </DialogTitle>
            <DialogDescription>
              This will permanently delete all social accounts from the database.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
              <p className="font-semibold mb-2">Warning: This action cannot be undone</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>All social accounts will be permanently deleted</li>
                <li>Follower and following relationships will be lost</li>
                <li>Links to people will be removed</li>
              </ul>
            </div>

            <div className="flex items-center justify-between rounded-md border p-4">
              <Label htmlFor="confirm-delete-socials" className="text-sm font-medium pr-4 leading-normal">
                I understand that this action is irreversible and wish to proceed
              </Label>
              <Switch
                id="confirm-delete-socials"
                checked={confirmDeleteSocials}
                onCheckedChange={setConfirmDeleteSocials}
                data-testid="switch-confirm-1"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDeleteSocialsDialogOpen(false);
                setConfirmDeleteSocials(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAllSocialAccounts}
              disabled={!confirmDeleteSocials || deleteAllSocialAccountsMutation.isPending}
              data-testid="button-delete-all-social-accounts"
            >
              {deleteAllSocialAccountsMutation.isPending ? "Deleting..." : "Delete All Social Accounts"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Delete Family Relationships */}
      <Dialog open={isDeleteFamilyDialogOpen} onOpenChange={(open) => {
        setIsDeleteFamilyDialogOpen(open);
        if (!open) setConfirmDeleteFamily(false);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Confirm Family Relationships Deletion
            </DialogTitle>
            <DialogDescription>
              This will permanently delete all family tree relationships from the database.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
              <p className="font-semibold mb-2">Warning: This action cannot be undone</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>All family-type relationships (spouse, sibling, parent, etc.) will be permanently deleted</li>
                <li>Custom relationship categories (e.g. Friends) will be unaffected</li>
                <li>Family propagation structure will be cleared</li>
              </ul>
            </div>

            <div className="flex items-center justify-between rounded-md border p-4">
              <Label htmlFor="confirm-delete-family" className="text-sm font-medium pr-4 leading-normal">
                I understand that this action is irreversible and wish to proceed
              </Label>
              <Switch
                id="confirm-delete-family"
                checked={confirmDeleteFamily}
                onCheckedChange={setConfirmDeleteFamily}
                data-testid="switch-confirm-family-1"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDeleteFamilyDialogOpen(false);
                setConfirmDeleteFamily(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAllFamilyRelationships}
              disabled={!confirmDeleteFamily || deleteAllFamilyRelationshipsMutation.isPending}
              data-testid="button-delete-all-family-relationships"
            >
              {deleteAllFamilyRelationshipsMutation.isPending ? "Deleting..." : "Delete Family Relationships"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Reset Database */}
      <Dialog open={isResetDialogOpen} onOpenChange={(open) => {
        setIsResetDialogOpen(open);
        if (!open) {
          setConfirmSliderValue([0]);
          setIncludeExamples(false);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Confirm Database Reset
            </DialogTitle>
            <DialogDescription>
              This will permanently delete all your data and recreate all tables.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
              <p className="font-semibold mb-2">Warning: This action cannot be undone</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>All tables will be dropped and recreated fresh</li>
                <li>All contacts, groups, interactions, and images will be lost</li>
                <li>A new "Me" user record will be initialized</li>
              </ul>
            </div>

            <div className="flex items-center justify-between rounded-md border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="include-examples" className="text-sm font-semibold">
                  Add Example Data
                </Label>
                <p className="text-xs text-muted-foreground">
                  Include 6 mock people and 2 groups
                </p>
              </div>
              <Switch
                id="include-examples"
                checked={includeExamples}
                onCheckedChange={setIncludeExamples}
                data-testid="switch-include-examples"
              />
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  Slide to confirm reset
                </Label>
                <span className="text-xs text-muted-foreground">
                  {confirmSliderValue[0]}%
                </span>
              </div>
              <div className="relative">
                <Slider
                  value={confirmSliderValue}
                  onValueChange={setConfirmSliderValue}
                  max={100}
                  step={1}
                  className="w-full"
                  data-testid="slider-confirm-reset"
                />
                <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                  <span>Cancel</span>
                  <span>Confirm Reset</span>
                </div>
              </div>
            </div>

            {confirmSliderValue[0] === 100 && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3">
                <AlertCircle className="h-4 w-4" />
                <span>Ready to reset. Click the button below to proceed.</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsResetDialogOpen(false);
                setConfirmSliderValue([0]);
                setIncludeExamples(false);
              }}
              data-testid="button-cancel-reset"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleResetDatabase}
              disabled={confirmSliderValue[0] !== 100 || resetDatabaseMutation.isPending}
              data-testid="button-confirm-reset"
            >
              {resetDatabaseMutation.isPending ? "Resetting..." : "Reset Database"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

