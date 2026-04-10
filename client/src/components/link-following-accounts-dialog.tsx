import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, X, Loader2 } from "lucide-react";
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
import type { SocialAccountWithCurrentProfile } from "@shared/schema";

const PAGE_SIZE = 30;

interface LinkFollowingAccountsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean, updated?: boolean) => void;
  accountUuid: string;
  linkedAccountIds: string[];
}

export function LinkFollowingAccountsDialog({
  open,
  onOpenChange,
  accountUuid,
  linkedAccountIds,
}: LinkFollowingAccountsDialogProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>(linkedAccountIds);
  const [offset, setOffset] = useState(0);
  const [accumulatedAccounts, setAccumulatedAccounts] = useState<SocialAccountWithCurrentProfile[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setOffset(0);
      setAccumulatedAccounts([]);
      setHasMore(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setDebouncedSearch("");
      setOffset(0);
      setAccumulatedAccounts([]);
      setHasMore(true);
      setSelectedIds(linkedAccountIds);
    }
  }, [open, linkedAccountIds]);

  const buildUrl = (search: string, off: number) => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(off),
    });
    if (search) params.set("search", search);
    return `/api/social-accounts/paginated?${params.toString()}`;
  };

  const { data: currentPage, isFetching } = useQuery<SocialAccountWithCurrentProfile[]>({
    queryKey: ["/api/social-accounts/paginated", debouncedSearch, offset],
    queryFn: async () => {
      const res = await fetch(buildUrl(debouncedSearch, offset), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch accounts");
      return res.json();
    },
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!currentPage) return;
    if (offset === 0) {
      setAccumulatedAccounts(currentPage);
    } else {
      setAccumulatedAccounts((prev) => {
        const existingIds = new Set(prev.map((a) => a.id));
        const newItems = currentPage.filter((a) => !existingIds.has(a.id));
        return [...prev, ...newItems];
      });
    }
    setHasMore(currentPage.length >= PAGE_SIZE);
  }, [currentPage, offset]);

  const loadMore = useCallback(() => {
    if (!isFetching && hasMore) {
      setOffset((prev) => prev + PAGE_SIZE);
    }
  }, [isFetching, hasMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1, root: listContainerRef.current }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const linkMutation = useMutation({
    mutationFn: async (followingIds: string[]) => {
      return await apiRequest("POST", `/api/social-accounts/${accountUuid}/network-state`, {
        following: followingIds,
        followers: [],
        followerCount: 0,
        followingCount: followingIds.length,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", accountUuid] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"], exact: false });
      toast({
        title: "Success",
        description: "Following accounts updated successfully",
      });
      onOpenChange(false, true);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update following accounts",
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
    if (username.length >= 2) return username.slice(0, 2).toUpperCase();
    return username.slice(0, 1).toUpperCase();
  };

  const isInitialLoading = isFetching && accumulatedAccounts.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onOpenChange(false);
        }
      }}
    >
      <DialogContent className="w-[95vw] max-w-sm md:max-w-lg p-2 md:p-6 max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="pb-2 md:pb-4">
          <DialogTitle className="text-base md:text-xl">Link Following Accounts</DialogTitle>
          <DialogDescription className="text-xs md:text-sm">
            Select social accounts this account follows
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
              data-testid="input-search-following-accounts"
            />
          </div>

          <div ref={listContainerRef} className="flex-1 overflow-auto space-y-1 md:space-y-2 min-h-0">
            {isInitialLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : accumulatedAccounts.length > 0 ? (
              <>
                {accumulatedAccounts.map((account) => {
                  const isSelected = selectedIds.includes(account.id);
                  return (
                    <Card
                      key={account.id}
                      className="p-1.5 md:p-3 cursor-pointer transition-all flex-shrink-0"
                      onClick={() => handleToggle(account.id)}
                      data-testid={`card-following-account-option-${account.id}`}
                    >
                      <div className="flex items-center gap-1.5 md:gap-3">
                        <Avatar className="h-6 w-6 md:h-8 md:w-8 flex-shrink-0">
                          {account.currentProfile?.imageUrl && (
                            <AvatarImage src={account.currentProfile?.imageUrl} alt={account.username} />
                          )}
                          <AvatarFallback className="text-[0.5rem] md:text-xs">
                            {getInitials(account.username)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-[0.65rem] md:text-sm truncate" data-testid={`text-username-following-${account.id}`}>
                            @{account.username}
                          </p>
                          <p className="text-[0.6rem] md:text-xs text-muted-foreground truncate" data-testid={`text-url-following-${account.id}`}>
                            {account.currentProfile?.accountUrl}
                          </p>
                        </div>
                        <div
                          className={`h-4 w-4 md:h-5 md:w-5 rounded border flex-shrink-0 flex items-center justify-center transition-all ${
                            isSelected
                              ? "bg-primary border-primary"
                              : "border-muted-foreground"
                          }`}
                          data-testid={`checkbox-following-${account.id}`}
                        >
                          {isSelected && (
                            <X className="h-2.5 w-2.5 md:h-3 md:w-3 text-primary-foreground" />
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
                <div ref={sentinelRef} className="py-2 flex items-center justify-center min-h-[1px]">
                  {isFetching && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-4 md:py-8 text-[0.65rem] md:text-sm text-muted-foreground">
                No accounts found
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse md:flex-row md:justify-end gap-1.5 md:gap-2 pt-2 md:pt-4 border-t flex-shrink-0">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-following"
              className="w-full md:w-auto text-xs md:text-sm h-7 md:h-auto px-2 md:px-4"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={linkMutation.isPending}
              data-testid="button-save-following"
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
