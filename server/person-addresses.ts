/**
 * Address history (address-history-plan.md §2.3, §5.4). Primary rules:
 *   - a person's first current address becomes primary when they have none at all;
 *   - only a current address can be made primary;
 *   - a primary that gets an end date stays primary ("Outdated"); nothing is promoted.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { personAddresses, type InsertPersonAddress, type PersonAddress, type PrimaryAddress } from "@shared/schema";
import { UNKNOWN_END, parseTpsRange } from "@shared/partial-date";
import { db } from "./db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A rule violation the routes report as 400 (or 409 for a duplicate address). */
export class AddressError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Same key as normAddress() in map-geocoder.ts and the person_addresses_person_query index. */
const norm = (address: string) => address.trim().replace(/\s+/g, " ").toLowerCase();

function checkRange(row: { startDate?: string | null; endDate?: string | null }) {
  if (row.startDate && row.endDate && row.endDate !== UNKNOWN_END && row.endDate < row.startDate) {
    throw new AddressError("End date is before start date");
  }
}

/** Primary first, then current by latest start, then past by latest end. */
export async function getPersonAddresses(personId: string): Promise<PersonAddress[]> {
  return db.select().from(personAddresses).where(eq(personAddresses.personId, personId)).orderBy(
    sql`${personAddresses.isPrimary} DESC`,
    sql`${personAddresses.endDate} IS NULL DESC`,
    sql`${personAddresses.endDate} DESC NULLS FIRST`,
    sql`${personAddresses.startDate} DESC NULLS LAST`,
  );
}

export async function getPrimaryAddress(personId: string): Promise<PrimaryAddress> {
  const [row] = await db.select({ address: personAddresses.address, endDate: personAddresses.endDate })
    .from(personAddresses)
    .where(and(eq(personAddresses.personId, personId), eq(personAddresses.isPrimary, 1)));
  return row ? { address: row.address, outdated: row.endDate !== null } : null;
}

async function hasPrimary(tx: Tx, personId: string): Promise<boolean> {
  const [row] = await tx.select({ id: personAddresses.id }).from(personAddresses)
    .where(and(eq(personAddresses.personId, personId), eq(personAddresses.isPrimary, 1)));
  return !!row;
}

async function clearPrimary(tx: Tx, personId: string) {
  await tx.update(personAddresses).set({ isPrimary: 0 })
    .where(and(eq(personAddresses.personId, personId), eq(personAddresses.isPrimary, 1)));
}

/** Postgres unique violation on the (person, address) index → a readable 409. */
async function guardDuplicate<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: any) {
    if ((error?.cause ?? error)?.code === "23505") throw new AddressError("This person already has that address", 409);
    throw error;
  }
}

export function createPersonAddress(personId: string, data: InsertPersonAddress): Promise<PersonAddress> {
  checkRange(data);
  if (data.isPrimary && data.endDate) throw new AddressError("Only a current address can be made primary");
  return guardDuplicate(() => db.transaction(async (tx) => {
    const makePrimary = data.isPrimary || (!data.endDate && !(await hasPrimary(tx, personId)));
    if (data.isPrimary) await clearPrimary(tx, personId);
    const [row] = await tx.insert(personAddresses)
      .values({ ...data, personId, isPrimary: makePrimary ? 1 : 0, source: "manual" })
      .returning();
    return row;
  }));
}

export function updatePersonAddress(id: string, patch: Partial<InsertPersonAddress>): Promise<PersonAddress | null> {
  return guardDuplicate(() => db.transaction(async (tx) => {
    const [current] = await tx.select().from(personAddresses).where(eq(personAddresses.id, id));
    if (!current) return null;
    const merged = { ...current, ...patch };
    checkRange(merged);
    const { isPrimary, ...fields } = patch;
    if (isPrimary) {
      if (merged.endDate) throw new AddressError("Only a current address can be made primary");
      await clearPrimary(tx, current.personId);
    }
    const [row] = await tx.update(personAddresses)
      .set({ ...fields, ...(isPrimary === undefined ? {} : { isPrimary: isPrimary ? 1 : 0 }), updatedAt: new Date() })
      .where(eq(personAddresses.id, id))
      .returning();
    return row;
  }));
}

export async function deletePersonAddress(id: string): Promise<boolean> {
  const rows = await db.delete(personAddresses).where(eq(personAddresses.id, id)).returning({ id: personAddresses.id });
  return rows.length > 0;
}

