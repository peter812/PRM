import { useMemo } from "react";
import TypeListPage, { type TypeListConfig } from "@/components/type-list-page";
import type { SocialAccountType } from "@shared/schema";

const socialAccountTypeConfig: TypeListConfig<SocialAccountType> = {
  title: "Social Account Types",
  entityName: "social account type",
  apiPath: "/api/social-account-types",
  queryKey: "/api/social-account-types",
  namePlaceholder: "e.g., Instagram, Twitter, TikTok",
  deleteWarning:
    "Social accounts using this type will have their type reference removed. This action cannot be undone.",
  extraFields: [],
  getExtraFieldValues: () => ({}),
};

export default function SocialAccountTypesList() {
  const config = useMemo(() => socialAccountTypeConfig, []);
  return <TypeListPage<SocialAccountType> config={config} />;
}
