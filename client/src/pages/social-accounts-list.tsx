import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, X, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { SocialAccount, Person } from "@shared/schema";
import { AddSocialAccountDialog } from "@/components/add-social-account-dialog";

export default function SocialAccountsList() {
  const [, navigate] = useLocation();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<SocialAccount | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFollowsYou, setShowFollowsYou] = useState(false);
  const { toast } = useToast();

  const { data: accounts, isLoading, isError, error } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
  });

  const { data: user } = useQuery<{ id: number; username: string; personId: string }>({
    queryKey: ["/api/user"],
  });

  const { data: mePerson } = useQuery<Person>({
    queryKey: user?.personId ? [`/api/people/${user.personId}`] : [],
    enabled: !!user?.personId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/social-accounts/${id}`);
    },
    onSuccess: () => {
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

  const getInitials = (username: string) => {
    if (username.length >= 2) {
      return username.slice(0, 2).toUpperCase();
    }
    return username.slice(0, 1).toUpperCase();
  };

  // Get ME user's social account IDs
  const meAccountIds = useMemo(() => {
    return mePerson?.socialAccountUuids || [];
  }, [mePerson]);

  // Filter accounts based on search query and "follows you" toggle
  const filteredAccounts = useMemo(() => {
    if (!accounts) return [];

    let filtered = accounts;

    // Apply search filter (live filtering)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (account) =>
          account.username.toLowerCase().includes(query) ||
          account.accountUrl.toLowerCase().includes(query)
      );
    }

    // Apply "follows you" filter
    if (showFollowsYou && meAccountIds.length > 0) {
      filtered = filtered.filter((account) =>
        meAccountIds.some((meId) => account.followers?.includes(meId))
      );
    }

    return filtered;
  }, [accounts, searchQuery, showFollowsYou, meAccountIds]);

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h1 className="text-3xl font-semibold" data-testid="text-page-title">
            Social Accounts
          </h1>
          <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-account">
            <Plus className="h-4 w-4" />
            Add Account
          </Button>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Input
              placeholder="Search accounts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search-accounts"
              className="max-w-md"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="follows-you"
              checked={showFollowsYou}
              onCheckedChange={setShowFollowsYou}
              data-testid="switch-follows-you"
            />
            <Label htmlFor="follows-you" className="cursor-pointer">
              Follows you
            </Label>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        {isLoading ? (
          <div className="flex flex-col gap-[5px]">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-4 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-1/3" />
                    <div className="h-3 bg-muted rounded w-1/4" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <Users2 className="h-8 w-8 text-destructive" />
            </div>
            <h3 className="text-lg font-medium mb-2">Failed to load social accounts</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              {error?.message || "An error occurred while fetching social accounts"}
            </p>
            <Button onClick={() => window.location.reload()} variant="outline" data-testid="button-retry">
              Try Again
            </Button>
          </div>
        ) : filteredAccounts && filteredAccounts.length > 0 ? (
          <div className="flex flex-col gap-[5px]">
            {filteredAccounts.map((account) => {
              const isFollowingYou = meAccountIds.some((meId) =>
                account.followers?.includes(meId)
              );
              
              return (
                <div
                  key={account.id}
                  onClick={() => navigate(`/social-accounts/${account.id}`)}
                  className="cursor-pointer"
                >
                  <Card
                    className="p-4 hover-elevate transition-all"
                    data-testid={`card-account-${account.id}`}
                  >
                    <div className="flex items-center gap-4">
                      <Avatar className="w-12 h-12">
                        {account.imageUrl && (
                          <AvatarImage src={account.imageUrl} alt={account.username} />
                        )}
                        <AvatarFallback>
                          {getInitials(account.username)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium truncate" data-testid={`text-username-${account.id}`}>
                            {account.username}
                          </h3>
                          {isFollowingYou && (
                            <Badge variant="secondary" className="text-xs">
                              Follows you
                            </Badge>
                          )}
                        </div>
                        <a
                          href={account.accountUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm text-muted-foreground hover:underline truncate block"
                          data-testid={`link-account-url-${account.id}`}
                        >
                          {account.accountUrl}
                        </a>
                        
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span data-testid={`text-followers-${account.id}`}>
                            {account.followers?.length || 0} followers
                          </span>
                          <span>•</span>
                          <span data-testid={`text-following-${account.id}`}>
                            {account.following?.length || 0} following
                          </span>
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setAccountToDelete(account);
                        }}
                        data-testid={`button-delete-${account.id}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </Card>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users2 className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {searchQuery || showFollowsYou ? "No accounts found" : "No social accounts"}
            </h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              {searchQuery || showFollowsYou
                ? "Try adjusting your search or filters"
                : "Get started by adding your first social account"}
            </p>
            {!searchQuery && !showFollowsYou && (
              <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-account-empty">
                <Plus className="h-4 w-4" />
                Add Account
              </Button>
            )}
          </div>
        )}
      </div>

      <AddSocialAccountDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen} />

      <AlertDialog open={!!accountToDelete} onOpenChange={(open) => !open && setAccountToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Social Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {accountToDelete?.username}? This will permanently remove this account and unlink it from any associated people. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (accountToDelete) {
                  deleteMutation.mutate(accountToDelete.id);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
