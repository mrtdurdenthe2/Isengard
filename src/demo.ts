import {
  compareRoutes,
  confidenceTable,
  createInitialState,
  routeTemplates,
  samplePrices,
  staffMods,
  staffTarget,
  voltaicStaff,
} from "./index.js";
import type { CraftContext } from "./index.js";

const ctx: CraftContext = {
  base: voltaicStaff,
  mods: staffMods,
  target: staffTarget,
  prices: samplePrices,
  weightMode: "equal-weight",
};

const initial = createInitialState(voltaicStaff, staffTarget.itemLevel);
const results = compareRoutes(initial, routeTemplates, ctx);
const best = results[0];

console.log("Best route under sample equal-weight assumptions:");
console.log(`  Route: ${best.route.join(" -> ")}`);
console.log(`  Success chance: ${(best.successProbability * 100).toFixed(3)}%`);
console.log(`  Expected attempts: ${best.expectedAttempts.toFixed(2)}`);
console.log(`  Expected cost: ${best.expectedCost.toFixed(2)} ex`);
console.log("");
console.log("Confidence table:");

for (const row of confidenceTable(best.successProbability, best.costPerAttempt)) {
  console.log(
    `  ${(row.confidence * 100).toFixed(1)}%: ${row.attempts} attempts, ${row.cost.toFixed(2)} ex`,
  );
}
