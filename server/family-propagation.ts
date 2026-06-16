import { FAMILY_RELATIONSHIP_RULES, FAMILY_RELATIONSHIP_INVERSES } from "@shared/schema";
import type { Relationship, InsertRelationship } from "@shared/schema";

const MAX_PROPAGATION_DEPTH = 6;
const MAX_BATCH_SIZE = 50;

interface StorageInterface {
  getRelationshipById(id: string): Promise<Relationship | undefined>;
  getFamilyRelationshipsForPerson(personId: string): Promise<Relationship[]>;
  findFamilyRelationship(fromPersonId: string, toPersonId: string): Promise<Relationship | undefined>;
  createRelationship(data: InsertRelationship): Promise<Relationship>;
}

function lookupRule(typeAB: string, typeBC: string): string | null {
  for (const rule of FAMILY_RELATIONSHIP_RULES) {
    if (rule.if[0] === typeAB && rule.if[1] === typeBC) {
      return rule.then;
    }
  }
  return null;
}

/**
 * BFS propagation engine. Given a newly-created relationship, infers
 * additional relationships based on transitivity rules and creates them
 * if they don't already exist. Returns the list of newly created relationships.
 *
 * Safety guards:
 *  - Cycle detection via visited set of "fromId:toId" pairs
 *  - Max depth cap (MAX_PROPAGATION_DEPTH)
 *  - Conflict-skip: never overwrites an existing relationship
 *  - Batch-size limit (MAX_BATCH_SIZE total new relationships per call)
 */
export async function propagateRelationship(
  startRelationshipId: string,
  storage: StorageInterface
): Promise<Relationship[]> {
  const startRel = await storage.getRelationshipById(startRelationshipId);
  if (!startRel || !startRel.familyRelationshipType) return [];

  const created: Relationship[] = [];
  const visited = new Set<string>();
  visited.add(`${startRel.fromPersonId}:${startRel.toPersonId}`);

  interface QueueItem {
    rel: Relationship;
    depth: number;
  }
  const queue: QueueItem[] = [{ rel: startRel, depth: 0 }];

  while (queue.length > 0 && created.length < MAX_BATCH_SIZE) {
    const item = queue.shift()!;
    if (item.depth >= MAX_PROPAGATION_DEPTH) continue;

    const { rel } = item;
    const A = rel.fromPersonId;
    const B = rel.toPersonId;
    const typeAB = rel.familyRelationshipType!;

    const relationsOfB = await storage.getFamilyRelationshipsForPerson(B);

    for (const relBC of relationsOfB) {
      if (created.length >= MAX_BATCH_SIZE) break;

      let C: string;
      let typeBC: string;

      if (relBC.fromPersonId === B && relBC.toPersonId !== A) {
        C = relBC.toPersonId;
        typeBC = relBC.familyRelationshipType!;
      } else if (relBC.toPersonId === B && relBC.fromPersonId !== A) {
        C = relBC.fromPersonId;
        const inv = FAMILY_RELATIONSHIP_INVERSES[relBC.familyRelationshipType!];
        if (!inv) continue;
        typeBC = inv;
      } else {
        continue;
      }

      if (C === A) continue;

      const inferredType = lookupRule(typeAB, typeBC);
      if (!inferredType) continue;

      const pairKey = `${A}:${C}`;
      if (visited.has(pairKey)) continue;
      visited.add(pairKey);

      const existing = await storage.findFamilyRelationship(A, C);
      if (existing) continue;

      try {
        const newRel = await storage.createRelationship({
          fromPersonId: A,
          toPersonId: C,
          familyRelationshipType: inferredType,
          typeId: rel.typeId,
          notes: null,
        });
        created.push(newRel);

        const inverseType = FAMILY_RELATIONSHIP_INVERSES[inferredType];
        if (inverseType) {
          const inversePairKey = `${C}:${A}`;
          if (!visited.has(inversePairKey)) {
            visited.add(inversePairKey);
            const existingInverse = await storage.findFamilyRelationship(C, A);
            if (!existingInverse) {
              const inverseRel = await storage.createRelationship({
                fromPersonId: C,
                toPersonId: A,
                familyRelationshipType: inverseType,
                typeId: rel.typeId,
                notes: null,
              });
              created.push(inverseRel);
            }
          }
        }

        queue.push({ rel: newRel, depth: item.depth + 1 });
      } catch (err) {
        console.error("[family-propagation] Failed to create inferred relationship:", err);
      }
    }
  }

  return created;
}
