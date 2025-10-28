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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertRelationshipSchema, type InsertRelationship, type Person, type RelationshipType } from "@shared/schema";
import { z } from "zod";
import { Check, ChevronsUpDown, X } from "lucide-react";

interface AddRelationshipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personId: string;
}

const relationshipFormSchema = insertRelationshipSchema.extend({
  typeId: z.string().min(1, "Relationship type is required"),
}).omit({ toPersonId: true });

type RelationshipForm = z.infer<typeof relationshipFormSchema> & {
  selectedPeopleIds: string[];
};

export function AddRelationshipDialog({
  open,
  onOpenChange,
  personId,
}: AddRelationshipDialogProps) {
  const { toast } = useToast();
  const [selectedPeopleIds, setSelectedPeopleIds] = useState<string[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const { data: allPeople } = useQuery<Person[]>({
    queryKey: ["/api/people"],
    enabled: open,
  });

  const { data: relationshipTypes } = useQuery<RelationshipType[]>({
    queryKey: ["/api/relationship-types"],
    enabled: open,
  });

  const availablePeople = allPeople?.filter((p) => p.id !== personId) || [];

  const form = useForm<RelationshipForm>({
    resolver: zodResolver(relationshipFormSchema),
    defaultValues: {
      fromPersonId: personId,
      typeId: "",
      notes: "",
      selectedPeopleIds: [],
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { relationships: InsertRelationship[] }) => {
      // Create all relationships in parallel
      const promises = data.relationships.map(rel =>
        apiRequest("POST", "/api/relationships", rel)
      );
      return await Promise.all(promises);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", String(personId)] });
      const count = variables.relationships.length;
      toast({
        title: "Success",
        description: `${count} relationship${count > 1 ? 's' : ''} added successfully`,
      });
      form.reset({ fromPersonId: personId, typeId: "", notes: "", selectedPeopleIds: [] });
      setSelectedPeopleIds([]);
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add relationships",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: RelationshipForm) => {
    if (selectedPeopleIds.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one person",
        variant: "destructive",
      });
      return;
    }

    // Create relationship objects for each selected person
    const relationships: InsertRelationship[] = selectedPeopleIds.map(toPersonId => ({
      fromPersonId: data.fromPersonId,
      toPersonId,
      typeId: data.typeId,
      notes: data.notes || "",
    }));

    createMutation.mutate({ relationships });
  };

  const togglePerson = (personId: string) => {
    setSelectedPeopleIds(prev =>
      prev.includes(personId)
        ? prev.filter(id => id !== personId)
        : [...prev, personId]
    );
  };

  const removePerson = (personId: string) => {
    setSelectedPeopleIds(prev => prev.filter(id => id !== personId));
  };

  const selectedPeople = availablePeople.filter(p => selectedPeopleIds.includes(p.id));

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      onOpenChange(newOpen);
      if (!newOpen) {
        setSelectedPeopleIds([]);
        setPopoverOpen(false);
      }
    }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Relationship{selectedPeopleIds.length > 1 ? 's' : ''}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormItem>
              <FormLabel>People{selectedPeopleIds.length > 0 && ` (${selectedPeopleIds.length} selected)`}</FormLabel>
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={popoverOpen}
                      className="w-full justify-between"
                      data-testid="select-people"
                    >
                      <span className="truncate">
                        {selectedPeopleIds.length === 0
                          ? "Select people..."
                          : `${selectedPeopleIds.length} selected`}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search people..." data-testid="input-search-people" />
                    <CommandList>
                      <CommandEmpty>No people found.</CommandEmpty>
                      <CommandGroup>
                        {availablePeople.map((person) => {
                          const isSelected = selectedPeopleIds.includes(person.id);
                          return (
                            <CommandItem
                              key={person.id}
                              value={`${person.firstName} ${person.lastName} ${person.company || ''}`}
                              onSelect={() => togglePerson(person.id)}
                              data-testid={`person-option-${person.id}`}
                            >
                              <Checkbox
                                checked={isSelected}
                                className="mr-2"
                                data-testid={`checkbox-person-${person.id}`}
                              />
                              <div className="flex-1">
                                {person.firstName} {person.lastName}
                                {person.company && (
                                  <span className="text-muted-foreground ml-1">({person.company})</span>
                                )}
                              </div>
                              {isSelected && <Check className="h-4 w-4" />}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedPeople.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {selectedPeople.map((person) => (
                    <Badge
                      key={person.id}
                      variant="secondary"
                      className="gap-1"
                      data-testid={`badge-selected-${person.id}`}
                    >
                      {person.firstName} {person.lastName}
                      <button
                        type="button"
                        onClick={() => removePerson(person.id)}
                        className="ml-1 hover:bg-accent rounded-sm"
                        data-testid={`button-remove-${person.id}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <FormMessage />
            </FormItem>

            <FormField
              control={form.control}
              name="typeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Relationship Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-relationship-type">
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
                      placeholder="Add any notes about these relationships..."
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
                disabled={createMutation.isPending || selectedPeopleIds.length === 0}
                data-testid="button-relationship-submit"
              >
                {createMutation.isPending
                  ? "Adding..."
                  : `Add Relationship${selectedPeopleIds.length > 1 ? 's' : ''}`}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
