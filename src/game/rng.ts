/**
 * Deterministic RNG helpers. The universe is generated from a string seed, so
 * the same seed must always produce the exact same galaxy.
 */

export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  picks<T>(items: readonly T[], count: number): T[];
  chance(p: number): boolean;
  weighted<T>(items: readonly { item: T; weight: number }[]): T;
  shuffle<T>(items: readonly T[]): T[];
  fork(): Rng;
}

export function hashString(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: string | number): Rng {
  let state = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  if (state === 0) state = 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    range(min, max) {
      return min + next() * (max - min);
    },
    int(min, max) {
      return Math.floor(min + next() * (max - min + 1));
    },
    pick(items) {
      return items[Math.floor(next() * items.length)];
    },
    picks(items, count) {
      return rng.shuffle(items).slice(0, Math.max(0, Math.min(count, items.length)));
    },
    chance(p) {
      return next() < p;
    },
    weighted(items) {
      const total = items.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
      let roll = next() * total;
      for (const entry of items) {
        roll -= Math.max(0, entry.weight);
        if (roll <= 0) return entry.item;
      }
      return items[items.length - 1].item;
    },
    shuffle(items) {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
      }
      return copy;
    },
    fork() {
      return createRng(Math.floor(next() * 0xffffffff));
    },
  };

  return rng;
}

/** Runtime randomness (events, combat) — does not need to be reproducible. */
export const runtimeRng: Rng = createRng(Math.floor(Math.random() * 0xffffffff));
