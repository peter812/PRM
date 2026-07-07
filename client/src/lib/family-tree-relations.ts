import { FamilyTreeData } from "@/components/family-tree-flow";

/**
 * Normalizes a detailed relationship type into one of the four base categories:
 * parent, child, sibling, or spouse.
 */
function getStepCategory(type: string): "parent" | "child" | "sibling" | "spouse" | "other" {
  const t = type.toLowerCase();
  if (
    t.includes("father") ||
    t.includes("mother") ||
    t === "parent" ||
    t === "stepparent" ||
    t.includes("adoptive_parent")
  ) {
    return "parent";
  }
  if (
    t.includes("son") ||
    t.includes("daughter") ||
    t === "child" ||
    t === "stepchild" ||
    t.includes("adoptive_child")
  ) {
    return "child";
  }
  if (t.includes("brother") || t.includes("sister") || t.includes("sibling")) {
    return "sibling";
  }
  if (t.includes("spouse") || t.includes("partner") || t === "married" || t === "divorced") {
    return "spouse";
  }
  return "other";
}

interface KinshipTerm {
  neutral: string;
  male: string;
  female: string;
}

// Maps normalized relationship paths (joined by comma) to gender-specific kinship terms.
const PATH_MAP: Record<string, KinshipTerm> = {
  // 1-step
  "parent": { neutral: "Parent", male: "Father", female: "Mother" },
  "child": { neutral: "Child", male: "Son", female: "Daughter" },
  "sibling": { neutral: "Sibling", male: "Brother", female: "Sister" },
  "spouse": { neutral: "Spouse", male: "Husband", female: "Wife" },

  // 2-steps
  "parent,parent": { neutral: "Grandparent", male: "Grandfather", female: "Grandmother" },
  "parent,sibling": { neutral: "Uncle/Aunt", male: "Uncle", female: "Aunt" },
  "sibling,child": { neutral: "Nephew/Niece", male: "Nephew", female: "Niece" },
  "child,child": { neutral: "Grandchild", male: "Grandson", female: "Granddaughter" },
  "spouse,parent": { neutral: "Parent-in-Law", male: "Father-in-Law", female: "Mother-in-Law" },
  "spouse,sibling": { neutral: "Sibling-in-Law", male: "Brother-in-Law", female: "Sister-in-Law" },
  "sibling,spouse": { neutral: "Sibling-in-Law", male: "Brother-in-Law", female: "Sister-in-Law" },
  "child,spouse": { neutral: "Child-in-Law", male: "Son-in-Law", female: "Daughter-in-Law" },
  "parent,spouse": { neutral: "Stepparent", male: "Stepfather", female: "Stepmother" },
  "spouse,child": { neutral: "Stepchild", male: "Stepson", female: "Stepdaughter" },

  // 3-steps
  "parent,parent,parent": { neutral: "Great-Grandparent", male: "Great-Grandfather", female: "Great-Grandmother" },
  "child,child,child": { neutral: "Great-Grandchild", male: "Great-Grandson", female: "Great-Granddaughter" },
  "parent,sibling,child": { neutral: "Cousin", male: "Cousin", female: "Cousin" },
  "parent,parent,sibling": { neutral: "Great-Uncle/Aunt", male: "Great-Uncle", female: "Great-Aunt" },
  "sibling,child,child": { neutral: "Grandnephew/Niece", male: "Grandnephew", female: "Grandniece" },

  // 4-steps
  "parent,parent,parent,parent": { neutral: "Great-Great-Grandparent", male: "Great-Great-Grandfather", female: "Great-Great-Grandmother" },
  "child,child,child,child": { neutral: "Great-Great-Grandchild", male: "Great-Great-Grandson", female: "Great-Great-Granddaughter" },
  "parent,parent,sibling,child": { neutral: "First Cousin Once Removed", male: "First Cousin Once Removed", female: "First Cousin Once Removed" },
  "parent,sibling,child,child": { neutral: "First Cousin Once Removed", male: "First Cousin Once Removed", female: "First Cousin Once Removed" },
  
  // 5-steps
  "parent,parent,sibling,child,child": { neutral: "Second Cousin", male: "Second Cousin", female: "Second Cousin" },
};

/**
 * Helper to apply appropriate prefixes (Step-, Adoptive-, Half-) based on the raw path
 */
