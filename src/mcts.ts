import { actions } from "./actions.js";
import { getEligiblePool, getWeight } from "./mods.js";
import { addModToState, createInitialState, modCount, stateKey } from "./state.js";
import { isFeasible, isSuccess } from "./targets.js";
import type { Affix, CraftContext, ItemState } from "./types.js";

export type MctsOptions = {
  iterations: number;
  maxSteps: number;
  seed?: number;
  exploration?: number;
};

export type MctsPolicyStep = {
  state: string;
  action: string;
  visits: number;
  successRate: number;
};

export type MctsResult = {
  method: "mcts";
  iterations: number;
  statesExplored: number;
  successes: number;
  successProbability: number;
  averageAttemptCost: number;
  expectedCost: number;
  bestAction?: string;
  policy: MctsPolicyStep[];
};

type EdgeStats = {
  actionId: string;
  visits: number;
  successes: number;
  totalCost: number;
  totalReward: number;
};

type NodeStats = {
  state: ItemState;
  visits: number;
  edges: Map<string, EdgeStats>;
};

function createRng(seed = 0x9e3779b9): () => number {
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

function rollOne(
  state: ItemState,
  ctx: CraftContext,
  rng: () => number,
  opts: { minimumModifierLevel?: number; affixFilter?: Affix } = {},
): ItemState | undefined {
  const mod = weightedRoll(getEligiblePool(state, ctx, opts), (candidate) => getWeight(candidate, ctx), rng);
  return mod ? addModToState(state, mod, ctx.target) : undefined;
}

function rollMany(
  state: ItemState,
  count: number,
  ctx: CraftContext,
  rng: () => number,
  opts: { minimumModifierLevel?: number; affixFilter?: Affix } = {},
): ItemState | undefined {
  let current: ItemState | undefined = state;
  for (let index = 0; index < count; index += 1) {
    if (!current) return undefined;
    current = rollOne(current, ctx, rng, opts);
  }
  return current;
}

function minimumLevel(actionId: string): number | undefined {
  if (actionId.startsWith("greater-transmute") || actionId.startsWith("greater-augment")) return 55;
  if (actionId.startsWith("perfect-transmute") || actionId.startsWith("perfect-augment")) return 70;
  if (actionId === "greater-regal" || actionId === "greater-exalt") return 35;
  if (actionId === "perfect-regal" || actionId === "perfect-exalt") return 50;
  return undefined;
}

function sampleAction(state: ItemState, actionId: string, ctx: CraftContext, rng: () => number): ItemState | undefined {
  if (actionId === "restart") return createInitialState(ctx.base, ctx.target.itemLevel);
  if (actionId === "stop") return state;

  if (actionId === "omen-sinistral-coronation" || actionId === "omen-dextral-coronation") {
    return rollMany({ ...state, rarity: "rare" }, 1, ctx, rng, {
      affixFilter: actionId === "omen-sinistral-coronation" ? "prefix" : "suffix",
    });
  }

  if (actionId === "omen-sinistral-exaltation" || actionId === "omen-dextral-exaltation") {
    return rollMany(state, 1, ctx, rng, {
      affixFilter: actionId === "omen-sinistral-exaltation" ? "prefix" : "suffix",
    });
  }

  if (actionId === "omen-greater-exaltation") return rollMany(state, 2, ctx, rng);

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
      rare = rollMany(rare, 1, ctx, rng, { affixFilter });
    }
    return rare;
  }

  const min = minimumLevel(actionId);
  if (actionId.endsWith("transmute")) return rollMany({ ...state, rarity: "magic" }, 1, ctx, rng, { minimumModifierLevel: min });
  if (actionId.endsWith("augment")) return rollMany(state, 1, ctx, rng, { minimumModifierLevel: min });
  if (actionId.endsWith("regal")) return rollMany({ ...state, rarity: "rare" }, 1, ctx, rng, { minimumModifierLevel: min });
  if (actionId.endsWith("exalt")) return rollMany(state, 1, ctx, rng, { minimumModifierLevel: min });
  if (actionId === "alchemy") {
    return rollMany({ ...state, rarity: "rare", prefixes: [], suffixes: [], lockedGroups: [], targetMask: 0 }, 4, ctx, rng);
  }

  return undefined;
}

function actionCost(actionId: string, ctx: CraftContext): number {
  if (actionId === "restart" || actionId === "stop") return 0;
  return actions[actionId]?.costExalts(ctx) ?? 0;
}

function canApplyAction(actionId: string, state: ItemState): boolean {
  if (actionId === "restart" || actionId === "stop") return true;
  return actions[actionId]?.canApply(state) ?? false;
}

