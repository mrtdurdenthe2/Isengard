import { actions } from "./actions.js";
import { applyActionToDistribution } from "./routes.js";
import { modCount, stateKey } from "./state.js";
import { isFeasible, isSuccess } from "./targets.js";
import type { CraftContext, ItemState, RouteResult } from "./types.js";

export type PolicyStep = {
  state: string;
  action: string;
};

export type PolicyResult = RouteResult & {
  policy: PolicyStep[];
  exploredStates: number;
  maxRolls: number;
};

type Candidate = {
  successProbability: number;
  costPerAttempt: number;
  policy: PolicyStep[];
  exploredStates: Set<string>;
};

function describeState(state: ItemState, ctx: CraftContext): string {
  if (modCount(state) === 0) return `Fresh ${ctx.base.name}`;
  const mods = [...state.prefixes, ...state.suffixes];
  const targetHits = mods.filter((mod) => ctx.target.targets.some((target) => target.id === mod.modId));
  if (targetHits.length > 0) {
    return `If item has ${targetHits.map((mod) => mod.name).join(" + ")}`;
  }
  return "If item has no selected target modifier";
}

function actionRollCount(actionId: string): number {
  if (actionId === "alchemy" || actionId === "omen-sinistral-alchemy" || actionId === "omen-dextral-alchemy") return 4;
  if (actionId === "omen-greater-exaltation") return 2;
  return 1;
}

function betterCandidate(current: Candidate | undefined, next: Candidate): Candidate {
  if (!current) return next;
  const currentExpected = current.successProbability > 0 ? current.costPerAttempt / current.successProbability : Infinity;
  const nextExpected = next.successProbability > 0 ? next.costPerAttempt / next.successProbability : Infinity;
  return nextExpected < currentExpected ? next : current;
}

function solveState(
  state: ItemState,
  ctx: CraftContext,
  actionIds: string[],
  remainingRolls: number,
  memo: Map<string, Candidate>,
): Candidate {
  const key = `${stateKey(state)}|${remainingRolls}`;
  const cached = memo.get(key);
  if (cached) return cached;

  const exploredStates = new Set([stateKey(state)]);

  if (isSuccess(state, ctx.target)) {
    const result = { successProbability: 1, costPerAttempt: 0, policy: [], exploredStates };
    memo.set(key, result);
    return result;
  }

  if (!isFeasible(state, ctx.target)) {
    const result = { successProbability: 0, costPerAttempt: 0, policy: [], exploredStates };
    memo.set(key, result);
    return result;
  }

  if (remainingRolls <= 0) {
    const result = { successProbability: 0, costPerAttempt: 0, policy: [], exploredStates };
    memo.set(key, result);
    return result;
  }

  let best: Candidate | undefined;

  for (const actionId of actionIds) {
    const action = actions[actionId];
    const rolls = actionRollCount(actionId);
    if (!action || rolls > remainingRolls || !action.canApply(state)) continue;

    const nextDist = applyActionToDistribution([{ value: state, probability: 1 }], actionId, ctx);
    if (nextDist.length === 0) continue;

    let successProbability = 0;
    let futureCost = 0;
    const policy: PolicyStep[] = [{ state: describeState(state, ctx), action: action.name }];
    const nextExploredStates = new Set<string>([stateKey(state)]);

    for (const outcome of nextDist) {
      const next = solveState(outcome.value, ctx, actionIds, remainingRolls - rolls, memo);
      successProbability += outcome.probability * next.successProbability;
      futureCost += outcome.probability * next.costPerAttempt;
      for (const explored of next.exploredStates) nextExploredStates.add(explored);
      for (const step of next.policy) {
        if (!policy.some((existing) => existing.state === step.state && existing.action === step.action)) {
          policy.push(step);
        }
      }
    }

    const candidate = {
      successProbability,
      costPerAttempt: action.costExalts(ctx) + futureCost,
      policy,
      exploredStates: nextExploredStates,
    };

    if (candidate.successProbability <= 0) continue;
    best = betterCandidate(best, candidate);
  }

  const result = best ?? { successProbability: 0, costPerAttempt: 0, policy: [], exploredStates };
  memo.set(key, result);
  return result;
}

export function solveBoundedPolicy(
  initialState: ItemState,
  actionIds: string[],
  ctx: CraftContext,
  maxRolls: number,
): PolicyResult {
  const solved = solveState(initialState, ctx, actionIds, maxRolls, new Map());
  const expectedAttempts = solved.successProbability > 0 ? 1 / solved.successProbability : Infinity;

  return {
    route: solved.policy.length > 0 ? ["conditional-policy"] : [],
    costPerAttempt: solved.costPerAttempt,
    successProbability: solved.successProbability,
    expectedAttempts,
    expectedCost: solved.successProbability > 0 ? solved.costPerAttempt / solved.successProbability : Infinity,
    policy: solved.policy,
    exploredStates: solved.exploredStates.size,
    maxRolls,
  };
}
