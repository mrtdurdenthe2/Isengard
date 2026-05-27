import type { ConfidenceRow, CraftContext, Distribution, ItemState, RouteResult } from "./types.js";
import { mergeEquivalentStates } from "./probability.js";
import { isSuccess } from "./targets.js";
import { resolveActions } from "./actions.js";

export const routeTemplates = [
  ["transmute", "augment"],
  ["greater-transmute", "greater-augment"],
  ["perfect-transmute", "perfect-augment"],
  ["transmute", "augment", "regal"],
  ["transmute", "augment", "omen-sinistral-coronation"],
  ["transmute", "augment", "omen-dextral-coronation"],
  ["greater-transmute", "greater-augment", "greater-regal"],
  ["perfect-transmute", "perfect-augment", "regal"],
  ["perfect-transmute", "perfect-augment", "perfect-regal"],
  ["transmute", "augment", "regal", "exalt"],
  ["transmute", "augment", "regal", "omen-sinistral-exaltation"],
  ["transmute", "augment", "regal", "omen-dextral-exaltation"],
  ["transmute", "augment", "regal", "exalt", "exalt"],
  ["transmute", "augment", "regal", "omen-sinistral-exaltation", "omen-dextral-exaltation"],
  ["transmute", "augment", "regal", "exalt", "exalt", "exalt"],
  ["greater-transmute", "greater-augment", "greater-regal", "greater-exalt"],
  ["greater-transmute", "greater-augment", "greater-regal", "greater-exalt", "greater-exalt"],
  ["perfect-transmute", "perfect-augment", "perfect-regal", "perfect-exalt"],
  ["perfect-transmute", "perfect-augment", "perfect-regal", "perfect-exalt", "perfect-exalt"],
  ["alchemy"],
  ["omen-sinistral-alchemy"],
  ["omen-dextral-alchemy"],
  ["alchemy", "exalt"],
  ["alchemy", "omen-sinistral-exaltation"],
  ["alchemy", "omen-dextral-exaltation"],
  ["alchemy", "greater-exalt"],
  ["alchemy", "exalt", "exalt"],
  ["alchemy", "omen-sinistral-exaltation", "omen-dextral-exaltation"],
  ["alchemy", "omen-greater-exaltation"],
  ["alchemy", "greater-exalt", "greater-exalt"],
  ["alchemy", "perfect-exalt", "perfect-exalt"],
  ["alchemy", "exalt", "exalt", "exalt"],
  ["alchemy", "greater-exalt", "greater-exalt", "greater-exalt"],
];

export function applyActionToDistribution(
  dist: Distribution<ItemState>,
  actionId: string,
  ctx: CraftContext,
): Distribution<ItemState> {
  const [action] = resolveActions([actionId]);
  const nextDist: Distribution<ItemState> = [];

  for (const entry of dist) {
    if (!action.canApply(entry.value)) continue;

    for (const next of action.transition(entry.value, ctx)) {
      nextDist.push({
        value: next.value,
        probability: entry.probability * next.probability,
      });
    }
  }

  return mergeEquivalentStates(nextDist);
}

export function evaluateRoute(
  initialState: ItemState,
  route: string[],
  ctx: CraftContext,
): RouteResult {
  let dist: Distribution<ItemState> = [{ value: initialState, probability: 1 }];
  const terminalDist: Distribution<ItemState> = [];
  let costPerAttempt = 0;

  for (const [index, action] of resolveActions(route).entries()) {
    const activeDist = dist.filter(({ value }) => {
      if (isSuccess(value, ctx.target)) return false;
      if (index === 0) return true;
      return value.targetMask !== 0;
    });

    terminalDist.push(...dist.filter(({ value }) => isSuccess(value, ctx.target)));

    if (activeDist.length === 0) {
      dist = [];
      break;
    }

    const appliedProbability = activeDist
      .filter(({ value }) => action.canApply(value))
      .reduce((sum, entry) => sum + entry.probability, 0);

    costPerAttempt += action.costExalts(ctx) * appliedProbability;
    dist = applyActionToDistribution(activeDist, action.id, ctx);
    if (dist.length === 0) break;
  }

  const successProbability = [...terminalDist, ...dist]
    .filter(({ value }) => isSuccess(value, ctx.target))
    .reduce((sum, entry) => sum + entry.probability, 0);

  return {
    route,
    costPerAttempt,
    successProbability,
    expectedAttempts: successProbability > 0 ? 1 / successProbability : Infinity,
    expectedCost: successProbability > 0 ? costPerAttempt / successProbability : Infinity,
  };
}

export function compareRoutes(
  initialState: ItemState,
  routes: string[][],
  ctx: CraftContext,
): RouteResult[] {
  return routes
    .map((route) => evaluateRoute(initialState, route, ctx))
    .sort((a, b) => a.expectedCost - b.expectedCost);
}

export function attemptsForConfidence(successProbability: number, confidence: number): number {
  if (successProbability <= 0) return Infinity;
  if (successProbability >= 1) return 1;
  return Math.ceil(Math.log(1 - confidence) / Math.log(1 - successProbability));
}

export function confidenceTable(
  successProbability: number,
  costPerAttempt: number,
  confidences = [0.5, 0.632, 0.9, 0.95, 0.99],
): ConfidenceRow[] {
  return confidences.map((confidence) => {
    const attempts = attemptsForConfidence(successProbability, confidence);
    return {
      confidence,
      attempts,
      cost: attempts * costPerAttempt,
    };
  });
}
