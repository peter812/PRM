import { useState, useRef, useEffect, useCallback } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Plus, X, Users2, Edit2, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { SocialAccount, Person, SocialAccountType } from "@shared/schema";
import { AddSocialAccountDialog } from "@/components/add-social-account-dialog";
import { EditSocialAccountDialog } from "@/components/edit-social-account-dialog";
import { ExportSocialAccountDialog } from "@/components/export-social-account-dialog";

function isValidHexColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color) || /^#[0-9A-Fa-f]{3}$/.test(color);
}

const PAGE_SIZE = 30;

export default function SocialAccountsList() {
  const [, navigate] = useLocation();
  const searchParams = useSearch();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<SocialAccount | null>(null);
  const [accountToEdit, setAccountToEdit] = useState<SocialAccount | null>(null);
  const [accountToExport, setAccountToExport] = useState<SocialAccount | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showFollowsYou, setShowFollowsYou] = useState(false);
  const { toast } = useToast();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const urlParams = new URLSearchParams(searchParams);
  const typeIdFromUrl = urlParams.get("type") || "";
  const [selectedTypeId, setSelectedTypeId] = useState(typeIdFromUrl);

  useEffect(() => {
    setSelectedTypeId(typeIdFromUrl);
  }, [typeIdFromUrl]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleTypeChange = (value: string) => {
    setSelectedTypeId(value);
    if (value && value !== "all") {
      navigate(`/social-accounts?type=${value}`);
    } else {
      navigate("/social-accounts");
    }
  };

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts/paginated", { search: debouncedSearch, typeId: selectedTypeId, followsYou: showFollowsYou }],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams();
      params.set("offset", String(pageParam));
      params.set("limit", String(PAGE_SIZE));
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (selectedTypeId && selectedTypeId !== "all") params.set("typeId", selectedTypeId);
      if (showFollowsYou) params.set("followsYou", "true");
      const response = await fetch(`/api/social-accounts/paginated?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch social accounts");
      return response.json();
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return allPages.length * PAGE_SIZE;
    },
    initialPageParam: 0,
  });

  const accounts = data?.pages.flat() || [];

  const { data: user } = useQuery<{ id: number; username: string; personId: string }>({
    queryKey: ["/api/user"],
  });

  const { data: mePerson } = useQuery<Person>({
    queryKey: user?.personId ? [`/api/people/${user.personId}`] : [],
    enabled: !!user?.personId,
  });

  const { data: socialAccountTypes } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  const meAccountIds = mePerson?.socialAccountUuids || [];

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/social-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts/paginated"], exact: false });
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

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (container.scrollHeight - container.scrollTop - container.clientHeight < 300) {
      if (hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-4 md:px-6 py-3 md:py-4">
        <div className="flex items-center justify-between gap-2 md:gap-4 mb-2 md:mb-4">
          <h1 className="text-xl md:text-3xl font-semibold truncate" data-testid="text-page-title">
            Social Accounts
          </h1>
          <Button onClick={() => setIsAddDialogOpen(true)} size="icon" className="md:hidden shrink-0" data-testid="button-add-account-mobile">
            <Plus className="h-4 w-4" />
          </Button>
          <Button onClick={() => setIsAddDialogOpen(true)} className="hidden md:inline-flex" data-testid="button-add-account">
            <Plus className="h-4 w-4" />
            Add Account
          </Button>
        </div>
        
        <div className="flex items-center gap-2 md:gap-4 flex-wrap">
          <div className="hidden md:block flex-1 min-w-[200px]">
            <Input
              placeholder="Search accounts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search-accounts"
              className="max-w-md"
            />
          </div>
          <Select value={selectedTypeId || "all"} onValueChange={handleTypeChange}>
            <SelectTrigger className="w-[140px] md:w-[180px]" data-testid="select-type-filter">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {socialAccountTypes?.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  <span className="flex items-center gap-2">
                    {isValidHexColor(type.color) && (
                      <span 
                        className="w-2 h-2 rounded-full" 
                        style={{ backgroundColor: type.color }}
                      />
                    )}
                    {type.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      <div className="flex-1 overflow-auto px-6 py-6" ref={scrollContainerRef}>
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
        ) : accounts.length > 0 ? (
          <div className="flex flex-col gap-[5px]">
            {accounts.map((account) => {
              const isFollowingYou = meAccountIds.some((meId) =>
                account.followers?.includes(meId)
              );
              const accountType = account.typeId 
                ? socialAccountTypes?.find(t => t.id === account.typeId) 
                : null;
              
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold md:truncate break-words" data-testid={`text-username-${account.id}`}>
                            {account.username}
                          </h3>
                          {accountType && (
                            <>
                              <span
                                className="md:hidden w-2.5 h-2.5 rounded-full shrink-0 cursor-pointer"
                                style={isValidHexColor(accountType.color) ? { backgroundColor: accountType.color } : undefined}
                                data-testid={`dot-type-${account.id}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  navigate(`/social-accounts?type=${accountType.id}`);
                                }}
                              />
                              <Badge 
                                variant="outline" 
                                className="text-xs cursor-pointer hidden md:inline-flex"
                                style={isValidHexColor(accountType.color) ? { borderColor: accountType.color, color: accountType.color } : undefined}
                                data-testid={`badge-type-${account.id}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  navigate(`/social-accounts?type=${accountType.id}`);
                                }}
                              >
                                {accountType.name}
                              </Badge>
                            </>
                          )}
                          {isFollowingYou && (
                            <Badge variant="secondary" className="text-xs">
                              Follows you
                            </Badge>
                          )}
                        </div>
                        {account.nickname && (
                          <p className="text-sm text-muted-foreground md:truncate break-words" data-testid={`text-nickname-${account.id}`}>
                            {account.nickname}
                          </p>
                        )}
                        
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span data-testid={`text-followers-${account.id}`}>
                            {account.followers?.length || 0} followers
                          </span>
                          <span>•</span>
                          <span data-testid={`text-following-${account.id}`}>
                            {account.following?.length || 0} following
                          </span>
                        </div>
                      </div>

                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            window.open(account.accountUrl, "_blank");
                          }}
                          data-testid={`button-goto-profile-${account.id}`}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hidden md:inline-flex"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setAccountToExport(account);
                          }}
                          data-testid={`button-export-${account.id}`}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hidden md:inline-flex"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setAccountToEdit(account);
                          }}
                          data-testid={`button-edit-${account.id}`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hidden md:inline-flex text-destructive hover:text-destructive hover:bg-destructive/10"
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
                    </div>
                  </Card>
                </div>
              );
            })}
            {isFetchingNextPage && (
              <div className="flex flex-col gap-[5px]">
                {[1, 2].map((i) => (
                  <Card key={`loading-${i}`} className="p-4 animate-pulse">
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
            )}
            {!hasNextPage && accounts.length >= PAGE_SIZE && (
              <p className="text-center text-sm text-muted-foreground py-4">
                All accounts loaded
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users2 className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {debouncedSearch || showFollowsYou || (selectedTypeId && selectedTypeId !== "all") ? "No accounts found" : "No social accounts"}
            </h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              {debouncedSearch || showFollowsYou || (selectedTypeId && selectedTypeId !== "all")
                ? "Try adjusting your search or filters"
                : "Get started by adding your first social account"}
            </p>
            {!debouncedSearch && !showFollowsYou && (!selectedTypeId || selectedTypeId === "all") && (
              <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-account-empty">
                <Plus className="h-4 w-4" />
                Add Account
              </Button>
            )}
          </div>
        )}
      </div>

      <AddSocialAccountDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen} />

      {accountToEdit && (
        <EditSocialAccountDialog
          open={!!accountToEdit}
          onOpenChange={(open) => !open && setAccountToEdit(null)}
          account={accountToEdit}
        />
      )}

      {accountToExport && (
        <ExportSocialAccountDialog
          open={!!accountToExport}
          onOpenChange={(open) => !open && setAccountToExport(null)}
          account={accountToExport}
        />
      )}

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
