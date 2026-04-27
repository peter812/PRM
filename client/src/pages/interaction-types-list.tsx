import TypeListPage, { type TypeListConfig } from "@/components/type-list-page";
import type { InteractionType } from "@shared/schema";

const interactionTypeConfig: TypeListConfig<InteractionType> = {
  title: "Interaction Types",
  entityName: "interaction type",
  apiPath: "/api/interaction-types",
  queryKey: "/api/interaction-types",
  namePlaceholder: "e.g., Meeting, Call, Email",
  protectGenericType: true,
  deleteWarning:
    "Existing interactions using this type will have their type reference removed. This action cannot be undone.",
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
      key: "description",
      label: "Description",
      type: "textarea",
      placeholder: "Additional description for this interaction type...",
      defaultValue: "",
      rows: 3,
      optional: true,
    },
  ],
  getExtraFieldValues: (type) => ({
    value: type.value,
    description: type.description ?? "",
  }),
};

export default function InteractionTypesList() {
  return <TypeListPage<InteractionType> config={interactionTypeConfig} />;
}
