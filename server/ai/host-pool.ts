import type { AiProvider } from "@shared/schema";
import { ProviderUnreachableError } from "./http";

// Spreads summary-run AI calls across several providers (Ollama hosts with the
// same models). Each host runs up to `slots` calls at once; a host that can't be
// reached sits out for a while and the call moves to another host.

const DOWN_MS = 30_000;
// Every host unreachable this long: give up and let the job's own retries take over.
const GIVE_UP_MS = 5 * 60_000;

// mlx: the host serves MLX builds of the models, named "<model>-mlx" (faster on Macs).
// tokensPerSecond: the host's most recent measured generation speed.
type Member = { provider: AiProvider; slots: number; mlx: boolean; inFlight: number; downUntil: number; tokensPerSecond: number | null };
export type HostStatus = { providerId: string; name: string; slots: number; inFlight: number; downUntil: number | null; tokensPerSecond: number | null };

let members: Member[] = [];
let nextIndex = 0;
let waiters: (() => void)[] = [];

function wakeWaiters() {
  const woken = waiters;
  waiters = [];
  woken.forEach((w) => w());
}

/**
 * Replace the pool. Hosts kept across a rebuild are updated in place: in-flight
 * calls hold their Member and release/mark-down on it, so a copy would leak slots.
 */
export function setHostPool(entries: { provider: AiProvider; slots: number; mlx: boolean }[]): void {
  members = entries.map(({ provider, slots, mlx }) => {
    const prior = members.find((m) => m.provider.id === provider.id);
    if (!prior) return { provider, slots, mlx, inFlight: 0, downUntil: 0, tokensPerSecond: null };
    return Object.assign(prior, { provider, slots, mlx });
  });
  nextIndex = 0;
  wakeWaiters();
}

/** Total slots across the pool; 0 = pool off. */
export function hostPoolSlots(): number {
  return members.reduce((n, m) => n + m.slots, 0);
}

export function hostPoolStatus(): HostStatus[] {
  const now = Date.now();
  return members.map((m) => ({
    providerId: m.provider.id,
    name: m.provider.name,
    slots: m.slots,
    inFlight: m.inFlight,
    downUntil: m.downUntil > now ? m.downUntil : null,
    tokensPerSecond: m.tokensPerSecond,
  }));
}

/** Record a finished call's generation speed on its pool host (ignored for providers outside the pool). */
export function noteTokensPerSecond(providerId: string, tokensPerSecond: number): void {
  const m = members.find((x) => x.provider.id === providerId);
  if (m) m.tokensPerSecond = tokensPerSecond;
}

/** Least-loaded live host with a free slot, round-robin on ties. */
function pick(): Member | undefined {
  const now = Date.now();
  let best: Member | undefined;
  for (let i = 0; i < members.length; i++) {
    const m = members[(nextIndex + i) % members.length];
    if (m.downUntil > now || m.inFlight >= m.slots) continue;
    if (!best || m.inFlight / m.slots < best.inFlight / best.slots) best = m;
  }
  if (best) nextIndex = (members.indexOf(best) + 1) % members.length;
  return best;
}

async function acquire(): Promise<Member> {
  for (;;) {
    const m = pick();
    if (m) {
      m.inFlight++;
      return m;
    }
    // Wait for a slot to free up, or for the first down host to come back.
    const now = Date.now();
    const backAt = Math.min(...members.map((x) => (x.downUntil > now ? x.downUntil : Infinity)));
    await new Promise<void>((resolve) => {
      const timer = Number.isFinite(backAt) ? setTimeout(resolve, backAt - now) : undefined;
      waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function release(m: Member) {
  m.inFlight--;
  wakeWaiters();
}

/** Run fn on a free host with the model name that host serves; on an unreachable host, mark it down and retry on another. */
export async function runOnHost<T>(model: string, fn: (provider: AiProvider, model: string) => Promise<T>): Promise<T> {
  let unreachableSince = 0;
  for (;;) {
    const m = await acquire();
    try {
      return await fn(m.provider, m.mlx ? `${model}-mlx` : model);
    } catch (err) {
      if (!(err instanceof ProviderUnreachableError)) throw err;
      m.downUntil = Date.now() + DOWN_MS;
      unreachableSince ||= Date.now();
      if (Date.now() - unreachableSince > GIVE_UP_MS) throw err;
    } finally {
      release(m);
    }
  }
}
