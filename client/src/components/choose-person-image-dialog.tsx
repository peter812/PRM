import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ImageUpload } from "@/components/image-upload";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { withImageSize } from "@shared/image-size";
import type { Person } from "@shared/schema";

// Mirrors GET /api/people/:id/image-options.
type ImageOption = {
  url: string;
  source: "upload" | "current" | "previous";
  photoId?: string;
  username?: string;
  date?: string;
};

const caption = (o: ImageOption) =>
  o.source === "upload" ? null
  : o.source === "current" ? `@${o.username} · current`
  : `@${o.username ?? "?"} · ${o.date ? new Date(o.date).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "earlier"}`;

interface ChoosePersonImageDialogProps {
  person: Person;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Pick the person's picture from their uploads and their social accounts' current and past pictures. */
export function ChoosePersonImageDialog({ person, open, onOpenChange }: ChoosePersonImageDialogProps) {
  const { toast } = useToast();
  const [toDelete, setToDelete] = useState<ImageOption | null>(null);

  const { data: options = [], isLoading } = useQuery<ImageOption[]>({
    queryKey: ["/api/people", person.id, "image-options"],
    enabled: open,
  });

  // /api/me serves the same person on the Me page.
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["/api/people"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/me"] }),
  ]);

  const choose = useMutation({
    mutationFn: (imageUrl: string) => apiRequest("PATCH", `/api/people/${person.id}`, { imageUrl }),
    onSuccess: () => { refresh(); onOpenChange(false); },
    onError: (error: Error) => toast({ title: "Failed to set image", description: error.message, variant: "destructive" }),
  });

  // DELETE /api/photos/:id also clears people.image_url and falls back to a social picture.
  const remove = useMutation({
    mutationFn: (photoId: string) => apiRequest("DELETE", `/api/photos/${photoId}`),
    onSuccess: refresh,
    onError: (error: Error) => toast({ title: "Failed to delete image", description: error.message, variant: "destructive" }),
    onSettled: () => setToDelete(null),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]" data-testid="dialog-choose-person-image">
        <DialogHeader>
          <DialogTitle>Choose image</DialogTitle>
          <DialogDescription>
            Pick a picture for {person.firstName}. Only pictures you uploaded can be deleted.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto p-1">
            {options.map((o) => (
              <div key={o.url} className="space-y-1">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => choose.mutate(o.url)}
                    disabled={choose.isPending}
                    className={cn(
                      "block aspect-square w-full overflow-hidden rounded-md border hover:opacity-80",
                      o.url === person.imageUrl && "ring-2 ring-primary ring-offset-2",
                    )}
                    data-testid={`button-choose-image-${o.source}`}
                  >
                    <img src={withImageSize(o.url, 150)} alt="" className="h-full w-full object-cover" />
                  </button>
                  {/* Wrapped: Button's hover-elevate forces position: relative. */}
                  {o.photoId && (
                    <div className="absolute bottom-1 right-1">
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="h-6 w-6 rounded-full"
                        onClick={() => setToDelete(o)}
                        data-testid="button-delete-person-image"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
                {caption(o) && <p className="truncate text-[10px] text-muted-foreground">{caption(o)}</p>}
              </div>
            ))}
            <ImageUpload
              tile
              aspectRatio={1}
              prmLocation={`person_image:${person.id}`}
              onImageChange={(url) => url && choose.mutate(url)}
            />
          </div>
        )}
      </DialogContent>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this image?</AlertDialogTitle>
            <AlertDialogDescription>
              The upload is removed from storage.
              {toDelete?.url === person.imageUrl && " It's the current picture, so a linked social account's picture takes its place, if there is one."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete?.photoId && remove.mutate(toDelete.photoId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
