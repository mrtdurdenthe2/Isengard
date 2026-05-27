import type { BaseItem, CraftContext, ItemState, Mod } from "./types.js";
import { modCount } from "./state.js";

export type ModFilterOptions = {
  itemLevel: number;
  minimumModifierLevel?: number;
  maximumModifierLevel?: number;
  affixFilter?: Mod["affix"];
};

export function isModEligible(base: BaseItem, mod: Mod, opts: ModFilterOptions): boolean {
  if (mod.level > opts.itemLevel) return false;
  if (opts.minimumModifierLevel !== undefined && mod.level < opts.minimumModifierLevel) return false;
  if (opts.maximumModifierLevel !== undefined && mod.level > opts.maximumModifierLevel) return false;
  if (opts.affixFilter !== undefined && mod.affix !== opts.affixFilter) return false;
  if (!mod.itemClasses.includes(base.itemClass)) return false;

  for (const tag of mod.requiredTags ?? []) {
    if (!base.tags.includes(tag)) return false;
  }

  for (const tag of mod.blockedByTags ?? []) {
    if (base.tags.includes(tag)) return false;
  }

  return true;
}

export function getWeight(mod: Mod, ctx: CraftContext): number {
  if (ctx.weightMode === "equal-weight") return 1;
  return mod.weight ?? 1;
}

export function canRollMod(state: ItemState, mod: Mod): boolean {
  if (state.prefixes.some((rolled) => rolled.modId === mod.id)) return false;
  if (state.suffixes.some((rolled) => rolled.modId === mod.id)) return false;
  if (mod.group && state.lockedGroups.includes(mod.group)) return false;

  const maxTotal = state.rarity === "rare" ? 6 : 2;
  if (modCount(state) >= maxTotal) return false;
  if (mod.affix === "prefix" && state.prefixes.length >= 3) return false;
  if (mod.affix === "suffix" && state.suffixes.length >= 3) return false;
  if (state.rarity === "magic" && state.prefixes.length >= 1 && mod.affix === "prefix") return false;
  if (state.rarity === "magic" && state.suffixes.length >= 1 && mod.affix === "suffix") return false;

  return true;
}

export function getEligiblePool(
  state: ItemState,
  ctx: CraftContext,
  opts: Partial<ModFilterOptions> = {},
): Mod[] {
  return ctx.mods.filter((mod) =>
    isModEligible(ctx.base, mod, {
      itemLevel: state.itemLevel,
      affixFilter: ctx.affixFilter,
      ...opts,
    }) && canRollMod(state, mod),
  );
}
