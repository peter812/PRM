import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, ScanFace } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { imageDetailHref } from "@/lib/image-link";

// Mirrors ProfileLinkOutcome / ProfilePhotoRun in server/recognition.ts.
type ProfileLink =
  | { linked: true; personfaceUuid: string; alreadyLinked: boolean }
  | { linked: false; reason: string };
type Run = { photoId: string; facesDetected: number; profileLink: ProfileLink };

type ProfilePhotoInfo = {
  current: {
    id: string; location: string; widthPx: number | null; heightPx: number | null;
    uploadedAt: string; faceIdAt: string | null;
    facialIds: { faceUuid?: string; personId?: string | null; socialAccountId?: string | null }[];
  } | null;
  previousCount: number;
  personfaceUuid: string | null;
  groupFaces: number;
};

const REASON_LABEL: Record<string, string> = {
  no_faces: "no face found",
  multiple_faces: "more than one face, so none was linked",
  no_box: "the face had no usable bounds",
  face_too_small: "the face is smaller than the minimum in Recognition settings",
  face_missing: "PRM-Face did not keep the face",
  group_conflict: "the face already belongs to a different identity",
  not_profile: "not a profile picture",
};

const describeLink = (link: ProfileLink) =>
  link.linked
    ? link.alreadyLinked ? "already linked to this account" : "linked to this account"
    : `not linked: ${REASON_LABEL[link.reason] ?? link.reason}`;

interface ProfilePhotoDialogProps {
  accountId: string;
  username: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Info on the stored profile picture plus a manual, synchronous recognition run. */
export function ProfilePhotoDialog({ accountId, username, open, onOpenChange }: ProfilePhotoDialogProps) {
  const [includePrevious, setIncludePrevious] = useState(false);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const { data: info, isLoading } = useQuery<ProfilePhotoInfo>({
    queryKey: ["/api/social-accounts", accountId, "profile-photo"],
    enabled: open,
  });

  const recognize = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/social-accounts/${accountId}/profile-photo/recognize`, { includePrevious });
      return (await res.json()) as { runs: Run[] };
    },
    onMutate: () => { setRuns(null); setRunError(null); },
    onSuccess: ({ runs }) => {
      setRuns(runs);
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", accountId] });
    },
    onError: (error: Error) => setRunError(error.message),
  });

  const current = info?.current;
  const facesOnCurrent = current?.facialIds.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" data-testid="dialog-profile-photo">
        <DialogHeader>
          <DialogTitle>Profile picture of @{username}</DialogTitle>
          <DialogDescription>
            A picture with exactly one face links that face to this account, so it can be named wherever else it appears.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
        ) : !current ? (
          <p className="text-sm text-muted-foreground">No profile picture is stored for this account.</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Stored copy</dt>
            <dd>
              <Link href={imageDetailHref(current.id)} className="underline" data-testid="link-profile-photo-detail">
                {current.widthPx && current.heightPx ? `${current.widthPx}×${current.heightPx}px` : "open image"}
              </Link>
            </dd>
            <dt className="text-muted-foreground">Saved</dt>
            <dd>{new Date(current.uploadedAt).toLocaleString()}</dd>
            <dt className="text-muted-foreground">Recognition</dt>
            <dd>
              {current.faceIdAt
                ? `${new Date(current.faceIdAt).toLocaleString()} · ${facesOnCurrent} face${facesOnCurrent === 1 ? "" : "s"}`
                : "never run"}
            </dd>
            <dt className="text-muted-foreground">Account face</dt>
            <dd>
              {info?.personfaceUuid
                ? `linked · ${info.groupFaces} face${info.groupFaces === 1 ? "" : "s"} in the group`
                : "not linked"}
            </dd>
          </dl>
        )}

        {current && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="profile-photo-include-previous"
              checked={includePrevious}
              onCheckedChange={(v) => setIncludePrevious(v === true)}
              disabled={!info?.previousCount}
              data-testid="checkbox-include-previous-profile-photos"
            />
            <Label htmlFor="profile-photo-include-previous" className="text-sm font-normal">
              Include {info?.previousCount ?? 0} previous profile picture{info?.previousCount === 1 ? "" : "s"}
            </Label>
          </div>
        )}

        {runs && (
          <ul className="text-sm space-y-1" data-testid="list-profile-photo-runs">
            {runs.map((run, i) => (
              <li key={run.photoId}>
                {i === 0 ? "Current" : `Previous ${i}`}: {run.facesDetected} face{run.facesDetected === 1 ? "" : "s"}, {describeLink(run.profileLink)}
              </li>
            ))}
          </ul>
        )}
        {runError && <p className="text-sm text-destructive">{runError}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button
            onClick={() => recognize.mutate()}
            disabled={!current || recognize.isPending}
            className="gap-1.5"
            data-testid="button-run-profile-photo-recognition"
          >
            {recognize.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanFace className="h-4 w-4" />}
            Run facial recognition
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
