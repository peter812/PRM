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
import { insertInteractionSchema, type Person, type Group } from "@shared/schema";
import { z } from "zod";
import { X, Upload, Trash2 } from "lucide-react";
import { useState, useRef } from "react";
import { Badge } from "@/components/ui/badge";

interface AddInteractionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personId: string;
}

const interactionFormSchema = insertInteractionSchema.extend({
  type: z.enum(["meeting", "call", "email", "other"]),
  description: z.string().min(1, "Description is required"),
  peopleIds: z.array(z.string()).min(2, "At least 2 people are required"),
  groupIds: z.array(z.string()).optional(),
});

type InteractionForm = z.infer<typeof interactionFormSchema>;

export function AddInteractionDialog({
  open,
  onOpenChange,
  personId,
}: AddInteractionDialogProps) {
  const { toast } = useToast();
  const [selectedPeopleIds, setSelectedPeopleIds] = useState<string[]>([personId]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: people = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["/api/groups"],
  });

  const form = useForm<InteractionForm>({
    resolver: zodResolver(interactionFormSchema),
    defaultValues: {
      peopleIds: [personId],
      groupIds: [],
      type: "meeting",
      date: new Date(),
      description: "",
    },
  });

  const uploadImageMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch("/api/upload-image", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("Failed to upload image");
      const data = await response.json();
      return data.imageUrl;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InteractionForm & { imageUrl?: string }) => {
      return await apiRequest("POST", "/api/interactions", data);
    },
    onSuccess: () => {
      // Invalidate all people and groups that were involved
      selectedPeopleIds.forEach((id) => {
        queryClient.invalidateQueries({ queryKey: ["/api/people", id] });
      });
      selectedGroupIds.forEach((id) => {
        queryClient.invalidateQueries({ queryKey: ["/api/groups", id] });
      });
      
      toast({
        title: "Success",
        description: "Interaction added successfully",
      });
      
      // Reset form
      setSelectedPeopleIds([personId]);
      setSelectedGroupIds([]);
      setImageFile(null);
      setImagePreview(null);
      form.reset({ 
        peopleIds: [personId], 
        groupIds: [], 
        type: "meeting", 
        date: new Date(), 
        description: "" 
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add interaction",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: InteractionForm) => {
    let imageUrl: string | undefined;
    
    if (imageFile) {
      try {
        imageUrl = await uploadImageMutation.mutateAsync(imageFile);
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to upload image",
          variant: "destructive",
        });
        return;
      }
    }

    createMutation.mutate({ 
      ...data, 
      peopleIds: selectedPeopleIds,
      groupIds: selectedGroupIds.length > 0 ? selectedGroupIds : undefined,
      imageUrl 
    });
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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

  // Filter out "ME" person from the people list
  const availablePeople = people.filter((p) => !p.userId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Interaction</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-interaction-type">
                        <SelectValue placeholder="Select interaction type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="meeting">Meeting</SelectItem>
                      <SelectItem value="call">Call</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
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
                      data-testid="input-interaction-date"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <Label>People Involved (minimum 2)</Label>
              <div className="border rounded-md p-4 max-h-48 overflow-y-auto space-y-2">
                {availablePeople.map((person) => (
                  <div key={person.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`person-${person.id}`}
                      checked={selectedPeopleIds.includes(person.id)}
                      onCheckedChange={() => togglePerson(person.id)}
                      data-testid={`checkbox-person-${person.id}`}
                    />
                    <label
                      htmlFor={`person-${person.id}`}
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
                ))}
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
                      data-testid={`badge-selected-person-${id}`}
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
                        id={`group-${group.id}`}
                        checked={selectedGroupIds.includes(group.id)}
                        onCheckedChange={() => toggleGroup(group.id)}
                        data-testid={`checkbox-group-${group.id}`}
                      />
                      <label
                        htmlFor={`group-${group.id}`}
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
                        data-testid={`badge-selected-group-${id}`}
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
                      data-testid="input-interaction-description"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <Label>Image (optional)</Label>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                  data-testid="input-interaction-image"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-upload-image"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {imageFile ? "Change Image" : "Upload Image"}
                </Button>
                {imageFile && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={removeImage}
                    data-testid="button-remove-image"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Remove
                  </Button>
                )}
              </div>
              {imagePreview && (
                <div className="mt-2">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="max-h-48 rounded-md border"
                    data-testid="img-interaction-preview"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-interaction-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || uploadImageMutation.isPending || selectedPeopleIds.length < 2}
                data-testid="button-interaction-submit"
              >
                {createMutation.isPending || uploadImageMutation.isPending
                  ? "Adding..."
                  : "Add Interaction"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
