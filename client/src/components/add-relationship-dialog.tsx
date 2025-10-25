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
import { insertRelationshipSchema, type InsertRelationship, type Person } from "@shared/schema";
import { z } from "zod";

interface AddRelationshipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personId: number;
}

const relationshipFormSchema = insertRelationshipSchema.extend({
  level: z.string().min(1, "Relationship level is required"),
});

type RelationshipForm = z.infer<typeof relationshipFormSchema>;

const RELATIONSHIP_LEVELS = [
  { value: "colleague", label: "Colleague" },
  { value: "friend", label: "Friend" },
  { value: "family", label: "Family" },
  { value: "client", label: "Client" },
  { value: "partner", label: "Partner" },
  { value: "mentor", label: "Mentor" },
  { value: "other", label: "Other" },
];

export function AddRelationshipDialog({
  open,
  onOpenChange,
  personId,
}: AddRelationshipDialogProps) {
  const { toast } = useToast();

  const { data: allPeople } = useQuery<Person[]>({
    queryKey: ["/api/people"],
    enabled: open,
  });

  const availablePeople = allPeople?.filter((p) => p.id !== personId) || [];

  const form = useForm<RelationshipForm>({
    resolver: zodResolver(relationshipFormSchema),
    defaultValues: {
      fromPersonId: personId,
      toPersonId: undefined,
      level: "",
      notes: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertRelationship) => {
      return await apiRequest("POST", "/api/relationships", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", String(personId)] });
      toast({
        title: "Success",
        description: "Relationship added successfully",
      });
      form.reset({ fromPersonId: personId, toPersonId: undefined, level: "", notes: "" });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add relationship",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: RelationshipForm) => {
    createMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Relationship</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="toPersonId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Person</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(parseInt(value))}
                    value={field.value?.toString()}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-person">
                        <SelectValue placeholder="Select a person" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availablePeople.map((person) => (
                        <SelectItem key={person.id} value={person.id.toString()}>
                          {person.firstName} {person.lastName}
                          {person.company && ` (${person.company})`}
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
              name="level"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Relationship Level</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-relationship-level">
                        <SelectValue placeholder="Select relationship level" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {RELATIONSHIP_LEVELS.map((level) => (
                        <SelectItem key={level.value} value={level.value}>
                          {level.label}
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
                      data-testid="input-relationship-notes"
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
                data-testid="button-relationship-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                data-testid="button-relationship-submit"
              >
                {createMutation.isPending ? "Adding..." : "Add Relationship"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
