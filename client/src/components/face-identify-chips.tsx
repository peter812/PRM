// The chips that name one face: the photo's suggestions (with look-alike scores merged in),
// extra look-alikes, "Someone else…" search, and Skip / Unskip. Shared by Face review's face
// rows and the post/story modals' face popover (photo-faces-plan.md §3).
import { useState } from "react";
import { Search, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";
import { withImageSize } from "@shared/image-size";
import { IdentitySearch, type IdentityTarget } from "@/components/identity-search";

export type FaceReviewKind = "story" | "profile" | "post" | "message";

export type FaceReviewSuggestion = {
  socialAccountId?: string;
  personId?: string;
  username?: string;
  imageUrl?: string | null;
  ownerName?: string | null;
  label: string;
  reason: "owner" | "coauthor" | "mentioned" | "profile_account" | "sender" | "participant" | "lookalike";
};

export type FaceReviewFaceLookAlike = {
  personfaceUuid: string;
  score: number;
  socialAccountId?: string;
  personId?: string;
  label: string;
  cropUrl: string;
};

/** One face as server/face-review.ts FaceReviewFace sends it. */
export type FaceReviewFace = {
  faceUuid: string;
  number: number;
  box: { x: number; y: number; w: number; h: number } | null;
  cropUrl: string;
  color: string;
  identified: { socialAccountId?: string; personId?: string; username?: string; label: string } | null;
  dismissed: boolean;
  /** Set when PRM auto-assigned this face and nobody has confirmed it. */
  autoMatchScore: number | null;
  /** A quality-noise face (too small, low confidence or blurry); hidden unless "Show noise" is on. */
  noise: boolean;
  cluster: { id: string; size: number } | null;
  lookAlikes: FaceReviewFaceLookAlike[];
};

export const SUGGESTION_COPY: Record<string, string> = {
  owner: "(posted this)",
  coauthor: "(coauthor)",
  mentioned: "(mentioned)",
  profile_account: "",
  sender: "(sent this)",
  participant: "(in this conversation)",
  lookalike: "(looks like them)",
};

export function suggestionLabel(kind: FaceReviewKind, s: FaceReviewSuggestion): string {
  if (kind === "post" && s.reason === "mentioned") return `${s.label} (tagged on this slide)`;
  return `${s.label} ${SUGGESTION_COPY[s.reason] ?? ""}`.trim();
}

/** apiRequest's "409: {"error":"…"}" as just the server's message. */
export function serverError(err: Error): string {
  const body = err.message.replace(/^\d+:\s*/, "");
  try {
    return JSON.parse(body).error ?? body;
  } catch {
    return body;
  }
}

/** Identities already on a face in the photo: still pickable (one person can appear twice), listed last and marked. */
export function placedIdsOf(faces: FaceReviewFace[]): Set<unknown> {
  return new Set(faces.flatMap((f) => [f.identified?.socialAccountId, f.identified?.personId]).filter(Boolean));
}

const ALSO_HERE = " (also in this photo)";
const sameIdentity = (a: { socialAccountId?: string; personId?: string }, b: { socialAccountId?: string; personId?: string }) =>
  (!!a.socialAccountId && a.socialAccountId === b.socialAccountId) || (!!a.personId && a.personId === b.personId);

export function FaceIdentifyChips({ face, kind, suggestions, placedIds, onAssign, onSkip, onUnskip }: {
  face: FaceReviewFace;
  kind: FaceReviewKind;
  suggestions: FaceReviewSuggestion[];
  placedIds: Set<unknown>;
  /** `label` names the face until the server's reply arrives. */
  onAssign: (target: IdentityTarget, label: string) => void;
  onSkip: () => void;
  onUnskip: () => void;
}) {
  const [searching, setSearching] = useState(false);
  const isPlaced = (s: { socialAccountId?: string; personId?: string }) =>
    (!!s.socialAccountId && placedIds.has(s.socialAccountId)) || (!!s.personId && placedIds.has(s.personId));
  const placedLast = <T extends { socialAccountId?: string; personId?: string }>(list: T[]) => [...list.filter((x) => !isPlaced(x)), ...list.filter(isPlaced)];

  const merged: (FaceReviewSuggestion & { score?: number })[] = placedLast(suggestions).map((s) => {
    const match = face.lookAlikes.find((la) => sameIdentity(la, s));
    return match ? { ...s, score: match.score } : s;
  });
  const extraLookAlikes = placedLast(face.lookAlikes).filter((la) => !suggestions.some((s) => sameIdentity(la, s)));
  const assign = (target: IdentityTarget, label: string) => {
    setSearching(false);
    onAssign(target, label);
  };

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {merged.map((s) => (
          <button
            key={`${s.socialAccountId ?? s.personId ?? s.username}-${s.reason}`}
            type="button"
            className="text-xs px-2 py-1 rounded-full border hover:bg-accent flex items-center gap-1"
            onClick={(e) => { e.stopPropagation(); assign({ socialAccountId: s.socialAccountId, personId: s.personId, username: s.username }, s.label); }}
            data-testid={`chip-suggestion-${s.socialAccountId ?? s.personId ?? s.username}`}
          >
            {suggestionLabel(kind, s)}
            {isPlaced(s) && <span className="text-muted-foreground">{ALSO_HERE}</span>}
            {s.score !== undefined && <span className="text-muted-foreground">· {Math.round(s.score * 100)}%</span>}
          </button>
        ))}
        {extraLookAlikes.map((la) => (
          <button
            key={la.personfaceUuid}
            type="button"
            className="text-xs pl-1 pr-2 py-1 rounded-full border hover:bg-accent flex items-center gap-1.5"
            onClick={(e) => { e.stopPropagation(); assign({ socialAccountId: la.socialAccountId, personId: la.personId }, la.label); }}
            data-testid={`chip-lookalike-${la.personfaceUuid}`}
          >
            <img src={withImageSize(la.cropUrl, 64)} alt="" className="h-4 w-4 rounded-full object-cover" />
            looks like {la.label} · {Math.round(la.score * 100)}%
            {isPlaced(la) && <span className="text-muted-foreground">{ALSO_HERE}</span>}
          </button>
        ))}
        <button
          type="button"
          className={cn("text-xs px-2 py-1 rounded-full border hover:bg-accent flex items-center gap-1", searching && "bg-accent")}
          onClick={(e) => { e.stopPropagation(); setSearching((v) => !v); }}
          data-testid={`chip-search-${face.faceUuid}`}
        >
          <Search className="h-3 w-3" /> Someone else…
        </button>
        {!face.dismissed ? (
          <button
            type="button"
            className="text-xs px-2 py-1 rounded-full border border-dashed text-muted-foreground hover:bg-accent flex items-center gap-1"
            onClick={(e) => { e.stopPropagation(); onSkip(); }}
            data-testid={`button-dismiss-${face.faceUuid}`}
          >
            <SkipForward className="h-3 w-3" /> Skip
          </button>
        ) : (
          <button
            type="button"
            className="text-xs px-2 py-1 rounded-full border border-dashed text-muted-foreground hover:bg-accent flex items-center gap-1"
            onClick={(e) => { e.stopPropagation(); onUnskip(); }}
            data-testid={`button-undismiss-${face.faceUuid}`}
          >
            Unskip
          </button>
        )}
      </div>

      {searching && (
        <IdentitySearch
          placedIds={placedIds}
          onPick={(target, label) => assign(target, label ?? `@${target.username ?? "…"}`)}
          onCancel={() => setSearching(false)}
        />
      )}
    </>
  );
}
