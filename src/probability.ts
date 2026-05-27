import type { CraftContext, Distribution, ItemState } from "./types.js";
import { addModToState, stateKey } from "./state.js";
import { getEligiblePool, getWeight } from "./mods.js";

export function mergeEquivalentStates(dist: Distribution<ItemState>): Distribution<ItemState> {
  const merged = new Map<string, { value: ItemState; probability: number }>();

  for (const entry of dist) {
    const key = stateKey(entry.value);
    const existing = merged.get(key);
    if (existing) {
      existing.probability += entry.probability;
    } else {
      merged.set(key, { ...entry });
    }
  }

  return [...merged.values()].filter((entry) => entry.probability > 0);
}

export function rollOneMod(
  state: ItemState,
  ctx: CraftContext,
  opts: { minimumModifierLevel?: number; maximumModifierLevel?: number; affixFilter?: "prefix" | "suffix" } = {},
): Distribution<ItemState> {
  const eligible = getEligiblePool(state, ctx, opts);
  const totalWeight = eligible.reduce((sum, mod) => sum + getWeight(mod, ctx), 0);

  if (totalWeight <= 0) return [];

  return eligible.map((mod) => ({
    probability: getWeight(mod, ctx) / totalWeight,
    value: addModToState(state, mod, ctx.target),
  }));
}

export function rollNMods(
  state: ItemState,
  count: number,
  ctx: CraftContext,
  opts: { minimumModifierLevel?: number; maximumModifierLevel?: number; affixFilter?: "prefix" | "suffix" } = {},
): Distribution<ItemState> {
  let dist: Distribution<ItemState> = [{ value: state, probability: 1 }];

  for (let i = 0; i < count; i += 1) {
    const nextDist: Distribution<ItemState> = [];

    for (const entry of dist) {
      for (const next of rollOneMod(entry.value, ctx, opts)) {
        nextDist.push({
          value: next.value,
          probability: entry.probability * next.probability,
        });
      }
    }

    dist = mergeEquivalentStates(nextDist);
    if (dist.length === 0) break;
  }

  return dist;
}

export function probabilitySum<T>(dist: Distribution<T>): number {
  return dist.reduce((sum, entry) => sum + entry.probability, 0);
}
