import React, { useState, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, GitBranch, Check, MoreVertical, Loader2 } from "lucide-react";
import { GraphTriangleIcon } from "@/components/icons/graph-triangle-icon";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Person, RelationshipType } from "@shared/schema";

import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

export interface PersonLike {
  id: string;
  firstName?: string;
  lastName?: string;
  relationshipTypeId?: string | null;
  relationshipTypeName?: string | null;
  relationshipTypeColor?: string | null;
  [key: string]: any;
}

export function usePersonMeRelationship(personId: string, currentPerson?: PersonLike) {
  const [isHovered, setIsHovered] = useState(false);
  const [optimisticTypeId, setOptimisticTypeId] = useState<string | null | undefined>(undefined);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleHover = useCallback(() => {
    setIsHovered(true);
  }, []);

  // Lazy query for "Me" user (cached for 60s)
  const { data: meUser } = useQuery<Person>({
    queryKey: ["/api/me"],
    enabled: isHovered,
    staleTime: 60000,
  });

  // Lazy query for relationship types (cached for 60s)
  const { data: relationshipTypes = [], isLoading: isLoadingTypes } = useQuery<RelationshipType[]>({
    queryKey: ["/api/relationship-types"],
    enabled: isHovered,
    staleTime: 60000,
  });

  // Lazy query for target person's relationships
  const { data: relationships = [], isLoading: isLoadingRels } = useQuery<any[]>({
    queryKey: [`/api/relationships/${personId}`],
    enabled: isHovered && !!personId,
  });

  // Find direct relationship between "Me" user and target person
  const existingRel = useMemo(() => {
    if (!relationships || !relationships.length) return null;
    const meId = meUser?.id;
    return (
      relationships.find(
        (rel: any) =>
          (meId &&
            ((rel.fromPersonId === meId && rel.toPersonId === personId) ||
              (rel.toPersonId === meId && rel.fromPersonId === personId))) ||
          (!rel.familyRelationshipType && (rel.toPersonId === personId || rel.fromPersonId === personId))
      ) || null
    );
  }, [relationships, meUser?.id, personId]);

  // Determine active relationship type ID (optimistic override -> fetched relationship -> person prop/cached data)
  const activeTypeId: string | null = useMemo(() => {
    if (optimisticTypeId !== undefined) {
      return optimisticTypeId;
    }
    if (existingRel && existingRel.typeId) {
      return existingRel.typeId;
    }
    if (currentPerson?.relationshipTypeId) {
      return currentPerson.relationshipTypeId;
    }
    if (currentPerson?.relationshipTypeName && relationshipTypes.length > 0) {
      const match = relationshipTypes.find((t) => t.name === currentPerson.relationshipTypeName);
      if (match) return match.id;
    }
    return null;
  }, [optimisticTypeId, existingRel, currentPerson, relationshipTypes]);

  const updateRelationship = useCallback(
    async (typeId: string | null) => {
      setOptimisticTypeId(typeId);

      const selectedType = typeId ? relationshipTypes.find((t) => t.id === typeId) : null;
      const newTypeName = selectedType ? selectedType.name : null;
      const newTypeColor = selectedType ? selectedType.color : null;

      // Optimistic cache update for paginated people list
      queryClient.setQueriesData({ queryKey: ["/api/people/paginated"] }, (old: any) => {
        if (!old) return old;
        if (Array.isArray(old)) {
          return old.map((p: any) =>
            p.id === personId
              ? {
                  ...p,
                  relationshipTypeName: newTypeName,
                  relationshipTypeColor: newTypeColor,
                }
              : p
          );
        }
        if (Array.isArray(old.people)) {
          return {
            ...old,
            people: old.people.map((p: any) =>
              p.id === personId
                ? {
                    ...p,
                    relationshipTypeName: newTypeName,
                    relationshipTypeColor: newTypeColor,
                  }
                : p
            ),
          };
        }
        return old;
      });

      // Optimistic cache update for unpaginated people list
      queryClient.setQueriesData({ queryKey: ["/api/people"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((p: any) =>
          p.id === personId
            ? {
                ...p,
                relationshipTypeName: newTypeName,
                relationshipTypeColor: newTypeColor,
              }
            : p
        );
      });

      // Optimistic cache update for groups
      queryClient.setQueriesData({ queryKey: ["/api/groups"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((g: any) => {
          if (!g.members || !Array.isArray(g.members)) return g;
          return {
            ...g,
            members: g.members.map((m: any) =>
              m.id === personId
                ? {
                    ...m,
                    relationshipTypeName: newTypeName,
                    relationshipTypeColor: newTypeColor,
                  }
                : m
            ),
          };
        });
      });

      try {
        if (typeId === null) {
          if (existingRel?.id) {
            await apiRequest("DELETE", `/api/relationships/${existingRel.id}`);
          }
        } else if (existingRel?.id) {
          await apiRequest("PATCH", `/api/relationships/${existingRel.id}`, { typeId });
        } else {
          let meId = meUser?.id;
          if (!meId) {
            const meRes = await fetch("/api/me");
            if (meRes.ok) {
              const meData = await meRes.json();
              meId = meData.id;
            }
          }
          if (!meId) {
            throw new Error("Could not identify current user.");
          }
          await apiRequest("POST", "/api/relationships", {
            fromPersonId: meId,
            toPersonId: personId,
            typeId,
          });
        }

        // Revalidate queries on success
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["/api/people/paginated"] }),
          queryClient.invalidateQueries({ queryKey: ["/api/people"] }),
          queryClient.invalidateQueries({ queryKey: ["/api/groups"] }),
          queryClient.invalidateQueries({ queryKey: [`/api/relationships/${personId}`] }),
          queryClient.invalidateQueries({ queryKey: ["/api/graph"] }),
        ]);
        setOptimisticTypeId(undefined);
      } catch (err: any) {
        console.error("Failed to update relationship:", err);
        setOptimisticTypeId(undefined);
        // Force sync with server truth
        queryClient.invalidateQueries({ queryKey: ["/api/people/paginated"] });
        queryClient.invalidateQueries({ queryKey: ["/api/people"] });
        queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
        queryClient.invalidateQueries({ queryKey: [`/api/relationships/${personId}`] });

        toast({
          variant: "destructive",
          title: "Relationship Update Failed",
          description: err?.message || "Could not update relationship. Please try again.",
        });
      }
    },
    [personId, existingRel, meUser?.id, relationshipTypes, queryClient, toast]
  );

  return {
    handleHover,
    isHovered,
    isLoading: isHovered && (isLoadingTypes || isLoadingRels),
    relationshipTypes,
    activeTypeId,
    updateRelationship,
  };
}

