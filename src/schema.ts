import * as S from "effect/Schema";
import type { Affix, BaseItem, CraftTarget, DataSource, IdealModifierSet, ItemProfile, Mod, TargetMod } from "./types.js";

export const AffixSchema = S.Literal("prefix", "suffix");

export const DataSourceSchema = S.Struct({
  provider: S.Literal("poe2db"),
  ref: S.String,
  url: S.String,
});

export const BaseItemSchema = S.Struct({
  id: S.String,
  name: S.String,
  itemClass: S.String,
  tags: S.Array(S.String),
  requiredLevel: S.optionalWith(S.Number, { exact: true }),
  source: S.optionalWith(DataSourceSchema, { exact: true }),
  priceSource: S.optionalWith(DataSourceSchema, { exact: true }),
});

export const ModSchema = S.Struct({
  id: S.String,
  name: S.String,
  text: S.String,
  affix: AffixSchema,
  level: S.Number,
  tier: S.Number,
  families: S.optionalWith(S.Array(S.String), { exact: true }),
  itemClasses: S.Array(S.String),
  requiredTags: S.optionalWith(S.Array(S.String), { exact: true }),
  blockedByTags: S.optionalWith(S.Array(S.String), { exact: true }),
  weight: S.Union(S.Number, S.Null),
  group: S.optionalWith(S.String, { exact: true }),
  source: S.optionalWith(DataSourceSchema, { exact: true }),
});

export const TargetModSchema = S.Struct({
  id: S.optionalWith(S.String, { exact: true }),
  textIncludes: S.optionalWith(S.String, { exact: true }),
  affix: S.optionalWith(AffixSchema, { exact: true }),
  minTier: S.optionalWith(S.Number, { exact: true }),
  exactTier: S.optionalWith(S.Number, { exact: true }),
  minItemLevel: S.optionalWith(S.Number, { exact: true }),
  allowedFamilies: S.optionalWith(S.Array(S.String), { exact: true }),
});

export const CraftTargetSchema = S.Struct({
  base: S.String,
  itemLevel: S.Number,
  targets: S.Array(TargetModSchema),
  mode: S.Literal("exact-mods-only", "contains-mods", "contains-and-good"),
  allowExtraMods: S.Boolean,
  minimumScore: S.optionalWith(S.Number, { exact: true }),
});

export const IdealModifierSetSchema = S.Struct({
  id: S.String,
  name: S.String,
  description: S.optionalWith(S.String, { exact: true }),
  baseItemId: S.String,
  itemLevel: S.Number,
  targets: S.Array(TargetModSchema),
  source: S.optionalWith(DataSourceSchema, { exact: true }),
});

export const ItemProfileSchema = S.Struct({
  id: S.String,
  baseItem: BaseItemSchema,
  mods: S.Array(ModSchema),
  idealModifierSets: S.Array(IdealModifierSetSchema),
});

export const parseDataSource = (input: unknown): DataSource =>
  S.decodeUnknownSync(DataSourceSchema)(input) as DataSource;

export const parseBaseItem = (input: unknown): BaseItem =>
  S.decodeUnknownSync(BaseItemSchema)(input) as BaseItem;

export const parseMod = (input: unknown): Mod =>
  S.decodeUnknownSync(ModSchema)(input) as Mod;

export const parseMods = (input: unknown): Mod[] =>
  S.decodeUnknownSync(S.Array(ModSchema))(input) as Mod[];

export const parseTargetMod = (input: unknown): TargetMod =>
  S.decodeUnknownSync(TargetModSchema)(input) as TargetMod;

export const parseCraftTarget = (input: unknown): CraftTarget =>
  S.decodeUnknownSync(CraftTargetSchema)(input) as CraftTarget;

export const parseIdealModifierSet = (input: unknown): IdealModifierSet =>
  S.decodeUnknownSync(IdealModifierSetSchema)(input) as IdealModifierSet;

export const parseItemProfile = (input: unknown): ItemProfile =>
  S.decodeUnknownSync(ItemProfileSchema)(input) as ItemProfile;

export const parseAffix = (input: unknown): Affix =>
  S.decodeUnknownSync(AffixSchema)(input) as Affix;
