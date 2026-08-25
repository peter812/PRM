import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, X, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface PersonTagsCellProps {
  personId: string;
  tags?: string[];
  onUpdate?: () => void;
  className?: string;
}

export function PersonTagsCell({
  personId,
  tags = [],
  onUpdate,
  className = "",
}: PersonTagsCellProps) {
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [newTagValue, setNewTagValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAdding) {
      inputRef.current?.focus();
    }
  }, [isAdding]);

  const updateTagsMutation = useMutation({
    mutationFn: async (updatedTags: string[]) => {
      return await apiRequest("PATCH", `/api/people/${personId}`, {
        tags: updatedTags,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", personId] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      if (onUpdate) {
        onUpdate();
      }
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
    const updatedTags = (tags || []).filter((tag) => tag !== tagToRemove);
    updateTagsMutation.mutate(updatedTags);
  };

  const handleAddTag = () => {
    const trimmedTag = newTagValue.trim();
    if (!trimmedTag) return;

    const currentTags = tags || [];
    if (currentTags.includes(trimmedTag)) {
      toast({
        title: "Error",
        description: "This tag already exists",
        variant: "destructive",
      });
      return;
    }

    const updatedTags = [...currentTags, trimmedTag];
    updateTagsMutation.mutate(updatedTags);
    setNewTagValue("");
    setIsAdding(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTag();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsAdding(false);
      setNewTagValue("");
    }
  };

  return (
    <div
      className={`group/tags relative flex items-center flex-wrap gap-1 min-h-[26px] min-w-[32px] ${className}`}
      onClick={(e) => e.stopPropagation()}
      data-testid={`tags-cell-${personId}`}
    >
      {tags && tags.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="text-xs flex items-center gap-1 group/chip py-0.5 px-2"
          data-testid={`badge-tag-${personId}-${tag}`}
        >
          <span>{tag}</span>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleRemoveTag(tag);
            }}
            className="opacity-0 group-hover/tags:opacity-60 hover:!opacity-100 rounded p-0.5 transition-opacity"
            title={`Remove tag "${tag}"`}
            data-testid={`button-remove-tag-${personId}-${tag}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      ))}

      {isAdding ? (
        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Input
            ref={inputRef}
            value={newTagValue}
            onChange={(e) => setNewTagValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="New tag..."
            className="h-6 px-1.5 text-xs w-24"
            data-testid={`input-new-tag-${personId}`}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleAddTag();
            }}
            disabled={updateTagsMutation.isPending || !newTagValue.trim()}
            className="h-6 w-6 p-0 hover:bg-muted text-green-600"
            title="Save tag"
            data-testid={`button-save-tag-${personId}`}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsAdding(false);
              setNewTagValue("");
            }}
            className="h-6 w-6 p-0 hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Cancel"
            data-testid={`button-cancel-tag-${personId}`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsAdding(true);
          }}
          className="h-5 w-5 p-0 rounded opacity-0 group-hover/tags:opacity-100 transition-opacity hover:bg-muted shrink-0 text-muted-foreground hover:text-foreground"
          title="Add tag"
          data-testid={`button-add-tag-${personId}`}
        >
          <Plus className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
