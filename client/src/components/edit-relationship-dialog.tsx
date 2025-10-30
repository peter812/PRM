import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type RelationshipType, type RelationshipWithPerson } from "@shared/schema";
import { z } from "zod";

interface EditRelationshipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relationship: RelationshipWithPerson;
  personId: string;
}

const editRelationshipSchema = z.object({
  typeId: z.string().min(1, "Relationship type is required"),
  notes: z.string().optional(),
});

type EditRelationshipForm = z.infer<typeof editRelationshipSchema>;

export function EditRelationshipDialog({
  open,
  onOpenChange,
  relationship,
  personId,
}: EditRelationshipDialogProps) {
  const { toast } = useToast();

  const { data: relationshipTypes } = useQuery<RelationshipType[]>({
    queryKey: ["/api/relationship-types"],
    enabled: open,
  });

  const form = useForm({
    resolver: zodResolver(editRelationshipSchema),
    defaultValues: {
      typeId: relationship.typeId,
      notes: relationship.notes || "",
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: EditRelationshipForm) => {
      return await apiRequest("PATCH", `/api/relationships/${relationship.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", String(personId)] });
      toast({
        title: "Success",
        description: "Relationship updated successfully",
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update relationship",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: any) => {
    updateMutation.mutate(data as EditRelationshipForm);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Relationship</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Editing relationship with <span className="font-medium">{relationship.toPerson.firstName} {relationship.toPerson.lastName}</span>
            </div>

            <FormField
              control={form.control}
              name="typeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Relationship Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-edit-relationship-type">
                        <SelectValue placeholder="Select relationship type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {relationshipTypes?.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: type.color }}
                            />
                            {type.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value || ""}
                      placeholder="Add any notes about this relationship..."
                      className="min-h-24 resize-none"
                      data-testid="input-edit-relationship-notes"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-edit-relationship-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                data-testid="button-edit-relationship-submit"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
