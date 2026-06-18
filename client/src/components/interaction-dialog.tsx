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
import { formatDateForInput } from "@/lib/utils";
import { insertInteractionSchema, type Person, type Group, type InteractionType, type Interaction } from "@shared/schema";
import { z } from "zod";
import { X, Upload, Trash2, Search } from "lucide-react";
import { useState, useRef, useMemo, useEffect } from "react";
import { Badge } from "@/components/ui/badge";

const interactionFormSchema = insertInteractionSchema.extend({
  description: z.string().optional(),
  peopleIds: z.array(z.string()).min(2, "At least 2 people are required"),
  groupIds: z.array(z.string()).optional(),
  title: z.string().optional(),
  typeId: z.string().optional(),
});

type InteractionForm = z.infer<typeof interactionFormSchema>;

interface InteractionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  interaction?: Interaction;
  personId?: string;
  groupId?: string;
}

export function InteractionDialog({
  open,
  onOpenChange,
  interaction,
  personId,
  groupId,
}: InteractionDialogProps) {
  const isEdit = !!interaction;
  const { toast } = useToast();
  const [selectedPeopleIds, setSelectedPeopleIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUuid, setImageUuid] = useState<string | null>(null);
  const [peopleSearchQuery, setPeopleSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: people = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["/api/groups"],
  });

  const { data: interactionTypes = [] } = useQuery<InteractionType[]>({
    queryKey: ["/api/interaction-types"],
  });

  const form = useForm<InteractionForm>({
    resolver: zodResolver(interactionFormSchema),
    defaultValues: {
      peopleIds: [],
      groupIds: [],
      typeId: "",
      title: "",
      date: new Date(),
      description: "",
    },
  });

  // Load and reset states when open or mode targets change
  useEffect(() => {
    if (open) {
      if (isEdit && interaction) {
        setSelectedPeopleIds(interaction.peopleIds || []);
        setSelectedGroupIds(interaction.groupIds || []);
        form.reset({
          title: interaction.title || "",
          typeId: interaction.typeId || interactionTypes[0]?.id || "",
          date: new Date(interaction.date),
          description: interaction.description || "",
          peopleIds: interaction.peopleIds || [],
          groupIds: interaction.groupIds || [],
        });
        setImageFile(null);
        setImagePreview(null);
        setImageUuid(null);
      } else {
        const initialPeople = personId ? [personId] : [];
        const initialGroups = groupId ? [groupId] : [];
        setSelectedPeopleIds(initialPeople);
        setSelectedGroupIds(initialGroups);
        form.reset({
          peopleIds: initialPeople,
          groupIds: initialGroups,
          typeId: interactionTypes[0]?.id || "",
          title: "",
          date: new Date(),
          description: "",
        });
        setImageFile(null);
        setImagePreview(null);
        setImageUuid(null);
      }
      setPeopleSearchQuery("");
    }
  }, [open, interaction, isEdit, personId, groupId, interactionTypes, form]);

  useEffect(() => {
    form.setValue("peopleIds", selectedPeopleIds, { shouldValidate: true });
  }, [selectedPeopleIds, form]);

  useEffect(() => {
    form.setValue("groupIds", selectedGroupIds.length > 0 ? selectedGroupIds : undefined, { shouldValidate: true });
  }, [selectedGroupIds, form]);

  const uploadImageMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("prmLocation", "interaction_photo");
      const response = await fetch("/api/upload-image", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("Failed to upload image");
      const data = await response.json();
      return { imageUrl: data.imageUrl as string, photoId: data.photoId as string | undefined };
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: InteractionForm & { imageUrl?: string; imageUuid?: string | null }) => {
      if (isEdit && interaction) {
        return await apiRequest("PATCH", `/api/interactions/${interaction.id}`, data);
      } else {
        return await apiRequest("POST", "/api/interactions", data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/interactions"] });
      selectedPeopleIds.forEach((id) => {
        queryClient.invalidateQueries({ queryKey: ["/api/people", id] });
      });
      selectedGroupIds.forEach((id) => {
        queryClient.invalidateQueries({ queryKey: ["/api/groups", id] });
      });

      toast({
        title: "Success",
        description: isEdit ? "Interaction updated successfully" : "Interaction added successfully",
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: `Failed to ${isEdit ? "update" : "add"} interaction`,
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: InteractionForm) => {
    let imageUrl: string | undefined;
    let uploadedImageUuid: string | null = imageUuid;

    if (imageFile) {
      try {
        const result = await uploadImageMutation.mutateAsync(imageFile);
        imageUrl = result.imageUrl;
        uploadedImageUuid = result.photoId ?? null;
      } catch (err) {
        toast({
          title: "Error",
          description: "Failed to upload image",
          variant: "destructive",
        });
        return;
      }
    }

    mutation.mutate({
      ...data,
      imageUrl,
      imageUuid: uploadedImageUuid,
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
    setImageUuid(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const togglePerson = (id: string) => {
    setSelectedPeopleIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  };

  const filteredPeople = useMemo(() => {
    if (!peopleSearchQuery.trim()) return people;
    return people.filter((p) =>
      `${p.firstName} ${p.lastName}`.toLowerCase().includes(peopleSearchQuery.toLowerCase()) ||
      (p.company && p.company.toLowerCase().includes(peopleSearchQuery.toLowerCase()))
    );
  }, [people, peopleSearchQuery]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Interaction" : "Add Interaction"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Catch up at coffee" {...field} data-testid="input-interaction-title" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="typeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-interaction-type">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {interactionTypes.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.name}
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
                    <FormLabel>Date *</FormLabel>
                    <FormControl>
                      <Input
                        type="datetime-local"
                        value={formatDateForInput(field.value)}
                        onChange={(e) => field.onChange(new Date(e.target.value))}
                        data-testid="input-interaction-date"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="What did you discuss? Add any notes here..."
                      className="min-h-[100px]"
                      {...field}
                      data-testid="textarea-interaction-desc"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-4">
              <Label>Who was involved? (Select at least 2 people) *</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search people..."
                    value={peopleSearchQuery}
                    onChange={(e) => setPeopleSearchQuery(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>

              <div className="border rounded-md p-2 max-h-[150px] overflow-y-auto space-y-1">
                {filteredPeople.map((person) => {
                  const isChecked = selectedPeopleIds.includes(person.id);
                  return (
                    <div
                      key={person.id}
                      onClick={() => togglePerson(person.id)}
                      className="flex items-center space-x-3 p-2 rounded-md hover:bg-accent cursor-pointer"
                    >
                      <Checkbox checked={isChecked} onCheckedChange={() => {}} />
                      <span className="text-sm font-medium">
                        {person.firstName} {person.lastName}
                        {person.company && (
                          <span className="text-xs text-muted-foreground ml-1">({person.company})</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>

              {selectedPeopleIds.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {selectedPeopleIds.map((id) => {
                    const person = people.find((p) => p.id === id);
                    if (!person) return null;
                    return (
                      <Badge key={id} variant="secondary" className="gap-1">
                        {person.firstName} {person.lastName}
                        <X
                          className="h-3 w-3 cursor-pointer hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePerson(id);
                          }}
                        />
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <Label>Involved Groups (optional)</Label>
              <div className="border rounded-md p-2 max-h-[120px] overflow-y-auto space-y-1">
                {groups.map((group) => {
                  const isChecked = selectedGroupIds.includes(group.id);
                  return (
                    <div
                      key={group.id}
                      onClick={() => toggleGroup(group.id)}
                      className="flex items-center space-x-3 p-2 rounded-md hover:bg-accent cursor-pointer"
                    >
                      <Checkbox checked={isChecked} onCheckedChange={() => {}} />
                      <span className="text-sm font-medium">{group.name}</span>
                    </div>
                  );
                })}
              </div>

              {selectedGroupIds.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {selectedGroupIds.map((id) => {
                    const group = groups.find((g) => g.id === id);
                    if (!group) return null;
                    return (
                      <Badge key={id} variant="secondary" className="gap-1">
                        {group.name}
                        <X
                          className="h-3 w-3 cursor-pointer hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleGroup(id);
                          }}
                        />
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>

            {!isEdit && (
              <div className="space-y-3">
                <Label>Image (optional)</Label>
                <div className="flex items-center gap-4">
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleImageChange}
                    className="hidden"
                    data-testid="input-interaction-image"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="button-upload-image"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {imageFile ? "Change Image" : "Upload Image"}
                  </Button>
                  {imageFile && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={removeImage}
                      data-testid="button-remove-image"
                      className="text-destructive hover:text-destructive/90"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove
                    </Button>
                  )}
                </div>
                {imagePreview && (
                  <div className="mt-2 border rounded-md p-2 max-w-[200px]">
                    <img src={imagePreview} alt="Preview" className="max-h-[150px] w-auto object-contain rounded" />
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending || uploadImageMutation.isPending || selectedPeopleIds.length < 2}
                data-testid="button-submit"
              >
                {mutation.isPending || uploadImageMutation.isPending
                  ? isEdit
                    ? "Saving..."
                    : "Adding..."
                  : isEdit
                  ? "Save Changes"
                  : "Add Interaction"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
