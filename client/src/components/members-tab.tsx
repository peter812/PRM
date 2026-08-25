import { useState, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, X, LayoutList, LayoutGrid, Search, ChevronDown, UserPlus, Users, Star, Phone, Mail, ExternalLink, ArrowUpDown, ArrowUp, ArrowDown, Filter, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";
import type { Person, SubGroup } from "@shared/schema";
import { Link } from "wouter";
import { PersonDialog } from "@/components/person-dialog";
import { PersonContextMenu, PersonActionButton } from "@/components/person-context-menu";
import { PersonTagsCell } from "@/components/person-tags-cell";

interface MembersTabProps {
  members: Person[];
  groupId: string;
  subGroups?: SubGroup[];
}

type ViewMode = "list" | "details";

export function MembersTab({ members, groupId, subGroups = [] }: MembersTabProps) {
  const { toast } = useToast();
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [isCreatePersonOpen, setIsCreatePersonOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isEmptyDropdownOpen, setIsEmptyDropdownOpen] = useState(false);
  const [starredStates, setStarredStates] = useState<Record<string, number>>({});
  const [tableSortColumn, setTableSortColumn] = useState<string | null>(null);
  const [tableSortDirection, setTableSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedSubGroupFilter, setSelectedSubGroupFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("group-members-view-mode");
    return (saved as ViewMode) || "list";
  });

  const memberSubGroupsMap = useMemo(() => {
    const map: Record<string, SubGroup[]> = {};
    for (const sg of subGroups) {
      for (const mId of sg.members || []) {
        if (!map[mId]) map[mId] = [];
        map[mId].push(sg);
      }
    }
    return map;
  }, [subGroups]);

  const { data: allPeople = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  const memberIds = members.map((m) => m.id);
  const availablePeople = allPeople.filter((p) => !memberIds.includes(p.id));

  const removeMemberMutation = useMutation({
    mutationFn: async (personId: string) => {
      const updatedMembers = memberIds.filter((id) => id !== personId);
      return await apiRequest("PATCH", `/api/groups/${groupId}`, {
        members: updatedMembers,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({
        title: "Success",
        description: "Member removed from group",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove member",
        variant: "destructive",
      });
    },
  });

  const starMutation = useMutation({
    mutationFn: async ({ personId, isStarred }: { personId: string; isStarred: number }) => {
      await apiRequest("PATCH", `/api/people/${personId}`, {
        isStarred: isStarred === 1 ? 0 : 1,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update star status",
        variant: "destructive",
      });
    },
  });

  const handleStarClick = (person: Person) => {
    const currentStarred = starredStates[person.id] ?? (person.isStarred || 0);
    const newStarred = currentStarred === 1 ? 0 : 1;
    setStarredStates((prev) => ({ ...prev, [person.id]: newStarred }));
    starMutation.mutate({ personId: person.id, isStarred: currentStarred });
  };

  const handleHeaderSort = (column: string) => {
    if (tableSortColumn === column) {
      setTableSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setTableSortColumn(column);
      setTableSortDirection(column === "starred" || column === "social" ? "desc" : "asc");
    }
  };

  const filteredMembers = useMemo(() => {
    if (!selectedSubGroupFilter) return members;
    if (selectedSubGroupFilter === "none") {
      return members.filter(
        (m) => !memberSubGroupsMap[m.id] || memberSubGroupsMap[m.id].length === 0
      );
    }
    return members.filter((m) =>
      memberSubGroupsMap[m.id]?.some((sg) => sg.id === selectedSubGroupFilter)
    );
  }, [members, selectedSubGroupFilter, memberSubGroupsMap]);

  const sortedMembers = useMemo(() => {
    if (!tableSortColumn) return filteredMembers;
    return [...filteredMembers].sort((a, b) => {
      let cmp = 0;
      if (tableSortColumn === "name") {
        const nameA = `${a.firstName || ""} ${a.lastName || ""}`.trim();
        const nameB = `${b.firstName || ""} ${b.lastName || ""}`.trim();
        cmp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
      } else if (tableSortColumn === "title_company") {
        const tcA = `${a.title || ""} ${a.company || ""}`.trim();
        const tcB = `${b.title || ""} ${b.company || ""}`.trim();
        if (!tcA && tcB) return 1;
        if (tcA && !tcB) return -1;
        cmp = tcA.localeCompare(tcB, undefined, { numeric: true, sensitivity: "base" });
      } else if (tableSortColumn === "tags") {
        const tagsA = (a.tags || []).join(", ");
        const tagsB = (b.tags || []).join(", ");
        if (!tagsA && tagsB) return 1;
        if (tagsA && !tagsB) return -1;
        cmp = tagsA.localeCompare(tagsB, undefined, { numeric: true, sensitivity: "base" });
      } else if (tableSortColumn === "subgroups") {
        const sgA = (memberSubGroupsMap[a.id] || []).map((s) => s.name).join(", ");
        const sgB = (memberSubGroupsMap[b.id] || []).map((s) => s.name).join(", ");
        if (!sgA && sgB) return 1;
        if (sgA && !sgB) return -1;
        cmp = sgA.localeCompare(sgB, undefined, { numeric: true, sensitivity: "base" });
      } else if (tableSortColumn === "starred") {
        const starA = starredStates[a.id] ?? (a.isStarred || 0);
        const starB = starredStates[b.id] ?? (b.isStarred || 0);
        cmp = starA - starB;
      } else if (tableSortColumn === "phone") {
        const phoneA = a.phone || "";
        const phoneB = b.phone || "";
        if (!phoneA && phoneB) return 1;
        if (phoneA && !phoneB) return -1;
        cmp = phoneA.localeCompare(phoneB, undefined, { numeric: true, sensitivity: "base" });
      } else if (tableSortColumn === "email") {
        const emailA = a.email || "";
        const emailB = b.email || "";
        if (!emailA && emailB) return 1;
        if (emailA && !emailB) return -1;
        cmp = emailA.localeCompare(emailB, undefined, { numeric: true, sensitivity: "base" });
      } else if (tableSortColumn === "social") {
        const countA = a.socialAccountUuids?.length || 0;
        const countB = b.socialAccountUuids?.length || 0;
        cmp = countA - countB;
      }
      return tableSortDirection === "asc" ? cmp : -cmp;
    });
  }, [filteredMembers, tableSortColumn, tableSortDirection, starredStates, memberSubGroupsMap]);

  const addMembersMutation = useMutation({
    mutationFn: async ({
      memberIds: newMemberIds,
      subGroupIds = [],
    }: {
      memberIds: string[];
      subGroupIds?: string[];
    }) => {
      const updatedMembers = Array.from(new Set([...memberIds, ...newMemberIds]));
      await apiRequest("PATCH", `/api/groups/${groupId}`, {
        members: updatedMembers,
      });

      if (subGroupIds.length > 0) {
        await Promise.all(
          subGroupIds.map(async (sgId) => {
            const sg = subGroups.find((s) => s.id === sgId);
            if (!sg) return;
            const updatedSgMembers = Array.from(
              new Set([...(sg.members || []), ...newMemberIds])
            );
            return apiRequest("PATCH", `/api/subgroups/${sgId}`, {
              members: updatedSgMembers,
            });
          })
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "subgroups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subgroups"] });
      toast({
        title: "Success",
        description: "Members added to group",
      });
      setIsAddMemberOpen(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add members",
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <div className="p-6">
        <div className="flex items-center justify-between gap-4 mb-6">
          <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
            <div
              className="inline-flex rounded-md shadow-sm"
              onMouseEnter={() => setIsDropdownOpen(true)}
              onMouseLeave={() => setIsDropdownOpen(false)}
            >
              <Button
                onClick={() => setIsAddMemberOpen(true)}
                size="sm"
                className="rounded-r-none border-r border-primary-foreground/20"
                data-testid="button-add-members"
              >
                <Plus className="h-4 w-4" />
                Add Members
              </Button>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="rounded-l-none px-2"
                  data-testid="button-add-members-dropdown"
                  aria-label="More options"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </div>
            <DropdownMenuContent
              align="start"
              onMouseEnter={() => setIsDropdownOpen(true)}
              onMouseLeave={() => setIsDropdownOpen(false)}
            >
              <DropdownMenuItem
                onClick={() => {
                  setIsDropdownOpen(false);
                  setIsCreatePersonOpen(true);
                }}
                data-testid="menu-item-new-person"
                className="cursor-pointer"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                New Person
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setIsDropdownOpen(false);
                  setIsAddMemberOpen(true);
                }}
                data-testid="menu-item-add-existing"
                className="cursor-pointer"
              >
                <Users className="h-4 w-4 mr-2" />
                Add Existing
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {subGroups.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={selectedSubGroupFilter ? "secondary" : "outline"}
                  size="sm"
                  className="h-8 gap-1.5 text-xs font-normal"
                  data-testid="button-filter-subgroups"
                >
                  <Filter className="h-3.5 w-3.5" />
                  <span>
                    {selectedSubGroupFilter === "none"
                      ? "No Sub Group"
                      : selectedSubGroupFilter
                      ? subGroups.find((s) => s.id === selectedSubGroupFilter)?.name || "Sub Group"
                      : "Sub Group"}
                  </span>
                  {selectedSubGroupFilter && (
                    <span
                      className="w-2 h-2 rounded-full ml-0.5 shrink-0"
                      style={{
                        backgroundColor:
                          selectedSubGroupFilter === "none"
                            ? "#888"
                            : subGroups.find((s) => s.id === selectedSubGroupFilter)?.color || "#888",
                      }}
                    />
                  )}
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  onClick={() => setSelectedSubGroupFilter(null)}
                  className="flex items-center justify-between cursor-pointer"
                  data-testid="filter-option-all-subgroups"
                >
                  <span>All Sub Groups</span>
                  {!selectedSubGroupFilter && <Check className="h-4 w-4" />}
                </DropdownMenuItem>
                {subGroups.map((sg) => (
                  <DropdownMenuItem
                    key={sg.id}
                    onClick={() => setSelectedSubGroupFilter(sg.id)}
                    className="flex items-center justify-between cursor-pointer"
                    data-testid={`filter-option-subgroup-${sg.id}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: sg.color }}
                      />
                      <span className="truncate">{sg.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({sg.members?.length || 0})
                      </span>
                    </div>
                    {selectedSubGroupFilter === sg.id && <Check className="h-4 w-4 shrink-0" />}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onClick={() => setSelectedSubGroupFilter("none")}
                  className="flex items-center justify-between cursor-pointer text-muted-foreground"
                  data-testid="filter-option-no-subgroup"
                >
                  <span>No Sub Group</span>
                  {selectedSubGroupFilter === "none" && <Check className="h-4 w-4" />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <div className="flex items-center border rounded-md p-1">
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => {
                setViewMode("list");
                localStorage.setItem("group-members-view-mode", "list");
              }}
              className="h-8"
              data-testid="button-view-list"
              title="List View"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "details" ? "default" : "ghost"}
              size="sm"
              onClick={() => {
                setViewMode("details");
                localStorage.setItem("group-members-view-mode", "details");
              }}
              className="h-8"
              data-testid="button-view-details"
              title="Details View"
            >
              <LayoutList className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {selectedSubGroupFilter && (
          <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
            <span>Filtered by:</span>
            <Badge
              variant="secondary"
              className="flex items-center gap-1.5 py-0.5 px-2 font-normal"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{
                  backgroundColor:
                    selectedSubGroupFilter === "none"
                      ? "#888"
                      : subGroups.find((s) => s.id === selectedSubGroupFilter)?.color || "#888",
                }}
              />
              <span className="font-medium text-foreground">
                {selectedSubGroupFilter === "none"
                  ? "No Sub Group"
                  : subGroups.find((s) => s.id === selectedSubGroupFilter)?.name}
              </span>
              <span className="text-[10px] text-muted-foreground">
                ({sortedMembers.length} member{sortedMembers.length !== 1 ? "s" : ""})
              </span>
              <button
                type="button"
                onClick={() => setSelectedSubGroupFilter(null)}
                className="ml-1 hover:text-foreground inline-flex items-center"
                data-testid="button-clear-subgroup-filter"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground hover:text-foreground px-1.5"
              onClick={() => setSelectedSubGroupFilter(null)}
            >
              Clear
            </Button>
          </div>
        )}

        {members.length > 0 ? (
          sortedMembers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center border rounded-lg border-dashed">
              <Filter className="h-8 w-8 text-muted-foreground mb-3" />
              <h3 className="text-base font-medium mb-1">No members in this sub group filter</h3>
              <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                No group members match the selected sub group filter.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedSubGroupFilter(null)}
                data-testid="button-clear-filter-empty"
              >
                Clear Filter
              </Button>
            </div>
          ) : viewMode === "list" ? (
            <div className="space-y-3">
              {sortedMembers.map((member) => (
                <PersonContextMenu key={member.id} person={member} groupId={groupId}>
                  <Card
                    className="p-4 hover-elevate transition-all cursor-pointer"
                    data-testid={`card-member-${member.id}`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <Link
                        href={`/person/${member.id}?from=group&groupId=${groupId}`}
                        className="flex items-center gap-4 min-w-0 shrink-0 max-w-full sm:max-w-[45%]"
                      >
                        <Avatar className="w-12 h-12 shrink-0">
                          {member.imageUrl && (
                            <AvatarImage
                              src={member.imageUrl}
                              alt={`${member.firstName} ${member.lastName}`}
                            />
                          )}
                          <AvatarFallback>
                            {getInitials(member.firstName, member.lastName)}
                          </AvatarFallback>
                        </Avatar>

                        <div className="min-w-0">
                          <h3
                            className="text-lg font-medium hover:underline cursor-pointer truncate"
                            data-testid={`text-member-name-${member.id}`}
                          >
                            {member.firstName} {member.lastName}
                          </h3>
                          {(member.company || member.title) && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground truncate">
                              {member.title && <span>{member.title}</span>}
                              {member.title && member.company && <span>•</span>}
                              {member.company && <span>{member.company}</span>}
                            </div>
                          )}
                        </div>
                      </Link>

                      <div className="flex-1 flex items-center justify-start sm:justify-end gap-1.5 flex-wrap min-w-0">
                        {memberSubGroupsMap[member.id]?.map((sg) => (
                          <Link
                            key={sg.id}
                            href={`/group/${groupId}/subgroup/${sg.id}`}
                          >
                            <Badge
                              variant="outline"
                              className="text-xs hover:bg-accent cursor-pointer flex items-center gap-1.5 py-0.5 px-2 font-normal"
                              data-testid={`badge-subgroup-chip-${member.id}-${sg.id}`}
                            >
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: sg.color }}
                              />
                              {sg.name}
                            </Badge>
                          </Link>
                        ))}
                      </div>

                      <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                        <PersonActionButton person={member} groupId={groupId} />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeMemberMutation.mutate(member.id);
                          }}
                          disabled={removeMemberMutation.isPending}
                          className="text-destructive hover:text-destructive"
                          data-testid={`button-remove-member-${member.id}`}
                        >
                          <X className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                </PersonContextMenu>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-members-details">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th
                      className="py-2 px-3 font-medium cursor-pointer select-none hover:text-foreground group/th transition-colors"
                      onClick={() => handleHeaderSort("name")}
                      data-testid="th-sort-name"
                      title="Sort by Name"
                    >
                      <div className="flex items-center gap-1">
                        <span>Name</span>
                        {tableSortColumn === "name" ? (
                          tableSortDirection === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5 text-foreground shrink-0" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5 text-foreground shrink-0" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-0 group-hover/th:opacity-60 transition-opacity shrink-0" />
                        )}
                      </div>
                    </th>
                    <th
                      className="py-2 px-3 font-medium cursor-pointer select-none hover:text-foreground group/th transition-colors"
                      onClick={() => handleHeaderSort("title_company")}
                      data-testid="th-sort-title-company"
                      title="Sort by Title / Company"
                    >
                      <div className="flex items-center gap-1">
                        <span>Title / Company</span>
                        {tableSortColumn === "title_company" ? (
                          tableSortDirection === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5 text-foreground shrink-0" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5 text-foreground shrink-0" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-0 group-hover/th:opacity-60 transition-opacity shrink-0" />
                        )}
                      </div>
                    </th>
                    <th
                      className="py-2 px-3 font-medium cursor-pointer select-none hover:text-foreground group/th transition-colors"
                      onClick={() => handleHeaderSort("tags")}
                      data-testid="th-sort-tags"
                      title="Sort by Tags"
                    >
                      <div className="flex items-center gap-1">
                        <span>Tags</span>
                        {tableSortColumn === "tags" ? (
                          tableSortDirection === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5 text-foreground shrink-0" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5 text-foreground shrink-0" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-0 group-hover/th:opacity-60 transition-opacity shrink-0" />
                        )}
                      </div>
                    </th>
                    <th
                      className="py-2 px-3 font-medium cursor-pointer select-none hover:text-foreground group/th transition-colors"
                      data-testid="th-subgroups"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div
                          className="flex items-center gap-1 flex-1"
                          onClick={() => handleHeaderSort("subgroups")}
                          title="Sort by Sub Groups"
                        >
                          <span>Sub Groups</span>
                          {tableSortColumn === "subgroups" ? (
                            tableSortDirection === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5 text-foreground shrink-0" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5 text-foreground shrink-0" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-0 group-hover/th:opacity-60 transition-opacity shrink-0" />
                          )}
                        </div>

                        {subGroups.length > 0 && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={`h-5 w-5 p-0 hover:bg-muted ${
                                  selectedSubGroupFilter
                                    ? "text-primary font-bold opacity-100"
                                    : "text-muted-foreground opacity-60 group-hover/th:opacity-100"
                                }`}
                                onClick={(e) => e.stopPropagation()}
                                title="Filter by Sub Group"
                                data-testid="button-th-filter-subgroup"
                              >
                                <Filter className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem
                                onClick={() => setSelectedSubGroupFilter(null)}
                                className="flex items-center justify-between cursor-pointer"
                                data-testid="th-filter-option-all"
                              >
                                <span>All Sub Groups</span>
                                {!selectedSubGroupFilter && <Check className="h-3.5 w-3.5" />}
                              </DropdownMenuItem>
                              {subGroups.map((sg) => (
                                <DropdownMenuItem
                                  key={sg.id}
                                  onClick={() => setSelectedSubGroupFilter(sg.id)}
                                  className="flex items-center justify-between cursor-pointer"
                                  data-testid={`th-filter-option-${sg.id}`}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span
                                      className="w-2.5 h-2.5 rounded-full shrink-0"
                                      style={{ backgroundColor: sg.color }}
                                    />
                                    <span className="truncate">{sg.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      ({sg.members?.length || 0})
                                    </span>
                                  </div>
                                  {selectedSubGroupFilter === sg.id && (
                                    <Check className="h-3.5 w-3.5 shrink-0" />
                                  )}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuItem
                                onClick={() => setSelectedSubGroupFilter("none")}
                                className="flex items-center justify-between cursor-pointer text-muted-foreground"
                                data-testid="th-filter-option-none"
                              >
                                <span>No Sub Group</span>
                                {selectedSubGroupFilter === "none" && <Check className="h-3.5 w-3.5" />}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </th>
                    <th
                      className="py-2 px-3 font-medium w-12 cursor-pointer select-none hover:text-foreground group/th transition-colors"
                      onClick={() => handleHeaderSort("starred")}
                      data-testid="th-sort-starred"
                      title="Sort by Starred"
                    >
                      <div className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 text-yellow-500 fill-current shrink-0" />
                        {tableSortColumn === "starred" ? (
                          tableSortDirection === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5 text-foreground shrink-0" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5 text-foreground shrink-0" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-0 group-hover/th:opacity-60 transition-opacity shrink-0" />
                        )}
                      </div>
                    </th>
                    <th
                      className="py-2 px-3 font-medium cursor-pointer select-none hover:text-foreground group/th transition-colors"
                      onClick={() => handleHeaderSort("phone")}
                      data-testid="th-sort-phone"
                      title="Sort by Phone"
                    >
                      <div className="flex items-center gap-1">
                        <span>Phone</span>
                        {tableSortColumn === "phone" ? (
                          tableSortDirection === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5 text-foreground shrink-0" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5 text-foreground shrink-0" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-0 group-hover/th:opacity-60 transition-opacity shrink-0" />
                        )}
                      </div>
                    </th>
                    <th
                      className="py-2 px-3 font-medium cursor-pointer select-none hover:text-foreground group/th transition-colors"
                      onClick={() => handleHeaderSort("email")}
                      data-testid="th-sort-email"
                      title="Sort by Email"
                    >
                      <div className="flex items-center gap-1">
                        <span>Email</span>
                        {tableSortColumn === "email" ? (
                          tableSortDirection === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5 text-foreground shrink-0" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5 text-foreground shrink-0" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-0 group-hover/th:opacity-60 transition-opacity shrink-0" />
                        )}
                      </div>
                    </th>
                    <th
                      className="py-2 px-3 font-medium cursor-pointer select-none hover:text-foreground group/th transition-colors"
                      onClick={() => handleHeaderSort("social")}
                      data-testid="th-sort-social"
                      title="Sort by Social accounts count"
                    >
                      <div className="flex items-center gap-1">
                        <span>Social</span>
                        {tableSortColumn === "social" ? (
                          tableSortDirection === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5 text-foreground shrink-0" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5 text-foreground shrink-0" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-0 group-hover/th:opacity-60 transition-opacity shrink-0" />
                        )}
                      </div>
                    </th>
                    <th className="py-2 px-3 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMembers.map((member) => {
                    const starredVal = starredStates[member.id] ?? (member.isStarred || 0);
                    return (
                      <PersonContextMenu key={member.id} person={member} groupId={groupId} asChild>
                        <tr
                          className="border-b hover:bg-muted/50 transition-colors cursor-pointer"
                          data-testid={`row-member-${member.id}`}
                        >
                          <td className="py-2 px-3">
                            <Link
                              href={`/person/${member.id}?from=group&groupId=${groupId}`}
                              className="font-medium hover:underline"
                              data-testid={`text-member-name-${member.id}`}
                            >
                              {member.firstName} {member.lastName}
                            </Link>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {(member.title || member.company) && (
                              <div className="flex items-center gap-1">
                                {member.title && <span>{member.title}</span>}
                                {member.title && member.company && <span>•</span>}
                                {member.company && <span>{member.company}</span>}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <PersonTagsCell personId={member.id} tags={member.tags || []} />
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex flex-wrap gap-1">
                              {memberSubGroupsMap[member.id]?.map((sg) => (
                                <Link
                                  key={sg.id}
                                  href={`/group/${groupId}/subgroup/${sg.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Badge
                                    variant="outline"
                                    className="text-xs hover:bg-accent cursor-pointer flex items-center gap-1.5 py-0.5 px-2 font-normal"
                                    data-testid={`table-chip-subgroup-${member.id}-${sg.id}`}
                                  >
                                    <span
                                      className="w-2 h-2 rounded-full shrink-0"
                                      style={{ backgroundColor: sg.color }}
                                    />
                                    {sg.name}
                                  </Badge>
                                </Link>
                              ))}
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 text-yellow-500 hover:text-yellow-600 p-0"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleStarClick(member);
                              }}
                              data-testid={`button-star-${member.id}`}
                            >
                              <Star className={`h-4 w-4 ${starredVal === 1 ? "fill-current" : ""}`} />
                            </Button>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {member.phone && (
                              <span className="flex items-center gap-1" data-testid={`text-phone-${member.id}`}>
                                <Phone className="h-3 w-3" />
                                {member.phone}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {member.email && (
                              <a
                                href={`mailto:${member.email}`}
                                className="flex items-center gap-1 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`text-email-${member.id}`}
                              >
                                <Mail className="h-3 w-3" />
                                {member.email}
                              </a>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            {member.socialAccountUuids && member.socialAccountUuids.length > 0 && (
                              <Link href={`/person/${member.id}?from=group&groupId=${groupId}`}>
                                <Badge variant="outline" className="text-xs cursor-pointer" data-testid={`badge-social-${member.id}`}>
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  {member.socialAccountUuids.length}
                                </Badge>
                              </Link>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-1">
                              <PersonActionButton person={member} groupId={groupId} />
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  removeMemberMutation.mutate(member.id);
                                }}
                                disabled={removeMemberMutation.isPending}
                                className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                                data-testid={`button-remove-member-${member.id}`}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      </PersonContextMenu>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Plus className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">No members yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              Add people to this group to organize your contacts
            </p>
            <DropdownMenu open={isEmptyDropdownOpen} onOpenChange={setIsEmptyDropdownOpen}>
              <div
                className="inline-flex rounded-md shadow-sm"
                onMouseEnter={() => setIsEmptyDropdownOpen(true)}
                onMouseLeave={() => setIsEmptyDropdownOpen(false)}
              >
                <Button
                  onClick={() => setIsAddMemberOpen(true)}
                  className="rounded-r-none border-r border-primary-foreground/20"
                  data-testid="button-add-members-empty"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Members
                </Button>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="rounded-l-none px-2"
                    data-testid="button-add-members-empty-dropdown"
                    aria-label="More options"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </div>
              <DropdownMenuContent
                align="center"
                onMouseEnter={() => setIsEmptyDropdownOpen(true)}
                onMouseLeave={() => setIsEmptyDropdownOpen(false)}
              >
                <DropdownMenuItem
                  onClick={() => {
                    setIsEmptyDropdownOpen(false);
                    setIsCreatePersonOpen(true);
                  }}
                  data-testid="menu-item-empty-new-person"
                  className="cursor-pointer"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  New Person
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setIsEmptyDropdownOpen(false);
                    setIsAddMemberOpen(true);
                  }}
                  data-testid="menu-item-empty-add-existing"
                  className="cursor-pointer"
                >
                  <Users className="h-4 w-4 mr-2" />
                  Add Existing
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <AddMembersDialog
        open={isAddMemberOpen}
        onOpenChange={setIsAddMemberOpen}
        availablePeople={availablePeople}
        subGroups={subGroups}
        onAddMembers={(ids, sgIds) =>
          addMembersMutation.mutate({ memberIds: ids, subGroupIds: sgIds })
        }
        isPending={addMembersMutation.isPending}
      />

      <PersonDialog
        open={isCreatePersonOpen}
        onOpenChange={setIsCreatePersonOpen}
        subGroups={subGroups}
        onPersonCreated={(newPerson, selectedSubGroupIds) => {
          if (newPerson?.id) {
            addMembersMutation.mutate({
              memberIds: [newPerson.id],
              subGroupIds: selectedSubGroupIds,
            });
          }
        }}
      />
    </>
  );
}

interface AddMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availablePeople: Person[];
  subGroups?: SubGroup[];
  onAddMembers: (memberIds: string[], subGroupIds: string[]) => void;
  isPending: boolean;
}

function AddMembersDialog({
  open,
  onOpenChange,
  availablePeople,
  subGroups = [],
  onAddMembers,
  isPending,
}: AddMembersDialogProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedSubGroupIds, setSelectedSubGroupIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const handleSubmit = () => {
    if (selectedIds.length > 0) {
      onAddMembers(selectedIds, selectedSubGroupIds);
      setSelectedIds([]);
      setSelectedSubGroupIds([]);
      setSearchQuery("");
    }
  };

  const toggleSelection = (personId: string) => {
    setSelectedIds((prev) =>
      prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId]
    );
  };

  // Filter available people based on search query
  const filteredPeople = availablePeople.filter((person) => {
    const query = searchQuery.toLowerCase();
    return (
      person.firstName.toLowerCase().includes(query) ||
      person.lastName.toLowerCase().includes(query) ||
      person.email?.toLowerCase().includes(query) ||
      person.company?.toLowerCase().includes(query) ||
      person.tags?.some((tag) => tag.toLowerCase().includes(query))
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Members</DialogTitle>
          <DialogDescription>
            Select people to add to this group ({selectedIds.length} selected)
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search people by name, company, email, or tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-members"
          />
        </div>

        <ScrollArea className="h-80 border rounded-md p-3">
          <div className="space-y-2">
            {filteredPeople.map((person) => {
              const isSelected = selectedIds.includes(person.id);
              return (
                <div
                  key={person.id}
                  onClick={() => toggleSelection(person.id)}
                  className={`flex items-center gap-3 p-2 rounded-md cursor-pointer hover-elevate ${
                    isSelected ? "bg-primary/10" : ""
                  }`}
                  data-testid={`add-member-option-${person.id}`}
                >
                  <Avatar className="w-8 h-8">
                    {person.imageUrl && (
                      <AvatarImage
                        src={person.imageUrl}
                        alt={`${person.firstName} ${person.lastName}`}
                      />
                    )}
                    <AvatarFallback className="text-xs">
                      {getInitials(person.firstName, person.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {person.firstName} {person.lastName}
                    </p>
                    {person.company && (
                      <p className="text-xs text-muted-foreground truncate">
                        {person.company}
                      </p>
                    )}
                  </div>
                  {isSelected && (
                    <Badge variant="default" className="text-xs">
                      Selected
                    </Badge>
                  )}
                </div>
              );
            })}
            {availablePeople.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                All people are already members of this group
              </p>
            )}
            {availablePeople.length > 0 && filteredPeople.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No people found matching "{searchQuery}"
              </p>
            )}
          </div>
        </ScrollArea>

        {subGroups.length > 0 && (
          <div className="space-y-2 pt-2 border-t">
            <p className="text-xs font-medium text-muted-foreground">
              Assign to Subgroups (Optional)
            </p>
            <div className="flex flex-wrap gap-2">
              {subGroups.map((sg) => {
                const isSelected = selectedSubGroupIds.includes(sg.id);
                return (
                  <Badge
                    key={sg.id}
                    variant={isSelected ? "default" : "outline"}
                    className="cursor-pointer select-none py-1 px-2.5 text-xs flex items-center gap-1.5 transition-all"
                    onClick={() => {
                      setSelectedSubGroupIds((prev) =>
                        prev.includes(sg.id)
                          ? prev.filter((id) => id !== sg.id)
                          : [...prev, sg.id]
                      );
                    }}
                    data-testid={`badge-add-member-subgroup-${sg.id}`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: sg.color }}
                    />
                    <span>{sg.name}</span>
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSelectedIds([]);
              setSelectedSubGroupIds([]);
              onOpenChange(false);
            }}
            className="flex-1"
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || selectedIds.length === 0}
            className="flex-1"
            data-testid="button-add-selected"
          >
            {isPending ? "Adding..." : `Add ${selectedIds.length} Member${selectedIds.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
