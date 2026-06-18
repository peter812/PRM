import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2, Users2, Edit, MoreHorizontal } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { RelationshipDialog } from "@/components/relationship-dialog";
import { MiniPersonGraph } from "@/components/mini-person-graph";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  RelationshipWithPerson,
  RelationshipsGroupedResponse,
} from "@shared/schema";

interface RelationshipsTabProps {
  /** Full relationship list from the parent person query, used to back the
   *  edit dialog (which expects RelationshipWithPerson) without an extra
   *  fetch. */
  relationships: RelationshipWithPerson[];
  personId: string;
  personName?: string;
  onAddRelationship: () => void;
}

/**
 * Returns a foreground color (white or near-black) that has acceptable
 * contrast against the supplied hex background color. Falls back to white
 * if the input cannot be parsed.
 */
function getReadableTextColor(hex: string): string {
  if (!hex) return "#ffffff";
  const m = hex.replace("#", "");
  if (m.length !== 3 && m.length !== 6) return "#ffffff";
  const expanded = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return "#ffffff";
  // Perceived luminance (Rec. 709 coefficients).
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? "#111827" : "#ffffff";
}

export function RelationshipsTab({
  relationships,
  personId,
  personName,
  onAddRelationship,
}: RelationshipsTabProps) {
  const { toast } = useToast();
  const [editingRelationship, setEditingRelationship] =
    useState<RelationshipWithPerson | null>(null);

  // Single API call powering this view: types + chips + colors.
  const { data, isLoading } = useQuery<RelationshipsGroupedResponse>({
    queryKey: ["/api/people", personId, "relationships-grouped"],
    enabled: !!personId,
  });

  const groups = data?.groups ?? [];

  // Map relationship id -> full object so chips' edit/delete actions can
  // hand the dialog the shape it expects without an additional fetch.
  const relationshipsById = useMemo(() => {
    const map = new Map<string, RelationshipWithPerson>();
    for (const rel of relationships) {
      map.set(rel.id, rel);
    }
    return map;
  }, [relationships]);

  const deleteMutation = useMutation({
    mutationFn: async (relationshipId: string) => {
      return await apiRequest(
        "DELETE",
        `/api/relationships/${relationshipId}`,
        undefined
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/people", String(personId)],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/me"],
      });
      toast({
        title: "Success",
        description: "Relationship deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete relationship",
        variant: "destructive",
      });
    },
  });

  const hasAny = groups.length > 0;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Relationships</h2>
        <Button
          onClick={onAddRelationship}
          size="sm"
          data-testid="button-add-relationship"
        >
          <Plus className="h-4 w-4" />
          Add Relationship
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: grouped chips. Spans two columns on large screens. */}
        <div className="lg:col-span-2 min-w-0">
          {isLoading ? (
            <div
              className="text-sm text-muted-foreground"
              data-testid="text-relationships-loading"
            >
              Loading relationships…
            </div>
          ) : hasAny ? (
            <div className="space-y-6">
              {groups.map((group) => {
                const titleColor = group.type.color || "#6b7280";
                return (
                  <section
                    key={group.type.id ?? "untyped"}
                    data-testid={`relationship-group-${group.type.id ?? "untyped"}`}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: titleColor }}
                        aria-hidden="true"
                      />
                      <h3
                        className="text-base font-semibold"
                        style={{ color: titleColor }}
                        data-testid={`text-group-title-${group.type.id ?? "untyped"}`}
                      >
                        {group.type.name}
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        ({group.relationships.length})
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.relationships.map((rel) => {
                        const fullName = `${rel.toPerson.firstName} ${rel.toPerson.lastName}`.trim();
                        const fullRel = relationshipsById.get(rel.id);
                        const fg = getReadableTextColor(titleColor);
                        return (
                          <div
                            key={rel.id}
                            className="group inline-flex items-center rounded-full overflow-hidden text-sm shadow-sm"
                            style={{ backgroundColor: titleColor, color: fg }}
                            data-testid={`chip-relationship-${rel.id}`}
                          >
                            <Link
                              href={`/person/${rel.toPerson.id}`}
                              className="px-3 py-1 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                              data-testid={`chip-link-${rel.id}`}
                              title={fullName}
                            >
                              {fullName || "Unnamed"}
                            </Link>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="px-1.5 py-1 opacity-70 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                                  aria-label={`Actions for relationship with ${fullName}`}
                                  data-testid={`chip-actions-${rel.id}`}
                                >
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  disabled={!fullRel}
                                  onClick={() => {
                                    if (fullRel) setEditingRelationship(fullRel);
                                  }}
                                  data-testid={`chip-edit-${rel.id}`}
                                >
                                  <Edit className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={deleteMutation.isPending}
                                  onClick={() => deleteMutation.mutate(rel.id)}
                                  className="text-destructive focus:text-destructive"
                                  data-testid={`chip-delete-${rel.id}`}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Users2 className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium mb-2">No relationships yet</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                Connect this person with others in your network to track
                relationships
              </p>
              <Button
                onClick={onAddRelationship}
                data-testid="button-add-relationship-empty"
              >
                <Plus className="h-4 w-4" />
                Add Relationship
              </Button>
            </div>
          )}
        </div>

        {/* Right: a small chrome-less 3D graph of direct connections. */}
        <aside
          className="lg:col-span-1"
          data-testid="relationships-mini-graph-panel"
        >
          <div className="h-[420px] lg:sticky lg:top-4">
            <MiniPersonGraph
              personId={personId}
              personName={personName ?? "This person"}
              data={data}
            />
          </div>
        </aside>
      </div>

      {editingRelationship && (
        <RelationshipDialog
          open={!!editingRelationship}
          onOpenChange={(open) => !open && setEditingRelationship(null)}
          relationship={editingRelationship}
          personId={personId}
        />
      )}
    </div>
  );
}
