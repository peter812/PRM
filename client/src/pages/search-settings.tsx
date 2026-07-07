import { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { ChevronUp, ChevronDown, GripVertical, Search as SearchIcon } from "lucide-react";
import {
  type SearchCategory,
  type SearchPreferences,
  loadPreferences,
  savePreferences,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
} from "@/lib/search-preferences";

export default function SearchSettingsPage() {
  const { toast } = useToast();
  const [preferences, setPreferences] = useState<SearchPreferences>(loadPreferences);

  const handleReorder = useCallback((newOrder: SearchCategory[]) => {
    const newPrefs = { ...preferences, order: newOrder };
    setPreferences(newPrefs);
    savePreferences(newPrefs);
    window.dispatchEvent(new Event('searchPreferencesChanged'));
    toast({
      title: "Search order updated",
      description: "Your global search order has been successfully updated.",
    });
  }, [preferences, toast]);

  const handleToggle = useCallback((category: SearchCategory, checked: boolean) => {
    const newPrefs = {
      ...preferences,
      enabled: { ...preferences.enabled, [category]: checked },
    };
    setPreferences(newPrefs);
    savePreferences(newPrefs);
    window.dispatchEvent(new Event('searchPreferencesChanged'));
    toast({
      title: checked ? "Category enabled" : "Category disabled",
      description: `${CATEGORY_LABELS[category]} results will now be ${checked ? "included in" : "excluded from"} search.`,
    });
  }, [preferences, toast]);

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" data-testid="text-search-options-title">
          Search Options
        </h1>
        <p className="text-muted-foreground mt-1">
          Customize the order and visibility of search results.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SearchIcon className="h-5 w-5 text-muted-foreground" />
            Search Categories
          </CardTitle>
          <CardDescription>
            Drag items to reorder how results appear. Uncheck to exclude a category from global search.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DraggableList
            items={preferences.order}
            enabled={preferences.enabled}
            onReorder={handleReorder}
            onToggle={handleToggle}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function DraggableList({
  items,
  enabled,
  onReorder,
  onToggle,
}: {
  items: SearchCategory[];
  enabled: Record<SearchCategory, boolean>;
  onReorder: (items: SearchCategory[]) => void;
  onToggle: (category: SearchCategory, checked: boolean) => void;
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragEnd = () => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const newItems = [...items];
      const [removed] = newItems.splice(draggedIndex, 1);
      newItems.splice(dragOverIndex, 0, removed);
      onReorder(newItems);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const moveItem = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= items.length) return;
    const newItems = [...items];
    [newItems[index], newItems[newIndex]] = [newItems[newIndex], newItems[index]];
    onReorder(newItems);
  };

  return (
    <div className="space-y-2">
      {items.map((category, index) => {
        const Icon = CATEGORY_ICONS[category];
        const isDragging = draggedIndex === index;
        const isDragOver = dragOverIndex === index;

        if (!Icon) return null;
        return (
          <div
            key={category}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-3 p-3 rounded-md border cursor-move transition-colors ${
              isDragging ? "opacity-50 bg-muted" : ""
            } ${isDragOver ? "border-primary bg-accent" : "border-border"}`}
            data-testid={`search-category-${category}`}
          >
            <div className="flex flex-col gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => moveItem(index, "up")}
                disabled={index === 0}
                data-testid={`move-up-${category}`}
              >
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => moveItem(index, "down")}
                disabled={index === items.length - 1}
                data-testid={`move-down-${category}`}
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
            </div>
            <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <Checkbox
              checked={enabled[category]}
              onCheckedChange={(checked) => onToggle(category, checked as boolean)}
              data-testid={`checkbox-${category}`}
            />
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium flex-1">{CATEGORY_LABELS[category]}</span>
          </div>
        );
      })}
    </div>
  );
}
