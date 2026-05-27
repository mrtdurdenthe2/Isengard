import type { Affix, CraftAction, CraftContext, Distribution, ItemState } from "./types.js";
import { modCount } from "./state.js";
import { rollNMods } from "./probability.js";

function price(id: string) {
  return (ctx: CraftContext) => ctx.prices[id] ?? 0;
}

function combinedPrice(...ids: string[]) {
  return (ctx: CraftContext) => ids.reduce((sum, id) => sum + (ctx.prices[id] ?? 0), 0);
}

function setRarity(state: ItemState, rarity: ItemState["rarity"]): ItemState {
  return { ...state, rarity };
}

function withRarity(dist: Distribution<ItemState>, rarity: ItemState["rarity"]): Distribution<ItemState> {
  return dist.map((entry) => ({ ...entry, value: { ...entry.value, rarity } }));
}

function transmuteAction(id: string, name: string, minimumModifierLevel?: number): CraftAction {
  return {
    id,
    name,
    costExalts: price(id),
    canApply: (state) => state.rarity === "normal",
    transition: (state, ctx) =>
      rollNMods(setRarity(state, "magic"), 1, ctx, { minimumModifierLevel }),
  };
}

function augmentAction(id: string, name: string, minimumModifierLevel?: number): CraftAction {
  return {
    id,
    name,
    costExalts: price(id),
    canApply: (state) => state.rarity === "magic" && modCount(state) < 2,
    transition: (state, ctx) => rollNMods(state, 1, ctx, { minimumModifierLevel }),
  };
}

function regalAction(id: string, name: string, minimumModifierLevel?: number): CraftAction {
  return {
    id,
    name,
    costExalts: price(id),
    canApply: (state) => state.rarity === "magic",
    transition: (state, ctx) =>
      withRarity(rollNMods(setRarity(state, "rare"), 1, ctx, { minimumModifierLevel }), "rare"),
  };
}

function exaltAction(id: string, name: string, minimumModifierLevel?: number): CraftAction {
  return {
    id,
    name,
    costExalts: price(id),
    canApply: (state) => state.rarity === "rare" && modCount(state) < 6,
    transition: (state, ctx) => rollNMods(state, 1, ctx, { minimumModifierLevel }),
  };
}

function regalAffixAction(id: string, name: string, affixFilter: Affix): CraftAction {
  return {
    id,
    name,
    costExalts: combinedPrice(id, "regal"),
    canApply: (state) => state.rarity === "magic",
    transition: (state, ctx) =>
      withRarity(rollNMods(setRarity(state, "rare"), 1, ctx, { affixFilter }), "rare"),
  };
}

function exaltAffixAction(id: string, name: string, affixFilter: Affix): CraftAction {
  return {
    id,
    name,
    costExalts: combinedPrice(id, "exalt"),
    canApply: (state) => state.rarity === "rare" && modCount(state) < 6,
    transition: (state, ctx) => rollNMods(state, 1, ctx, { affixFilter }),
  };
}

function omenGreaterExaltAction(): CraftAction {
  return {
    id: "omen-greater-exaltation",
    name: "Omen of Greater Exaltation + Exalt",
    costExalts: combinedPrice("omen-greater-exaltation", "exalt"),
    canApply: (state) => state.rarity === "rare" && modCount(state) < 5,
    transition: (state, ctx) => rollNMods(state, 2, ctx),
  };
}

function alchemyAffixPatternAction(id: string, name: string, prefixes: number, suffixes: number): CraftAction {
  return {
    id,
    name,
    costExalts: combinedPrice(id, "alchemy"),
    canApply: (state) => state.rarity === "normal" || state.rarity === "magic",
    transition: (state, ctx) => {
      const rare = { ...state, rarity: "rare" as const, prefixes: [], suffixes: [], lockedGroups: [], targetMask: 0 };
      let dist: Distribution<ItemState> = [{ value: rare, probability: 1 }];
      for (const affixFilter of [
        ...Array<Affix>(prefixes).fill("prefix"),
        ...Array<Affix>(suffixes).fill("suffix"),
      ]) {
        dist = dist.flatMap((entry) =>
          rollNMods(entry.value, 1, ctx, { affixFilter }).map((next) => ({
            value: next.value,
            probability: entry.probability * next.probability,
          })),
        );
      }
      return dist;
    },
  };
}

export const actions: Record<string, CraftAction> = {
  transmute: transmuteAction("transmute", "Orb of Transmutation"),
  "greater-transmute": transmuteAction("greater-transmute", "Greater Orb of Transmutation", 55),
  "perfect-transmute": transmuteAction("perfect-transmute", "Perfect Orb of Transmutation", 70),
  augment: augmentAction("augment", "Orb of Augmentation"),
  "greater-augment": augmentAction("greater-augment", "Greater Orb of Augmentation", 55),
  "perfect-augment": augmentAction("perfect-augment", "Perfect Orb of Augmentation", 70),
  regal: regalAction("regal", "Regal Orb"),
  "greater-regal": regalAction("greater-regal", "Greater Regal Orb", 35),
  "perfect-regal": regalAction("perfect-regal", "Perfect Regal Orb", 50),
  "omen-sinistral-coronation": regalAffixAction(
    "omen-sinistral-coronation",
    "Omen of Sinistral Coronation + Regal",
    "prefix",
  ),
  "omen-dextral-coronation": regalAffixAction(
    "omen-dextral-coronation",
    "Omen of Dextral Coronation + Regal",
    "suffix",
  ),
  alchemy: {
    id: "alchemy",
    name: "Orb of Alchemy",
    costExalts: price("alchemy"),
    canApply: (state) => state.rarity === "normal" || state.rarity === "magic",
    transition: (state, ctx) => {
      const rare = setRarity(state, "rare");
      return rollNMods(rare, Math.max(0, 4 - modCount(rare)), ctx);
    },
  },
  "omen-sinistral-alchemy": alchemyAffixPatternAction(
    "omen-sinistral-alchemy",
    "Omen of Sinistral Alchemy + Alchemy",
    3,
    1,
  ),
  "omen-dextral-alchemy": alchemyAffixPatternAction(
    "omen-dextral-alchemy",
    "Omen of Dextral Alchemy + Alchemy",
    1,
    3,
  ),
  exalt: exaltAction("exalt", "Exalted Orb"),
  "greater-exalt": exaltAction("greater-exalt", "Greater Exalted Orb", 35),
  "perfect-exalt": exaltAction("perfect-exalt", "Perfect Exalted Orb", 50),
  "omen-sinistral-exaltation": exaltAffixAction(
    "omen-sinistral-exaltation",
    "Omen of Sinistral Exaltation + Exalt",
    "prefix",
  ),
  "omen-dextral-exaltation": exaltAffixAction(
    "omen-dextral-exaltation",
    "Omen of Dextral Exaltation + Exalt",
    "suffix",
  ),
  "omen-greater-exaltation": omenGreaterExaltAction(),
};

export function resolveActions(route: string[]): CraftAction[] {
  return route.map((id) => {
    const action = actions[id];
    if (!action) throw new Error(`Unknown craft action: ${id}`);
    return action;
  });
}
