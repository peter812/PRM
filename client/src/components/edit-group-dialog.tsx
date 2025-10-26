import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertGroupSchema, type Group } from "@shared/schema";
import { ImageUpload } from "@/components/image-upload";
import { X } from "lucide-react";

interface EditGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: Group;
}

const updateGroupSchema = insertGroupSchema.partial().omit({ members: true });
type UpdateGroup = z.infer<typeof updateGroupSchema>;

export function EditGroupDialog({ open, onOpenChange, group }: EditGroupDialogProps) {
  const { toast } = useToast();
  const [typeInput, setTypeInput] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(group.imageUrl || null);

  const form = useForm<UpdateGroup>({
    resolver: zodResolver(updateGroupSchema),
    defaultValues: {
      name: group.name,
      color: group.color,
      type: group.type || [],
      imageUrl: group.imageUrl || null,
    },
  });

  useEffect(() => {
    if (open) {
      setImageUrl(group.imageUrl || null);
      form.reset({
        name: group.name,
        color: group.color,
        type: group.type || [],
        imageUrl: group.imageUrl || null,
      });
    }
  }, [open, group, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: UpdateGroup) => {
      return await apiRequest("PATCH", `/api/groups/${group.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", group.id] });
      toast({
        title: "Success",
        description: "Group updated successfully",
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update group",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: UpdateGroup) => {
    updateMutation.mutate({
      ...values,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Group</DialogTitle>
          <DialogDescription>
            Update group information (manage members in the Members tab)
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                      data-testid="input-edit-group-name"
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
                        data-testid="input-edit-group-color"
                      />
                    </FormControl>
                    <Input
                      type="text"
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="#3b82f6"
                      className="flex-1"
                      data-testid="input-edit-group-color-hex"
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
                      data-testid="input-edit-group-type"
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
                disabled={updateMutation.isPending}
                className="flex-1"
                data-testid="button-submit"
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
