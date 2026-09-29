import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { withImageSize } from "@shared/image-size";
import {
  ArrowLeft,
  GitBranch,
  Users,
  Search,
  ExternalLink,
  Link2,
  FolderPlus,
  HeartHandshake,
  CheckCircle2,
  AlertCircle,
  AtSign,
  SlidersHorizontal,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";
import { FamilyMemberDialog } from "@/components/family-member-dialog";
import type {
  PotentialFamiliesResponse,
  PotentialFamilyGroup,
  PotentialFamilyMember,
  PotentialFamilySocialAccount,
} from "@shared/schema";

type SortOption = "members_desc" | "alpha_asc" | "unconnected_desc" | "unlinked_social_desc";

export default function PotentialFamiliesPage() {
  const { toast } = useToast();

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [minMembersFilter, setMinMembersFilter] = useState("2");
  const [showUnconnectedOnly, setShowUnconnectedOnly] = useState(false);
  const [showUnlinkedSocialOnly, setShowUnlinkedSocialOnly] = useState(false);
  const [sortOption, setSortOption] = useState<SortOption>("members_desc");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Family connector dialog state
  const [connectDialogContext, setConnectDialogContext] = useState<{
    personId: string;
    personName: string;
    targetPerson?: { id: string; name: string };
  } | null>(null);

  // Link Social Account dialog state
  const [linkAccountContext, setLinkAccountContext] = useState<{
    account: PotentialFamilySocialAccount;
    family: PotentialFamilyGroup;
  } | null>(null);
  const [selectedPersonForLink, setSelectedPersonForLink] = useState<string>("");

  // Create PRM Group dialog state
  const [createGroupContext, setCreateGroupContext] = useState<PotentialFamilyGroup | null>(null);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [groupColorInput, setGroupColorInput] = useState("#3b82f6");

  // Fetch potential families from API
  const { data, isLoading, isError, refetch } = useQuery<PotentialFamiliesResponse>({
    queryKey: ["/api/family-tree/potential-families"],
  });

  // Mutation to connect social account to person
  const connectSocialAccountMutation = useMutation({
    mutationFn: async ({
      personId,
      socialAccountId,
    }: {
      personId: string;
      socialAccountId: string;
    }) => {
      return await apiRequest("POST", "/api/account-matching/connect", {
        personId,
        socialAccountIds: [socialAccountId],
      });
    },
    onSuccess: () => {
      toast({
        title: "Account Linked",
        description: "The social account has been linked to the person.",
      });
      setLinkAccountContext(null);
      setSelectedPersonForLink("");
      queryClient.invalidateQueries({ queryKey: ["/api/family-tree/potential-families"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to link account",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Mutation to create PRM group
  const createGroupMutation = useMutation({
    mutationFn: async ({
      name,
      color,
      memberIds,
    }: {
      name: string;
      color: string;
      memberIds: string[];
    }) => {
      return await apiRequest("POST", "/api/groups", {
        name,
        color,
        description: `Potential family group for ${name}`,
        members: memberIds,
      });
    },
    onSuccess: () => {
      toast({
        title: "Group Created",
        description: "A new PRM Group has been created with the family members.",
      });
      setCreateGroupContext(null);
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to create group",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Client-side filtering & sorting
  const filteredFamilies = useMemo(() => {
    if (!data?.families) return [];

    let list = data.families.filter((fam) => {
      // Min members filter
      const min = parseInt(minMembersFilter, 10) || 1;
      if (fam.totalCount < min) return false;

      // Text search
      if (debouncedSearchQuery) {
        const q = debouncedSearchQuery.toLowerCase();
        const matchesSurname = fam.surname.toLowerCase().includes(q);
        const matchesPeople = fam.people.some(
          (p) =>
            p.firstName.toLowerCase().includes(q) ||
            p.lastName.toLowerCase().includes(q) ||
            (p.maidenName && p.maidenName.toLowerCase().includes(q))
        );
        const matchesSocial = fam.socialAccounts.some(
          (s) =>
            s.username.toLowerCase().includes(q) ||
            (s.nickname && s.nickname.toLowerCase().includes(q))
        );
        if (!matchesSurname && !matchesPeople && !matchesSocial) return false;
      }

      // Unconnected filter
      if (showUnconnectedOnly && fam.unconnectedPeopleCount === 0) {
        return false;
      }

      // Unlinked social filter
      if (showUnlinkedSocialOnly && fam.unlinkedSocialCount === 0) {
        return false;
      }

      return true;
    });

    // Sorting
    list = [...list].sort((a, b) => {
      switch (sortOption) {
        case "members_desc":
          return b.totalCount - a.totalCount || a.surname.localeCompare(b.surname);
        case "alpha_asc":
          return a.surname.localeCompare(b.surname);
        case "unconnected_desc":
          return b.unconnectedPeopleCount - a.unconnectedPeopleCount || b.totalCount - a.totalCount;
        case "unlinked_social_desc":
          return b.unlinkedSocialCount - a.unlinkedSocialCount || b.totalCount - a.totalCount;
        default:
          return b.totalCount - a.totalCount;
      }
    });

    return list;
  }, [
    data?.families,
    debouncedSearchQuery,
    minMembersFilter,
    showUnconnectedOnly,
    showUnlinkedSocialOnly,
    sortOption,
  ]);

  const handleOpenCreateGroup = (family: PotentialFamilyGroup) => {
    setCreateGroupContext(family);
    setGroupNameInput(`${family.surname} Family`);
    setGroupColorInput("#3b82f6");
  };

  const handleConfirmCreateGroup = () => {
    if (!createGroupContext || !groupNameInput.trim()) return;
    createGroupMutation.mutate({
      name: groupNameInput.trim(),
      color: groupColorInput,
      memberIds: createGroupContext.people.map((p) => p.id),
    });
  };

  const handleOpenLinkAccount = (
    account: PotentialFamilySocialAccount,
    family: PotentialFamilyGroup
  ) => {
    setLinkAccountContext({ account, family });
    if (family.people.length > 0) {
      setSelectedPersonForLink(family.people[0].id);
    }
  };

  const handleConfirmLinkAccount = () => {
    if (!linkAccountContext || !selectedPersonForLink) return;
    connectSocialAccountMutation.mutate({
      personId: selectedPersonForLink,
      socialAccountId: linkAccountContext.account.id,
    });
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-background">
      {/* Top Header */}
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Link href="/family-tree">
                <Button variant="ghost" size="sm" className="gap-2" data-testid="button-back-to-tree">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Tree
                </Button>
              </Link>
              <div className="h-4 w-[1px] bg-border" />
              <div>
                <h1 className="text-xl font-bold flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Potential Families
                </h1>
                <p className="text-xs text-muted-foreground">
                  Group people and social accounts with the same surname to discover and build family connections
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link href="/family-tree">
                <Button variant="outline" size="sm" className="gap-2">
                  <GitBranch className="h-4 w-4 text-primary" />
                  Tree Visualizer
                </Button>
              </Link>
            </div>
          </div>

          {/* Metric Stats Cards */}
          {data?.stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-3 border-t">
              <div className="bg-muted/40 rounded-lg p-3 border">
                <div className="text-xs text-muted-foreground font-medium">Potential Families</div>
                <div className="text-2xl font-bold mt-1 text-foreground" data-testid="stat-total-families">
                  {data.stats.totalFamilies}
                </div>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 border">
                <div className="text-xs text-muted-foreground font-medium">Grouped People</div>
                <div className="text-2xl font-bold mt-1 text-foreground" data-testid="stat-total-people">
                  {data.stats.totalPeople}
                </div>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 border">
                <div className="text-xs text-muted-foreground font-medium">Unlinked Accounts</div>
                <div className="text-2xl font-bold mt-1 text-amber-500" data-testid="stat-unlinked-social">
                  {data.stats.unlinkedSocialCount}
                </div>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 border">
                <div className="text-xs text-muted-foreground font-medium">Unconnected People</div>
                <div className="text-2xl font-bold mt-1 text-indigo-500" data-testid="stat-unconnected-people">
                  {data.stats.unconnectedPeopleCount}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filter and Controls Toolbar */}
      <div className="container mx-auto px-4 py-4">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between bg-card p-3 rounded-lg border">
          <div className="flex flex-1 items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search surname or member..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
                data-testid="input-search-potential-families"
              />
            </div>

            <Select value={minMembersFilter} onValueChange={setMinMembersFilter}>
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue placeholder="Min members" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">All (1+ members)</SelectItem>
                <SelectItem value="2">2+ members</SelectItem>
                <SelectItem value="3">3+ members</SelectItem>
                <SelectItem value="5">5+ members</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant={showUnconnectedOnly ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowUnconnectedOnly((v) => !v)}
              className="text-xs h-9"
              data-testid="button-filter-unconnected"
            >
              Unconnected only
            </Button>
            <Button
              variant={showUnlinkedSocialOnly ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowUnlinkedSocialOnly((v) => !v)}
              className="text-xs h-9"
              data-testid="button-filter-unlinked-social"
            >
              Has unlinked accounts
            </Button>

            <div className="flex items-center gap-1.5 ml-auto">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              <Select value={sortOption} onValueChange={(v) => setSortOption(v as SortOption)}>
                <SelectTrigger className="w-[170px] h-9 text-xs">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="members_desc">Most Members</SelectItem>
                  <SelectItem value="alpha_asc">Surname (A-Z)</SelectItem>
                  <SelectItem value="unconnected_desc">Most Unconnected</SelectItem>
                  <SelectItem value="unlinked_social_desc">Most Unlinked Accounts</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="container mx-auto px-4 pb-12 flex-1">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-6">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <Skeleton className="h-6 w-48 mb-2" />
                  <Skeleton className="h-4 w-32" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-20 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : isError ? (
          <div className="text-center py-16 bg-card border rounded-lg">
            <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-1">Failed to load potential families</h3>
            <p className="text-sm text-muted-foreground mb-4">
              There was an error communicating with the server.
            </p>
            <Button onClick={() => refetch()}>Retry</Button>
          </div>
        ) : filteredFamilies.length === 0 ? (
          <div className="text-center py-16 bg-card border rounded-lg">
            <Users className="h-12 w-12 text-muted-foreground/60 mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-1">No matching families found</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
              Try adjusting your search query, lowering the minimum member count filter, or clearing the toggles.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setSearchQuery("");
                setMinMembersFilter("1");
                setShowUnconnectedOnly(false);
                setShowUnlinkedSocialOnly(false);
              }}
            >
              Reset Filters
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {filteredFamilies.map((family) => {
              const rootPerson = family.people[0];
              const isFullyConnected =
                family.peopleCount > 1 && family.connectedPeopleCount === family.peopleCount;
              const isPartiallyConnected =
                family.connectedPeopleCount > 0 &&
                family.connectedPeopleCount < family.peopleCount;

              return (
                <Card
                  key={family.surname}
                  className="overflow-hidden border transition-shadow hover:shadow-sm"
                  data-testid={`family-card-${family.surname.toLowerCase()}`}
                >
                  <CardHeader className="bg-muted/30 border-b pb-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg font-bold">
                            The {family.surname} Family
                          </CardTitle>
                          <Badge variant="outline" className="text-xs">
                            {family.totalCount} member{family.totalCount === 1 ? "" : "s"}
                          </Badge>
                          {isFullyConnected ? (
                            <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 text-xs gap-1 border-emerald-500/30">
                              <CheckCircle2 className="h-3 w-3" />
                              All Connected
                            </Badge>
                          ) : isPartiallyConnected ? (
                            <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 text-xs gap-1 border-amber-500/30">
                              <AlertCircle className="h-3 w-3" />
                              Partially Connected ({family.connectedPeopleCount}/{family.peopleCount})
                            </Badge>
                          ) : family.peopleCount > 1 ? (
                            <Badge variant="secondary" className="text-xs text-muted-foreground gap-1">
                              No Tree Links Yet
                            </Badge>
                          ) : null}
                        </div>
                        <CardDescription className="text-xs mt-0.5">
                          {family.peopleCount} {family.peopleCount === 1 ? "person" : "people"}
                          {family.socialCount > 0 &&
                            ` • ${family.socialCount} social ${
                              family.socialCount === 1 ? "account" : "accounts"
                            } (${family.unlinkedSocialCount} unlinked)`}
                        </CardDescription>
                      </div>

                      <div className="flex items-center gap-2">
                        {rootPerson && (
                          <Link href={`/family-tree?person=${rootPerson.id}`}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 text-xs"
                              title="View this family in the Family Tree canvas"
                            >
                              <GitBranch className="h-3.5 w-3.5 text-primary" />
                              View in Tree
                            </Button>
                          </Link>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => handleOpenCreateGroup(family)}
                          title="Create a PRM Group containing this family"
                        >
                          <FolderPlus className="h-3.5 w-3.5" />
                          Create Group
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="pt-4 space-y-5">
                    {/* People Section */}
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        People ({family.peopleCount})
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {family.people.map((person) => {
                          const hasInGroupLinks = person.inGroupConnections.length > 0;
                          return (
                            <div
                              key={person.id}
                              className="group flex flex-col justify-between p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                            >
                              <div className="flex items-start gap-2.5">
                                <Avatar className="h-9 w-9 border shrink-0">
                                  <AvatarImage src={person.imageUrl ? withImageSize(person.imageUrl, 64) : undefined} />
                                  <AvatarFallback className="text-xs">
                                    {getInitials(person.firstName, person.lastName)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <Link href={`/person/${person.id}`}>
                                    <div className="font-medium text-sm hover:underline truncate cursor-pointer flex items-center gap-1">
                                      {person.firstName} {person.lastName}
                                      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 text-muted-foreground shrink-0" />
                                    </div>
                                  </Link>
                                  {person.isMaidenMatch && (
                                    <Badge variant="outline" className="text-[10px] py-0 h-4 bg-muted/60 mt-0.5">
                                      Maiden: {person.maidenName}
                                    </Badge>
                                  )}
                                  {person.title && (
                                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                                      {person.title}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Connections inside this surname family */}
                              <div className="mt-2.5 pt-2 border-t text-[11px]">
                                {hasInGroupLinks ? (
                                  <div className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 truncate font-medium">
                                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                                    <span className="truncate">
                                      {person.inGroupConnections
                                        .map((c) => `${c.type === "parent" ? "Child" : c.type === "child" ? "Parent" : "Partner"} of ${(c.relatedPersonName?.split(" ")[0] ?? "Someone")}`)
                                        .slice(0, 2)
                                        .join(", ")}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="text-muted-foreground flex items-center justify-between">
                                    <span>Not linked in tree</span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-5 px-1.5 text-[10px] text-primary hover:text-primary"
                                      onClick={() =>
                                        setConnectDialogContext({
                                          personId: person.id,
                                          personName: `${person.firstName} ${person.lastName}`,
                                        })
                                      }
                                    >
                                      <HeartHandshake className="h-3 w-3 mr-1" />
                                      Connect
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Social Accounts Section (if any) */}
                    {family.socialAccounts.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                          <AtSign className="h-3.5 w-3.5" />
                          Social Accounts ({family.socialCount})
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                          {family.socialAccounts.map((account) => {
                            return (
                              <div
                                key={account.id}
                                className="flex flex-col justify-between p-3 rounded-lg border bg-card/60 hover:bg-muted/30 transition-colors"
                              >
                                <div className="flex items-start gap-2.5">
                                  <Avatar className="h-8 w-8 border shrink-0">
                                    <AvatarImage src={account.imageUrl ? withImageSize(account.imageUrl, 64) : undefined} />
                                    <AvatarFallback className="text-[10px]">
                                      {account.username.slice(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-medium text-xs truncate">
                                        @{account.username}
                                      </span>
                                      {account.typeName && (
                                        <Badge
                                          variant="outline"
                                          className="text-[9px] px-1 py-0 h-3.5"
                                          style={{
                                            borderColor: account.typeColor || undefined,
                                            color: account.typeColor || undefined,
                                          }}
                                        >
                                          {account.typeName}
                                        </Badge>
                                      )}
                                    </div>
                                    {account.nickname && (
                                      <div className="text-[11px] text-muted-foreground truncate">
                                        {account.nickname}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="mt-2.5 pt-2 border-t text-[11px] flex items-center justify-between">
                                  {account.isLinked ? (
                                    <div className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 truncate">
                                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                                      <span className="truncate">
                                        Linked to {account.ownerName || "Person"}
                                      </span>
                                    </div>
                                  ) : (
                                    <>
                                      <span className="text-amber-500 font-medium">
                                        Unlinked
                                      </span>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-5 px-1.5 text-[10px] gap-1"
                                        onClick={() => handleOpenLinkAccount(account, family)}
                                      >
                                        <Link2 className="h-3 w-3" />
                                        Link to Person
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Link Social Account to Person Dialog */}
      {linkAccountContext && (
        <Dialog
          open={!!linkAccountContext}
          onOpenChange={(open) => !open && setLinkAccountContext(null)}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5 text-primary" />
                Link Social Account to Person
              </DialogTitle>
              <DialogDescription>
                Assign @{linkAccountContext.account.username}{" "}
                {linkAccountContext.account.nickname
                  ? `("${linkAccountContext.account.nickname}")`
                  : ""}{" "}
                to a person in the {linkAccountContext.family.surname} family.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Select Person</Label>
                <Select
                  value={selectedPersonForLink}
                  onValueChange={setSelectedPersonForLink}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a person in this family" />
                  </SelectTrigger>
                  <SelectContent>
                    {linkAccountContext.family.people.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.firstName} {p.lastName} {p.title ? `(${p.title})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setLinkAccountContext(null)}
                disabled={connectSocialAccountMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmLinkAccount}
                disabled={!selectedPersonForLink || connectSocialAccountMutation.isPending}
              >
                {connectSocialAccountMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Link Account
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create PRM Group Dialog */}
      {createGroupContext && (
        <Dialog
          open={!!createGroupContext}
          onOpenChange={(open) => !open && setCreateGroupContext(null)}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FolderPlus className="h-5 w-5 text-primary" />
                Create PRM Group
              </DialogTitle>
              <DialogDescription>
                Create a new group with the {createGroupContext.people.length} people from the{" "}
                {createGroupContext.surname} family.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="group-name">Group Name</Label>
                <Input
                  id="group-name"
                  value={groupNameInput}
                  onChange={(e) => setGroupNameInput(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="group-color">Group Color</Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="group-color"
                    type="color"
                    value={groupColorInput}
                    onChange={(e) => setGroupColorInput(e.target.value)}
                    className="h-10 w-16 p-1 cursor-pointer"
                  />
                  <span className="text-sm font-mono text-muted-foreground">
                    {groupColorInput}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Members included:</Label>
                <div className="text-xs flex flex-wrap gap-1 max-h-32 overflow-y-auto p-2 bg-muted/40 rounded border">
                  {createGroupContext.people.map((p) => (
                    <Badge key={p.id} variant="secondary" className="text-xs">
                      {p.firstName} {p.lastName}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateGroupContext(null)}
                disabled={createGroupMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmCreateGroup}
                disabled={!groupNameInput.trim() || createGroupMutation.isPending}
              >
                {createGroupMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Create Group
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Family Connection Dialog */}
      {connectDialogContext && (
        <FamilyMemberDialog
          open={!!connectDialogContext}
          onOpenChange={(open) => !open && setConnectDialogContext(null)}
          personId={connectDialogContext.personId}
          personName={connectDialogContext.personName}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/family-tree/potential-families"] });
            queryClient.invalidateQueries({ queryKey: ["/api/family-tree"] });
            toast({
              title: "Connection saved",
              description: "The family tree connection was successfully saved.",
            });
          }}
        />
      )}
    </div>
  );
}
