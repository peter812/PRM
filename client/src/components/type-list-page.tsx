import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

/**
 * Field definition for a type entity's extra fields beyond name and color.
 */
interface TypeFieldConfig {
  key: string;
  label: string;
  type: "text" | "number" | "textarea";
  placeholder?: string;
  defaultValue?: string | number;
  min?: number;
  max?: number;
  rows?: number;
  optional?: boolean;
}

/**
 * Configuration for a generic type list page.
 */
export interface TypeListConfig<T extends { id: string; name: string; color: string }> {
  /** Display title (e.g. "Interaction Types") */
  title: string;
  /** Singular entity name for toast messages (e.g. "interaction type") */
  entityName: string;
  /** API base path (e.g. "/api/interaction-types") */
  apiPath: string;
  /** Query key for react-query */
  queryKey: string;
  /** Placeholder for the name input in create dialog */
  namePlaceholder: string;
  /** Extra fields beyond name and color */
  extraFields: TypeFieldConfig[];
  /** Delete warning message template. Receives type name as parameter. */
  deleteWarning: string;
  /** Whether to prevent deletion of "Generic" type */
  protectGenericType?: boolean;
  /** Extract extra field values from a type entity for editing */
  getExtraFieldValues: (type: T) => Record<string, string | number>;
}

interface TypeEntity {
  id: string;
  name: string;
  color: string;
  [key: string]: unknown;
}

/**
 * Loading skeleton for the type list.
 */
function TypeListSkeleton({ showDescription = true }: { showDescription?: boolean }) {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i} className="p-4 animate-pulse">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-muted rounded w-1/3" />
              {showDescription && <div className="h-3 bg-muted rounded w-1/2" />}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * Empty state for the type list.
 */
function TypeListEmptyState({
  entityName,
  onAddClick,
}: {
  entityName: string;
  onAddClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Plus className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium mb-2">No {entityName}s yet</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm">
        Get started by creating your first {entityName}
      </p>
      <Button onClick={onAddClick} data-testid="button-add-type-empty">
        <Plus className="h-4 w-4" />
        Add Type
      </Button>
    </div>
  );
}

/**
 * Color picker field (color input + text input).
 */
function ColorPickerField({
  id,
  value,
  onChange,
  testIdPrefix,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Color</Label>
      <div className="flex items-center gap-3">
        <Input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-20 h-10 p-1"
          data-testid={`${testIdPrefix}-color`}
        />
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#3b82f6"
          className="flex-1"
          data-testid={`${testIdPrefix}-color-text`}
        />
      </div>
    </div>
  );
}

/**
 * Renders extra form fields based on field configuration.
 */
function ExtraFormFields({
  fields,
  values,
  onChange,
  idPrefix,
  testIdPrefix,
}: {
  fields: TypeFieldConfig[];
  values: Record<string, string | number>;
  onChange: (key: string, value: string | number) => void;
  idPrefix: string;
  testIdPrefix: string;
}) {
  return (
    <>
      {fields.map((field) => (
        <div key={field.key} className="space-y-2">
          <Label htmlFor={`${idPrefix}-${field.key}`}>
            {field.label}{field.optional ? " (Optional)" : ""}
          </Label>
          {field.type === "textarea" ? (
            <Textarea
              id={`${idPrefix}-${field.key}`}
              value={String(values[field.key] ?? field.defaultValue ?? "")}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              rows={field.rows ?? 3}
              data-testid={`${testIdPrefix}-${field.key}`}
            />
          ) : (
            <Input
              id={`${idPrefix}-${field.key}`}
              type={field.type}
              min={field.min}
              max={field.max}
              value={values[field.key] ?? field.defaultValue ?? ""}
              onChange={(e) =>
                onChange(
                  field.key,
                  field.type === "number"
                    ? parseInt(e.target.value) || (field.defaultValue as number ?? 0)
                    : e.target.value
                )
              }
              placeholder={field.placeholder}
              data-testid={`${testIdPrefix}-${field.key}`}
            />
          )}
        </div>
      ))}
    </>
  );
}

/**
 * Generic type list page component. Handles CRUD for any type entity
 * (InteractionType, RelationshipType, SocialAccountType).
 */
