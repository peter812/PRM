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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertRelationshipSchema, type Person, type RelationshipType } from "@shared/schema";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface AddConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type RelationshipFormValues = {
  fromPersonId: string;
  toPersonId: string;
  typeId: string;
  notes: string;
};

export function AddConnectionDialog({ open, onOpenChange }: AddConnectionDialogProps) {
  const { toast } = useToast();
  const [person1Open, setPerson1Open] = useState(false);
  const [person2Open, setPerson2Open] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);

  const { data: allPeople = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  const { data: relationshipTypes = [] } = useQuery<RelationshipType[]>({
    queryKey: ["/api/relationship-types"],
  });

  const form = useForm<RelationshipFormValues>({
    resolver: zodResolver(insertRelationshipSchema),
    defaultValues: {
      fromPersonId: "",
      toPersonId: "",
      typeId: "",
      notes: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: RelationshipFormValues) => {
      return await apiRequest("POST", "/api/relationships", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/graph"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({
        title: "Success",
        description: "Connection created successfully",
      });
      form.reset();
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

  const selectedPerson1Id = form.watch("fromPersonId");
  const selectedPerson2Id = form.watch("toPersonId");
  const selectedTypeId = form.watch("typeId");

  const selectedPerson1 = allPeople.find((p) => p.id === selectedPerson1Id);
  const selectedPerson2 = allPeople.find((p) => p.id === selectedPerson2Id);
  const selectedType = relationshipTypes.find((t) => t.id === selectedTypeId);

  // Filter out selected person from person 2 list
  const availablePeople2 = allPeople.filter((p) => p.id !== selectedPerson1Id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-add-connection">
        <DialogHeader>
          <DialogTitle>Add Connection</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Person 1 Field with Search */}
            <FormField
              control={form.control}
              name="fromPersonId"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Person 1</FormLabel>
                  <Popover open={person1Open} onOpenChange={setPerson1Open}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={person1Open}
                          className={cn(
                            "w-full justify-between",
                            !field.value && "text-muted-foreground"
                          )}
                          data-testid="button-select-person-1"
                        >
                          {selectedPerson1 ? (
                            <span className="truncate">
                              {selectedPerson1.firstName} {selectedPerson1.lastName}
                              {selectedPerson1.company && (
                                <span className="text-muted-foreground ml-2">
                                  ({selectedPerson1.company})
                                </span>
                              )}
                            </span>
                          ) : (
                            "Select first person..."
                          )}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search people..." />
                        <CommandList>
                          <CommandEmpty>No person found.</CommandEmpty>
                          <CommandGroup>
                            {allPeople.map((person) => (
                              <CommandItem
                                key={person.id}
                                value={`${person.firstName} ${person.lastName} ${person.company || ""}`}
                                onSelect={() => {
                                  form.setValue("fromPersonId", person.id);
                                  setPerson1Open(false);
                                }}
                                data-testid={`option-person-1-${person.id}`}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    person.id === field.value ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <span className="truncate">
                                  {person.firstName} {person.lastName}
                                  {person.company && (
                                    <span className="text-muted-foreground ml-2 text-xs">
                                      {person.company}
                                    </span>
                                  )}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Person 2 Field with Search */}
            <FormField
              control={form.control}
              name="toPersonId"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Person 2</FormLabel>
                  <Popover open={person2Open} onOpenChange={setPerson2Open}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={person2Open}
                          className={cn(
                            "w-full justify-between",
                            !field.value && "text-muted-foreground"
                          )}
                          disabled={!selectedPerson1Id}
                          data-testid="button-select-person-2"
                        >
                          {selectedPerson2 ? (
                            <span className="truncate">
                              {selectedPerson2.firstName} {selectedPerson2.lastName}
                              {selectedPerson2.company && (
                                <span className="text-muted-foreground ml-2">
                                  ({selectedPerson2.company})
                                </span>
                              )}
                            </span>
                          ) : (
                            "Select second person..."
                          )}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search people..." />
                        <CommandList>
                          <CommandEmpty>No person found.</CommandEmpty>
                          <CommandGroup>
                            {availablePeople2.map((person) => (
                              <CommandItem
                                key={person.id}
                                value={`${person.firstName} ${person.lastName} ${person.company || ""}`}
                                onSelect={() => {
                                  form.setValue("toPersonId", person.id);
                                  setPerson2Open(false);
                                }}
                                data-testid={`option-person-2-${person.id}`}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    person.id === field.value ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <span className="truncate">
                                  {person.firstName} {person.lastName}
                                  {person.company && (
                                    <span className="text-muted-foreground ml-2 text-xs">
                                      {person.company}
                                    </span>
                                  )}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Relationship Type Field with Search */}
            <FormField
              control={form.control}
              name="typeId"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Relationship Type</FormLabel>
                  <Popover open={typeOpen} onOpenChange={setTypeOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={typeOpen}
                          className={cn(
                            "w-full justify-between",
                            !field.value && "text-muted-foreground"
                          )}
                          data-testid="button-select-type"
                        >
                          {selectedType ? (
                            <span className="flex items-center gap-2 truncate">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: selectedType.color }}
                              />
                              {selectedType.name}
                            </span>
                          ) : (
                            "Select relationship type..."
                          )}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search types..." />
                        <CommandList>
                          <CommandEmpty>No relationship type found.</CommandEmpty>
                          <CommandGroup>
                            {relationshipTypes.map((type) => (
                              <CommandItem
                                key={type.id}
                                value={type.name}
                                onSelect={() => {
                                  form.setValue("typeId", type.id);
                                  setTypeOpen(false);
                                }}
                                data-testid={`option-type-${type.id}`}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    type.id === field.value ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <div
                                  className="w-3 h-3 rounded-full mr-2"
                                  style={{ backgroundColor: type.color }}
                                />
                                {type.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Notes Field */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add notes about this connection..."
                      value={field.value || ""}
                      onChange={field.onChange}
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
