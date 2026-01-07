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
import { AlertCircle, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

export default function DeleteOptionsPage() {
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [confirmSliderValue, setConfirmSliderValue] = useState([0]);
  const [includeExamples, setIncludeExamples] = useState(false);
  const [confirmSwitch1, setConfirmSwitch1] = useState(false);
  const [confirmSwitch2, setConfirmSwitch2] = useState(false);
  const [confirmSwitch3, setConfirmSwitch3] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const allSwitchesOn = confirmSwitch1 && confirmSwitch2 && confirmSwitch3;

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

      setConfirmSwitch1(false);
      setConfirmSwitch2(false);
      setConfirmSwitch3(false);

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
    if (allSwitchesOn) {
      deleteAllSocialAccountsMutation.mutate();
    }
  };

  return (
    <div className="container max-w-2xl py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Delete Options</h1>
        <p className="text-muted-foreground">Manage destructive operations for your data</p>
      </div>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Users className="h-5 w-5" />
            Remove All Social Accounts
          </CardTitle>
          <CardDescription>Permanently delete all social accounts from the database</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />
              <div className="space-y-1 text-sm">
                <p className="font-medium text-destructive">Warning: This action cannot be undone</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>All social accounts will be permanently deleted</li>
                  <li>Follower and following relationships will be lost</li>
                  <li>Links to people will be removed</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm font-medium">Confirm by enabling all three switches:</p>
            
            <div className="flex items-center justify-between rounded-md border p-4">
              <Label htmlFor="confirm-switch-1" className="text-sm">
                I understand I am about to delete all social accounts
              </Label>
              <Switch
                id="confirm-switch-1"
                checked={confirmSwitch1}
                onCheckedChange={setConfirmSwitch1}
                data-testid="switch-confirm-1"
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-4">
              <Label htmlFor="confirm-switch-2" className="text-sm">
                I understand I am about to delete all social accounts
              </Label>
              <Switch
                id="confirm-switch-2"
                checked={confirmSwitch2}
                onCheckedChange={setConfirmSwitch2}
                data-testid="switch-confirm-2"
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-4">
              <Label htmlFor="confirm-switch-3" className="text-sm">
                I understand I am about to delete all social accounts
              </Label>
              <Switch
                id="confirm-switch-3"
                checked={confirmSwitch3}
                onCheckedChange={setConfirmSwitch3}
                data-testid="switch-confirm-3"
              />
            </div>
          </div>

          <Button
            variant="destructive"
            onClick={handleDeleteAllSocialAccounts}
            disabled={!allSwitchesOn || deleteAllSocialAccountsMutation.isPending}
            className="gap-2"
            data-testid="button-delete-all-social-accounts"
          >
            {deleteAllSocialAccountsMutation.isPending ? (
              <>
                <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Remove All Social Accounts
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card className="mt-6 border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Reset Database</CardTitle>
          <CardDescription>Remove all tables from database and reinstall</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />
              <div className="space-y-1 text-sm">
                <p className="font-medium text-destructive">Warning: This action cannot be undone</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>All existing data will be permanently deleted</li>
                  <li>All tables will be dropped and recreated</li>
                  <li>Default relationship and interaction types will be restored</li>
                  <li>A new "Me" person entry will be created for your user account</li>
                  <li>Optionally add example people and groups for testing</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="include-examples" className="text-base font-medium">
                Add Example Data
              </Label>
              <p className="text-sm text-muted-foreground">
                Include 6 example people and 2 groups in the reset
              </p>
            </div>
            <Switch
              id="include-examples"
              checked={includeExamples}
              onCheckedChange={setIncludeExamples}
              data-testid="switch-include-examples"
            />
          </div>

          <Button
            variant="destructive"
            onClick={() => setIsResetDialogOpen(true)}
            className="gap-2"
            data-testid="button-reset-database"
          >
            <Trash2 className="h-4 w-4" />
            Reset Database
          </Button>
        </CardContent>
      </Card>

      <Dialog open={isResetDialogOpen} onOpenChange={(open) => {
        setIsResetDialogOpen(open);
        if (!open) {
          setConfirmSliderValue([0]);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Confirm Database Reset</DialogTitle>
            <DialogDescription>
              This will permanently delete all your data. Slide to confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  Slide to confirm
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
              {resetDatabaseMutation.isPending ? (
                <>
                  <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin mr-2" />
                  Resetting...
                </>
              ) : (
                "Reset Database"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
