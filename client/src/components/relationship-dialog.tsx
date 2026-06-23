import { useState, useEffect } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertRelationshipSchema, type InsertRelationship, type Person, type RelationshipType, type RelationshipWithPerson } from "@shared/schema";
import { z } from "zod";
import { Check, ChevronsUpDown, X } from "lucide-react";

const relationshipFormSchema = z.object({
  fromPersonId: z.string().min(1),
  typeId: z.string().min(1, "Relationship type is required"),
  notes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof relationshipFormSchema>;

interface RelationshipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personId: string;
  relationship?: RelationshipWithPerson;
  existingRelationships?: RelationshipWithPerson[];
}

export function RelationshipDialog({
  open,
  onOpenChange,
  personId,
  relationship,
  existingRelationships = [],
}: RelationshipDialogProps) {
  const isEdit = !!relationship;
  const { toast } = useToast();
  const [selectedPeopleIds, setSelectedPeopleIds] = useState<string[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [typePopoverOpen, setTypePopoverOpen] = useState(false);

  const { data: allPeople } = useQuery<Person[]>({
    queryKey: ["/api/people"],
    enabled: open,
  });

  const { data: meUser } = useQuery<Person>({
    queryKey: ["/api/me"],
    enabled: open,
  });

  const { data: relationshipTypes } = useQuery<RelationshipType[]>({
    queryKey: ["/api/relationship-types"],
    enabled: open,
  });

  // Check if ME user already has a relationship with this person (only in Add mode)
  const meHasRelationship = meUser ? existingRelationships.some(
    rel => rel.toPerson.id === meUser.id
  ) : false;

  // Build available people list (only for Add mode)
  let availablePeople: Person[] = [];
  if (allPeople) {
    availablePeople = allPeople.filter((p) => p.id !== personId);
    if (meUser && !meHasRelationship && meUser.id !== personId) {
      availablePeople = [meUser, ...availablePeople];
    }
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(relationshipFormSchema),
    defaultValues: {
      fromPersonId: personId,
      typeId: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (open) {
      if (isEdit && relationship) {
        form.reset({
          fromPersonId: personId,
          typeId: relationship.typeId ?? "",
          notes: relationship.notes || "",
        });
      } else {
        form.reset({
          fromPersonId: personId,
          typeId: "",
          notes: "",
        });
        setSelectedPeopleIds([]);
      }
      setPopoverOpen(false);
      setTypePopoverOpen(false);
    }
  }, [open, relationship, isEdit, personId, form]);

  const mutation = useMutation({
    mutationFn: async (data: FormValues) => {
      if (isEdit && relationship) {
        const payload = {
          typeId: data.typeId || null,
          notes: data.notes || "",
        };
        return await apiRequest("PATCH", `/api/relationships/${relationship.id}`, payload);
      } else {
        const rels: InsertRelationship[] = selectedPeopleIds.map(toPersonId => ({
          fromPersonId: data.fromPersonId,
          toPersonId,
          typeId: data.typeId || null,
          notes: data.notes || "",
        }));

        const promises = rels.map(rel =>
          apiRequest("POST", "/api/relationships", rel)
        );
        return await Promise.all(promises);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", String(personId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      toast({
        title: "Success",
        description: isEdit
          ? "Relationship updated successfully"
          : `${selectedPeopleIds.length} relationship(s) added successfully`,
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: `Failed to ${isEdit ? "update" : "add"} relationships`,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: FormValues) => {
    if (!isEdit && selectedPeopleIds.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one person",
        variant: "destructive",
      });
      return;
    }
    mutation.mutate(values);
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
        setTypePopoverOpen(false);
      }
    }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Relationship" : "Add Relationships"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {!isEdit && (
              <div className="space-y-2">
                <FormLabel>Related People *</FormLabel>
                <div className="flex flex-col gap-2">
                  <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={popoverOpen}
                        className="w-full justify-between text-left font-normal"
                        data-testid="button-select-people"
                      >
                        Select people...
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[350px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search people..." />
                        <CommandEmpty>No people found.</CommandEmpty>
                        <CommandList>
                          <CommandGroup>
                            {availablePeople.map((person) => {
                              const isChecked = selectedPeopleIds.includes(person.id);
                              return (
                                <CommandItem
                                  key={person.id}
                                  value={`${person.firstName} ${person.lastName}`}
                                  onSelect={() => togglePerson(person.id)}
                                >
                                  <div className="flex items-center gap-2 w-full">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => {}}
                                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span>
                                      {person.firstName} {person.lastName}
                                      {person.company && (
                                        <span className="text-xs text-muted-foreground ml-1">
                                          ({person.company})
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  {selectedPeople.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {selectedPeople.map((p) => (
                        <Badge key={p.id} variant="secondary" className="gap-1">
                          {p.firstName} {p.lastName}
                          <X
                            className="h-3 w-3 cursor-pointer hover:text-destructive"
                            onClick={() => removePerson(p.id)}
                          />
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {isEdit && relationship && (
              <div className="space-y-2">
                <FormLabel>Relationship with</FormLabel>
                <div className="p-3 bg-muted rounded-md font-medium text-sm">
                  {relationship.toPerson.firstName} {relationship.toPerson.lastName}
                  {relationship.toPerson.company && (
                    <span className="text-xs text-muted-foreground ml-1">
                      ({relationship.toPerson.company})
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <FormLabel>Relationship Type *</FormLabel>
              <Popover open={typePopoverOpen} onOpenChange={setTypePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={typePopoverOpen}
                    className="w-full justify-between text-left font-normal"
                    data-testid="button-select-relationship-type"
                  >
                    {form.watch("typeId")
                      ? relationshipTypes?.find(t => t.id === form.watch("typeId"))?.name || "Custom Type"
                      : "Select relationship type..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[350px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search types..." />
                    <CommandEmpty>No type found.</CommandEmpty>
                    <CommandList>
                      {relationshipTypes && relationshipTypes.length > 0 && (
                        <CommandGroup heading="Relationship Types">
                          {relationshipTypes.filter(t => t.name.toLowerCase() !== "family").map((t) => (
                            <CommandItem
                              key={t.id}
                              value={t.name}
                              onSelect={() => {
                                form.setValue("typeId", t.id, { shouldValidate: true });
                                setTypePopoverOpen(false);
                              }}
                            >
                              <Check
                                className={`mr-2 h-4 w-4 ${
                                  form.watch("typeId") === t.id ? "opacity-100" : "opacity-0"
                                }`}
                              />
                              {t.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <FormField
                control={form.control}
                name="typeId"
                render={() => (
                  <FormItem className="hidden">
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add details about how you know them, how long, etc..."
                      className="min-h-[100px]"
                      {...field}
                      value={field.value || ""}
                      data-testid="textarea-relationship-notes"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-3 pt-4 border-t justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending || (!isEdit && selectedPeopleIds.length === 0)}
                data-testid="button-submit"
              >
                {mutation.isPending
                  ? isEdit
                    ? "Saving..."
                    : "Adding..."
                  : isEdit
                  ? "Save Changes"
                  : "Add Relationships"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
