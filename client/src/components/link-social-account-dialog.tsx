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
      <DialogContent className="w-[95vw] max-w-sm md:max-w-lg p-2 md:p-6 max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="pb-2 md:pb-4">
          <DialogTitle className="text-base md:text-xl">Link Accounts</DialogTitle>
          <DialogDescription className="text-xs md:text-sm">
            Select social accounts to link
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-2 md:gap-4 min-h-0">
          <div className="relative flex-shrink-0">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs md:text-sm h-8 md:h-auto"
              data-testid="input-search-social-accounts"
            />
          </div>

          <div className="flex-1 overflow-auto space-y-1 md:space-y-2 min-h-0">
            {filteredAccounts.length > 0 ? (
              filteredAccounts.map((account) => {
                const isSelected = selectedIds.includes(account.id);
                return (
                  <Card
                    key={account.id}
                    className="p-1.5 md:p-3 cursor-pointer transition-all flex-shrink-0"
                    onClick={() => handleToggle(account.id)}
                    data-testid={`card-social-account-option-${account.id}`}
                  >
                    <div className="flex items-center gap-1.5 md:gap-3">
                      <Avatar className="h-6 w-6 md:h-8 md:w-8 flex-shrink-0">
                        {account.imageUrl && (
                          <AvatarImage src={account.imageUrl} alt={account.username} />
                        )}
                        <AvatarFallback className="text-[0.5rem] md:text-xs">
                          {getInitials(account.username)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-[0.65rem] md:text-sm truncate" data-testid={`text-username-option-${account.id}`}>
                          @{account.username}
                        </p>
                        <p className="text-[0.6rem] md:text-xs text-muted-foreground truncate" data-testid={`text-url-option-${account.id}`}>
                          {account.accountUrl}
                        </p>
                      </div>
                      <div
                        className={`h-4 w-4 md:h-5 md:w-5 rounded border flex-shrink-0 flex items-center justify-center transition-all ${
                          isSelected
                            ? "bg-primary border-primary"
                            : "border-muted-foreground"
                        }`}
                        data-testid={`checkbox-${account.id}`}
                      >
                        {isSelected && (
                          <X className="h-2.5 w-2.5 md:h-3 md:w-3 text-primary-foreground" />
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })
            ) : (
              <div className="text-center py-4 md:py-8 text-[0.65rem] md:text-sm text-muted-foreground">
                No accounts found
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse md:flex-row md:justify-end gap-1.5 md:gap-2 pt-2 md:pt-4 border-t flex-shrink-0">
            <Button
              variant="outline"
              onClick={() => {
                setSearchQuery("");
                setSelectedIds(linkedAccountIds);
                onOpenChange(false);
              }}
              data-testid="button-cancel"
              className="w-full md:w-auto text-xs md:text-sm h-7 md:h-auto px-2 md:px-4"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={linkMutation.isPending}
              data-testid="button-save-links"
              className="w-full md:w-auto text-xs md:text-sm h-7 md:h-auto px-2 md:px-4"
            >
              {linkMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