export interface RelationshipMenuItemsProps {
  isContextMenu: boolean;
  relationshipTypes: RelationshipType[];
  activeTypeId: string | null;
  isLoading: boolean;
  onSelect: (typeId: string | null) => void;
}

export function RelationshipMenuItems({
  isContextMenu,
  relationshipTypes,
  activeTypeId,
  isLoading,
  onSelect,
}: RelationshipMenuItemsProps) {
  const Item = isContextMenu ? ContextMenuItem : DropdownMenuItem;
  const Separator = isContextMenu ? ContextMenuSeparator : DropdownMenuSeparator;

  if (isLoading && relationshipTypes.length === 0) {
    return (
      <div className="flex items-center justify-center py-2 px-3 text-xs text-muted-foreground gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Loading types...</span>
      </div>
    );
  }

  return (
    <>
      <Item
        className="flex items-center justify-between cursor-pointer text-xs"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(null);
        }}
      >
        <span>None</span>
        {activeTypeId === null && <Check className="h-3.5 w-3.5 ml-auto text-primary" />}
      </Item>

      {relationshipTypes.length > 0 && <Separator />}

      {relationshipTypes.map((type) => {
        const isSelected = activeTypeId === type.id;
        return (
          <Item
            key={type.id}
            className="flex items-center justify-between cursor-pointer text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(type.id);
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: type.color || "#888888" }}
              />
              <span className="truncate">{type.name}</span>
            </div>
            {isSelected && <Check className="h-3.5 w-3.5 ml-auto text-primary shrink-0" />}
          </Item>
        );
      })}
    </>
  );
}

export interface PersonContextMenuProps {
  person: PersonLike;
  groupId?: string;
  children: React.ReactNode;
  asChild?: boolean;
}

export function PersonContextMenu({
  person,
  groupId,
  children,
  asChild = false,
}: PersonContextMenuProps) {
  const [, navigate] = useLocation();
  const { handleHover, isLoading, relationshipTypes, activeTypeId, updateRelationship } =
    usePersonMeRelationship(person.id, person);

  const profileUrl = groupId
    ? `/person/${person.id}?from=group&groupId=${groupId}`
    : `/person/${person.id}`;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild={asChild}>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem
          className="flex items-center gap-2 cursor-pointer text-xs"
          onClick={() => navigate(profileUrl)}
        >
          <Eye className="h-4 w-4" />
          <span>View Profile</span>
        </ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger
            className="flex items-center gap-2 cursor-pointer text-xs"
            onMouseEnter={handleHover}
            onFocus={handleHover}
          >
            <GitBranch className="h-4 w-4" />
            <span>Relationship</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <RelationshipMenuItems
              isContextMenu={true}
              relationshipTypes={relationshipTypes}
              activeTypeId={activeTypeId}
              isLoading={isLoading}
              onSelect={updateRelationship}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuItem
          className="flex items-center gap-2 cursor-pointer text-xs"
          onClick={() => navigate(`/social-graph-3d?view=person&selected=${person.id}`)}
        >
          <GraphTriangleIcon className="h-4 w-4" />
          <span>Open in Graph</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export interface PersonActionButtonProps {
  person: PersonLike;
  groupId?: string;
  className?: string;
}

export function PersonActionButton({
  person,
  groupId,
  className,
}: PersonActionButtonProps) {
  const [, navigate] = useLocation();
  const { handleHover, isLoading, relationshipTypes, activeTypeId, updateRelationship } =
    usePersonMeRelationship(person.id, person);

  const profileUrl = groupId
    ? `/person/${person.id}?from=group&groupId=${groupId}`
    : `/person/${person.id}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-7 w-7 text-muted-foreground hover:text-foreground", className)}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          data-testid={`button-person-actions-${person.id}`}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuItem
          className="flex items-center gap-2 cursor-pointer text-xs"
          onClick={() => navigate(profileUrl)}
        >
          <Eye className="h-4 w-4" />
          <span>View Profile</span>
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            className="flex items-center gap-2 cursor-pointer text-xs"
            onMouseEnter={handleHover}
            onFocus={handleHover}
          >
            <GitBranch className="h-4 w-4" />
            <span>Relationship</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            <RelationshipMenuItems
              isContextMenu={false}
              relationshipTypes={relationshipTypes}
              activeTypeId={activeTypeId}
              isLoading={isLoading}
              onSelect={updateRelationship}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem
          className="flex items-center gap-2 cursor-pointer text-xs"
          onClick={() => navigate(`/social-graph-3d?view=person&selected=${person.id}`)}
        >
          <GraphTriangleIcon className="h-4 w-4" />
          <span>Open in Graph</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
