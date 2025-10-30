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
import { Input } from "@/components/ui/input";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type Person, type Group, type InteractionType, type Interaction } from "@shared/schema";
import { z } from "zod";
import { X, Search } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { Badge } from "@/components/ui/badge";

interface EditInteractionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  interaction: Interaction;
  personId?: string;
  groupId?: string;
}

const editInteractionSchema = z.object({
  title: z.string().optional(),
  typeId: z.string().optional(),
  date: z.date(),
  description: z.string().optional(),
  peopleIds: z.array(z.string()).min(2, "At least 2 people are required"),
  groupIds: z.array(z.string()).optional(),
});

type EditInteractionForm = z.infer<typeof editInteractionSchema>;

export function EditInteractionDialog({
  open,
  onOpenChange,
  interaction,
  personId,
  groupId,
}: EditInteractionDialogProps) {
  const { toast } = useToast();
  const [selectedPeopleIds, setSelectedPeopleIds] = useState<string[]>(interaction.peopleIds || []);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(interaction.groupIds || []);
  const [peopleSearchQuery, setPeopleSearchQuery] = useState("");

  const { data: people = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["/api/groups"],
  });

  const { data: interactionTypes = [] } = useQuery<InteractionType[]>({
    queryKey: ["/api/interaction-types"],
  });

  const form = useForm<EditInteractionForm>({
    resolver: zodResolver(editInteractionSchema),
    defaultValues: {
      title: interaction.title || "",
      typeId: interaction.typeId || interactionTypes[0]?.id,
      date: new Date(interaction.date),
      description: interaction.description || "",
      peopleIds: interaction.peopleIds || [],
      groupIds: interaction.groupIds || [],
    },
  });

  // Sync state with form fields
  useEffect(() => {
    form.setValue("peopleIds", selectedPeopleIds, { shouldValidate: true });
  }, [selectedPeopleIds, form]);

  useEffect(() => {
    form.setValue("groupIds", selectedGroupIds.length > 0 ? selectedGroupIds : undefined, { shouldValidate: true });
  }, [selectedGroupIds, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: EditInteractionForm) => {
      return await apiRequest("PATCH", `/api/interactions/${interaction.id}`, data);
    },
    onSuccess: () => {
      // Invalidate all people and groups that were or are now involved
      const allPeopleIds = new Set([...selectedPeopleIds, ...(interaction.peopleIds || [])]);
      allPeopleIds.forEach((id) => {
        queryClient.invalidateQueries({ queryKey: ["/api/people", id] });
      });

      const allGroupIds = new Set([...selectedGroupIds, ...(interaction.groupIds || [])]);
      allGroupIds.forEach((id) => {
        queryClient.invalidateQueries({ queryKey: ["/api/groups", id] });
      });

      // Also invalidate the current context (person or group)
      if (personId) {
        queryClient.invalidateQueries({ queryKey: ["/api/people", personId] });
      }
      if (groupId) {
        queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      }

      toast({
        title: "Success",
        description: "Interaction updated successfully",
      });

      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update interaction",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: EditInteractionForm) => {
    updateMutation.mutate({
      ...data,
      peopleIds: selectedPeopleIds,
      groupIds: selectedGroupIds.length > 0 ? selectedGroupIds : undefined,
    });
  };

  const togglePerson = (id: string) => {
    setSelectedPeopleIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((p) => p !== id);
      }
      return [...prev, id];
    });
  };

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((g) => g !== id);
      }
      return [...prev, id];
    });
  };

  const formatDateForInput = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  // Sort people with ME user first
  const availablePeople = useMemo(() => {
    return [...people].sort((a, b) => {
      // ME user (with userId) comes first
      if (a.userId && !b.userId) return -1;
      if (!a.userId && b.userId) return 1;
      // Otherwise sort alphabetically by first name
      return a.firstName.localeCompare(b.firstName);
    });
  }, [people]);

  // Filter people based on search query
  const filteredPeople = useMemo(() => {
    if (!peopleSearchQuery.trim()) return availablePeople;

    const query = peopleSearchQuery.toLowerCase();
    return availablePeople.filter(
      (person) =>
        person.firstName.toLowerCase().includes(query) ||
        person.lastName.toLowerCase().includes(query) ||
        person.company?.toLowerCase().includes(query) ||
        person.email?.toLowerCase().includes(query)
    );
  }, [availablePeople, peopleSearchQuery]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Interaction</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title (optional)</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="e.g., Quarterly Review, Coffee Chat"
                      data-testid="input-edit-interaction-title"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="typeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-edit-interaction-type">
                        <SelectValue placeholder="Select interaction type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {interactionTypes.map((type) => (
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
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date & Time</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      {...field}
                      value={
                        field.value
                          ? formatDateForInput(new Date(field.value))
                          : ""
                      }
                      onChange={(e) => {
                        field.onChange(new Date(e.target.value));
                      }}
                      data-testid="input-edit-interaction-date"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <Label>People Involved (minimum 2)</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search people..."
                  value={peopleSearchQuery}
                  onChange={(e) => setPeopleSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-edit-people-search"
                />
              </div>
              <div className="border rounded-md p-4 max-h-48 overflow-y-auto space-y-2">
                {filteredPeople.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No people found</p>
                ) : (
                  filteredPeople.map((person) => (
                    <div key={person.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`edit-person-${person.id}`}
                        checked={selectedPeopleIds.includes(person.id)}
                        onCheckedChange={() => togglePerson(person.id)}
                        data-testid={`checkbox-edit-person-${person.id}`}
                      />
                      <label
                        htmlFor={`edit-person-${person.id}`}
                        className="text-sm cursor-pointer flex-1"
                      >
                        {person.firstName} {person.lastName}
                        {person.company && (
                          <span className="text-muted-foreground ml-2">
                            ({person.company})
                          </span>
                        )}
                      </label>
                    </div>
                  ))
                )}
              </div>
              {selectedPeopleIds.length < 2 && (
                <p className="text-sm text-destructive">
                  Please select at least 2 people
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-2">
                {selectedPeopleIds.map((id) => {
                  const person = people.find((p) => p.id === id);
                  if (!person) return null;
                  return (
                    <Badge
                      key={id}
                      variant="secondary"
                      className="gap-1"
                      data-testid={`badge-edit-selected-person-${id}`}
                    >
                      {person.firstName} {person.lastName}
                      <button
                        type="button"
                        onClick={() => togglePerson(id)}
                        className="hover:bg-destructive/20 rounded-full"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Groups (optional)</Label>
              <div className="border rounded-md p-4 max-h-48 overflow-y-auto space-y-2">
                {groups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No groups available</p>
                ) : (
                  groups.map((group) => (
                    <div key={group.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`edit-group-${group.id}`}
                        checked={selectedGroupIds.includes(group.id)}
                        onCheckedChange={() => toggleGroup(group.id)}
                        data-testid={`checkbox-edit-group-${group.id}`}
                      />
                      <label
                        htmlFor={`edit-group-${group.id}`}
                        className="text-sm cursor-pointer flex-1"
                      >
                        {group.name}
                      </label>
                    </div>
                  ))
                )}
              </div>
              {selectedGroupIds.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedGroupIds.map((id) => {
                    const group = groups.find((g) => g.id === id);
                    if (!group) return null;
                    return (
                      <Badge
                        key={id}
                        variant="secondary"
                        className="gap-1"
                        data-testid={`badge-edit-selected-group-${id}`}
                      >
                        {group.name}
                        <button
                          type="button"
                          onClick={() => toggleGroup(id)}
                          className="hover:bg-destructive/20 rounded-full"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Describe the interaction..."
                      className="min-h-32 resize-none"
                      data-testid="input-edit-interaction-description"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {interaction.imageUrl && (
              <div className="space-y-2">
                <Label>Current Image</Label>
                <div className="border rounded-md p-2">
                  <img
                    src={interaction.imageUrl}
                    alt="Interaction attachment"
                    className="max-h-48 rounded-md"
                    data-testid="img-edit-interaction-current"
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Note: Image cannot be changed. Delete and create a new interaction to change the image.
                </p>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-edit-interaction-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateMutation.isPending || selectedPeopleIds.length < 2}
                data-testid="button-edit-interaction-submit"
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
