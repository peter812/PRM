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
import { insertGroupSchema, type Person, type Group } from "@shared/schema";
import { ImageUpload } from "@/components/image-upload";
import { X } from "lucide-react";

const formSchema = insertGroupSchema.extend({
  name: z.string().min(1, "Group name is required"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color"),
  type: z.array(z.string()).default([]),
  members: z.array(z.string()).default([]),
});

type FormValues = z.infer<typeof formSchema>;

interface GroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group?: Group;
}

export function GroupDialog({ open, onOpenChange, group }: GroupDialogProps) {
  const isEdit = !!group;
  const { toast } = useToast();
  const [typeInput, setTypeInput] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const { data: people = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
    enabled: !isEdit,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      color: "#3b82f6",
      type: [],
      members: [],
      imageUrl: null,
    },
  });

  useEffect(() => {
    if (open) {
      if (group) {
        setImageUrl(group.imageUrl || null);
        form.reset({
          name: group.name,
          color: group.color,
          type: group.type || [],
          members: [],
          imageUrl: group.imageUrl || null,
        });
      } else {
        setImageUrl(null);
        setSelectedMembers([]);
        form.reset({
          name: "",
          color: "#3b82f6",
          type: [],
          members: [],
          imageUrl: null,
        });
      }
      setTypeInput("");
    }
  }, [open, group, form]);

  const mutation = useMutation({
    mutationFn: async (data: FormValues) => {
      if (isEdit && group) {
        // Edit mode: members are managed separately, only update group details
        const { members, ...editData } = data;
        return await apiRequest("PATCH", `/api/groups/${group.id}`, {
          ...editData,
          imageUrl,
        });
      } else {
        // Add mode: include members
        return await apiRequest("POST", "/api/groups", {
          ...data,
          members: selectedMembers,
          imageUrl,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      if (isEdit && group) {
        queryClient.invalidateQueries({ queryKey: ["/api/groups", group.id] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/me"] });
        selectedMembers.forEach((memberId) => {
          queryClient.invalidateQueries({ queryKey: ["/api/people", memberId] });
        });
      }
      toast({
        title: "Success",
        description: isEdit ? "Group updated successfully" : "Group created successfully",
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || `Failed to ${isEdit ? "update" : "create"} group`,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (values: FormValues) => {
    mutation.mutate(values);
  };

  const handleAddType = () => {
    if (typeInput.trim()) {
      const currentTypes = form.getValues("type") || [];
      if (!currentTypes.includes(typeInput.trim())) {
        form.setValue("type", [...currentTypes, typeInput.trim()]);
      }
      setTypeInput("");
    }
  };

  const handleRemoveType = (typeToRemove: string) => {
    const currentTypes = form.getValues("type") || [];
    form.setValue(
      "type",
      currentTypes.filter((t) => t !== typeToRemove)
    );
  };

  const toggleMember = (personId: string) => {
    setSelectedMembers((prev) =>
      prev.includes(personId)
        ? prev.filter((id) => id !== personId)
        : [...prev, personId]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={isEdit ? "max-w-lg" : "max-w-2xl max-h-[90vh]"}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Group" : "Add New Group"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update group information (manage members in the Members tab)"
              : "Create a new group to organize your contacts"}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className={isEdit ? "pr-1" : "max-h-[calc(90vh-8rem)] pr-4"}>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
              <div>
                <FormLabel>Group Image</FormLabel>
                <div className="mt-2">
                  <ImageUpload
                    currentImageUrl={imageUrl}
                    onImageChange={setImageUrl}
                    aspectRatio={1}
                  />
                </div>
              </div>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Group Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Marketing Team"
                        {...field}
                        data-testid={isEdit ? "input-edit-group-name" : "input-group-name"}
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
                    <FormLabel>Group Color</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input
                          type="color"
                          {...field}
                          className="w-20 h-10"
                          data-testid={isEdit ? "input-edit-group-color" : "input-group-color"}
                        />
                      </FormControl>
                      <Input
                        type="text"
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="#3b82f6"
                        className="flex-1"
                        data-testid={isEdit ? "input-edit-group-color-hex" : "input-group-color-hex"}
                      />
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Group Types</FormLabel>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Add a type (e.g., Team, Project)"
                        value={typeInput}
                        onChange={(e) => setTypeInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddType();
                          }
                        }}
                        data-testid={isEdit ? "input-edit-group-type" : "input-group-type"}
                      />
                      <Button
                        type="button"
                        onClick={handleAddType}
                        variant="outline"
                        data-testid="button-add-type"
                      >
                        Add
                      </Button>
                    </div>
                    {field.value && field.value.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {field.value.map((type) => (
                          <Badge
                            key={type}
                            variant="secondary"
                            className="gap-1"
                            data-testid={`badge-type-${type}`}
                          >
                            {type}
                            <X
                              className="h-3 w-3 cursor-pointer hover-elevate"
                              onClick={() => handleRemoveType(type)}
                            />
                          </Badge>
                        ))}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!isEdit && (
                <div className="space-y-3">
                  <FormLabel>Members ({selectedMembers.length})</FormLabel>
                  <ScrollArea className="h-48 border rounded-md p-3">
                    <div className="space-y-2">
                      {people.map((person) => {
                        const isSelected = selectedMembers.includes(person.id);
                        return (
                          <div
                            key={person.id}
                            onClick={() => toggleMember(person.id)}
                            className={`flex items-center gap-3 p-2 rounded-md cursor-pointer hover-elevate ${
                              isSelected ? "bg-primary/10" : ""
                            }`}
                            data-testid={`member-option-${person.id}`}
                          >
                            <Avatar className="w-8 h-8">
                              {person.imageUrl && (
                                <AvatarImage src={person.imageUrl} alt={`${person.firstName} ${person.lastName}`} />
                              )}
                              <AvatarFallback className="text-xs">
                                {getInitials(person.firstName, person.lastName)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">
                                {person.firstName} {person.lastName}
                              </p>
                              {person.company && (
                                <p className="text-xs text-muted-foreground truncate">
                                  {person.company}
                                </p>
                              )}
                            </div>
                            {isSelected && (
                              <Badge variant="default" className="text-xs">
                                Selected
                              </Badge>
                            )}
                          </div>
                        );
                      })}
                      {people.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-8">
                          No people available. Add people first.
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="flex-1"
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={mutation.isPending}
                  className="flex-1"
                  data-testid="button-submit"
                >
                  {mutation.isPending
                    ? isEdit
                      ? "Saving..."
                      : "Creating..."
                    : isEdit
                    ? "Save Changes"
                    : "Create Group"}
                </Button>
              </div>
            </form>
          </Form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
