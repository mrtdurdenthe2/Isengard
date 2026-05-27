import type { CraftTarget, ItemState, Mod, RolledMod, TargetMod } from "./types.js";

export function matchesTarget(mod: RolledMod | Mod, target: TargetMod): boolean {
  if (target.id && "id" in mod && mod.id !== target.id) return false;
  if (target.id && "modId" in mod && mod.modId !== target.id) return false;
  if (target.affix && mod.affix !== target.affix) return false;
  if (target.exactTier !== undefined && mod.tier !== target.exactTier) return false;
  if (target.minTier !== undefined && mod.tier > target.minTier) return false;
  if (target.minItemLevel !== undefined && "level" in mod && mod.level < target.minItemLevel) return false;
  if (target.textIncludes && !mod.text.includes(target.textIncludes)) return false;
  if (target.allowedFamilies && "families" in mod) {
    const families = mod.families ?? [];
    if (!target.allowedFamilies.some((family) => families.includes(family))) return false;
  }

  return true;
}

export function targetMaskForMods(mods: RolledMod[], target: CraftTarget): number {
  return target.targets.reduce((mask, targetMod, index) => {
    const matched = mods.some((mod) => matchesTarget(mod, targetMod));
    return matched ? mask | (1 << index) : mask;
  }, 0);
}

export function isSuccess(state: ItemState, target: CraftTarget): boolean {
  const mods = [...state.prefixes, ...state.suffixes];
  const containsTargets = target.targets.every((targetMod) =>
    mods.some((mod) => matchesTarget(mod, targetMod)),
  );

  if (!containsTargets) return false;

  if (target.mode === "exact-mods-only") {
    return mods.length === target.targets.length;
  }

  if (target.mode === "contains-and-good") {
    return scoreState(state, target) >= (target.minimumScore ?? target.targets.length);
  }

  return true;
}

export function scoreState(state: ItemState, target: CraftTarget): number {
  const mods = [...state.prefixes, ...state.suffixes];
  return target.targets.filter((targetMod) => mods.some((mod) => matchesTarget(mod, targetMod))).length;
}

export function isFeasible(state: ItemState, target: CraftTarget): boolean {
  const mods = [...state.prefixes, ...state.suffixes];
  const missing = target.targets.filter((targetMod) => !mods.some((mod) => matchesTarget(mod, targetMod)));
  const missingPrefixes = missing.filter((targetMod) => targetMod.affix === "prefix").length;
  const missingSuffixes = missing.filter((targetMod) => targetMod.affix === "suffix").length;
  const maxPrefixes = state.rarity === "magic" ? 1 : 3;
  const maxSuffixes = state.rarity === "magic" ? 1 : 3;

  return missingPrefixes <= maxPrefixes - state.prefixes.length && missingSuffixes <= maxSuffixes - state.suffixes.length;
}
