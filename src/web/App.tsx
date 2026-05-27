import {
  Activity,
  AlertTriangle,
  Check,
  Coins,
  FlaskConical,
  Info,
  Route,
  Server,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  compareRoutes,
  compareRoutesMonteCarlo,
  confidenceTable,
  createInitialState,
  poe2dbWeaponModifierPages,
  poe2dbWeaponProfiles,
  routeTemplates,
  samplePrices,
  solveBoundedPolicy,
} from "../index.js";
import type { CraftContext, CraftTarget, MctsResult, Mod, TargetMod, WeightMode } from "../index.js";

type ModifierGroup = {
  key: string;
  label: string;
  affix: Mod["affix"];
  mods: Mod[];
};

type OptimizationObjective = "expected-cost" | "expected-attempts" | "success-chance";

const currencyLabels: Record<string, string> = {
  transmute: "Transmute",
  "greater-transmute": "Greater Transmute",
  "perfect-transmute": "Perfect Transmute",
  augment: "Augment",
  "greater-augment": "Greater Augment",
  "perfect-augment": "Perfect Augment",
  regal: "Regal",
  "greater-regal": "Greater Regal",
  "perfect-regal": "Perfect Regal",
  "omen-sinistral-coronation": "Omen Prefix Regal",
  "omen-dextral-coronation": "Omen Suffix Regal",
  alchemy: "Alchemy",
  "omen-sinistral-alchemy": "Omen Prefix Alchemy",
  "omen-dextral-alchemy": "Omen Suffix Alchemy",
  exalt: "Exalt",
  "greater-exalt": "Greater Exalt",
  "perfect-exalt": "Perfect Exalt",
  "omen-sinistral-exaltation": "Omen Prefix Exalt",
  "omen-dextral-exaltation": "Omen Suffix Exalt",
  "omen-greater-exaltation": "Omen Greater Exalt",
};

const modifierSetModes = [
  { id: "allow-extra", label: "Set + random" },
  { id: "exact", label: "Exact set" },
];

const weightModes: Array<{ id: WeightMode; label: string }> = [
  { id: "equal-weight", label: "Equal" },
  { id: "poe2db-visible-weight", label: "Visible weights" },
];

const optimizationObjectives: Array<{ id: OptimizationObjective; label: string }> = [
  { id: "expected-cost", label: "Lowest cost" },
  { id: "expected-attempts", label: "Fewest attempts" },
  { id: "success-chance", label: "Highest chance" },
];

const itemProfiles = poe2dbWeaponProfiles;
const exactPolicyRollCap = 2;
const exactTemplateRollCap = 2;
const monteCarloTrials = 100000;
const reliableMonteCarloSuccesses = 300;
const mctsIterations = 10000;
const mctsMaxSteps = 6;
const actionRollCounts: Record<string, number> = {
  transmute: 1,
  "greater-transmute": 1,
  "perfect-transmute": 1,
  augment: 1,
  "greater-augment": 1,
  "perfect-augment": 1,
  regal: 1,
  "greater-regal": 1,
  "perfect-regal": 1,
  "omen-sinistral-coronation": 1,
  "omen-dextral-coronation": 1,
  alchemy: 4,
  "omen-sinistral-alchemy": 4,
  "omen-dextral-alchemy": 4,
  exalt: 1,
  "greater-exalt": 1,
  "perfect-exalt": 1,
  "omen-sinistral-exaltation": 1,
  "omen-dextral-exaltation": 1,
  "omen-greater-exaltation": 2,
};
const actionMinimumModifierLevels: Record<string, number> = {
  "greater-transmute": 55,
  "perfect-transmute": 70,
  "greater-augment": 55,
  "perfect-augment": 70,
  "greater-regal": 35,
  "perfect-regal": 50,
  "greater-exalt": 35,
  "perfect-exalt": 50,
};

function formatExalts(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (value >= 100) return `${value.toFixed(0)} ex`;
  if (value >= 10) return `${value.toFixed(1)} ex`;
  return `${value.toFixed(2)} ex`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}

