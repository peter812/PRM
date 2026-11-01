// The social account page's Faces tab (account-faces-plan.md): the account holder's own face,
// and the other faces seen in this account's profile images, posts, stories and tagged posts.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, ScanFace, Trash2, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { FaceBoxOverlay } from "@/components/face-box-overlay";
import { FaceClustersTab } from "@/components/face-clusters-tab";
import { IdentitySearch, type IdentityTarget } from "@/components/identity-search";
import { useNoFaceToggle } from "@/components/no-face-account";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { withImageSize } from "@shared/image-size";

export type AccountFaceCounts = { group: string | null; total: number; holder: number; unnamed: number; needsLook: number; probably: number };

type FaceBox = { x: number; y: number; w: number; h: number };
type HolderFaceSource = "profile" | "post" | "story" | "message" | "other";
type HolderFace = {
  id: string; cropUrl: string; photoId: string | null; photoUrl: string | null;
  box: FaceBox | null; width: number | null; height: number | null;
  source: HolderFaceSource; postId: string | null; postAccountId: string | null; date: string | null;
  inScope: boolean; how: "confirmed" | "auto"; score: number | null;
};
type ProfileCandidate = { photoId: string; photoUrl: string; current: boolean; faces: { id: string; cropUrl: string; label: string | null }[] };
type HolderOwner = { personId: string; name: string; group: string | null; cropUrl: string | null; faceCount: number };
type OwnerConflict = "none" | "owner-has-none" | "account-has-none" | "differs";
type AccountHolder = {
  group: string | null; noFace: boolean; username: string; owner: HolderOwner | null; conflict: OwnerConflict;
  faces: HolderFace[]; profileCandidates: ProfileCandidate[];
};
/** Face review's Verify list for one identity (server/face-verify.ts); only `pendingFaces` is used here. */
type VerifyFace = { id: string; cropUrl: string; score: number };
type VerifyGroup = { group: string; pendingFaces: VerifyFace[] };

const SOURCE_LABEL: Record<HolderFaceSource, string> = { profile: "Profile", post: "Post", story: "Story", message: "Message", other: "Other" };

export const accountFaceCountsKey = (accountId: string) => [`/api/social-accounts/${accountId}/faces/counts`];
const holderKey = (accountId: string) => [`/api/social-accounts/${accountId}/faces/holder`];

/** What still wants a decision here: the sidebar badge. */
export const accountFacesPending = (c: AccountFaceCounts | undefined) => (c ? c.unnamed + c.needsLook + c.probably : 0);

export function useAccountFaceCounts(accountId: string | undefined) {
  return useQuery<AccountFaceCounts>({ queryKey: accountFaceCountsKey(accountId ?? ""), enabled: !!accountId });
}

/** This tab's queries plus every Face review / Faces page query, after faces change. */
export const invalidateAccountFaces = (accountId: string) => queryClient.invalidateQueries({
  predicate: (q) => {
    const k = String(q.queryKey[0]);
    return k.startsWith(`/api/social-accounts/${accountId}/faces`) || k.startsWith("/api/face-review") || k.startsWith("/api/faces");
  },
});

export function AccountFacesTab({ accountId }: { accountId: string }) {
  const { data: counts, isLoading } = useAccountFaceCounts(accountId);
  const [clusterId, setClusterId] = useState<string | null>(null);

  if (isLoading || !counts) return <Spinner />;

  return (
    <Tabs defaultValue="holder" className="p-6 space-y-4">
      <TabsList>
        <TabsTrigger value="holder" data-testid="tab-faces-holder">Account holder</TabsTrigger>
        <TabsTrigger value="others" data-testid="tab-faces-others">Other faces</TabsTrigger>
      </TabsList>
      <TabsContent value="holder">
        <AccountHolderView accountId={accountId} />
      </TabsContent>
      <TabsContent value="others" className="space-y-6">
        <p className="text-sm text-muted-foreground">{counts.total - counts.holder} other faces, {counts.unnamed} still unnamed.</p>
        <PeopleSeen accountId={accountId} />
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Unnamed clusters</h3>
          <FaceClustersTab accountId={accountId} clusterId={clusterId} onOpenCluster={setClusterId} />
        </section>
        <LooseFaces accountId={accountId} />
      </TabsContent>
    </Tabs>
  );
}

const onMutationError = (toast: ReturnType<typeof useToast>["toast"]) => (err: Error) =>
  toast({ title: "That didn't work", description: err.message.replace(/^\d+: /, ""), variant: "destructive" });

