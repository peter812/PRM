// Social Accounts → Notes (inbox-notes-plan.md): every note the stories run read
// from the Instagram inbox. Every sighting is stored; "Collapse repeats" folds
// the same note seen on several runs (or reposted with the same text and song)
// into one row. Display only. A social account's Notes tab shows NotesList for that account.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronDown, ChevronRight, Loader2, Music } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getInitials } from "@/lib/utils";
import { withImageSize } from "@shared/image-size";
import type { SentNote } from "@shared/schema";

interface NoteRow extends SentNote {
  socialAccountId: string;
  username: string;
  imageUrl: string | null;
  ownerUuid: string | null;
  ownerName: string | null;
}

/** One displayed row: a single note, or every note folded together by "Collapse repeats". */
interface NoteGroup {
  key: string;
  notes: NoteRow[]; // newest first
  sightings: string[]; // every seenAt, oldest first
  days: number;
}

const ALL = "all";
const when = (d: string) => new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const day = (d: string) => new Date(d).toLocaleDateString();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function groupOf(key: string, notes: NoteRow[]): NoteGroup {
  const sightings = notes.flatMap((n) => n.seenAt).sort();
  return { key, notes, sightings, days: new Set(sightings.map(day)).size };
}

function NoteCard({ group }: { group: NoteGroup }) {
  const [open, setOpen] = useState(false);
  const note = group.notes[0];
  const expandable = group.notes.length > 1 || group.sightings.length > 1;
  return (
    <Card data-testid={`note-${note.noteId}`}>
      <CardContent className="p-4 flex gap-3">
        <Avatar className="w-10 h-10 shrink-0">
          {note.imageUrl && <AvatarImage src={withImageSize(note.imageUrl, 64)} alt={note.username} />}
          <AvatarFallback>{getInitials(note.username)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <Link href={`/social-accounts/${note.socialAccountId}`} className="font-medium hover:underline">
              @{note.username}
            </Link>
            {note.ownerUuid && note.ownerName && (
              <Link href={`/person/${note.ownerUuid}`} className="text-muted-foreground hover:underline">
                · {note.ownerName}
              </Link>
            )}
            {group.days > 1 && <Badge variant="secondary">seen on {group.days} days</Badge>}
            {group.notes.length > 1 && <Badge variant="outline">posted {group.notes.length} times</Badge>}
          </div>
          {note.text && <p className="text-sm whitespace-pre-wrap break-words">{note.text}</p>}
          {note.song && (
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Music className="h-3.5 w-3.5 shrink-0" /> {note.song.title} — {note.song.artist}
            </p>
          )}
          <button
            type="button"
            className="text-xs text-muted-foreground text-left flex items-center gap-1 disabled:cursor-default"
            onClick={() => setOpen((v) => !v)}
            disabled={!expandable}
            data-testid={`button-expand-${note.noteId}`}
          >
            {expandable && (open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
            Posted {when(note.createdAt)} · seen {when(group.sightings[0])}
            {group.sightings.length > 1 && ` – ${when(group.sightings[group.sightings.length - 1])}`}
          </button>
          {open && (
            <ul className="text-xs text-muted-foreground space-y-1 pl-4 pt-1">
              {group.notes.map((n) => (
                <li key={n.noteId}>
                  Posted {when(n.createdAt)}: seen {n.seenAt.map(when).join(", ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** The search, filters and note rows; given a socialAccountId, only that account's notes. */
export function NotesList({ socialAccountId }: { socialAccountId?: string }) {
  const [collapse, setCollapse] = useState(true);
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState(ALL);
  const { data, isLoading } = useQuery<NoteRow[]>({ queryKey: ["/api/inbox-notes", { socialAccountId }] });

  const accounts = useMemo(
    () => Array.from(new Map((data ?? []).map((n) => [n.socialAccountId, n.username])).entries()).sort((a, b) => a[1].localeCompare(b[1])),
    [data],
  );

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const shown = (data ?? []).filter(
      (n) =>
        (account === ALL || n.socialAccountId === account) &&
        (!q || [n.text, n.username, n.song?.title, n.song?.artist].some((s) => s?.toLowerCase().includes(q))),
    );
    if (!collapse) return shown.map((n) => groupOf(n.noteId, [n]));
    // Data is newest first, so each group's first note is its newest and groups keep that order.
    const byKey = new Map<string, NoteRow[]>();
    for (const n of shown) {
      const key = JSON.stringify([n.socialAccountId, n.text, n.song?.title ?? null, n.song?.artist ?? null]);
      byKey.set(key, [...(byKey.get(key) ?? []), n]);
    }
    return Array.from(byKey, ([key, notes]) => groupOf(key, notes));
  }, [data, search, account, collapse]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Input
          placeholder={socialAccountId ? "Search text or song" : "Search text, song or username"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[12rem]"
          data-testid="input-search-notes"
        />
        {!socialAccountId && (
          <Select value={account} onValueChange={setAccount}>
            <SelectTrigger className="w-48" data-testid="select-note-account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All accounts</SelectItem>
              {accounts.map(([id, username]) => (
                <SelectItem key={id} value={id}>
                  @{username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-2">
          <Switch id="collapse-repeats" checked={collapse} onCheckedChange={setCollapse} data-testid="switch-collapse-repeats" />
          <Label htmlFor="collapse-repeats" className="text-sm">
            Collapse repeats
          </Label>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-no-notes">
          No notes yet. They arrive with the next stories run.
        </p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes match.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground" data-testid="text-note-counts">
            {plural(groups.length, "row")} ·{" "}
            {plural(
              groups.reduce((n, g) => n + g.notes.length, 0),
              "note",
            )}
          </p>
          {groups.map((g) => (
            <NoteCard key={g.key} group={g} />
          ))}
        </div>
      )}
    </>
  );
}

export default function NotesPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="container max-w-full md:max-w-3xl py-3 md:py-8 px-4 md:pl-12">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold" data-testid="text-notes-title">
            Notes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Notes from the Instagram inbox, read at the start of each stories run.</p>
        </div>
        <NotesList />
      </div>
    </div>
  );
}
