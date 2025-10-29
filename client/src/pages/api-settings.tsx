import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Plus, Copy, Trash2, Key, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type ApiKey = {
  id: string;
  userId: number;
  name: string;
  key: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export default function ApiSettingsPage() {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [newKeyData, setNewKeyData] = useState<{ name: string; key: string } | null>(null);
  const [keyToDelete, setKeyToDelete] = useState<string | null>(null);

  const { data: apiKeys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ["/api/api-keys"],
  });

  const createKeyMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await apiRequest("POST", "/api/api-keys", { name });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create API key");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setNewKeyData({ name: data.name, key: data.key });
      setIsCreateDialogOpen(false);
      setKeyName("");
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({
        title: "API Key Created",
        description: "Copy your key now - it won't be shown again!",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/api-keys/${id}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete API key");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({
        title: "API Key Deleted",
        description: "The API key has been permanently deleted.",
      });
      setKeyToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to Clipboard",
      description: "API key has been copied to your clipboard.",
    });
  };

  const handleCreateKey = () => {
    if (!keyName.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a name for the API key.",
      });
      return;
    }
    createKeyMutation.mutate(keyName);
  };

  return (
    <div className="container max-w-4xl py-8 pl-12 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2" data-testid="heading-api-settings">API Settings</h1>
        <p className="text-muted-foreground">
          Manage API keys for external access to your CRM data.
        </p>
      </div>

      {/* WIP Section */}
      <Card>
        <CardHeader>
          <CardTitle>API Settings WIP</CardTitle>
        </CardHeader>
      </Card>

      {/* API Keys List */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">API Keys</h2>
            <p className="text-sm text-muted-foreground">
              Create and manage API keys for external API access
            </p>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-key">
                <Plus className="h-4 w-4 mr-2" />
                Create Key
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create API Key</DialogTitle>
                <DialogDescription>
                  Give your API key a descriptive name to help you remember what it's for.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="key-name">Key Name</Label>
                  <Input
                    id="key-name"
                    placeholder="e.g., Mobile App, Dashboard Integration"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    data-testid="input-key-name"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsCreateDialogOpen(false);
                    setKeyName("");
                  }}
                  data-testid="button-cancel-create"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateKey}
                  disabled={createKeyMutation.isPending}
                  data-testid="button-confirm-create"
                >
                  {createKeyMutation.isPending ? "Creating..." : "Create Key"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Loading API keys...
            </CardContent>
          </Card>
        ) : apiKeys.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Key className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-4" data-testid="text-no-keys">
                No API keys exist yet
              </p>
              <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-create-first-key">
                    <Plus className="h-4 w-4 mr-2" />
                    Create Your First Key
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create API Key</DialogTitle>
                    <DialogDescription>
                      Give your API key a descriptive name to help you remember what it's for.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="key-name-2">Key Name</Label>
                      <Input
                        id="key-name-2"
                        placeholder="e.g., Mobile App, Dashboard Integration"
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                        data-testid="input-key-name-alt"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsCreateDialogOpen(false);
                        setKeyName("");
                      }}
                      data-testid="button-cancel-create-alt"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleCreateKey}
                      disabled={createKeyMutation.isPending}
                      data-testid="button-confirm-create-alt"
                    >
                      {createKeyMutation.isPending ? "Creating..." : "Create Key"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {apiKeys.map((key) => (
              <Card key={key.id} data-testid={`card-api-key-${key.id}`}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Key className="h-4 w-4 text-muted-foreground" />
                        <h3 className="font-medium" data-testid={`text-key-name-${key.id}`}>
                          {key.name}
                        </h3>
                      </div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        <p data-testid={`text-key-created-${key.id}`}>
                          Created {formatDistanceToNow(new Date(key.createdAt), { addSuffix: true })}
                        </p>
                        {key.lastUsedAt && (
                          <p data-testid={`text-key-used-${key.id}`}>
                            Last used {formatDistanceToNow(new Date(key.lastUsedAt), { addSuffix: true })}
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setKeyToDelete(key.id)}
                      data-testid={`button-delete-key-${key.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* New Key Display Dialog */}
      <Dialog open={!!newKeyData} onOpenChange={(open) => !open && setNewKeyData(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Save Your API Key
            </DialogTitle>
            <DialogDescription>
              This is the only time you'll see this key. Copy it now and store it securely.
            </DialogDescription>
          </DialogHeader>
          {newKeyData && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Key Name</Label>
                <p className="text-sm font-mono" data-testid="text-new-key-name">
                  {newKeyData.name}
                </p>
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <div className="flex gap-2">
                  <Input
                    value={newKeyData.key}
                    readOnly
                    className="font-mono text-sm"
                    data-testid="input-new-key-value"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(newKeyData.key)}
                    data-testid="button-copy-new-key"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="rounded-md bg-yellow-50 dark:bg-yellow-950 p-4 border border-yellow-200 dark:border-yellow-800">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  <strong>Warning:</strong> Make sure to copy this key now. You won't be able to see it again.
                </p>
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={() => setNewKeyData(null)} data-testid="button-close-new-key">
              I've Saved My Key
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!keyToDelete} onOpenChange={(open) => !open && setKeyToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this API key? This action cannot be undone and any
              applications using this key will lose access immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => keyToDelete && deleteKeyMutation.mutate(keyToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteKeyMutation.isPending ? "Deleting..." : "Delete Key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
