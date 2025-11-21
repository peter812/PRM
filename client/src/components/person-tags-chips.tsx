import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface PersonTagsChipsProps {
  personId: string;
  tags: string[];
}

export function PersonTagsChips({ personId, tags }: PersonTagsChipsProps) {
  const { toast } = useToast();
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagValue, setNewTagValue] = useState("");

  const updateTagsMutation = useMutation({
    mutationFn: async (updatedTags: string[]) => {
      return await apiRequest("PATCH", `/api/people/${personId}`, {
        tags: updatedTags,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", personId] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({
        title: "Success",
        description: "Tags updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update tags",
        variant: "destructive",
      });
    },
  });

  const handleRemoveTag = (tagToRemove: string) => {
    const updatedTags = tags.filter((tag) => tag !== tagToRemove);
    updateTagsMutation.mutate(updatedTags);
  };

  const handleAddTag = () => {
    const trimmedTag = newTagValue.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      const updatedTags = [...tags, trimmedTag];
      updateTagsMutation.mutate(updatedTags);
      setNewTagValue("");
      setIsAddingTag(false);
    } else if (tags.includes(trimmedTag)) {
      toast({
        title: "Error",
        description: "This tag already exists",
        variant: "destructive",
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleAddTag();
    } else if (e.key === "Escape") {
      setIsAddingTag(false);
      setNewTagValue("");
    }
  };

  return (
    <div className="flex flex-wrap gap-2 mt-4">
      {tags && tags.length > 0 ? (
        <>
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="flex items-center gap-1"
              data-testid={`chip-tag-${tag}`}
            >
              <span>{tag}</span>
              <button
                onClick={() => handleRemoveTag(tag)}
                className="ml-1 hover:bg-secondary-foreground/20 rounded p-0.5"
                data-testid={`button-remove-tag-${tag}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Badge
            variant="outline"
            className="cursor-pointer hover-elevate"
            onClick={() => setIsAddingTag(true)}
            data-testid="button-add-tag"
          >
            <Plus className="h-3 w-3" />
          </Badge>
        </>
      ) : (
        <Badge
          variant="outline"
          className="cursor-pointer hover-elevate"
          onClick={() => setIsAddingTag(true)}
          data-testid="button-add-first-tag"
        >
          <Plus className="h-3 w-3 mr-1" />
          Add tag
        </Badge>
      )}

      {isAddingTag && (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={newTagValue}
            onChange={(e) => setNewTagValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="New tag..."
            className="h-6 px-2 text-xs w-28"
            data-testid="input-new-tag"
          />
          <Button
            size="sm"
            onClick={handleAddTag}
            disabled={updateTagsMutation.isPending || !newTagValue.trim()}
            className="h-6 px-2 text-xs"
            data-testid="button-save-tag"
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setIsAddingTag(false);
              setNewTagValue("");
            }}
            className="h-6 px-2 text-xs"
            data-testid="button-cancel-tag"
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
