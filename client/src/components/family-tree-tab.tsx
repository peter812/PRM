import { FamilyTreeExplorer } from "@/components/family-tree-explorer";

interface FamilyTreeTabProps {
  personId: string;
  personName?: string;
}

/**
 * Embedded family-tree tab for profile pages. Renders the same interactive
 * React Flow explorer used by the standalone /family-tree page, rooted at the
 * profile's person and without the dev banner / URL syncing.
 */
export function FamilyTreeTab({ personId }: FamilyTreeTabProps) {
  return <FamilyTreeExplorer initialPersonId={personId} initialDepth={3} embedded />;
}
