import { actions, resolveActions } from "./actions.js";
import { getEligiblePool, getWeight } from "./mods.js";
import { addModToState, createInitialState, modCount } from "./state.js";
import { isFeasible, isSuccess } from "./targets.js";
import type { Affix, CraftContext, ItemState, RouteResult } from "./types.js";

export type MonteCarloRouteResult = RouteResult & {
  trials: number;
  successes: number;
  method: "monte-carlo";
  confidenceLow: number;
  confidenceHigh: number;
};

export type MonteCarloOptions = {
  trials: number;
  seed?: number;
};

function createRng(seed = 0xdecafbad): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function weightedRoll<T>(items: T[], weightOf: (item: T) => number, rng: () => number): T | undefined {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  if (total <= 0) return undefined;

  let roll = rng() * total;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll <= 0) return item;
  }

  return items[items.length - 1];
}

function rollOneModSample(
  state: ItemState,
  ctx: CraftContext,
  rng: () => number,
  opts: { minimumModifierLevel?: number; affixFilter?: Affix } = {},
): ItemState | undefined {
  const eligible = getEligiblePool(state, ctx, opts);
  const mod = weightedRoll(eligible, (candidate) => getWeight(candidate, ctx), rng);
  return mod ? addModToState(state, mod, ctx.target) : undefined;
}

function rollNModsSample(
  state: ItemState,
  count: number,
  ctx: CraftContext,
  rng: () => number,
  opts: { minimumModifierLevel?: number; affixFilter?: Affix } = {},
): ItemState | undefined {
  let current: ItemState | undefined = state;
  for (let index = 0; index < count; index += 1) {
    if (!current) return undefined;
    current = rollOneModSample(current, ctx, rng, opts);
  }
  return current;
}

function actionMinimumModifierLevel(actionId: string): number | undefined {
  if (actionId.startsWith("greater-transmute") || actionId.startsWith("greater-augment")) return 55;
  if (actionId.startsWith("perfect-transmute") || actionId.startsWith("perfect-augment")) return 70;
  if (actionId === "greater-regal" || actionId === "greater-exalt") return 35;
  if (actionId === "perfect-regal" || actionId === "perfect-exalt") return 50;
  return undefined;
}

function sampleAction(state: ItemState, actionId: string, ctx: CraftContext, rng: () => number): ItemState | undefined {
  const minimumModifierLevel = actionMinimumModifierLevel(actionId);

  if (actionId === "omen-sinistral-coronation" || actionId === "omen-dextral-coronation") {
    const affixFilter: Affix = actionId === "omen-sinistral-coronation" ? "prefix" : "suffix";
    return rollNModsSample({ ...state, rarity: "rare" }, 1, ctx, rng, { affixFilter });
  }

  if (actionId === "omen-sinistral-exaltation" || actionId === "omen-dextral-exaltation") {
    const affixFilter: Affix = actionId === "omen-sinistral-exaltation" ? "prefix" : "suffix";
    return rollNModsSample(state, 1, ctx, rng, { affixFilter });
  }

  if (actionId === "omen-greater-exaltation") {
    return rollNModsSample(state, 2, ctx, rng);
  }

  if (actionId === "omen-sinistral-alchemy" || actionId === "omen-dextral-alchemy") {
    let rare: ItemState | undefined = {
      ...state,
      rarity: "rare",
      prefixes: [],
      suffixes: [],
      lockedGroups: [],
      targetMask: 0,
    };
    const pattern: Affix[] = actionId === "omen-sinistral-alchemy"
      ? ["prefix", "prefix", "prefix", "suffix"]
      : ["prefix", "suffix", "suffix", "suffix"];
    for (const affixFilter of pattern) {
      if (!rare) return undefined;
      rare = rollNModsSample(rare, 1, ctx, rng, { affixFilter });
    }
    return rare;
  }

  if (actionId.endsWith("transmute")) {
    return rollNModsSample({ ...state, rarity: "magic" }, 1, ctx, rng, { minimumModifierLevel });
  }

  if (actionId.endsWith("augment")) {
    return rollNModsSample(state, 1, ctx, rng, { minimumModifierLevel });
  }

  if (actionId.endsWith("regal")) {
    return rollNModsSample({ ...state, rarity: "rare" }, 1, ctx, rng, { minimumModifierLevel });
  }

  if (actionId.endsWith("exalt")) {
    return rollNModsSample(state, 1, ctx, rng, { minimumModifierLevel });
  }

  if (actionId === "alchemy") {
    const rare: ItemState = {
      ...state,
      rarity: "rare",
      prefixes: [],
      suffixes: [],
      lockedGroups: [],
      targetMask: 0,
    };
    return rollNModsSample(rare, Math.max(0, 4 - modCount(rare)), ctx, rng);
  }

  return undefined;
}

function shouldContinueRoute(state: ItemState, ctx: CraftContext): boolean {
  if (isSuccess(state, ctx.target)) return false;
  if (!isFeasible(state, ctx.target)) return false;
  if (ctx.target.allowExtraMods) return true;
  return state.targetMask !== 0;
}

export function evaluateRouteMonteCarlo(
  route: string[],
  ctx: CraftContext,
  opts: MonteCarloOptions,
): MonteCarloRouteResult {
  const rng = createRng(opts.seed);
  const resolved = resolveActions(route);
  let successes = 0;
  let totalCost = 0;

  for (let trial = 0; trial < opts.trials; trial += 1) {
    let state: ItemState | undefined = createInitialState(ctx.base, ctx.target.itemLevel);
    let cost = 0;

    for (const action of resolved) {
      if (!state || !action.canApply(state)) break;
      if (!shouldContinueRoute(state, ctx)) break;

      cost += action.costExalts(ctx);
      state = sampleAction(state, action.id, ctx, rng);
    }

    if (state && isSuccess(state, ctx.target)) successes += 1;
    totalCost += cost;
  }

  const successProbability = successes / opts.trials;
  const costPerAttempt = totalCost / opts.trials;
  const standardError = Math.sqrt((successProbability * (1 - successProbability)) / opts.trials);

  return {
    route,
    costPerAttempt,
    successProbability,
    expectedAttempts: successProbability > 0 ? 1 / successProbability : Infinity,
    expectedCost: successProbability > 0 ? costPerAttempt / successProbability : Infinity,
    trials: opts.trials,
    successes,
    method: "monte-carlo",
    confidenceLow: Math.max(0, successProbability - 1.96 * standardError),
    confidenceHigh: Math.min(1, successProbability + 1.96 * standardError),
  };
}

export function compareRoutesMonteCarlo(
  routes: string[][],
  ctx: CraftContext,
  opts: MonteCarloOptions,
): MonteCarloRouteResult[] {
  return routes
    .map((route, index) => evaluateRouteMonteCarlo(route, ctx, { ...opts, seed: (opts.seed ?? 0xdecafbad) + index }))
    .sort((a, b) => a.expectedCost - b.expectedCost);
}
