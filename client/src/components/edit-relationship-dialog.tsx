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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type RelationshipType, type RelationshipWithPerson } from "@shared/schema";
import { z } from "zod";
import { Check, ChevronsUpDown } from "lucide-react";

interface EditRelationshipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relationship: RelationshipWithPerson;
  personId: string;
}

const editRelationshipSchema = z.object({
  typeId: z.string().optional().nullable(),
  familyRelationshipType: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
}).refine((data) => data.typeId || data.familyRelationshipType, {
  message: "Relationship type is required",
  path: ["typeId"],
});

type EditRelationshipForm = z.infer<typeof editRelationshipSchema>;

export function EditRelationshipDialog({
  open,
  onOpenChange,
  relationship,
  personId,
}: EditRelationshipDialogProps) {
  const { toast } = useToast();
  const [typePopoverOpen, setTypePopoverOpen] = useState(false);

  const { data: relationshipTypes } = useQuery<RelationshipType[]>({
    queryKey: ["/api/relationship-types"],
    enabled: open,
  });

  const { data: familyTypesData } = useQuery<{ types: { value: string; label: string }[] }>({
    queryKey: ["/api/family-relationships/types"],
    enabled: open,
  });

  const familyTypes = familyTypesData?.types ?? [];

  const form = useForm<EditRelationshipForm>({
    resolver: zodResolver(editRelationshipSchema),
    defaultValues: {
      typeId: relationship.typeId ?? "",
      familyRelationshipType: relationship.familyRelationshipType ?? null,
      notes: relationship.notes || "",
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: EditRelationshipForm) => {
      const payload = {
        typeId: data.typeId || null,
        familyRelationshipType: data.familyRelationshipType || null,
        notes: data.notes || "",
      };
      return await apiRequest("PATCH", `/api/relationships/${relationship.id}`, payload);
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

  const onSubmit = (data: EditRelationshipForm) => {
    updateMutation.mutate(data);
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
              render={() => {
                const currentTypeId = form.watch("typeId");
                const currentFamilyType = form.watch("familyRelationshipType");

                const getSelectedTypeLabel = () => {
                  if (currentFamilyType) {
                    const fType = familyTypes.find(t => t.value === currentFamilyType);
                    return fType ? fType.label : currentFamilyType;
                  }
                  const sType = relationshipTypes?.find(t => t.id === currentTypeId);
                  return sType ? sType.name : "Select relationship type";
                };

                const getSelectedTypeColor = () => {
                  if (currentFamilyType) {
                    return "#ef4444";
                  }
                  const sType = relationshipTypes?.find(t => t.id === currentTypeId);
                  return sType?.color ?? null;
                };

                const selectedColor = getSelectedTypeColor();
                const selectedLabel = getSelectedTypeLabel();

                return (
                  <FormItem className="flex flex-col">
                    <FormLabel>Relationship Type</FormLabel>
                    <Popover open={typePopoverOpen} onOpenChange={setTypePopoverOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={typePopoverOpen}
                            className="w-full justify-between"
                            data-testid="select-edit-relationship-type"
                          >
                            <div className="flex items-center gap-2 truncate">
                              {selectedColor && (
                                <div
                                  className="w-3 h-3 rounded-full shrink-0"
                                  style={{ backgroundColor: selectedColor }}
                                />
                              )}
                              <span className="truncate">{selectedLabel}</span>
                            </div>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search relationship types..." data-testid="input-search-edit-relationship-type" />
                          <CommandList className="max-h-64 overflow-y-auto" onWheel={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()}>
                            <CommandEmpty>No relationship type found.</CommandEmpty>
                            <CommandGroup heading="Standard Relationship Types">
                              {relationshipTypes?.map((type) => {
                                const isSelected = currentTypeId === type.id && !currentFamilyType;
                                return (
                                  <CommandItem
                                    key={type.id}
                                    value={type.name}
                                    onSelect={() => {
                                      form.setValue("typeId", type.id);
                                      form.setValue("familyRelationshipType", null);
                                      setTypePopoverOpen(false);
                                    }}
                                    data-testid={`edit-relationship-type-option-${type.id}`}
                                    className="flex items-center justify-between font-normal"
                                  >
                                    <div className="flex items-center gap-2">
                                      <div
                                        className="w-3 h-3 rounded-full"
                                        style={{ backgroundColor: type.color }}
                                      />
                                      {type.name}
                                    </div>
                                    {isSelected && <Check className="h-4 w-4 shrink-0 opacity-100" />}
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                            <CommandGroup heading="Family Relationship Types">
                              {familyTypes.map((ft) => {
                                const isSelected = currentFamilyType === ft.value;
                                return (
                                  <CommandItem
                                    key={ft.value}
                                    value={ft.label}
                                    onSelect={() => {
                                      const familyDbType = relationshipTypes?.find(t => t.name.toLowerCase() === "family");
                                      form.setValue("typeId", familyDbType?.id || null);
                                      form.setValue("familyRelationshipType", ft.value);
                                      setTypePopoverOpen(false);
                                    }}
                                    data-testid={`edit-family-relationship-type-option-${ft.value}`}
                                    className="flex items-center justify-between font-normal"
                                  >
                                    <div className="flex items-center gap-2">
                                      <div
                                        className="w-3 h-3 rounded-full"
                                        style={{ backgroundColor: "#ef4444" }}
                                      />
                                      {ft.label}
                                    </div>
                                    {isSelected && <Check className="h-4 w-4 shrink-0 opacity-100" />}
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                );
              }}
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
