export type Affix = "prefix" | "suffix";

export type Rarity = "normal" | "magic" | "rare";

export type WeightMode = "poe2db-visible-weight" | "equal-weight" | "user-supplied";

export type TargetMode = "exact-mods-only" | "contains-mods" | "contains-and-good";

export type DataSource = {
  provider: "poe2db";
  ref: string;
  url: string;
};

export type BaseItem = {
  id: string;
  name: string;
  itemClass: string;
  tags: string[];
  requiredLevel?: number;
  source?: DataSource;
  priceSource?: DataSource;
};

export type Mod = {
  id: string;
  name: string;
  text: string;
  affix: Affix;
  level: number;
  tier: number;
  families?: string[];
  itemClasses: string[];
  requiredTags?: string[];
  blockedByTags?: string[];
  weight: number | null;
  group?: string;
  source?: DataSource;
};

export type RolledMod = {
  modId: string;
  name: string;
  text: string;
  affix: Affix;
  tier: number;
  group?: string;
};

export type ItemState = {
  baseId: string;
  itemLevel: number;
  rarity: Rarity;
  prefixes: RolledMod[];
  suffixes: RolledMod[];
  lockedGroups: string[];
  targetMask: number;
};

export type TargetMod = {
  id?: string;
  textIncludes?: string;
  affix?: Affix;
  minTier?: number;
  exactTier?: number;
  minItemLevel?: number;
  allowedFamilies?: string[];
};

export type CraftTarget = {
  base: string;
  itemLevel: number;
  targets: TargetMod[];
  mode: TargetMode;
  allowExtraMods: boolean;
  minimumScore?: number;
};

export type IdealModifierSet = {
  id: string;
  name: string;
  description?: string;
  baseItemId: string;
  itemLevel: number;
  targets: TargetMod[];
  source?: DataSource;
};

export type ItemProfile = {
  id: string;
  baseItem: BaseItem;
  mods: Mod[];
  idealModifierSets: IdealModifierSet[];
};

export type Weighted<T> = {
  value: T;
  probability: number;
};

export type Distribution<T> = Weighted<T>[];

export type CurrencyPrices = Record<string, number>;

export type CraftContext = {
  base: BaseItem;
  mods: Mod[];
  target: CraftTarget;
  prices: CurrencyPrices;
  weightMode: WeightMode;
  affixFilter?: Affix;
};

export type CraftAction = {
  id: string;
  name: string;
  costExalts: (ctx: CraftContext) => number;
  canApply: (state: ItemState) => boolean;
  transition: (state: ItemState, ctx: CraftContext) => Distribution<ItemState>;
};

export type RouteResult = {
  route: string[];
  costPerAttempt: number;
  successProbability: number;
  expectedAttempts: number;
  expectedCost: number;
};

export type ConfidenceRow = {
  confidence: number;
  attempts: number;
  cost: number;
};
