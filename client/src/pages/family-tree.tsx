import { useCallback } from "react";
import {
  FamilyTreeExplorer,
} from "@/components/family-tree-explorer";
import { FamilyTreeViewMode } from "@/components/family-tree-flow";

const VIEW_MODES: FamilyTreeViewMode[] = ["name", "avatar-name", "avatar-circle"];

export default function FamilyTreePage() {
  // Read initial state from URL params
  const params = new URLSearchParams(window.location.search);
  const initialPersonId = params.get("person") || null;
  const initialDepth = parseInt(params.get("depth") ?? "6", 10) || 6;
  const initialViewParam = params.get("view") as FamilyTreeViewMode | null;
  const initialView: FamilyTreeViewMode =
    initialViewParam && VIEW_MODES.includes(initialViewParam)
      ? initialViewParam
      : "name";

  // Keep the URL in sync with the explorer's view state.
  const handleStateChange = useCallback(
    ({
      personId,
      depth,
      viewMode,
    }: {
      personId: string;
      depth: number;
      viewMode: FamilyTreeViewMode;
    }) => {
      const newParams = new URLSearchParams();
      newParams.set("person", personId);
      newParams.set("depth", String(depth));
      newParams.set("view", viewMode);
      window.history.replaceState(null, "", `/family-tree?${newParams.toString()}`);
    },
    [],
  );

  return (
    <FamilyTreeExplorer
      initialPersonId={initialPersonId}
      initialDepth={initialDepth}
      initialView={initialView}
      onStateChange={handleStateChange}
    />
  );
}
