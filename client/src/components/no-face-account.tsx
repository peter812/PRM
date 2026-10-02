// "This account doesn't have a face" (organisation/brand accounts with no single
// owner): face review and the profile auto-link stop matching faces to it.
// Shared by Face review and the social account page.
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

type NoFaceAccount = { id: string; username: string; noFace: boolean };
type NoFaceImpact = { personfaceUuid: string | null; unlinkedFaces: number };

/** `toggle(account)` flips the flag, asking first when the account already has a face linked. Render `dialog`. */
export function useNoFaceToggle() {
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<{ account: NoFaceAccount; impact: NoFaceImpact } | null>(null);

  const mutation = useMutation({
    mutationFn: async (v: { account: NoFaceAccount; noFace: boolean; clearLinks: boolean }) => {
      await apiRequest("PATCH", `/api/social-accounts/${v.account.id}/no-face`, { noFace: v.noFace, clearLinks: v.clearLinks });
    },
    onSuccess: (_, v) => {
      setConfirm(null);
      queryClient.invalidateQueries({ queryKey: ["/api/face-review"] });
      queryClient.invalidateQueries({ queryKey: ["/api/face-review/counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", v.account.id] });
      toast({
        title: v.noFace ? `@${v.account.username} marked as having no face` : `@${v.account.username} can be matched to faces again`,
        description: v.clearLinks ? "Its face link was removed." : undefined,
        // Undo restores the flag only; a removed face link isn't brought back.
        action: v.clearLinks ? undefined : (
          <ToastAction altText="Undo" onClick={() => mutation.mutate({ account: { ...v.account, noFace: v.noFace }, noFace: !v.noFace, clearLinks: false })}>
            Undo
          </ToastAction>
        ),
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't update the account", description: e.message, variant: "destructive" }),
  });

  async function toggle(account: NoFaceAccount) {
    if (account.noFace) return mutation.mutate({ account, noFace: false, clearLinks: false });
    try {
      const impact: NoFaceImpact = await (await apiRequest("GET", `/api/social-accounts/${account.id}/no-face-impact`)).json();
      if (impact.personfaceUuid) setConfirm({ account, impact });
      else mutation.mutate({ account, noFace: true, clearLinks: false });
    } catch (e) {
      toast({ title: "Couldn't check the account", description: (e as Error).message, variant: "destructive" });
    }
  }

  const dialog = (
    <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>@{confirm?.account.username} already has a face linked</AlertDialogTitle>
          <AlertDialogDescription>
            {confirm?.impact.unlinkedFaces
              ? `Unlinking puts ${confirm.impact.unlinkedFaces} face${confirm.impact.unlinkedFaces === 1 ? "" : "s"} back in Face review as unidentified.`
              : "Unlinking leaves every face identified (a person or another account also uses this face)."}{" "}
            Keeping the link only stops new matches.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="outline" disabled={mutation.isPending} onClick={() => confirm && mutation.mutate({ account: confirm.account, noFace: true, clearLinks: false })} data-testid="button-no-face-keep">
            Mark only, keep link
          </Button>
          <Button disabled={mutation.isPending} onClick={() => confirm && mutation.mutate({ account: confirm.account, noFace: true, clearLinks: true })} data-testid="button-no-face-unlink">
            Unlink and mark
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { toggle, dialog, isPending: mutation.isPending };
}