// ── TruePeopleSearch import ─────────────────────────────────────────────────────

export type TpsAddressEntry = { address: string; propertyUrl?: string | null; startDate?: string | null; endDate?: string | null };

/** What the user confirmed in PRM-chrome. Absent = an older extension that never asked. */
export type TpsPrimaryChoice = { choice: "keep" } | { choice: "tps"; address: string } | undefined;

/**
 * A TPS record's addresses as history entries: the current one has no end (TPS's
 * end there only means "last reported"); previous ones without a scraped end
 * date get UNKNOWN_END so they still count as past.
 */
export function tpsEntries(record: {
  currentAddress?: string | null;
  currentAddressStartDate?: string | null;
  currentAddressPropertyDetails?: string | null;
  currentAddressPropertyUrl?: string | null;
  addresses?: TpsAddressEntry[] | null;
}): TpsAddressEntry[] {
  const entries: TpsAddressEntry[] = [];
  if (record.currentAddress?.trim()) {
    entries.push({
      address: record.currentAddress,
      propertyUrl: record.currentAddressPropertyUrl,
      startDate: record.currentAddressStartDate ?? parseTpsRange(record.currentAddressPropertyDetails).start,
      endDate: null,
    });
  }
  // TPS repeats the current address in its full list; that copy's end only means "last reported".
  const currentKey = record.currentAddress ? norm(record.currentAddress) : null;
  for (const a of record.addresses ?? []) {
    if (a.address?.trim() && norm(a.address) !== currentKey) entries.push({ ...a, endDate: a.endDate ?? UNKNOWN_END });
  }
  return entries;
}

/**
 * Merge TPS addresses into a person's history. New addresses are inserted;
 * existing ones only get their empty fields filled, so hand edits win. The
 * confirmed primary is never given an end date.
 */
export async function upsertTpsAddresses(
  tx: Tx,
  personId: string,
  entries: TpsAddressEntry[],
  primary: TpsPrimaryChoice,
): Promise<{ added: number; primaryAddress: string | null }> {
  const rows = await tx.select().from(personAddresses).where(eq(personAddresses.personId, personId));
  const byKey = new Map(rows.map((r) => [norm(r.address), r]));
  const existingPrimary = rows.find((r) => r.isPrimary === 1);
  const tpsCurrent = entries.find((e) => !e.endDate);
  const primaryKey =
    primary?.choice === "tps" ? norm(primary.address)
    : existingPrimary ? norm(existingPrimary.address)
    : primary === undefined && tpsCurrent ? norm(tpsCurrent.address)
    : undefined;

  let added = 0;
  for (const e of entries) {
    const key = norm(e.address);
    const endDate = key === primaryKey ? null : e.endDate ?? null;
    const row = byKey.get(key);
    if (!row) {
      const [inserted] = await tx.insert(personAddresses)
        .values({ personId, address: e.address.trim(), startDate: e.startDate ?? null, endDate, propertyUrl: e.propertyUrl ?? null, source: "tps" })
        .returning();
      byKey.set(key, inserted);
      added++;
      continue;
    }
    const fill: Partial<PersonAddress> = {};
    if (!row.startDate && e.startDate) fill.startDate = e.startDate;
    if (!row.propertyUrl && e.propertyUrl) fill.propertyUrl = e.propertyUrl;
    // A real TPS end date fills a current or unknown end; "unknown" never closes a current address.
    if (key !== primaryKey && endDate && endDate !== UNKNOWN_END && (row.endDate === null || row.endDate === UNKNOWN_END)) {
      fill.endDate = endDate;
    }
    if (Object.keys(fill).length) {
      const [updated] = await tx.update(personAddresses).set({ ...fill, updatedAt: new Date() })
        .where(eq(personAddresses.id, row.id)).returning();
      byKey.set(key, updated);
    }
  }

  const target = primaryKey ? byKey.get(primaryKey) : undefined;
  if (target && (target.isPrimary !== 1 || (primary?.choice === "tps" && target.endDate))) {
    await tx.update(personAddresses).set({ isPrimary: 0 })
      .where(and(eq(personAddresses.personId, personId), eq(personAddresses.isPrimary, 1), ne(personAddresses.id, target.id)));
    await tx.update(personAddresses).set({ isPrimary: 1, endDate: null, updatedAt: new Date() })
      .where(eq(personAddresses.id, target.id));
  }
  return { added, primaryAddress: target?.address ?? existingPrimary?.address ?? null };
}
