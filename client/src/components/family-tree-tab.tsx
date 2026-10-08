import { FamilyTreeExplorer } from "@/components/family-tree-explorer";

interface FamilyTreeTabProps {
  personId: string;
  personName?: string;
}

/**
 * Family-tree tab for profile pages: the interactive React Flow explorer,
 * rooted at the profile's person.
 */
export function FamilyTreeTab({ personId }: FamilyTreeTabProps) {
  return <FamilyTreeExplorer initialPersonId={personId} initialDepth={3} />;
}