/** Confirm auto-assigned faces where they are. */
function useKeepFaces(accountId: string, label: string) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) return 0;
      await apiRequest("POST", "/api/faces/keep", { faceUuids: ids });
      return ids.length;
    },
    onSuccess: (n) => toast({ title: `Kept ${n} face${n === 1 ? "" : "s"} as ${label}` }),
    onError: onMutationError(toast),
    onSettled: () => invalidateAccountFaces(accountId),
  });
}

/** Take faces out of whatever group they are in. */
function useRemoveFaces(accountId: string, label: string, onDone?: () => void) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) return 0;
      await apiRequest("POST", "/api/faces/remove-from-group", { faceUuids: ids });
      return ids.length;
    },
    onSuccess: (n) => {
      toast({ title: `Removed ${n} face${n === 1 ? "" : "s"} from ${label}` });
      onDone?.();
    },
    onError: onMutationError(toast),
    onSettled: () => invalidateAccountFaces(accountId),
  });
}

const Spinner = () => <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

// ── Account holder (§2) ─────────────────────────────────────────────────────────

type ScopeFilter = "all" | "here" | "elsewhere";

function AccountHolderView({ accountId }: { accountId: string }) {
  const { data, isLoading } = useQuery<AccountHolder>({ queryKey: holderKey(accountId) });
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [source, setSource] = useState<HolderFaceSource | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<HolderFace | null>(null);

  const remove = useRemoveFaces(accountId, `@${data?.username}`, () => {
    setSelected(new Set());
    setOpen(null);
  });
  const keep = useKeepFaces(accountId, `@${data?.username}`);
  const noFace = useNoFaceToggle(invalidateAccountFaces);

  const faces = data?.faces ?? [];
  const sources = useMemo(() => Array.from(new Set(faces.map((f) => f.source))), [faces]);
  const shown = faces.filter((f) => (scope === "all" || (scope === "here") === f.inScope) && (source === "all" || f.source === source));

  if (isLoading || !data) return <Spinner />;

  const noFaceSwitch = (
    <>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Switch checked={data.noFace} disabled={noFace.isPending} onCheckedChange={() => noFace.toggle({ id: accountId, username: data.username, noFace: data.noFace })} data-testid="switch-no-face" />
        No single face (brand/org)
      </label>
      {noFace.dialog}
    </>
  );
  if (!data.group) return <PickHolderFace accountId={accountId} holder={data} noFaceSwitch={noFaceSwitch} />;

  const auto = faces.filter((f) => f.how === "auto").sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  const here = faces.filter((f) => f.inScope).length;
  const best = faces.find((f) => f.how === "confirmed" && f.source === "profile") ?? faces.find((f) => f.how === "confirmed") ?? faces[0];
  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        {best && <img src={withImageSize(best.cropUrl, 128)} alt="" className="h-20 w-20 rounded-lg object-cover bg-muted" />}
        <div className="space-y-1">
          <div className="font-medium">@{data.username}</div>
          <div className="text-sm text-muted-foreground">
            {faces.length} face{faces.length === 1 ? "" : "s"} · {here} in this account · {faces.length - here} elsewhere
          </div>
          <Link href={`/faces?group=${encodeURIComponent(data.group)}`} className="text-xs text-primary inline-flex items-center gap-1">
            Open on the Faces page <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <div className="ml-auto">{noFaceSwitch}</div>
      </div>

      <OwnerFaceBanner accountId={accountId} holder={data} accountCrop={best?.cropUrl ?? null} />

      {auto.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">Needs a look</h3>
            <span className="text-xs text-muted-foreground">{auto.length} auto-assigned, lowest score first</span>
            <Button size="sm" variant="outline" className="ml-auto h-7" disabled={keep.isPending} onClick={() => keep.mutate(auto.map((f) => f.id))} data-testid="button-keep-all-auto">
              {keep.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
              Keep all {auto.length}
            </Button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {auto.map((f) => (
              <div key={f.id} className="w-24 shrink-0 space-y-1">
                <button type="button" onClick={() => setOpen(f)} className="relative block w-full">
                  <img src={withImageSize(f.cropUrl, 128)} alt="" loading="lazy" className="aspect-square w-full rounded object-cover bg-muted" />
                  <Badge className="absolute bottom-1 left-1 h-4 px-1 text-[10px] bg-amber-500/90 hover:bg-amber-500/90">{Math.round((f.score ?? 0) * 100)}%</Badge>
                </button>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-6 flex-1 px-0" title="Keep" disabled={keep.isPending || remove.isPending} onClick={() => keep.mutate([f.id])}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 flex-1 px-0" title={`Not @${data.username}`} disabled={keep.isPending || remove.isPending} onClick={() => remove.mutate([f.id])}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <ProbablyThem accountId={accountId} group={data.group} username={data.username} />

      <h3 className="text-sm font-medium">All faces</h3>
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips value={scope} onChange={setScope} options={[["all", "All"], ["here", "In this account"], ["elsewhere", "Elsewhere"]]} />
        {sources.length > 1 && (
          <FilterChips value={source} onChange={setSource} options={[["all", "Any source"], ...sources.map((s) => [s, SOURCE_LABEL[s]] as [HolderFaceSource, string])]} />
        )}
        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{selected.size} selected</span>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(Array.from(selected))} data-testid="button-remove-holder-faces">
              {remove.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Not @{data.username}
            </Button>
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No faces match these filters.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
          {shown.map((f) => (
            <HolderFaceTile key={f.id} face={f} selected={selected.has(f.id)} onToggle={() => toggle(f.id)} onOpen={() => setOpen(f)} />
          ))}
        </div>
      )}

      <FacePhotoDialog face={open} label={`@${data.username}`} removing={remove.isPending} onRemove={(id) => remove.mutate([id])} onClose={() => setOpen(null)} />
    </div>
  );
}

function FilterChips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex gap-1 rounded-md bg-muted/50 p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn("px-2 py-1 text-xs rounded", value === v ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function HolderFaceTile({ face, selected, onToggle, onOpen }: { face: HolderFace; selected: boolean; onToggle: () => void; onOpen: () => void }) {
  return (
    <div className={cn("group relative rounded-md overflow-hidden ring-2", selected ? "ring-primary" : "ring-transparent")}>
      <button type="button" onClick={onOpen} className="block w-full" title={face.date ? new Date(face.date).toLocaleDateString() : undefined}>
        <img src={withImageSize(face.cropUrl, 128)} alt="" loading="lazy" className={cn("aspect-square w-full object-cover bg-muted", !face.inScope && "opacity-60")} />
      </button>
      <button
        type="button"
        onClick={onToggle}
        aria-label={selected ? "Deselect face" : "Select face"}
        className={cn(
          "absolute top-1 left-1 h-5 w-5 rounded border flex items-center justify-center bg-background/80",
          selected ? "opacity-100 border-primary" : "opacity-0 group-hover:opacity-100",
        )}
      >
        {selected && <Check className="h-3.5 w-3.5 text-primary" />}
      </button>
      <div className="absolute bottom-0 inset-x-0 flex justify-between gap-1 p-1 pointer-events-none">
        <Badge variant="secondary" className="h-4 px-1 text-[10px]">{SOURCE_LABEL[face.source]}</Badge>
        {face.how === "auto" && face.score !== null && (
          <Badge className="h-4 px-1 text-[10px] bg-amber-500/90 hover:bg-amber-500/90">Auto {Math.round(face.score * 100)}%</Badge>
        )}
      </div>
    </div>
  );
}

function FacePhotoDialog({ face, label, removing, onRemove, onClose, actions }: {
  face: HolderFace | null; label: string; removing?: boolean; onRemove?: (id: string) => void; onClose: () => void;
  /** Replaces the "Not <label>" button. */
  actions?: ReactNode;
}) {
  return (
    <Dialog open={!!face} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{face ? SOURCE_LABEL[face.source] : ""}</DialogTitle>
          <DialogDescription>
            {face?.date ? new Date(face.date).toLocaleDateString() : "No date"}
            {face && !face.inScope && " · not in this account's photos"}
            {face?.how === "auto" && face.score !== null && ` · auto-assigned at ${Math.round(face.score * 100)}%`}
          </DialogDescription>
        </DialogHeader>
        {face?.photoUrl ? (
          <FaceBoxOverlay
            src={withImageSize(face.photoUrl, 1080)}
            width={face.width}
            height={face.height}
            faces={[{ key: face.id, box: face.box, color: "#3b82f6", label, variant: "solid" }]}
            className="mx-auto"
            imgClassName="max-h-[65vh] rounded"
          />
        ) : (
          face && <img src={withImageSize(face.cropUrl, 360)} alt="" className="mx-auto rounded" />
        )}
        {face && (
          <div className="flex items-start justify-between gap-2">
            {face.postId && face.postAccountId ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/social-accounts/${face.postAccountId}?postId=${face.postId}`}>Open {face.source === "story" ? "story" : "post"}</Link>
              </Button>
            ) : <span />}
            {actions ?? (
              <Button variant="destructive" size="sm" disabled={removing} onClick={() => onRemove?.(face.id)}>
                <X className="h-4 w-4 mr-1" /> Not {label}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Probably them (§2.2): faces auto-assign thought were this account but didn't move (the verify
 * tier). Everything starts selected; Confirm names the selected faces and rejects the rest, as
 * Face review's Verify tab does.
 */
function ProbablyThem({ accountId, group, username }: { accountId: string; group: string; username: string }) {
  // 404 when the group isn't a named identity: nothing to verify.
  const { data } = useQuery<VerifyGroup>({ queryKey: [`/api/face-review/verify/${group}`], retry: false });
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const confirm = useMutation({
    mutationFn: async (v: { confirm: string[]; reject: string[] }) =>
      (await apiRequest("POST", `/api/face-review/verify/${group}/confirm`, v)).json() as Promise<{ confirmed: number; rejected: number }>,
    onSuccess: (r) => {
      toast({ title: `Confirmed ${r.confirmed}${r.rejected ? `, rejected ${r.rejected}` : ""}` });
      setRejected(new Set());
    },
    onError: onMutationError(toast),
    onSettled: () => invalidateAccountFaces(accountId),
  });

  const list = data?.pendingFaces ?? [];
  if (!list.length) return null;
  const toggle = (id: string) => setRejected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const keepIds = list.filter((f) => !rejected.has(f.id)).map((f) => f.id);

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Probably them</h3>
        <span className="text-xs text-muted-foreground">Click a face to leave it out</span>
        <Button
          size="sm"
          className="ml-auto h-7"
          disabled={confirm.isPending}
          onClick={() => confirm.mutate({ confirm: keepIds, reject: Array.from(rejected) })}
          data-testid="button-confirm-probably"
        >
          {confirm.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
          Confirm {keepIds.length} as @{username}{rejected.size > 0 && `, reject ${rejected.size}`}
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-2">
        {list.map((f) => (
          <button key={f.id} type="button" onClick={() => toggle(f.id)} className="relative rounded overflow-hidden">
            <img src={withImageSize(f.cropUrl, 128)} alt="" loading="lazy" className={cn("aspect-square w-full object-cover bg-muted", rejected.has(f.id) && "opacity-30 grayscale")} />
            {rejected.has(f.id) && <X className="absolute inset-0 m-auto h-6 w-6 text-destructive" />}
            <Badge variant="secondary" className="absolute bottom-1 left-1 h-4 px-1 text-[10px]">{Math.round(f.score * 100)}%</Badge>
          </button>
        ))}
      </div>
    </section>
  );
}

/** §2.3: the account's face and its owner person's face disagree, or one of them has none. */
function OwnerFaceBanner({ accountId, holder, accountCrop }: { accountId: string; holder: AccountHolder; accountCrop: string | null }) {
  const { toast } = useToast();
  const resolve = useMutation({
    mutationFn: (action: "use-account" | "use-owner" | "merge" | "keep-apart") => apiRequest("POST", `/api/social-accounts/${accountId}/faces/owner`, { action }),
    onError: onMutationError(toast),
    onSettled: () => invalidateAccountFaces(accountId),
  });
  const { owner, conflict, username } = holder;
  if (!owner || conflict === "none") return null;

  const act = (action: Parameters<typeof resolve.mutate>[0], label: string, variant: "default" | "outline" = "outline") => (
    <Button size="sm" variant={variant} className="h-7" disabled={resolve.isPending} onClick={() => resolve.mutate(action)} data-testid={`button-owner-${action}`}>
      {label}
    </Button>
  );
  const crop = (url: string | null, title: string, sub: string) => (
    <div className="flex items-center gap-2">
      {url ? <img src={withImageSize(url, 128)} alt="" className="h-12 w-12 rounded object-cover bg-muted" /> : <div className="h-12 w-12 rounded bg-muted" />}
      <div className="text-xs"><div className="font-medium">{title}</div><div className="text-muted-foreground">{sub}</div></div>
    </div>
  );
  const faces = (n: number) => `${n} face${n === 1 ? "" : "s"}`;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-3" data-testid="owner-face-banner">
      {conflict === "owner-has-none" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">{owner.name} has no face yet. Use @{username}'s face for them?</span>
          <div className="ml-auto">{act("use-account", "Use it", "default")}</div>
        </div>
      )}
      {conflict === "account-has-none" && (
        <div className="flex flex-wrap items-center gap-3">
          {crop(owner.cropUrl, owner.name, faces(owner.faceCount))}
          <span className="text-sm">This account's owner already has a face. Use {owner.name}'s face for @{username}?</span>
          <div className="ml-auto">{act("use-owner", "Use it", "default")}</div>
        </div>
      )}
      {conflict === "differs" && (
        <>
          <div className="text-sm">@{username} and its owner {owner.name} have different faces.</div>
          <div className="flex flex-wrap gap-6">
            {crop(accountCrop, `@${username}`, faces(holder.faces.length))}
            {crop(owner.cropUrl, owner.name, faces(owner.faceCount))}
          </div>
          <div className="flex flex-wrap gap-2">
            {act("merge", "Same person, merge", "default")}
            {act("use-owner", `@${username}'s face is wrong`)}
            {act("use-account", `${owner.name}'s face is wrong`)}
            {act("keep-apart", "Leave them different")}
          </div>
        </>
      )}
    </div>
  );
}

/** No face group yet (§2.2 empty state): pick it from a profile picture. */
function PickHolderFace({ accountId, holder, noFaceSwitch }: { accountId: string; holder: AccountHolder; noFaceSwitch: ReactNode }) {
  const { toast } = useToast();
  const onError = onMutationError(toast);
  const pick = useMutation({
    mutationFn: (faceUuid: string) => apiRequest("POST", `/api/social-accounts/${accountId}/faces/holder`, { faceUuid }),
    onSuccess: () => toast({ title: `Linked @${holder.username}'s face` }),
    onError,
    onSettled: () => invalidateAccountFaces(accountId),
  });
  const detect = useMutation({
    mutationFn: () => apiRequest("POST", `/api/social-accounts/${accountId}/profile-photo/recognize`, { includePrevious: true }),
    onError,
    onSettled: () => invalidateAccountFaces(accountId),
  });

  if (holder.noFace) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">This account is marked as having no single face (a brand or organisation), so no faces are matched to it.</p>
        {noFaceSwitch}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <OwnerFaceBanner accountId={accountId} holder={holder} accountCrop={null} />
      <div className="flex items-center gap-4">
        <p className="text-sm text-muted-foreground">No face is linked to @{holder.username} yet. Pick it from a profile picture.</p>
        <div className="ml-auto">{noFaceSwitch}</div>
      </div>
      {holder.profileCandidates.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">No faces have been found in this account's profile pictures.</p>
          <Button size="sm" variant="outline" disabled={detect.isPending} onClick={() => detect.mutate()} data-testid="button-detect-profile-faces">
            {detect.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ScanFace className="h-4 w-4 mr-1" />}
            Run face detection on profile pictures
          </Button>
        </div>
      ) : (
        holder.profileCandidates.map((p) => (
          <div key={p.photoId} className="flex gap-4 items-start">
            <img src={withImageSize(p.photoUrl, 360)} alt="" className="h-28 w-28 rounded-lg object-cover bg-muted" />
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">{p.current ? "Current profile picture" : "Earlier profile picture"}</div>
              <div className="flex flex-wrap gap-3">
                {p.faces.map((f) => (
                  <div key={f.id} className="w-24 space-y-1">
                    <img src={withImageSize(f.cropUrl, 128)} alt="" className="aspect-square w-full rounded object-cover bg-muted" />
                    {f.label && <div className="text-[11px] text-muted-foreground truncate" title={f.label}>Now {f.label}</div>}
                    <Button size="sm" className="w-full h-7 text-xs" disabled={pick.isPending} onClick={() => pick.mutate(f.id)}>
                      This is @{holder.username}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Other faces: People seen (§3.1) ─────────────────────────────────────────────

type ScopeSource = "profile" | "post" | "story" | "tagged";
type PersonSeen = {
  group: string; label: string; personId: string | null; socialAccountId: string | null; cropUrl: string | null;
  count: number; auto: number; sources: Partial<Record<ScopeSource, number>>; lastSeen: string | null;
};
const SCOPE_SOURCE_LABEL: Record<ScopeSource, string> = { profile: "profile", post: "posts", story: "stories", tagged: "tagged" };

/** Named faces seen in this account (not the holder's), most seen first; a row expands to its faces. */
function PeopleSeen({ accountId }: { accountId: string }) {
  const { data, isLoading } = useQuery<{ people: PersonSeen[] }>({ queryKey: [`/api/social-accounts/${accountId}/faces/people`] });
  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading || !data) return <Spinner />;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">People seen <span className="text-muted-foreground font-normal">{data.people.length}</span></h3>
      {data.people.length === 0 && <p className="text-sm text-muted-foreground">No named faces in this account's photos yet.</p>}
      <div className="divide-y rounded-lg border">
        {data.people.map((p) => (
          <div key={p.group} data-testid={`person-seen-${p.group}`}>
            <div className="flex items-center gap-3 p-2">
              <button type="button" className="flex flex-1 items-center gap-3 text-left min-w-0" onClick={() => setExpanded(expanded === p.group ? null : p.group)}>
                {p.cropUrl ? <img src={withImageSize(p.cropUrl, 64)} alt="" className="h-10 w-10 rounded object-cover bg-muted" /> : <div className="h-10 w-10 rounded bg-muted" />}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{p.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.count} face{p.count === 1 ? "" : "s"} · {Object.entries(p.sources).map(([k, n]) => `${n} ${SCOPE_SOURCE_LABEL[k as ScopeSource]}`).join(", ")}
                    {p.lastSeen && ` · last ${new Date(p.lastSeen).toLocaleDateString()}`}
                  </div>
                </div>
                {p.auto > 0 && <Badge className="ml-auto bg-amber-500/90 hover:bg-amber-500/90">{p.auto} auto</Badge>}
              </button>
              {(p.personId || p.socialAccountId) && (
                <Link href={p.personId ? `/person/${p.personId}` : `/social-accounts/${p.socialAccountId}`} className="text-muted-foreground hover:text-foreground" title={`Open ${p.label}`}>
                  <ExternalLink className="h-4 w-4" />
                </Link>
              )}
            </div>
            {expanded === p.group && <PersonSeenFaces accountId={accountId} person={p} />}
          </div>
        ))}
      </div>
    </section>
  );
}

/** One person's faces in this account: auto ones get ✓/✕, any face opens its photo with "Not them". */
function PersonSeenFaces({ accountId, person }: { accountId: string; person: PersonSeen }) {
  const { data, isLoading } = useQuery<{ faces: HolderFace[] }>({ queryKey: [`/api/social-accounts/${accountId}/faces/people/${person.group}`] });
  const [open, setOpen] = useState<HolderFace | null>(null);
  const keep = useKeepFaces(accountId, person.label);
  const remove = useRemoveFaces(accountId, person.label, () => setOpen(null));
  const busy = keep.isPending || remove.isPending;

  if (isLoading || !data) return <Spinner />;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2 p-2 pt-0">
      {data.faces.map((f) => (
        <div key={f.id} className="space-y-1">
          <button type="button" onClick={() => setOpen(f)} className="relative block w-full" title={f.date ? new Date(f.date).toLocaleDateString() : undefined}>
            <img src={withImageSize(f.cropUrl, 128)} alt="" loading="lazy" className="aspect-square w-full rounded object-cover bg-muted" />
            <div className="absolute bottom-1 inset-x-1 flex justify-between gap-1">
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">{f.postAccountId && f.postAccountId !== accountId ? "Tagged" : SOURCE_LABEL[f.source]}</Badge>
              {f.how === "auto" && f.score !== null && <Badge className="h-4 px-1 text-[10px] bg-amber-500/90 hover:bg-amber-500/90">{Math.round(f.score * 100)}%</Badge>}
            </div>
          </button>
          {f.how === "auto" && (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-6 flex-1 px-0" title="Keep" disabled={busy} onClick={() => keep.mutate([f.id])}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="h-6 flex-1 px-0" title={`Not ${person.label}`} disabled={busy} onClick={() => remove.mutate([f.id])}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      ))}
      <FacePhotoDialog face={open} label={person.label} removing={remove.isPending} onRemove={(id) => remove.mutate([id])} onClose={() => setOpen(null)} />
    </div>
  );
}

// ── Other faces: loose faces (§3.3) ─────────────────────────────────────────────

type LoosePage = { faces: HolderFace[]; nextOffset: number | null; noiseCount: number };
const LOOSE_PAGE = 48;
/** Face review's photo kind for a face's source; "other" photos can't be acted on from here. */
const REVIEW_KIND: Partial<Record<HolderFaceSource, string>> = { profile: "profile", post: "post", story: "story", message: "message" };

/** In-scope open faces in no cluster: name one (from its photo) or skip it. */
function LooseFaces({ accountId }: { accountId: string }) {
  const { toast } = useToast();
  const [noise, setNoise] = useState(false);
  const [open, setOpen] = useState<HolderFace | null>(null);
  const [searching, setSearching] = useState(false);
  const query = useInfiniteQuery<LoosePage>({
    queryKey: [`/api/social-accounts/${accountId}/faces/loose`, { noise }],
    queryFn: async ({ pageParam }) => {
      const res = await fetch(`/api/social-accounts/${accountId}/faces/loose?offset=${pageParam}&limit=${LOOSE_PAGE}${noise ? "&noise=1" : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load loose faces");
      return res.json();
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
  const list = query.data?.pages.flatMap((p) => p.faces) ?? [];
  const noiseCount = query.data?.pages[0]?.noiseCount ?? 0;
  const close = () => {
    setOpen(null);
    setSearching(false);
  };
  const body = (f: HolderFace) => ({ faceUuid: f.id, photoId: f.photoId, kind: REVIEW_KIND[f.source] });
  const assign = useMutation({
    mutationFn: (v: { face: HolderFace; to: IdentityTarget; label: string }) =>
      apiRequest("POST", "/api/face-review/assign", { ...body(v.face), socialAccountId: v.to.socialAccountId, personId: v.to.personId, username: v.to.username }),
    onSuccess: (_r, v) => {
      toast({ title: `Named the face as ${v.label}` });
      close();
    },
    onError: onMutationError(toast),
    onSettled: () => invalidateAccountFaces(accountId),
  });
  const skip = useMutation({
    mutationFn: (f: HolderFace) => apiRequest("POST", "/api/face-review/dismiss", body(f)),
    onSuccess: () => {
      toast({ title: "Skipped the face", description: "It's under Skipped in Face review, where it can be undone." });
      close();
    },
    onError: onMutationError(toast),
    onSettled: () => invalidateAccountFaces(accountId),
  });
  const busy = assign.isPending || skip.isPending;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-medium">Loose faces <span className="text-muted-foreground font-normal">not in any cluster</span></h3>
        {noiseCount > 0 && (
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={noise} onCheckedChange={setNoise} data-testid="switch-loose-noise" /> Show noise ({noiseCount})
          </label>
        )}
      </div>
      {query.isLoading ? <Spinner /> : !list.length ? (
        <p className="text-sm text-muted-foreground">No loose faces.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2">
          {list.map((f) => (
            <div key={f.id} className="space-y-1" data-testid={`loose-face-${f.id}`}>
              <button type="button" onClick={() => setOpen(f)} className="relative block w-full" title="Open its photo to name it">
                <img src={withImageSize(f.cropUrl, 128)} alt="" loading="lazy" className="aspect-square w-full rounded object-cover bg-muted" />
                <Badge variant="secondary" className="absolute bottom-1 left-1 h-4 px-1 text-[10px]">
                  {f.source === "post" && f.postAccountId !== accountId ? "Tagged" : SOURCE_LABEL[f.source]}
                </Badge>
              </button>
              {REVIEW_KIND[f.source] && (
                <Button size="sm" variant="outline" className="h-6 w-full px-0 text-xs" disabled={busy} onClick={() => skip.mutate(f)}>
                  Skip
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
            {query.isFetchingNextPage ? "Loading…" : "More faces"}
          </Button>
        </div>
      )}
      <FacePhotoDialog
        face={open}
        label="?"
        onClose={close}
        actions={open && REVIEW_KIND[open.source] ? (
          <div className="flex flex-1 flex-col items-end gap-2">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => skip.mutate(open)}>Skip</Button>
              <Button size="sm" disabled={busy} onClick={() => setSearching((v) => !v)} data-testid="button-loose-name">Name as…</Button>
            </div>
            {searching && (
              <div className="w-full max-w-sm">
                <IdentitySearch onPick={(to, label) => assign.mutate({ face: open, to, label: label ?? "them" })} onCancel={() => setSearching(false)} />
              </div>
            )}
          </div>
        ) : <span />}
      />
    </section>
  );
}
