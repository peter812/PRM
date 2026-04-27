import TypeListPage, { type TypeListConfig } from "@/components/type-list-page";
import type { RelationshipType } from "@shared/schema";

const relationshipTypeConfig: TypeListConfig<RelationshipType> = {
  title: "Relationship Types",
  entityName: "relationship type",
  apiPath: "/api/relationship-types",
  queryKey: "/api/relationship-types",
  namePlaceholder: "e.g., Friend, Colleague, Family",
  deleteWarning:
    "Existing relationships using this type will have their type reference removed. This action cannot be undone.",
  extraFields: [
    {
      key: "value",
      label: "Value (1-255)",
      type: "number",
      placeholder: "50",
      defaultValue: 50,
      min: 1,
      max: 255,
    },
    {
      key: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Additional notes about this relationship type...",
      defaultValue: "",
      rows: 3,
      optional: true,
    },
  ],
  getExtraFieldValues: (type) => ({
    value: type.value,
    notes: type.notes ?? "",
  }),
};

export default function RelationshipTypesList() {
  return <TypeListPage config={relationshipTypeConfig} />;
}
