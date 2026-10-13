// Per-account processing bans (face scan / OCR / summaries / transcription):
// automatic and bulk runs skip the account. Shared by Face review and the social account page.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BANNED_ACTION_LABELS, type BannedAction } from "@shared/banned-actions";

type BanAccount = { id: string; username: string };
type BanChange = { account: BanAccount; action: BannedAction; banned: boolean; purge: boolean };

const RESULT_NOUN: Record<BannedAction, [string, string]> = {
  facial_scan: ["detected face", "detected faces"],
  ocr: ["OCR result", "OCR results"],
  summary: ["AI summary", "AI summaries"],
  transcribe: ["video transcript", "video transcripts"],
};

/** `set(account, action, banned)` adds or lifts a ban, asking whether to delete existing results first. Render `dialog`. */
export function useBannedActionToggle() {
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<{ account: BanAccount; action: BannedAction; count: number } | null>(null);

  const mutation = useMutation({
    mutationFn: async (v: BanChange) => {
      await apiRequest("PATCH", `/api/social-accounts/${v.account.id}/banned-actions`, { action: v.action, banned: v.banned, purge: v.purge });
    },
    onSuccess: (_, v) => {
      setConfirm(null);
      queryClient.invalidateQueries({ queryKey: ["/api/face-review"] });
      queryClient.invalidateQueries({ queryKey: ["/api/face-review/counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", v.account.id] });
      const label = BANNED_ACTION_LABELS[v.action];
      toast({
        title: v.banned ? `${label} banned for @${v.account.username}` : `${label} allowed again for @${v.account.username}`,
        description: v.purge ? "Existing results were deleted." : undefined,
        // Undo restores the ban only; deleted results aren't brought back.
        action: v.purge ? undefined : (
          <ToastAction altText="Undo" onClick={() => mutation.mutate({ ...v, banned: !v.banned, purge: false })}>Undo</ToastAction>
        ),
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't update the account", description: e.message, variant: "destructive" }),
  });

  async function set(account: BanAccount, action: BannedAction, banned: boolean) {
    if (!banned) return mutation.mutate({ account, action, banned, purge: false });
    try {
      const { count }: { count: number } = await (await apiRequest("GET", `/api/social-accounts/${account.id}/ban-impact?action=${action}`)).json();
      if (count) setConfirm({ account, action, count });
      else mutation.mutate({ account, action, banned, purge: false });
    } catch (e) {
      toast({ title: "Couldn't check the account", description: (e as Error).message, variant: "destructive" });
    }
  }

  const ban = (purge: boolean) => confirm && mutation.mutate({ account: confirm.account, action: confirm.action, banned: true, purge });
  const existing = confirm ? `${confirm.count} ${RESULT_NOUN[confirm.action][confirm.count === 1 ? 0 : 1]}` : "";

  const dialog = (
    <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ban {confirm && BANNED_ACTION_LABELS[confirm.action]} for @{confirm?.account.username}?</AlertDialogTitle>
          <AlertDialogDescription>
            This account already has {existing}. Automatic and bulk runs will skip it from now on; you can keep what's there or delete it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="outline" disabled={mutation.isPending} onClick={() => ban(false)} data-testid="button-ban-keep">
            Ban, keep existing
          </Button>
          <Button variant="destructive" disabled={mutation.isPending} onClick={() => ban(true)} data-testid="button-ban-purge">
            Ban and delete {existing}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { set, dialog, isPending: mutation.isPending };
}