function objectiveValue(
  result: { expectedCost: number; expectedAttempts: number; successProbability: number },
  objective: OptimizationObjective,
): number {
  if (objective === "expected-attempts") return result.expectedAttempts;
  if (objective === "success-chance") return -result.successProbability;
  return result.expectedCost;
}

function routeName(route: string[]): string {
  if (route.length === 1 && route[0] === "conditional-policy") return "Conditional policy";
  return route.map((id) => currencyLabels[id] ?? id).join(" -> ");
}

function routeRollCount(route: string[]): number {
  return route.reduce((count, action) => count + (actionRollCounts[action] ?? 0), 0);
}

function routeMinimumModifierLevel(route: string[]): number | undefined {
  const minimums = route
    .map((action) => actionMinimumModifierLevels[action])
    .filter((level): level is number => level !== undefined);
  return minimums.length > 0 ? Math.max(...minimums) : undefined;
}

function defaultSelectedModIds(mods: Mod[]): string[] {
  const prefix = mods.find((mod) => mod.affix === "prefix");
  const suffix = mods.find((mod) => mod.affix === "suffix");
  return [prefix?.id, suffix?.id].filter((id): id is string => Boolean(id));
}

function modToTarget(mod: Mod): TargetMod {
  return {
    id: mod.id,
    affix: mod.affix,
    exactTier: mod.tier,
  };
}

function modifierGroupKey(mod: Mod): string {
  return `${mod.affix}:${mod.group ?? mod.families?.[0] ?? mod.name}`;
}

function groupModifiers(mods: Mod[]): ModifierGroup[] {
  const groups = new Map<string, ModifierGroup>();

  for (const mod of mods) {
    const key = modifierGroupKey(mod);
    const existing = groups.get(key);
    if (existing) {
      existing.mods.push(mod);
    } else {
      groups.set(key, {
        key,
        label: mod.families?.[0]?.replaceAll("_", " ") ?? mod.group?.replaceAll("_", " ") ?? mod.name,
        affix: mod.affix,
        mods: [mod],
      });
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      mods: group.mods.slice().sort((a, b) => a.tier - b.tier || b.level - a.level),
    }))
    .sort((a, b) => a.affix.localeCompare(b.affix) || a.label.localeCompare(b.label));
}