export default function TypeListPage<T extends TypeEntity>({
  config,
}: {
  config: TypeListConfig<T>;
}) {
  const { toast } = useToast();
  const {
    title,
    entityName,
    apiPath,
    queryKey,
    namePlaceholder,
    extraFields,
    deleteWarning,
    protectGenericType,
    getExtraFieldValues,
  } = config;

  // Dialog states
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<T | null>(null);
  const [typeToDelete, setTypeToDelete] = useState<T | null>(null);

  // Create form state
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeColor, setNewTypeColor] = useState("#3b82f6");
  const [newExtraValues, setNewExtraValues] = useState<Record<string, string | number>>(() => {
    const defaults: Record<string, string | number> = {};
    for (const field of extraFields) {
      defaults[field.key] = field.defaultValue ?? (field.type === "number" ? 0 : "");
    }
    return defaults;
  });

  // Edit form state
  const [editedName, setEditedName] = useState("");
  const [editedColor, setEditedColor] = useState("");
  const [editedExtraValues, setEditedExtraValues] = useState<Record<string, string | number>>({});

  const { data: types, isLoading } = useQuery<T[]>({
    queryKey: [queryKey],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return apiRequest("POST", apiPath, data);
    },
    onSuccess: () => {
      setIsCreateDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      toast({
        title: `${entityName.charAt(0).toUpperCase() + entityName.slice(1)} created`,
        description: `The new ${entityName} has been added.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || `Failed to create ${entityName}`,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      return apiRequest("PATCH", `${apiPath}/${id}`, data);
    },
    onSuccess: () => {
      setEditingType(null);
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      toast({
        title: `${entityName.charAt(0).toUpperCase() + entityName.slice(1)} updated`,
        description: `The ${entityName} has been updated.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || `Failed to update ${entityName}`,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (typeId: string) => {
      return apiRequest("DELETE", `${apiPath}/${typeId}`);
    },
    onSuccess: () => {
      setTypeToDelete(null);
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      toast({
        title: `${entityName.charAt(0).toUpperCase() + entityName.slice(1)} deleted`,
        description: `The ${entityName} has been removed.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || `Failed to delete ${entityName}`,
        variant: "destructive",
      });
    },
  });

  const handleStartEdit = useCallback((type: T) => {
    setEditingType(type);
    setEditedName(type.name);
    setEditedColor(type.color);
    setEditedExtraValues(getExtraFieldValues(type));
  }, [getExtraFieldValues]);

  const handleSaveEdit = () => {
    if (!editingType) return;
    updateMutation.mutate({
      id: editingType.id,
      data: {
        name: editedName,
        color: editedColor,
        ...editedExtraValues,
      },
    });
  };

  const handleCreateType = () => {
    if (!newTypeName.trim()) {
      toast({
        title: "Error",
        description: `Please enter a name for the ${entityName}`,
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      name: newTypeName,
      color: newTypeColor,
      ...newExtraValues,
    });
    resetCreateForm();
  };

  const resetCreateForm = () => {
    setNewTypeName("");
    setNewTypeColor("#3b82f6");
    const defaults: Record<string, string | number> = {};
    for (const field of extraFields) {
      defaults[field.key] = field.defaultValue ?? (field.type === "number" ? 0 : "");
    }
    setNewExtraValues(defaults);
  };

  const handleNewExtraChange = (key: string, value: string | number) => {
    setNewExtraValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleEditExtraChange = (key: string, value: string | number) => {
    setEditedExtraValues((prev) => ({ ...prev, [key]: value }));
  };

  const isGenericType = (typeName: string) => typeName.toLowerCase() === "generic";
  const hasExtraFields = extraFields.length > 0;
  const descriptionField = extraFields.find(
    (f) => f.type === "textarea" || f.key === "description" || f.key === "notes"
  );

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-3 md:px-6 py-2 md:py-4">
        <div className="flex items-center justify-between gap-2 md:gap-4 mb-2 md:mb-4">
          <h1 className="text-3xl font-semibold" data-testid="text-page-title">
            {title}
          </h1>
          <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-add-type">
            <Plus className="h-4 w-4" />
            Add Type
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        {isLoading ? (
          <TypeListSkeleton showDescription={hasExtraFields} />
        ) : types && types.length > 0 ? (
          <div className="space-y-3">
            {types.map((type) => {
              const extraValues = getExtraFieldValues(type);
              const descriptionValue = descriptionField
                ? String(extraValues[descriptionField.key] ?? "")
                : "";

              return (
                <Card
                  key={type.id}
                  className="p-4 hover-elevate transition-all"
                  data-testid={`card-type-${type.id}`}
                >
                  <div className="flex items-center gap-4">
                    <button
                      className="w-8 h-8 rounded-full flex-shrink-0 border-2 border-border cursor-pointer hover-elevate"
                      style={{ backgroundColor: type.color }}
                      onClick={() => handleStartEdit(type)}
                      data-testid={`button-color-${type.id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <button
                        className="text-lg font-medium text-left hover:text-primary transition-colors"
                        onClick={() => handleStartEdit(type)}
                        data-testid={`button-name-${type.id}`}
                      >
                        {type.name}
                      </button>
                      {descriptionValue && (
                        <button
                          className="text-sm text-muted-foreground mt-1 block text-left hover:text-foreground transition-colors"
                          onClick={() => handleStartEdit(type)}
                          data-testid={`button-description-${type.id}`}
                        >
                          {descriptionValue}
                        </button>
                      )}
                    </div>
                    {!(protectGenericType && isGenericType(type.name)) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setTypeToDelete(type)}
                        data-testid={`button-delete-${type.id}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <TypeListEmptyState
            entityName={entityName}
            onAddClick={() => setIsCreateDialogOpen(true)}
          />
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create {title.replace(/s$/, "")}</DialogTitle>
            <DialogDescription>
              Add a new {entityName} with a name, color{hasExtraFields ? ", and additional details" : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                placeholder={namePlaceholder}
                data-testid="input-name"
              />
            </div>
            <ColorPickerField
              id="color"
              value={newTypeColor}
              onChange={setNewTypeColor}
              testIdPrefix="input"
            />
            <ExtraFormFields
              fields={extraFields}
              values={newExtraValues}
              onChange={handleNewExtraChange}
              idPrefix="new"
              testIdPrefix="input"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              data-testid="button-cancel-create"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateType}
              disabled={createMutation.isPending}
              data-testid="button-save-create"
            >
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingType} onOpenChange={(open) => !open && setEditingType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {title.replace(/s$/, "")}</DialogTitle>
            <DialogDescription>
              Update the name, color{hasExtraFields ? ", or other details" : ""} for this {entityName}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                data-testid="input-edit-name"
              />
            </div>
            <ColorPickerField
              id="edit-color"
              value={editedColor}
              onChange={setEditedColor}
              testIdPrefix="input-edit"
            />
            <ExtraFormFields
              fields={extraFields}
              values={editedExtraValues}
              onChange={handleEditExtraChange}
              idPrefix="edit"
              testIdPrefix="input-edit"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingType(null)}
              data-testid="button-cancel-edit"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!typeToDelete} onOpenChange={(open) => !open && setTypeToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {title.replace(/s$/, "")}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{typeToDelete?.name}&quot;? {deleteWarning}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (typeToDelete) {
                  deleteMutation.mutate(typeToDelete.id);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
