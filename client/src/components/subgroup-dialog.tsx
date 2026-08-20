import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";
import {
  insertSubGroupSchema,
  type Person,
  type SubGroup,
  SUBGROUP_COLORS,
  getRandomSubGroupColor,
} from "@shared/schema";
import { Dices, Search } from "lucide-react";

const formSchema = insertSubGroupSchema.extend({
  name: z.string().min(1, "Sub group name is required"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color"),
  members: z.array(z.string()).default([]),
});

type FormValues = z.infer<typeof formSchema>;

interface SubGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  subGroup?: SubGroup;
  parentGroupMembers?: Person[];
}

export function SubGroupDialog({
  open,
  onOpenChange,
  groupId,
  subGroup,
  parentGroupMembers = [],
}: SubGroupDialogProps) {
  const isEdit = !!subGroup;
  const { toast } = useToast();
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: allPeople = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
    enabled: open && parentGroupMembers.length === 0,
  });

  const availablePeople = parentGroupMembers.length > 0 ? parentGroupMembers : allPeople;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      groupId,
      name: "",
      color: getRandomSubGroupColor(),
      members: [],
    },
  });

  useEffect(() => {
    if (open) {
      if (subGroup) {
        setSelectedMembers(subGroup.members || []);
        form.reset({
          groupId: subGroup.groupId,
          name: subGroup.name,
          color: subGroup.color,
          members: subGroup.members || [],
        });
      } else {
        setSelectedMembers([]);
        form.reset({
          groupId,
          name: "",
          color: getRandomSubGroupColor(),
          members: [],
        });
      }
      setSearchQuery("");
    }
  }, [open, subGroup, groupId, form]);

  const mutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const payload = {
        ...data,
        groupId,
        members: selectedMembers,
      };

      if (isEdit && subGroup) {
        return await apiRequest("PATCH", `/api/subgroups/${subGroup.id}`, payload);
      } else {
        return await apiRequest("POST", `/api/groups/${groupId}/subgroups`, payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "subgroups"] });
      if (isEdit && subGroup) {
        queryClient.invalidateQueries({ queryKey: ["/api/subgroups", subGroup.id] });
      }
      selectedMembers.forEach((personId) => {
        queryClient.invalidateQueries({ queryKey: ["/api/people", personId] });
      });
      toast({
        title: "Success",
        description: isEdit ? "Sub group updated successfully" : "Sub group created successfully",
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || `Failed to ${isEdit ? "update" : "create"} sub group`,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (values: FormValues) => {
    mutation.mutate(values);
  };

  const toggleMember = (personId: string) => {
    setSelectedMembers((prev) =>
      prev.includes(personId)
        ? prev.filter((id) => id !== personId)
        : [...prev, personId]
    );
  };

  const filteredPeople = availablePeople.filter((p) => {
    const q = searchQuery.toLowerCase();
    return (
      p.firstName.toLowerCase().includes(q) ||
      p.lastName.toLowerCase().includes(q) ||
      p.company?.toLowerCase().includes(q)
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Sub Group" : "Add New Sub Group"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update sub group details and member roster."
              : "Create a sub group within this group to categorize members."}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-8rem)] pr-2">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sub Group Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Leadership, Frontend Team, Core Crew"
                        {...field}
                        data-testid="input-subgroup-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="color"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Sub Group Color</FormLabel>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs flex items-center gap-1"
                        onClick={() => form.setValue("color", getRandomSubGroupColor())}
                        data-testid="button-random-color"
                      >
                        <Dices className="h-3.5 w-3.5" />
                        Random
                      </Button>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1 pb-2">
                      {SUBGROUP_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => form.setValue("color", c)}
                          className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${
                            field.value === c ? "ring-2 ring-primary ring-offset-2 scale-110" : ""
                          }`}
                          style={{ backgroundColor: c }}
                          title={c}
                        />
                      ))}
                    </div>

                    <div className="flex gap-2">
                      <FormControl>
                        <Input
                          type="color"
                          {...field}
                          className="w-16 h-9 p-1"
                          data-testid="input-subgroup-color-picker"
                        />
                      </FormControl>
                      <Input
                        type="text"
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="#6366f1"
                        className="flex-1 font-mono text-sm"
                        data-testid="input-subgroup-color-hex"
                      />
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <FormLabel>Members ({selectedMembers.length} selected)</FormLabel>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search people..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-8 text-xs"
                    data-testid="input-search-subgroup-members"
                  />
                </div>

                <ScrollArea className="h-44 border rounded-md p-2">
                  <div className="space-y-1.5">
                    {filteredPeople.map((person) => {
                      const isSelected = selectedMembers.includes(person.id);
                      return (
                        <div
                          key={person.id}
                          onClick={() => toggleMember(person.id)}
                          className={`flex items-center gap-2.5 p-2 rounded-md cursor-pointer text-sm hover:bg-muted/60 transition-colors ${
                            isSelected ? "bg-primary/10 font-medium" : ""
                          }`}
                          data-testid={`subgroup-member-option-${person.id}`}
                        >
                          <Avatar className="w-7 h-7">
                            {person.imageUrl && (
                              <AvatarImage
                                src={person.imageUrl}
                                alt={`${person.firstName} ${person.lastName}`}
                              />
                            )}
                            <AvatarFallback className="text-[10px]">
                              {getInitials(person.firstName, person.lastName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-xs">
                              {person.firstName} {person.lastName}
                            </p>
                            {person.company && (
                              <p className="text-[10px] text-muted-foreground truncate">
                                {person.company}
                              </p>
                            )}
                          </div>
                          {isSelected && (
                            <Badge variant="default" className="text-[10px] py-0 px-1.5 h-4">
                              Selected
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                    {availablePeople.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-6">
                        No members available in this group
                      </p>
                    )}
                    {availablePeople.length > 0 && filteredPeople.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-6">
                        No members matching "{searchQuery}"
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="flex-1"
                  data-testid="button-cancel-subgroup"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={mutation.isPending}
                  className="flex-1"
                  data-testid="button-submit-subgroup"
                >
                  {mutation.isPending
                    ? isEdit
                      ? "Saving..."
                      : "Creating..."
                    : isEdit
                    ? "Save Changes"
                    : "Create Sub Group"}
                </Button>
              </div>
            </form>
          </Form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
