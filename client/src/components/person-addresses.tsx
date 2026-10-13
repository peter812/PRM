/**
 * A person's address history (address-history-plan.md §6.1): current addresses
 * with one primary, and past ones with date ranges. A primary that has ended
 * stays primary and shows as "Outdated" until the user picks a new one.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronDown, Home, Pencil, Plus, Star, Trash2 } from "lucide-react";
import type { PersonAddress } from "@shared/schema";
import { formatDateRange } from "@shared/partial-date";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { mapHref } from "@/lib/map-shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const OUTDATED_TEXT = "text-yellow-700 dark:text-yellow-300";

export function OutdatedBadge() {
  return (
    <span className="ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200">
      Outdated
    </span>
  );
}

type Form = { address: string; label: string; startDate: string; endDate: string; isPrimary: boolean };
const EMPTY: Form = { address: "", label: "", startDate: "", endDate: "", isPrimary: false };

export function PersonAddresses({ personId }: { personId: string }) {
  const { toast } = useToast();
  const queryKey = ["/api/people", personId, "addresses"];
  const { data: addresses = [] } = useQuery<PersonAddress[]>({ queryKey });
  const [editing, setEditing] = useState<PersonAddress | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [showPast, setShowPast] = useState(false);

  const mutation = useMutation({
    mutationFn: async ({ method, url, body }: { method: string; url: string; body?: unknown }) =>
      (await apiRequest(method, url, body)).json(),
    onSuccess: (row: PersonAddress | { ok: true }) => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/people", personId] });
      setEditing(null);
      if ("isPrimary" in row && row.isPrimary === 1 && row.endDate) {
        toast({ title: "Primary address is now outdated — pick a new primary." });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't save address", description: error.message.replace(/^\d+: /, ""), variant: "destructive" });
    },
  });

  const open = (row: PersonAddress | "new") => {
    setForm(row === "new" ? EMPTY : {
      address: row.address,
      label: row.label ?? "",
      startDate: row.startDate ?? "",
      endDate: row.endDate ?? "",
      isPrimary: row.isPrimary === 1,
    });
    setEditing(row);
  };

  const save = () => {
    const body = {
      address: form.address,
      label: form.label.trim() || null,
      startDate: form.startDate.trim() || null,
      endDate: form.endDate.trim() || null,
      // Only sent to make an address primary; clearing it is done by picking another.
      ...(form.isPrimary && !form.endDate.trim() ? { isPrimary: true } : {}),
    };
    mutation.mutate(editing === "new"
      ? { method: "POST", url: `/api/people/${personId}/addresses`, body }
      : { method: "PATCH", url: `/api/addresses/${(editing as PersonAddress).id}`, body });
  };

  // The primary stays on top even when it has ended.
  const current = addresses.filter((a) => a.isPrimary === 1 || !a.endDate);
  const past = addresses.filter((a) => a.isPrimary !== 1 && a.endDate);

  const row = (a: PersonAddress) => {
    const outdated = a.isPrimary === 1 && !!a.endDate;
    const range = formatDateRange(a.startDate, a.endDate);
    return (
      <div key={a.id} className="group flex items-start gap-2 text-sm" data-testid="address-item">
        {a.isPrimary === 1 ? (
          <Star className={`h-4 w-4 mt-0.5 shrink-0 fill-current ${outdated ? OUTDATED_TEXT : "text-primary"}`} />
        ) : a.endDate ? (
          <Home className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        ) : (
          <button
            title="Make primary"
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
            onClick={() => mutation.mutate({ method: "PATCH", url: `/api/addresses/${a.id}`, body: { isPrimary: true } })}
          >
            <Star className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className={`break-words ${outdated ? OUTDATED_TEXT : ""}`}>
            <Link href={mapHref(personId, a.address)} className="hover:underline" title="Show on map">
              {a.address}
            </Link>
            {a.label && <span className="ml-1.5 text-xs text-muted-foreground">({a.label})</span>}
            {outdated && <OutdatedBadge />}
          </div>
          {range && <div className="text-xs text-muted-foreground">{range}</div>}
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100">
          <button title="Edit" className="text-muted-foreground hover:text-foreground" onClick={() => open(a)}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            title="Delete"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => confirm(`Delete ${a.address}?`) && mutation.mutate({ method: "DELETE", url: `/api/addresses/${a.id}` })}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  };

  const field = (key: "address" | "label" | "startDate" | "endDate", label: string, placeholder?: string) => (
    <div className="space-y-1">
      <Label htmlFor={`address-${key}`}>{label}</Label>
      <Input
        id={`address-${key}`}
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2 border-b pb-2 text-foreground/80">
        <Home className="h-5 w-5 text-primary" />
        Addresses
        <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => open("new")} data-testid="button-add-address">
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </h3>

      <div className="space-y-3 pl-7">
        {current.length > 0 ? current.map(row) : (
          <div className="text-sm text-muted-foreground italic">No current address.</div>
        )}
        {past.length > 0 && (
          <div className="space-y-3">
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowPast(!showPast)}>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showPast ? "" : "-rotate-90"}`} />
              Previous addresses ({past.length})
            </button>
            {showPast && past.map(row)}
          </div>
        )}
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add address" : "Edit address"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {field("address", "Address")}
            {field("label", "Label", "Home, Dorm…")}
            <div className="grid grid-cols-2 gap-3">
              {field("startDate", "Start", "YYYY-MM")}
              {field("endDate", "End (empty = current)", "YYYY-MM")}
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="address-primary"
                checked={form.isPrimary && !form.endDate.trim()}
                disabled={!!form.endDate.trim() || (editing !== "new" && editing?.isPrimary === 1)}
                onCheckedChange={(c) => setForm({ ...form, isPrimary: c === true })}
              />
              <Label htmlFor="address-primary">Primary address</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={!form.address.trim() || mutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