function applyModifiers(title: string, rawPath: string[]): string {
  let result = title;

  // 1. Detect step relationships
  const isStep = rawPath.some(step => step.toLowerCase().includes("step"));
  if (isStep && !result.toLowerCase().startsWith("step")) {
    if (["father", "mother", "son", "daughter", "brother", "sister", "parent", "child", "sibling"].includes(result.toLowerCase())) {
      // e.g. Stepfather, Stepson, Stepsister
      result = "Step" + result.toLowerCase();
      // Capitalize first letter
      result = result.charAt(0).toUpperCase() + result.slice(1);
    } else {
      result = "Step-" + result;
    }
  }

  // 2. Detect half relationships
  const isHalf = rawPath.some(step => step.toLowerCase().includes("half"));
  if (isHalf && !result.toLowerCase().startsWith("half")) {
    if (["brother", "sister", "sibling"].includes(result.toLowerCase())) {
      result = "Half-" + result;
    }
  }

  // 3. Detect adoptive relationships
  const isAdoptive = rawPath.some(step => step.toLowerCase().includes("adopt"));
  if (isAdoptive && !result.toLowerCase().startsWith("adopt")) {
    result = "Adoptive " + result;
  }

  return result;
}

/**
 * Translates a path of raw relationship strings into a human-readable title.
 */
function translateRelationshipPath(path: string[], sex: string | null | undefined): string {
  if (path.length === 0) return "";

  const normPath = path.map(getStepCategory);
  const pathKey = normPath.join(",");
  const term = PATH_MAP[pathKey];

  let resolvedTitle = "";

  if (term) {
    if (sex === "male") {
      resolvedTitle = term.male;
    } else if (sex === "female") {
      resolvedTitle = term.female;
    } else {
      resolvedTitle = term.neutral;
    }
  } else {
    // Generational fallbacks for long chains of parents or children
    const allParent = normPath.every(cat => cat === "parent");
    const allChild = normPath.every(cat => cat === "child");

    if (allParent) {
      const g = normPath.length; // e.g. 4 parents
      if (sex === "male") {
        resolvedTitle = "Great-".repeat(g - 2) + "Grandfather";
      } else if (sex === "female") {
        resolvedTitle = "Great-".repeat(g - 2) + "Grandmother";
      } else {
        resolvedTitle = "Great-".repeat(g - 2) + "Grandparent";
      }
    } else if (allChild) {
      const g = normPath.length;
      if (sex === "male") {
        resolvedTitle = "Great-".repeat(g - 2) + "Grandson";
      } else if (sex === "female") {
        resolvedTitle = "Great-".repeat(g - 2) + "Granddaughter";
      } else {
        resolvedTitle = "Great-".repeat(g - 2) + "Grandchild";
      }
    } else {
      // Default fallback for very distant/complex relations
      resolvedTitle = "Extended Family";
    }
  }

  return applyModifiers(resolvedTitle, path);
}

/**
 * Performs a BFS traversal starting from selectedPersonId to compute relationship labels.
 */
export function computeExtendedRelationships(
  treeData: FamilyTreeData,
  selectedPersonId: string
): Record<string, string> {
  const titles: Record<string, string> = {};
  
  // Build lookup for people by ID to retrieve their sex/gender
  const sexMap = new Map<string, string | null | undefined>();
  for (const person of treeData.people) {
    sexMap.set(person.id, (person as any).sex);
  }

  // Build adjacency list for BFS
  const adj = new Map<string, Array<{ to: string; type: string }>>();
  for (const rel of treeData.relationships) {
    if (!adj.has(rel.toPersonId)) {
      adj.set(rel.toPersonId, []);
    }
    adj.get(rel.toPersonId)!.push({
      to: rel.fromPersonId,
      type: rel.familyRelationshipType,
    });
  }

  const queue: Array<{ id: string; path: string[] }> = [{ id: selectedPersonId, path: [] }];
  const visited = new Set<string>([selectedPersonId]);

  while (queue.length > 0) {
    const { id, path } = queue.shift()!;

    if (id !== selectedPersonId) {
      const sex = sexMap.get(id);
      titles[id] = translateRelationshipPath(path, sex);
    }

    const neighbors = adj.get(id) || [];
    for (const edge of neighbors) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push({
          id: edge.to,
          path: [...path, edge.type],
        });
      }
    }
  }

  return titles;
}
