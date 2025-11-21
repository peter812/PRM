import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { SocialAccount } from "@shared/schema";

interface LinkSocialAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean, updated?: boolean) => void;
  personId: string;
  linkedAccountIds: string[];
}

export function LinkSocialAccountDialog({
  open,
  onOpenChange,
  personId,
  linkedAccountIds,
}: LinkSocialAccountDialogProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>(linkedAccountIds);

  const { data: allAccounts = [] } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
  });

  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return allAccounts;
    const query = searchQuery.toLowerCase();
    return allAccounts.filter(
      (acc) =>
        acc.username.toLowerCase().includes(query) ||
        acc.accountUrl.toLowerCase().includes(query)
    );
  }, [allAccounts, searchQuery]);

  const linkMutation = useMutation({
    mutationFn: async (accountIds: string[]) => {
      return await apiRequest("PATCH", `/api/people/${personId}`, {
        socialAccountUuids: accountIds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", personId] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({
        title: "Success",
        description: "Social accounts linked successfully",
      });
      onOpenChange(false, true);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to link social accounts",
        variant: "destructive",
      });
    },
  });

  const handleToggle = (accountId: string) => {
    setSelectedIds((prev) =>
      prev.includes(accountId)
        ? prev.filter((id) => id !== accountId)
        : [...prev, accountId]
    );
  };

  const handleSave = () => {
    linkMutation.mutate(selectedIds);
  };

  const getInitials = (username: string) => {
    if (username.length >= 2) {
      return username.slice(0, 2).toUpperCase();
    }
    return username.slice(0, 1).toUpperCase();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setSearchQuery("");
          setSelectedIds(linkedAccountIds);
          onOpenChange(false);
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link Social Accounts</DialogTitle>
          <DialogDescription>
            Search and select social accounts to link to this person
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by username or account URL..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-social-accounts"
            />
          </div>

          <div className="max-h-64 overflow-auto space-y-2">
            {filteredAccounts.length > 0 ? (
              filteredAccounts.map((account) => {
                const isSelected = selectedIds.includes(account.id);
                return (
                  <Card
                    key={account.id}
                    className="p-3 cursor-pointer transition-all"
                    onClick={() => handleToggle(account.id)}
                    data-testid={`card-social-account-option-${account.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1 flex items-center gap-3 min-w-0">
                        <Avatar className="h-8 w-8 flex-shrink-0">
                          {account.imageUrl && (
                            <AvatarImage src={account.imageUrl} alt={account.username} />
                          )}
                          <AvatarFallback className="text-xs">
                            {getInitials(account.username)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate" data-testid={`text-username-option-${account.id}`}>
                            @{account.username}
                          </p>
                          <p className="text-xs text-muted-foreground truncate" data-testid={`text-url-option-${account.id}`}>
                            {account.accountUrl}
                          </p>
                        </div>
                      </div>
                      <div
                        className={`h-5 w-5 rounded border flex-shrink-0 flex items-center justify-center transition-all ${
                          isSelected
                            ? "bg-primary border-primary"
                            : "border-muted-foreground"
                        }`}
                        data-testid={`checkbox-${account.id}`}
                      >
                        {isSelected && (
                          <X className="h-3 w-3 text-primary-foreground" />
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No social accounts found
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => {
                setSearchQuery("");
                setSelectedIds(linkedAccountIds);
                onOpenChange(false);
              }}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={linkMutation.isPending}
              data-testid="button-save-links"
            >
              {linkMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
