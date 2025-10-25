import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertRelationshipSchema, type InsertRelationship, type Person } from "@shared/schema";
import { z } from "zod";

interface AddConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const relationshipFormSchema = insertRelationshipSchema.extend({
  level: z.string().min(1, "Relationship level is required"),
});

type RelationshipFormValues = z.infer<typeof relationshipFormSchema>;

const relationshipLevels = [
  { value: "colleague", label: "Colleague" },
  { value: "friend", label: "Friend" },
  { value: "family", label: "Family" },
  { value: "client", label: "Client" },
  { value: "partner", label: "Partner" },
  { value: "mentor", label: "Mentor" },
  { value: "other", label: "Other" },
];

export function AddConnectionDialog({ open, onOpenChange }: AddConnectionDialogProps) {
  const { toast } = useToast();
  const [selectedPerson1, setSelectedPerson1] = useState<string>("");

  const { data: allPeople = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  const form = useForm<RelationshipFormValues>({
    resolver: zodResolver(relationshipFormSchema),
    defaultValues: {
      fromPersonId: "",
      toPersonId: "",
      level: "",
      notes: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertRelationship) => {
      return await apiRequest("POST", "/api/relationships", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people?includeRelationships=true"] });
      toast({
        title: "Success",
        description: "Connection created successfully",
      });
      form.reset();
      setSelectedPerson1("");
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create connection",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: RelationshipFormValues) => {
    createMutation.mutate(data);
  };

  // Filter out selected person from person 2 dropdown
  const availablePeople2 = selectedPerson1
    ? allPeople.filter((p) => p.id !== selectedPerson1)
    : allPeople;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-add-connection">
        <DialogHeader>
          <DialogTitle>Add Connection</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="fromPersonId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Person 1</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      setSelectedPerson1(value);
                    }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-person-1">
                        <SelectValue placeholder="Select first person" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {allPeople.map((person) => (
                        <SelectItem key={person.id} value={person.id}>
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
              name="toPersonId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Person 2</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={!selectedPerson1}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-person-2">
                        <SelectValue placeholder="Select second person" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availablePeople2.map((person) => (
                        <SelectItem key={person.id} value={person.id}>
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
                      <SelectTrigger data-testid="select-level">
                        <SelectValue placeholder="Select relationship type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {relationshipLevels.map((level) => (
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
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add notes about this connection..."
                      {...field}
                      data-testid="input-notes"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit">
                {createMutation.isPending ? "Creating..." : "Create Connection"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
