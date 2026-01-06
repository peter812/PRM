import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { Trash2, Mail, Phone, AtSign, AlertTriangle, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import type { Message } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const typeIcons = {
  email: Mail,
  phone: Phone,
  social: AtSign,
};

const typeColors = {
  email: "#3b82f6",
  phone: "#22c55e",
  social: "#a855f7",
};

export default function MessagesList() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { toast } = useToast();

  const { data: allMessages = [], isLoading: allLoading } = useQuery<Message[]>({
    queryKey: ["/api/messages"],
  });

  const { data: orphanMessages = [], isLoading: orphansLoading } = useQuery<Message[]>({
    queryKey: ["/api/messages/orphans"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await apiRequest("DELETE", "/api/messages", { ids });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/orphans"] });
      toast({ title: "Messages deleted successfully" });
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
    },
    onError: () => {
      toast({ title: "Failed to delete messages", variant: "destructive" });
    },
  });

  const updateOrphanMutation = useMutation({
    mutationFn: async ({ id, isOrphan }: { id: string; isOrphan: boolean }) => {
      await apiRequest("PATCH", `/api/messages/${id}/orphan-status`, { isOrphan });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/orphans"] });
      toast({ title: "Message status updated" });
    },
    onError: () => {
      toast({ title: "Failed to update message", variant: "destructive" });
    },
  });

  const handleSelectAll = (messages: Message[]) => {
    if (selectedIds.size === messages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(messages.map((m) => m.id)));
    }
  };

  const handleToggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleMassDelete = () => {
    if (selectedIds.size > 0) {
      setShowDeleteConfirm(true);
    }
  };

  const confirmDelete = () => {
    deleteMutation.mutate(Array.from(selectedIds));
  };

  const renderMessageCard = (message: Message, showOrphanActions = false) => {
    const TypeIcon = typeIcons[message.type as keyof typeof typeIcons] || Mail;
    const typeColor = typeColors[message.type as keyof typeof typeColors] || "#6b7280";

    return (
      <Card
        key={message.id}
        className="p-4 hover-elevate transition-all"
        data-testid={`card-message-${message.id}`}
      >
        <div className="flex items-start gap-3">
          <Checkbox
            checked={selectedIds.has(message.id)}
            onCheckedChange={() => handleToggleSelect(message.id)}
            data-testid={`checkbox-message-${message.id}`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Badge
                style={{ backgroundColor: typeColor }}
                className="text-white"
              >
                <TypeIcon className="h-3 w-3 mr-1" />
                {message.type}
              </Badge>
              {message.isOrphan && (
                <Badge variant="outline" className="text-orange-500 border-orange-500">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Orphan
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {format(new Date(message.sentTimestamp), "MMM d, yyyy h:mm a")}
              </span>
            </div>

            <div className="text-sm mb-2">
              <span className="font-medium">From:</span>{" "}
              <span className="text-muted-foreground">{message.sender}</span>
            </div>

            <div className="text-sm mb-2">
              <span className="font-medium">To:</span>{" "}
              <span className="text-muted-foreground">
                {message.receivers?.join(", ") || "N/A"}
              </span>
            </div>

            {message.content && (
              <p className="text-sm line-clamp-2">{message.content}</p>
            )}

            {message.imageUrls && message.imageUrls.length > 0 && (
              <div className="flex gap-2 mt-2">
                {message.imageUrls.slice(0, 3).map((url, idx) => (
                  <img
                    key={idx}
                    src={url}
                    alt={`Attachment ${idx + 1}`}
                    className="h-12 w-12 object-cover rounded"
                  />
                ))}
                {message.imageUrls.length > 3 && (
                  <div className="h-12 w-12 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">
                    +{message.imageUrls.length - 3}
                  </div>
                )}
              </div>
            )}

            {showOrphanActions && message.isOrphan && (
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    updateOrphanMutation.mutate({ id: message.id, isOrphan: false })
                  }
                  disabled={updateOrphanMutation.isPending}
                  data-testid={`button-resolve-orphan-${message.id}`}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Mark Resolved
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>
    );
  };

  const isLoading = allLoading || orphansLoading;

  if (isLoading) {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading messages...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <h1 className="text-2xl font-bold">Messages</h1>
          {selectedIds.size > 0 && (
            <Button
              variant="destructive"
              onClick={handleMassDelete}
              data-testid="button-delete-selected"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Selected ({selectedIds.size})
            </Button>
          )}
        </div>

        <Tabs defaultValue="all" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="all" data-testid="tab-all-messages">
              All Messages ({allMessages.length})
            </TabsTrigger>
            <TabsTrigger value="orphans" data-testid="tab-orphan-messages">
              <AlertTriangle className="h-4 w-4 mr-1" />
              Orphan Messages ({orphanMessages.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-3">
            {allMessages.length > 0 && (
              <div className="flex items-center gap-2 mb-4">
                <Checkbox
                  checked={selectedIds.size === allMessages.length && allMessages.length > 0}
                  onCheckedChange={() => handleSelectAll(allMessages)}
                  data-testid="checkbox-select-all"
                />
                <span className="text-sm text-muted-foreground">Select All</span>
              </div>
            )}
            {allMessages.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No messages yet</p>
              </div>
            ) : (
              allMessages.map((message) => renderMessageCard(message))
            )}
          </TabsContent>

          <TabsContent value="orphans" className="space-y-3">
            {orphanMessages.length > 0 && (
              <div className="flex items-center gap-2 mb-4">
                <Checkbox
                  checked={selectedIds.size === orphanMessages.length && orphanMessages.length > 0}
                  onCheckedChange={() => handleSelectAll(orphanMessages)}
                  data-testid="checkbox-select-all-orphans"
                />
                <span className="text-sm text-muted-foreground">Select All Orphans</span>
              </div>
            )}
            {orphanMessages.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Check className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No orphan messages</p>
                <p className="text-sm mt-1">
                  All messages are linked to known contacts
                </p>
              </div>
            ) : (
              orphanMessages.map((message) => renderMessageCard(message, true))
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Messages?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedIds.size} message
              {selectedIds.size > 1 ? "s" : ""}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
