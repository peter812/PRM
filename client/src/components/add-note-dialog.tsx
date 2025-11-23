import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertNoteSchema, type InsertNote } from "@shared/schema";
import { z } from "zod";
import { ImageUpload } from "./image-upload";

interface AddNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personId: string;
}

const noteFormSchema = insertNoteSchema.extend({
  content: z.string().min(1, "Note content is required"),
});

type NoteForm = z.infer<typeof noteFormSchema>;

export function AddNoteDialog({
  open,
  onOpenChange,
  personId,
}: AddNoteDialogProps) {
  const { toast } = useToast();
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const form = useForm<NoteForm>({
    resolver: zodResolver(noteFormSchema),
    defaultValues: {
      personId,
      content: "",
      imageUrl: null,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertNote) => {
      return await apiRequest("POST", "/api/notes", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", String(personId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      toast({
        title: "Success",
        description: "Note added successfully",
      });
      form.reset({ personId, content: "" });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add note",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: NoteForm) => {
    createMutation.mutate({ ...data, imageUrl });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Note</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="content"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Enter your note..."
                      className="min-h-32 resize-none"
                      data-testid="input-note-content"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div>
              <FormLabel>Attach Image (Optional)</FormLabel>
              <div className="mt-2">
                <ImageUpload
                  currentImageUrl={imageUrl}
                  onImageChange={setImageUrl}
                  aspectRatio={4 / 3}
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-note-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                data-testid="button-note-submit"
              >
                {createMutation.isPending ? "Adding..." : "Add Note"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
