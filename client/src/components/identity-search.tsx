// "Someone else…" picker for naming faces: search-as-you-type over people and social accounts
// (3+ chars, debounced), with create-and-pick when nothing matches. Used by Face review's
// per-photo face rows and the cluster dialog.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SocialAccountDialog } from "@/components/social-account-dialog";
import { PersonDialog } from "@/components/person-dialog";
import { getInitials } from "@/lib/utils";
import { withImageSize } from "@shared/image-size";
import type { Person, SocialAccount } from "@shared/schema";

export type IdentityTarget = { personId?: string; socialAccountId?: string };

type SearchPerson = Person & { uuid?: string; name?: string };

const getPersonId = (p: SearchPerson) => p.id || p.uuid || "";
const getPersonName = (p: SearchPerson) => `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.name || "Unknown";

/** `placedIds`: identities already on another face here; still pickable, listed last and marked. */
export function IdentitySearch({ onPick, onCancel, placedIds, placedLabel = " (also in this photo)" }: {
  onPick: (target: IdentityTarget) => void;
  onCancel: () => void;
  placedIds?: Set<unknown>;
  placedLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  // A search that found nobody: create the account/person, then pick it.
  const [createFor, setCreateFor] = useState<"account" | "person" | null>(null);
  const newPersonName = useMemo(() => {
    const [firstName = "", ...rest] = createFor === "person" ? debounced.split(/\s+/) : [];
    return { firstName, lastName: rest.join(" ") };
  }, [createFor, debounced]);

  const active = debounced.length >= 3;
  const fetchList = async (url: string) => {
    const res = await fetch(url, { credentials: "include" });
    return res.ok ? res.json() : [];
  };
  const { data: people = [], isFetching: fetchingPeople } = useQuery<SearchPerson[]>({
    queryKey: ["/api/people/search", { q: debounced }],
    queryFn: () => fetchList(`/api/people/search?q=${encodeURIComponent(debounced)}`),
    enabled: active,
  });
  const { data: accounts = [], isFetching: fetchingAccounts } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts", { search: debounced }],
    queryFn: () => fetchList(`/api/social-accounts?search=${encodeURIComponent(debounced)}`),
    enabled: active,
  });
  const searching = fetchingPeople || fetchingAccounts;
  const placed = (id: string) => !!placedIds?.has(id);
  const placedLast = <T,>(list: T[], id: (x: T) => string) => [...list.filter((x) => !placed(id(x))), ...list.filter((x) => placed(id(x)))];
  const visiblePeople = placedLast(people, getPersonId);
  const visibleAccounts = placedLast(accounts, (a) => a.id);
  const short = query.trim().length;

  return (
    <div className="pt-1 space-y-1" onClick={(e) => e.stopPropagation()}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search people or accounts (3+ chars)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
          className="pl-8 h-8 text-sm"
          autoFocus
          data-testid="input-face-search"
        />
        {query && (
          <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setQuery("")}>
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
      {short > 0 && short < 3 && (
        <div className="border rounded-md p-2 text-xs text-muted-foreground text-center">
          Type {3 - short} more character{3 - short > 1 ? "s" : ""} to search…
        </div>
      )}
      {active && (
        <div className="max-h-56 overflow-auto space-y-2 border rounded-md p-1.5">
          {searching && (
            <div className="p-2 text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
            </div>
          )}

          {visiblePeople.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-0.5">Person Profiles</div>
              {visiblePeople.map((p) => {
                const pid = getPersonId(p);
                const name = getPersonName(p);
                return (
                  <button
                    key={pid}
                    type="button"
                    className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent flex items-center gap-2"
                    onClick={() => onPick({ personId: pid })}
                    data-testid={`result-person-${pid}`}
                  >
                    <Avatar className="h-5 w-5 shrink-0">
                      {p.imageUrl && <AvatarImage src={withImageSize(p.imageUrl, 64)} alt={name} />}
                      <AvatarFallback className="text-[10px]">{getInitials(p.firstName || name, p.lastName || "")}</AvatarFallback>
                    </Avatar>
                    <span className="truncate font-medium">{name}</span>
                    {placed(pid) && <span className="text-xs text-muted-foreground shrink-0">{placedLabel}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {visibleAccounts.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-0.5">Social Accounts</div>
              {visibleAccounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent flex items-center gap-2"
                  onClick={() => onPick({ socialAccountId: a.id })}
                  data-testid={`result-account-${a.id}`}
                >
                  <Avatar className="h-5 w-5 shrink-0">
                    {a.imageUrl && <AvatarImage src={withImageSize(a.imageUrl, 64)} alt={a.username} />}
                    <AvatarFallback className="text-[10px]">@{a.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="truncate">@{a.username}</span>
                  {placed(a.id) && <span className="text-xs text-muted-foreground shrink-0">{placedLabel}</span>}
                </button>
              ))}
            </div>
          )}

          {!searching && !visibleAccounts.length && !visiblePeople.length && (
            <div className="px-2 py-1.5 space-y-1.5">
              <p className="text-xs text-muted-foreground">No matches for "{debounced}"</p>
              <div className="flex gap-1.5">
                {(["account", "person"] as const).map((k) => (
                  <Button key={k} size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCreateFor(k)} data-testid={`button-create-${k}`}>
                    <Plus className="h-3 w-3 mr-1" /> {k === "account" ? "Social account" : "Person"}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <SocialAccountDialog
        open={createFor === "account"}
        onOpenChange={(open) => !open && setCreateFor(null)}
        initialUsername={debounced.replace(/^@/, "")}
        queueTrackingByDefault={false}
        onAccountCreated={(a) => onPick({ socialAccountId: a.id })}
      />
      <PersonDialog
        open={createFor === "person"}
        onOpenChange={(open) => !open && setCreateFor(null)}
        initialValues={newPersonName}
        onPersonCreated={(p) => onPick({ personId: p.id })}
      />
    </div>
  );
}
