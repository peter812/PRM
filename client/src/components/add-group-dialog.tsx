import { useState } from "react";
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
import { insertGroupSchema, type Person } from "@shared/schema";
import { ImageUpload } from "@/components/image-upload";
import { X } from "lucide-react";

const formSchema = insertGroupSchema.extend({
  name: z.string().min(1, "Group name is required"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color"),
  type: z.array(z.string()).default([]),
  members: z.array(z.string()).default([]),
});

interface AddGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddGroupDialog({ open, onOpenChange }: AddGroupDialogProps) {
  const { toast } = useToast();
  const [typeInput, setTypeInput] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const { data: people = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      color: "#3b82f6",
      type: [],
      members: [],
      imageUrl: null,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      return await apiRequest("POST", "/api/groups", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({
        title: "Success",
        description: "Group created successfully",
      });
      onOpenChange(false);
      form.reset();
      setTypeInput("");
      setSelectedMembers([]);
      setImageUrl(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create group",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (values: z.infer<typeof formSchema>) => {
    createMutation.mutate({
      ...values,
      members: selectedMembers,
      imageUrl,
    });
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

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Add New Group</DialogTitle>
          <DialogDescription>
            Create a new group to organize your contacts
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-8rem)] pr-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
              <div>
                <FormLabel>Group Image</FormLabel>
                <div className="mt-2">
                  <ImageUpload
                    currentImageUrl={imageUrl}
                    onImageChange={setImageUrl}
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
                        data-testid="input-group-name"
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
                          data-testid="input-group-color"
                        />
                      </FormControl>
                      <Input
                        type="text"
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="#3b82f6"
                        className="flex-1"
                        data-testid="input-group-color-hex"
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
                        data-testid="input-group-type"
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
                  disabled={createMutation.isPending}
                  className="flex-1"
                  data-testid="button-submit"
                >
                  {createMutation.isPending ? "Creating..." : "Create Group"}
                </Button>
              </div>
            </form>
          </Form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
