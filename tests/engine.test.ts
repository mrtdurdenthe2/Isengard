import assert from "node:assert/strict";
import test from "node:test";
import {
  actions,
  compareRoutesMonteCarlo,
  compareRoutes,
  confidenceTable,
  createInitialState,
  evaluateRoute,
  itemProfiles,
  parseBaseItem,
  probabilitySum,
  routeTemplates,
  samplePrices,
  solveBoundedPolicy,
  staffMods,
  staffTarget,
  voltaicStaff,
} from "../src/index.js";
import { isSuccess } from "../src/targets.js";
import type { CraftContext } from "../src/index.js";

const ctx: CraftContext = {
  base: voltaicStaff,
  mods: staffMods,
  target: staffTarget,
  prices: samplePrices,
  weightMode: "equal-weight",
};

test("single-mod transitions form a complete probability distribution", () => {
  const initial = createInitialState(voltaicStaff, 80);
  const dist = actions["perfect-transmute"].transition(initial, ctx);

  assert.equal(dist.length > 0, true);
  assert.equal(Math.abs(probabilitySum(dist) - 1) < 1e-12, true);
});

test("fixed route evaluation reports success probability and expected cost", () => {
  const initial = createInitialState(voltaicStaff, 80);
  const result = evaluateRoute(initial, ["perfect-transmute", "perfect-augment"], ctx);

  assert.equal(result.successProbability > 0, true);
  assert.equal(result.successProbability <= 1, true);
  assert.equal(result.expectedAttempts, 1 / result.successProbability);
  assert.equal(result.expectedCost, result.costPerAttempt / result.successProbability);
});

test("route costs are weighted by promising intermediate states", () => {
  const initial = createInitialState(voltaicStaff, 80);
  const result = evaluateRoute(initial, ["perfect-transmute", "perfect-augment"], ctx);

  assert.equal(result.successProbability > 0, true);
  assert.equal(result.costPerAttempt < samplePrices["perfect-transmute"] + samplePrices["perfect-augment"], true);
  assert.equal(result.costPerAttempt > samplePrices["perfect-transmute"], true);
});

test("bounded policy search returns a conditional policy", () => {
  const initial = createInitialState(voltaicStaff, 80);
  const result = solveBoundedPolicy(initial, ["perfect-transmute", "perfect-augment"], ctx, 2);

  assert.equal(result.successProbability > 0, true);
  assert.equal(result.policy.length > 0, true);
  assert.equal(result.exploredStates > 0, true);
  assert.deepEqual(result.route, ["conditional-policy"]);
});

test("monte carlo route comparison estimates route outcomes", () => {
  const results = compareRoutesMonteCarlo([["perfect-transmute", "perfect-augment"]], ctx, { trials: 2000, seed: 1 });

  assert.equal(results.length, 1);
  assert.equal(results[0].trials, 2000);
  assert.equal(results[0].successProbability >= 0, true);
  assert.equal(results[0].successProbability <= 1, true);
});

test("route comparison sorts by expected cost", () => {
  const initial = createInitialState(voltaicStaff, 80);
  const results = compareRoutes(initial, routeTemplates, ctx);

  assert.equal(results.length, routeTemplates.length);
  for (let i = 1; i < results.length; i += 1) {
    assert.equal(results[i - 1].expectedCost <= results[i].expectedCost, true);
  }
});

test("confidence table increases attempts with confidence", () => {
  const rows = confidenceTable(0.1, 2, [0.5, 0.9, 0.99]);

  assert.deepEqual(
    rows.map((row) => row.confidence),
    [0.5, 0.9, 0.99],
  );
  assert.equal(rows[0].attempts < rows[1].attempts, true);
  assert.equal(rows[1].attempts < rows[2].attempts, true);
  assert.equal(rows[2].cost, rows[2].attempts * 2);
});

test("Effect Schema rejects invalid base data", () => {
  assert.throws(() =>
    parseBaseItem({
      id: "bad",
      name: "Bad Staff",
      itemClass: "staff",
      tags: "staff",
    }),
  );
});

test("poe2db item profiles expose ideal modifier sets", () => {
  const profile = itemProfiles[0];
  const set = profile.idealModifierSets[0];

  assert.equal(profile.baseItem.source?.provider, "poe2db");
  assert.equal(profile.baseItem.priceSource?.provider, "poe2db");
  assert.equal(set.baseItemId, profile.baseItem.id);
  assert.equal(set.targets.length > 0, true);
  assert.equal(profile.mods.every((mod) => mod.source?.provider === "poe2db"), true);
});

test("exact modifier sets reject extra random modifiers", () => {
  const target = {
    ...staffTarget,
    mode: "exact-mods-only" as const,
    allowExtraMods: false,
  };
  const matching = {
    ...createInitialState(voltaicStaff, 80),
    prefixes: [
      {
        modId: "stormbound_t1",
        name: "Stormbound",
        text: "Gain (55-60)% of Damage as Extra Lightning Damage",
        affix: "prefix" as const,
        tier: 1,
        group: "extra_damage",
      },
    ],
    suffixes: [
      {
        modId: "of_assimilation_t1",
        name: "of Assimilation",
        text: "Gain (36-45) Mana per enemy killed",
        affix: "suffix" as const,
        tier: 1,
        group: "mana_on_kill",
      },
    ],
  };
  const withExtra = {
    ...matching,
    prefixes: [
      ...matching.prefixes,
      {
        modId: "charged_t1",
        name: "Charged",
        text: "(90-109)% increased Lightning Damage",
        affix: "prefix" as const,
        tier: 1,
        group: "elemental_damage",
      },
    ],
  };

  assert.equal(isSuccess(matching, target), true);
  assert.equal(isSuccess(withExtra, target), false);
  assert.equal(isSuccess(withExtra, { ...target, mode: "contains-mods", allowExtraMods: true }), true);
});
