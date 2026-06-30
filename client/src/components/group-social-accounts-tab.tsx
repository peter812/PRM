import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, X, Search, Trash, Star, StarOff, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getInitials, isValidHexColor } from "@/lib/utils";
import type { SocialAccountWithCurrentProfile, Group, SocialAccountType } from "@shared/schema";
import { SocialAccountDialog } from "./social-account-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLocation } from "wouter";

interface GroupSocialAccountsTabProps {
  groupId: string;
}

export function GroupSocialAccountsTab({ groupId }: GroupSocialAccountsTabProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  
  // State for Add (Create) Social Account Dialog
  const [isAddOpen, setIsAddOpen] = useState(false);
  
  // State for Link Existing Social Account Dialog
  const [isLinkOpen, setIsLinkOpen] = useState(false);
  const [linkSearchQuery, setLinkSearchQuery] = useState("");
  const debouncedSearch = useDebounce(linkSearchQuery, 300);

  // State for Delete Confirmation Dialog
  const [accountToDelete, setAccountToDelete] = useState<SocialAccountWithCurrentProfile | null>(null);

  // Fetch the current group details
  const { data: group } = useQuery<Group>({
    queryKey: [`/api/groups/${groupId}`],
  });

  // Fetch social account types for mapping types/colors
  const { data: socialAccountTypes = [] } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  // Fetch social accounts associated with this group
  const { data: groupAccounts = [], isLoading } = useQuery<SocialAccountWithCurrentProfile[]>({
    queryKey: ["/api/groups", groupId, "social-accounts"],
    queryFn: async () => {
      const res = await fetch(`/api/groups/${groupId}/social-accounts`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch group social accounts");
      return res.json();
    },
  });

  // Fetch existing social accounts for linking (exclude those already linked to this group)
  const { data: searchResults = [], isFetching: isSearching } = useQuery<SocialAccountWithCurrentProfile[]>({
    queryKey: ["/api/social-accounts", { search: debouncedSearch }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("search", debouncedSearch);
      const res = await fetch(`/api/social-accounts?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to search accounts");
      return res.json();
    },
    enabled: isLinkOpen && debouncedSearch.trim().length >= 2,
  });

  // Mutate group centerAccountId
  const setCenterAccountMutation = useMutation({
    mutationFn: async (accountId: string | null) => {
      return await apiRequest("PATCH", `/api/groups/${groupId}`, {
        centerAccountId: accountId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/groups/${groupId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({
        title: "Success",
        description: "Center account updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update center account",
        variant: "destructive",
      });
    },
  });

  // Mutate social account groupId to link
  const linkAccountMutation = useMutation({
    mutationFn: async (accountId: string) => {
      return await apiRequest("PATCH", `/api/social-accounts/${accountId}`, {
        groupId: groupId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "social-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      toast({
        title: "Success",
        description: "Social account linked to group",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to link social account",
        variant: "destructive",
      });
    },
  });

  // Mutate social account groupId to null to unlink
  const unlinkAccountMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const payload: { groupId: string | null; centerAccountId?: string | null } = {
        groupId: null,
      };
      
      // If this account was the center account, we should also clear centerAccountId
      if (group?.centerAccountId === accountId) {
        await apiRequest("PATCH", `/api/groups/${groupId}`, {
          centerAccountId: null,
        });
        queryClient.invalidateQueries({ queryKey: [`/api/groups/${groupId}`] });
        queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      }

      return await apiRequest("PATCH", `/api/social-accounts/${accountId}`, {
        groupId: null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "social-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      toast({
        title: "Success",
        description: "Social account unlinked from group",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to unlink social account",
        variant: "destructive",
      });
    },
  });

  // Mutate delete social account
  const deleteAccountMutation = useMutation({
    mutationFn: async (accountId: string) => {
      // If this account was the center account, clear centerAccountId first
      if (group?.centerAccountId === accountId) {
        await apiRequest("PATCH", `/api/groups/${groupId}`, {
          centerAccountId: null,
        });
        queryClient.invalidateQueries({ queryKey: [`/api/groups/${groupId}`] });
        queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      }
      return await apiRequest("DELETE", `/api/social-accounts/${accountId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "social-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      toast({
        title: "Success",
        description: "Social account deleted successfully",
      });
      setAccountToDelete(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete social account",
        variant: "destructive",
      });
    },
  });

  const handleLinkSelect = (accountId: string) => {
    linkAccountMutation.mutate(accountId);
    setIsLinkOpen(false);
    setLinkSearchQuery("");
  };

  const handleSetCenter = (accountId: string, isCenter: boolean) => {
    setCenterAccountMutation.mutate(isCenter ? null : accountId);
  };

  // Filter out accounts that are already linked to this group
  const linkCandidates = searchResults.filter(
    (sa) => sa.groupId !== groupId
  );

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setIsAddOpen(true)}
            size="sm"
            data-testid="button-add-group-social-account"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Social Account
          </Button>
          <Button
            onClick={() => setIsLinkOpen(true)}
            variant="outline"
            size="sm"
            data-testid="button-link-group-social-account"
          >
            <Plus className="h-4 w-4 mr-2" />
            Link Existing
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2].map((n) => (
            <Card key={n} className="p-4 h-32 animate-pulse bg-muted/40" />
          ))}
        </div>
      ) : groupAccounts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groupAccounts.map((account) => {
            const isCenter = group?.centerAccountId === account.id;
            const accountType = account.typeId
              ? socialAccountTypes.find((t) => t.id === account.typeId)
              : undefined;
            return (
              <Card
                key={account.id}
                className={`p-5 hover-elevate transition-all border flex flex-col justify-between h-44 relative ${
                  isCenter ? "border-primary/55 ring-1 ring-primary/20" : ""
                }`}
                data-testid={`card-group-social-account-${account.id}`}
              >
                <div className="flex items-start gap-4">
                  <Avatar 
                    className="h-12 w-12 cursor-pointer border" 
                    onClick={() => navigate(`/social-accounts/${account.id}`)}
                  >
                    <AvatarImage src={account.currentProfile?.imageUrl || undefined} />
                    <AvatarFallback>{getInitials(account.username)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="font-semibold text-foreground hover:underline cursor-pointer truncate block"
                        onClick={() => navigate(`/social-accounts/${account.id}`)}
                      >
                        @{account.username}
                      </span>
                      {isCenter && (
                        <Badge variant="default" className="text-[10px] py-0 px-1.5 shrink-0 bg-primary/90">
                          Center
                        </Badge>
                      )}
                    </div>
                    {account.currentProfile?.nickname && (
                      <span className="text-sm text-muted-foreground block truncate">
                        {account.currentProfile.nickname}
                      </span>
                    )}
                    {accountType && (
                      <Badge
                        variant="secondary"
                        className="mt-1 text-[10px] font-normal"
                        style={{
                          backgroundColor: accountType.color && isValidHexColor(accountType.color)
                            ? `${accountType.color}15`
                            : undefined,
                          color: accountType.color && isValidHexColor(accountType.color)
                            ? accountType.color
                            : undefined,
                          borderColor: accountType.color && isValidHexColor(accountType.color)
                            ? `${accountType.color}30`
                            : undefined,
                        }}
                      >
                        {accountType.name}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t pt-3 mt-4 gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-8 px-2.5 text-xs ${
                      isCenter ? "text-primary hover:text-primary/80" : "text-muted-foreground"
                    }`}
                    onClick={() => handleSetCenter(account.id, isCenter)}
                    title={isCenter ? "Remove as center account" : "Set as center account"}
                    data-testid={`button-center-account-${account.id}`}
                  >
                    {isCenter ? (
                      <>
                        <Star className="h-3.5 w-3.5 mr-1.5 fill-current" />
                        Center
                      </>
                    ) : (
                      <>
                        <StarOff className="h-3.5 w-3.5 mr-1.5" />
                        Set Center
                      </>
                    )}
                  </Button>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => unlinkAccountMutation.mutate(account.id)}
                      title="Unlink from this group"
                      data-testid={`button-unlink-account-${account.id}`}
                    >
                      Unlink
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setAccountToDelete(account)}
                      title="Delete account permanently"
                      data-testid={`button-delete-account-${account.id}`}
                    >
                      <Trash className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="flex-1 flex flex-col items-center justify-center p-8 border-dashed bg-muted/10 min-h-[300px]">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <Search className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="font-semibold text-lg mb-1">No social accounts linked</h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
            Associate social media accounts with this group to calculate crowds and visualize networks.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => setIsAddOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Social Account
            </Button>
            <Button variant="outline" onClick={() => setIsLinkOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Link Existing
            </Button>
          </div>
        </Card>
      )}

      {/* Dialog for adding/creating a new social account */}
      <SocialAccountDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        groupId={groupId}
        onAccountCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "social-accounts"] });
        }}
      />

      {/* Dialog for linking an existing social account */}
      <Dialog open={isLinkOpen} onOpenChange={setIsLinkOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Link Existing Social Account</DialogTitle>
            <DialogDescription>
              Search for an existing social account to link it to this group.
            </DialogDescription>
          </DialogHeader>

          <div className="relative my-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by username..."
              className="pl-9"
              value={linkSearchQuery}
              onChange={(e) => setLinkSearchQuery(e.target.value)}
              data-testid="input-search-link-candidates"
            />
          </div>

          <ScrollArea className="h-60 border rounded-md p-2">
            {linkSearchQuery.trim().length < 2 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground py-10">
                Type at least 2 characters to search...
              </div>
            ) : isSearching ? (
              <div className="space-y-2">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="flex items-center gap-3 p-2 animate-pulse">
                    <div className="w-8 h-8 rounded-full bg-muted" />
                    <div className="flex-1 space-y-1">
                      <div className="h-4 bg-muted rounded w-3/4" />
                      <div className="h-3 bg-muted rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : linkCandidates.length > 0 ? (
              <div className="space-y-1">
                {linkCandidates.map((account) => {
                  const accountType = account.typeId
                    ? socialAccountTypes.find((t) => t.id === account.typeId)
                    : undefined;
                  return (
                    <div
                      key={account.id}
                      className="flex items-center justify-between p-2 hover:bg-muted/60 rounded-md transition-colors cursor-pointer"
                      onClick={() => handleLinkSelect(account.id)}
                      data-testid={`link-candidate-${account.id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar className="h-8 w-8 border">
                          <AvatarImage src={account.currentProfile?.imageUrl || undefined} />
                          <AvatarFallback>{getInitials(account.username)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <span className="font-medium text-sm block truncate">@{account.username}</span>
                          {account.currentProfile?.nickname && (
                            <span className="text-xs text-muted-foreground block truncate">
                              {account.currentProfile.nickname}
                            </span>
                          )}
                        </div>
                      </div>
                      {accountType && (
                        <Badge variant="secondary" className="text-[9px] font-normal shrink-0">
                          {accountType.name}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground py-10">
                No matching accounts found
              </div>
            )}
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsLinkOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Deleting Account */}
      <Dialog open={!!accountToDelete} onOpenChange={(open) => !open && setAccountToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete Social Account?
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>@{accountToDelete?.username}</strong> permanently? 
              This will also delete all of its historical profile versions and scrape history. 
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccountToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => accountToDelete && deleteAccountMutation.mutate(accountToDelete.id)}
              disabled={deleteAccountMutation.isPending}
            >
              {deleteAccountMutation.isPending ? "Deleting..." : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