function legalActions(state: ItemState, actionIds: string[], ctx: CraftContext): string[] {
  if (isSuccess(state, ctx.target)) return ["stop"];
  if (!isFeasible(state, ctx.target)) return ["restart"];
  return [...actionIds, "restart"].filter((actionId) => canApplyAction(actionId, state));
}

function describeState(state: ItemState, ctx: CraftContext): string {
  if (modCount(state) === 0) return `Fresh ${ctx.base.name}`;
  const targetMods = [...state.prefixes, ...state.suffixes].filter((mod) =>
    ctx.target.targets.some((target) => target.id === mod.modId),
  );
  if (targetMods.length > 0) return `If item has ${targetMods.map((mod) => mod.name).join(" + ")}`;
  return `If item is ${state.rarity} with ${state.prefixes.length} prefixes and ${state.suffixes.length} suffixes`;
}

function ucb(edge: EdgeStats, nodeVisits: number, exploration: number): number {
  if (edge.visits === 0) return Infinity;
  return edge.totalReward / edge.visits + exploration * Math.sqrt(Math.log(Math.max(1, nodeVisits)) / edge.visits);
}

export function runMcts(ctx: CraftContext, actionIds: string[], options: MctsOptions): MctsResult {
  const rng = createRng(options.seed);
  const exploration = options.exploration ?? 1.4;
  const nodes = new Map<string, NodeStats>();
  let successes = 0;
  let totalCost = 0;

  function nodeFor(state: ItemState): NodeStats {
    const key = stateKey(state);
    const existing = nodes.get(key);
    if (existing) return existing;
    const node: NodeStats = { state, visits: 0, edges: new Map() };
    for (const actionId of legalActions(state, actionIds, ctx)) {
      node.edges.set(actionId, { actionId, visits: 0, successes: 0, totalCost: 0, totalReward: 0 });
    }
    nodes.set(key, node);
    return node;
  }

  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    let state: ItemState | undefined = createInitialState(ctx.base, ctx.target.itemLevel);
    let cost = 0;
    const path: EdgeStats[] = [];

    for (let step = 0; step < options.maxSteps; step += 1) {
      if (!state || isSuccess(state, ctx.target)) break;
      const node = nodeFor(state);
      node.visits += 1;
      const edges = [...node.edges.values()];
      const edge = edges.sort((a, b) => ucb(b, node.visits, exploration) - ucb(a, node.visits, exploration))[0];
      if (!edge || edge.actionId === "stop") break;
      path.push(edge);
      cost += actionCost(edge.actionId, ctx);
      state = sampleAction(state, edge.actionId, ctx, rng);
      if (edge.actionId === "restart") break;
    }

    const success = Boolean(state && isSuccess(state, ctx.target));
    if (success) successes += 1;
    totalCost += cost;
    const reward = success ? 1 / (1 + cost) : 0;

    for (const edge of path) {
      edge.visits += 1;
      edge.successes += success ? 1 : 0;
      edge.totalCost += cost;
      edge.totalReward += reward;
    }
  }

  const root = nodeFor(createInitialState(ctx.base, ctx.target.itemLevel));
  const bestRoot = [...root.edges.values()].sort((a, b) => (b.totalReward / Math.max(1, b.visits)) - (a.totalReward / Math.max(1, a.visits)))[0];
  const policy: MctsPolicyStep[] = [...nodes.values()]
    .filter((node) => node.visits > 0)
    .map((node) => {
      const edge = [...node.edges.values()].sort((a, b) => (b.totalReward / Math.max(1, b.visits)) - (a.totalReward / Math.max(1, a.visits)))[0];
      return edge
        ? {
            state: describeState(node.state, ctx),
            action: actions[edge.actionId]?.name ?? edge.actionId,
            visits: edge.visits,
            successRate: edge.visits > 0 ? edge.successes / edge.visits : 0,
          }
        : undefined;
    })
    .filter((step): step is MctsPolicyStep => step !== undefined)
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 8);
  const successProbability = successes / options.iterations;
  const averageAttemptCost = totalCost / options.iterations;

  return {
    method: "mcts",
    iterations: options.iterations,
    statesExplored: nodes.size,
    successes,
    successProbability,
    averageAttemptCost,
    expectedCost: successProbability > 0 ? averageAttemptCost / successProbability : Infinity,
    bestAction: bestRoot ? actions[bestRoot.actionId]?.name ?? bestRoot.actionId : undefined,
    policy,
  };
}
