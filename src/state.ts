import type { BaseItem, ItemState, Mod, RolledMod } from "./types.js";
import { targetMaskForMods } from "./targets.js";
import type { CraftTarget } from "./types.js";

export function createInitialState(base: BaseItem, itemLevel: number): ItemState {
  return {
    baseId: base.id,
    itemLevel,
    rarity: "normal",
    prefixes: [],
    suffixes: [],
    lockedGroups: [],
    targetMask: 0,
  };
}

export function toRolledMod(mod: Mod): RolledMod {
  return {
    modId: mod.id,
    name: mod.name,
    text: mod.text,
    affix: mod.affix,
    tier: mod.tier,
    group: mod.group,
  };
}

export function addModToState(state: ItemState, mod: Mod, target: CraftTarget): ItemState {
  const rolled = toRolledMod(mod);
  const prefixes = mod.affix === "prefix" ? [...state.prefixes, rolled] : state.prefixes;
  const suffixes = mod.affix === "suffix" ? [...state.suffixes, rolled] : state.suffixes;
  const lockedGroups = mod.group ? [...new Set([...state.lockedGroups, mod.group])].sort() : state.lockedGroups;

  return {
    ...state,
    prefixes,
    suffixes,
    lockedGroups,
    targetMask: targetMaskForMods([...prefixes, ...suffixes], target),
  };
}

export function modCount(state: ItemState): number {
  return state.prefixes.length + state.suffixes.length;
}

export function stateKey(state: ItemState): string {
  const prefixIds = state.prefixes.map((mod) => mod.modId).sort().join(",");
  const suffixIds = state.suffixes.map((mod) => mod.modId).sort().join(",");
  const groups = state.lockedGroups.slice().sort().join(",");
  return [
    state.baseId,
    state.itemLevel,
    state.rarity,
    prefixIds,
    suffixIds,
    groups,
    state.targetMask,
  ].join("|");
}