export function App() {
  const defaultProfile = itemProfiles[0];
  const [profileId, setProfileId] = useState(defaultProfile.id);
  const [selectedModIds, setSelectedModIds] = useState(() => defaultSelectedModIds(defaultProfile.mods));
  const [allowExtraMods, setAllowExtraMods] = useState(true);
  const [maxExplicitMods, setMaxExplicitMods] = useState(2);
  const [optimizationObjective, setOptimizationObjective] = useState<OptimizationObjective>("expected-cost");
  const [weightMode, setWeightMode] = useState<WeightMode>("equal-weight");
  const [prices, setPrices] = useState(samplePrices);
  const [enabledActions, setEnabledActions] = useState(() => new Set(Object.keys(samplePrices)));
  const [modifierSearch, setModifierSearch] = useState("");
  const [expandedModifierGroups, setExpandedModifierGroups] = useState(() => new Set<string>());
  const [mctsResult, setMctsResult] = useState<MctsResult | undefined>();
  const [mctsRunning, setMctsRunning] = useState(false);

  const selectedProfile = useMemo(
    () => itemProfiles.find((profile) => profile.id === profileId) ?? defaultProfile,
    [defaultProfile, profileId],
  );
  const selectedMods = useMemo(
    () => selectedProfile.mods.filter((mod) => selectedModIds.includes(mod.id)),
    [selectedModIds, selectedProfile.mods],
  );
  const optimalItemLevel = useMemo(
    () => Math.max(1, ...selectedMods.map((mod) => mod.level)),
    [selectedMods],
  );
  const modifierGroups = useMemo(() => groupModifiers(selectedProfile.mods), [selectedProfile.mods]);
  const filteredModifierGroups = useMemo(
    () =>
      modifierGroups.filter((group) => {
        const query = modifierSearch.trim().toLowerCase();
        if (!query) return true;
        return `${group.label} ${group.affix} ${group.mods.map((mod) => `${mod.name} ${mod.text} t${mod.tier}`).join(" ")}`
          .toLowerCase()
          .includes(query);
      }),
    [modifierGroups, modifierSearch],
  );
  const prefixGroups = useMemo(
    () => filteredModifierGroups.filter((group) => group.affix === "prefix"),
    [filteredModifierGroups],
  );
  const suffixGroups = useMemo(
    () => filteredModifierGroups.filter((group) => group.affix === "suffix"),
    [filteredModifierGroups],
  );

  const enabledRoutes = useMemo(
    () =>
      routeTemplates.filter(
        (route) => route.every((action) => enabledActions.has(action)) && routeRollCount(route) <= maxExplicitMods,
      ),
    [enabledActions, maxExplicitMods],
  );
  const exactRoutes = useMemo(
    () => enabledRoutes.filter((route) => routeRollCount(route) <= exactTemplateRollCap),
    [enabledRoutes],
  );
  const skippedRoutes = useMemo(
    () => enabledRoutes.filter((route) => routeRollCount(route) > exactTemplateRollCap),
    [enabledRoutes],
  );
  const invalidRoutes = useMemo(
    () =>
      exactRoutes
        .map((route) => {
          const minimumLevel = routeMinimumModifierLevel(route);
          const blockedMod = minimumLevel
            ? selectedMods.find((mod) => mod.level < minimumLevel)
            : undefined;

          return blockedMod
            ? {
                route,
                reason: `Invalid: selected mod "${blockedMod.name}" has level ${blockedMod.level}, below route minimum modifier level ${minimumLevel}.`,
              }
            : undefined;
        })
        .filter((entry): entry is { route: string[]; reason: string } => entry !== undefined),
    [exactRoutes, selectedMods],
  );
  const validRoutes = useMemo(
    () => exactRoutes.filter((route) => !invalidRoutes.some((invalid) => invalid.route === route)),
    [exactRoutes, invalidRoutes],
  );

  const target = useMemo<CraftTarget>(
    () => ({
      base: selectedProfile.baseItem.name,
      itemLevel: optimalItemLevel,
      targets: selectedMods.map(modToTarget),
      mode: allowExtraMods ? "contains-mods" : "exact-mods-only",
      allowExtraMods,
    }),
    [allowExtraMods, optimalItemLevel, selectedMods, selectedProfile.baseItem.name],
  );

  const ctx: CraftContext = useMemo(
    () => ({
      base: selectedProfile.baseItem,
      mods: selectedProfile.mods,
      target,
      prices,
      weightMode,
    }),
    [prices, selectedProfile, target, weightMode],
  );

  const results = useMemo(
    () => {
      if (selectedMods.length === 0) return [];
      return compareRoutes(createInitialState(selectedProfile.baseItem, optimalItemLevel), validRoutes, ctx);
    },
    [ctx, optimalItemLevel, selectedMods.length, selectedProfile.baseItem, validRoutes],
  );
  const monteCarloResults = useMemo(
    () => {
      if (selectedMods.length === 0 || skippedRoutes.length === 0) return [];
      return compareRoutesMonteCarlo(skippedRoutes, ctx, { trials: monteCarloTrials });
    },
    [ctx, selectedMods.length, skippedRoutes],
  );
  const policyResult = useMemo(
    () => {
      if (selectedMods.length === 0) return undefined;
      return solveBoundedPolicy(
        createInitialState(selectedProfile.baseItem, optimalItemLevel),
        [...enabledActions],
        ctx,
        Math.min(maxExplicitMods, exactPolicyRollCap),
      );
    },
    [ctx, enabledActions, maxExplicitMods, optimalItemLevel, selectedMods.length, selectedProfile.baseItem],
  );

  const rankedMonteCarloResults = useMemo(
    () =>
      monteCarloResults
        .slice()
        .sort((a, b) => objectiveValue(a, optimizationObjective) - objectiveValue(b, optimizationObjective)),
    [monteCarloResults, optimizationObjective],
  );
  const rankedExactResults = useMemo(
    () =>
      results
        .slice()
        .sort((a, b) => objectiveValue(a, optimizationObjective) - objectiveValue(b, optimizationObjective)),
    [optimizationObjective, results],
  );
  const bestReliableMonteCarlo = rankedMonteCarloResults.find(
    (result) => result.successes >= reliableMonteCarloSuccesses,
  );
  const exactBest = policyResult && policyResult.successProbability > 0 ? policyResult : rankedExactResults[0];
  const best = bestReliableMonteCarlo && (!exactBest || objectiveValue(bestReliableMonteCarlo, optimizationObjective) < objectiveValue(exactBest, optimizationObjective)) ? bestReliableMonteCarlo : exactBest;
  const confidenceRows = best ? confidenceTable(best.successProbability, best.costPerAttempt) : [];
  const perfectEligibleMods = selectedMods.filter((mod) => mod.level >= 70);
  const testedRouteCount = results.length + monteCarloResults.length;

  useEffect(() => {
    if (selectedMods.length === 0) {
      setMctsResult(undefined);
      setMctsRunning(false);
      return;
    }

    setMctsRunning(true);
    setMctsResult(undefined);
    const worker = new Worker(new URL("./mctsWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ type: "done"; result: MctsResult }>) => {
      if (event.data.type === "done") {
        setMctsResult(event.data.result);
        setMctsRunning(false);
        worker.terminate();
      }
    };
    worker.onerror = () => {
      setMctsRunning(false);
      worker.terminate();
    };
    worker.postMessage({
      type: "run",
      ctx,
      actionIds: [...enabledActions],
      options: { iterations: mctsIterations, maxSteps: mctsMaxSteps, seed: selectedMods.length + optimalItemLevel },
    });

    return () => {
      worker.terminate();
    };
  }, [ctx, enabledActions, optimalItemLevel, selectedMods.length]);

  function updatePrice(id: string, value: string) {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 0) return;
    setPrices((current) => ({ ...current, [id]: next }));
  }

  function toggleAction(id: string) {
    setEnabledActions((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectProfile(id: string) {
    const nextProfile = itemProfiles.find((profile) => profile.id === id) ?? defaultProfile;
    setProfileId(nextProfile.id);
    setSelectedModIds(defaultSelectedModIds(nextProfile.mods));
    setModifierSearch("");
    setExpandedModifierGroups(new Set());
  }

  function toggleTargetMod(mod: Mod) {
    setSelectedModIds((current) => {
      if (current.includes(mod.id)) return current.filter((modId) => modId !== mod.id);
      const groupIds = selectedProfile.mods
        .filter((candidate) => modifierGroupKey(candidate) === modifierGroupKey(mod))
        .map((candidate) => candidate.id);
      return [...current.filter((modId) => !groupIds.includes(modId)), mod.id];
    });
  }

  function toggleModifierGroup(key: string) {
    setExpandedModifierGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function removeTargetMod(id: string) {
    setSelectedModIds((current) => current.filter((modId) => modId !== id));
  }

  function renderModifierGroup(group: ModifierGroup) {
    return (
      <div className="modifier-group" key={group.key}>
        <button
          className="modifier-group-toggle"
          type="button"
          onClick={() => toggleModifierGroup(group.key)}
        >
          <span>{expandedModifierGroups.has(group.key) ? "-" : "+"}</span>
          <strong>{group.label}</strong>
          <small>{group.mods.length} tiers</small>
        </button>
        {expandedModifierGroups.has(group.key) ? (
          <div className="modifier-tiers">
            {group.mods.map((mod) => (
              <button
                className={selectedModIds.includes(mod.id) ? "modifier-tier-row active" : "modifier-tier-row"}
                key={mod.id}
                type="button"
                onClick={() => toggleTargetMod(mod)}
              >
                <span className="modifier-tier">T{mod.tier}</span>
                <span className="modifier-text">
                  <strong>{mod.name}</strong>
                  {mod.text}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <main className="shell">
      <section className="workspace">
        <aside className="sidebar" aria-label="Craft inputs">
          <div className="brand">
            <FlaskConical aria-hidden="true" />
            <div>
              <h1>POE2 Craft Optimizer</h1>
              <p>poe2db modifier target search</p>
            </div>
          </div>

          <section className="panel">
            <div className="panel-title">
              <SlidersHorizontal aria-hidden="true" />
              <h2>Target</h2>
            </div>
            <label className="field">
              <span>Weapon type</span>
              <select value={selectedProfile.id} onChange={(event) => selectProfile(event.target.value)}>
                {itemProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.baseItem.name} ({profile.mods.length} modifiers)
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Optimal item level</span>
              <input
                min={1}
                max={100}
                type="number"
                value={optimalItemLevel}
                readOnly
              />
            </label>
            <div className="segmented" aria-label="Modifier set mode">
              {modifierSetModes.map((mode) => (
                <button
                  className={(mode.id === "allow-extra") === allowExtraMods ? "active" : ""}
                  key={mode.id}
                  type="button"
                  onClick={() => setAllowExtraMods(mode.id === "allow-extra")}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <label className="field">
              <span>Max explicit mods</span>
              <select
                value={maxExplicitMods}
                onChange={(event) => setMaxExplicitMods(Number(event.target.value))}
              >
                {[2, 3, 4, 5, 6].map((count) => (
                  <option key={count} value={count}>
                    {count} {count === 2 ? "magic-only" : "rare-capable"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Optimize for</span>
              <select
                value={optimizationObjective}
                onChange={(event) => setOptimizationObjective(event.target.value as OptimizationObjective)}
              >
                {optimizationObjectives.map((objective) => (
                  <option key={objective.id} value={objective.id}>
                    {objective.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field modifier-search">
              <span>Wanted modifiers and tiers</span>
              <input
                placeholder="Search modifiers"
                type="search"
                value={modifierSearch}
                onChange={(event) => setModifierSearch(event.target.value)}
              />
            </label>
            <div className="modifier-picker">
              <div className="modifier-column">
                <h3>Base Prefix</h3>
                <div className="modifier-column-list">
                  {prefixGroups.map(renderModifierGroup)}
                  {prefixGroups.length === 0 ? <p className="empty-copy">No prefixes match.</p> : null}
                </div>
              </div>
              <div className="modifier-column">
                <h3>Base Suffix</h3>
                <div className="modifier-column-list">
                  {suffixGroups.map(renderModifierGroup)}
                  {suffixGroups.length === 0 ? <p className="empty-copy">No suffixes match.</p> : null}
                </div>
              </div>
            </div>
            <div className="target-mods">
              {selectedMods.map((mod) => (
                <div className="target-mod" key={mod.id}>
                  <div>
                    <strong>{mod.affix} T{mod.tier} · ilvl {mod.level}</strong>
                    <span>{mod.text}</span>
                  </div>
                  <button type="button" onClick={() => removeTargetMod(mod.id)}>
                    Remove
                  </button>
                </div>
              ))}
              {selectedMods.length === 0 ? <p className="empty-copy">Select at least one modifier to evaluate routes.</p> : null}
            </div>
            {perfectEligibleMods.length > 0 ? (
              <div className="info-note">
                Higher-level targets can be cheaper because they qualify for Greater or Perfect currency. These currencies only roll modifiers at or above their minimum modifier level.
              </div>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel-title">
              <Coins aria-hidden="true" />
              <h2>Prices</h2>
            </div>
            <div className="price-grid">
              {Object.entries(samplePrices).map(([id]) => (
                <label className="price-row" key={id}>
                  <span>{currencyLabels[id] ?? id}</span>
                  <input
                    min={0}
                    step={0.01}
                    type="number"
                    value={prices[id]}
                    onChange={(event) => updatePrice(id, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <Route aria-hidden="true" />
              <h2>Currencies</h2>
            </div>
            <div className="toggle-grid">
              {Object.keys(samplePrices).map((id) => (
                <label className="check-row" key={id}>
                  <input
                    checked={enabledActions.has(id)}
                    type="checkbox"
                    onChange={() => toggleAction(id)}
                  />
                  <span>{currencyLabels[id] ?? id}</span>
                </label>
              ))}
            </div>
          </section>
        </aside>

        <section className="results" aria-label="Route results">
          <div className="topbar">
            <div>
              <h2>Best Known Result</h2>
              <p>
                Best by {optimizationObjectives.find((objective) => objective.id === optimizationObjective)?.label.toLowerCase()} among {testedRouteCount} tested templates/policies, not a global optimum. Monte Carlo rare routes need {reliableMonteCarloSuccesses}+ successes to rank as best.
              </p>
            </div>
            <div className="weight-switch" aria-label="Weight mode">
              {weightModes.map((mode) => (
                <button
                  className={mode.id === weightMode ? "active" : ""}
                  key={mode.id}
                  type="button"
                  onClick={() => setWeightMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {best ? (
            <>
              <section className="summary-grid">
                <div className="metric">
                  <span>Best reliable result</span>
                  <strong>{routeName(best.route)}</strong>
                </div>
                <div className="metric">
                  <span>Success chance</span>
                  <strong>{formatPercent(best.successProbability)}</strong>
                </div>
                <div className="metric">
                  <span>Expected attempts</span>
                  <strong>{best.expectedAttempts.toFixed(2)}</strong>
                </div>
                <div className="metric">
                  <span>Expected cost</span>
                  <strong>{formatExalts(best.expectedCost)}</strong>
                </div>
              </section>

              <section className="table-panel">
                <div className="section-title">
                  <Activity aria-hidden="true" />
                  <h2>Best Exact 2-Roll Policy</h2>
                </div>
                {policyResult && policyResult.policy.length > 0 ? (
                  <div className="policy-list">
                    {policyResult.policy.map((step) => (
                      <article className="policy-row" key={`${step.state}-${step.action}`}>
                        <span>{step.state}</span>
                        <strong>{step.action}</strong>
                      </article>
                    ))}
                    <article className="policy-row restart">
                      <span>Otherwise</span>
                      <strong>Discard and restart</strong>
                    </article>
                  </div>
                ) : null}
              </section>

              <section className="table-panel route-comparison">
                <div className="section-title">
                  <Activity aria-hidden="true" />
                  <h2>Experimental MCTS Worker</h2>
                </div>
                {mctsRunning ? <p className="empty-copy">Running {mctsIterations.toLocaleString()} MCTS iterations in a worker...</p> : null}
                {mctsResult ? (
                  <div className="policy-list">
                    <article className="policy-row">
                      <span>
                        {mctsResult.iterations.toLocaleString()} iterations, {mctsResult.statesExplored.toLocaleString()} states, {mctsResult.successes.toLocaleString()} successes
                      </span>
                      <strong>{mctsResult.bestAction ?? "No action found"}</strong>
                    </article>
                    <article className="policy-row">
                      <span>Estimated chance {formatPercent(mctsResult.successProbability)}; expected cost {formatExalts(mctsResult.expectedCost)}</span>
                      <strong>Best found by search</strong>
                    </article>
                    {mctsResult.policy.map((step) => (
                      <article className="policy-row" key={`${step.state}-${step.action}-${step.visits}`}>
                        <span>
                          {step.state} · {step.visits.toLocaleString()} visits · {formatPercent(step.successRate)} success in branch
                        </span>
                        <strong>{step.action}</strong>
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="table-panel route-comparison">
                <div className="section-title">
                  <Route aria-hidden="true" />
                  <h2>Template Comparison</h2>
                </div>
                <div className="route-list">
                  {rankedExactResults.map((result, index) => (
                    <article className="route-row" key={result.route.join("-")}>
                      <div className="rank">{index + 1}</div>
                      <div className="route-main">
                        <strong>{routeName(result.route)}</strong>
                        <span>{formatExalts(result.costPerAttempt)} per attempt</span>
                      </div>
                      <div className="route-stat">
                        <span>Chance</span>
                        <strong>{formatPercent(result.successProbability)}</strong>
                      </div>
                      <div className="route-stat">
                        <span>Average</span>
                        <strong>{formatExalts(result.expectedCost)}</strong>
                      </div>
                    </article>
                  ))}
                  {invalidRoutes.map((invalid) => (
                    <article className="route-row invalid" key={invalid.route.join("-")}>
                      <div className="rank">!</div>
                      <div className="route-main">
                        <strong>{routeName(invalid.route)}</strong>
                        <span>{invalid.reason}</span>
                      </div>
                      <div className="route-stat">
                        <span>Chance</span>
                        <strong>Invalid</strong>
                      </div>
                      <div className="route-stat">
                        <span>Average</span>
                        <strong>n/a</strong>
                      </div>
                    </article>
                  ))}
                  {rankedMonteCarloResults.map((result, index) => (
                    <article className="route-row simulated" key={result.route.join("-")}>
                      <div className="rank">~{index + 1}</div>
                      <div className="route-main">
                        <strong>{routeName(result.route)}</strong>
                        <span>
                          Monte Carlo: {result.successes}/{result.trials.toLocaleString()} successes, 95% CI {formatPercent(result.confidenceLow)}-{formatPercent(result.confidenceHigh)}
                          {result.successes < reliableMonteCarloSuccesses ? `; noisy estimate, not used for best ranking` : ""}
                        </span>
                      </div>
                      <div className="route-stat">
                        <span>Chance</span>
                        <strong>{formatPercent(result.successProbability)}</strong>
                      </div>
                      <div className="route-stat">
                        <span>Average</span>
                        <strong>{formatExalts(result.expectedCost)}</strong>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="lower-grid">
                <div className="table-panel">
                  <div className="section-title">
                    <Check aria-hidden="true" />
                    <h2>Confidence</h2>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Confidence</th>
                        <th>Attempts</th>
                        <th>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {confidenceRows.map((row) => (
                        <tr key={row.confidence}>
                          <td>{(row.confidence * 100).toFixed(1)}%</td>
                          <td>{row.attempts}</td>
                          <td>{formatExalts(row.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="assumptions">
                  <div className="section-title">
                    <Info aria-hidden="true" />
                    <h2>Assumptions</h2>
                  </div>
                  <ul>
                    <li>Weights: {weightModes.find((mode) => mode.id === weightMode)?.label}</li>
                    <li>Item source: {selectedProfile.baseItem.source?.provider ?? "manual"}</li>
                    <li>Modifier set: {allowExtraMods ? "specified mods plus random mods allowed" : "exact specified mods only"}</li>
                    <li>Item level: optimized to {optimalItemLevel}, the lowest level that can roll all selected tiers</li>
                    <li>poe2db weapon pages tracked: {poe2dbWeaponModifierPages.length}</li>
                    <li>Template cap: routes up to {maxExplicitMods} explicit mods</li>
                    <li>Exact template solver: capped at {exactTemplateRollCap} rolls to avoid state explosion</li>
                    <li>Monte Carlo: {monteCarloTrials.toLocaleString()} trials per route above {exactTemplateRollCap} rolls</li>
                    <li>Monte Carlo ranking: routes need at least {reliableMonteCarloSuccesses} successes before they can become the headline best result</li>
                    <li>Policy cap: exact conditional policy search limited to {exactPolicyRollCap} modifier rolls</li>
                    <li>Optimality: best known among enabled/tested routes only; omens, essences, resale, and unmodeled mechanics are excluded</li>
                    <li>Roll model: sequential draws from eligible mods</li>
                    <li>Failed items: discarded</li>
                    <li>Resale value: ignored</li>
                    <li>Pricing: manual for now, poe2db source refs are stored for import</li>
                  </ul>
                  <div className="host-note">
                    <Server aria-hidden="true" />
                    <span>Use `npm run dev` for LAN testing or `npm run build` then serve `dist-web` on the Pi.</span>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <div className="empty-state">
              <AlertTriangle aria-hidden="true" />
              <h2>No enabled route can be evaluated</h2>
              <p>Enable at least one complete route template in the currency list.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
