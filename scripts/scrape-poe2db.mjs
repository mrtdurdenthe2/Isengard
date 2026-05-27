import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = "https://poe2db.tw";
const modifiersUrl = `${baseUrl}/us/Modifiers`;
const outputPath = new URL("../src/generated/poe2db-scrape-summary.json", import.meta.url);
const dataOutputPath = new URL("../src/generated/poe2db-data.ts", import.meta.url);
const dataJsonOutputPath = new URL("../src/generated/poe2db-data.json", import.meta.url);

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function itemClassFromLabel(label) {
  return slug(label.replace(/s$/, ""));
}

function affixFromGenerationType(value) {
  if (String(value) === "1") return "prefix";
  if (String(value) === "2") return "suffix";
  return null;
}

function extractModsViewPayload(html) {
  const marker = "new ModsView(";
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return null;

  const start = markerIndex + marker.length;
  let depth = 1;
  let inString = false;
  let quote = "";
  let escape = false;

  for (let index = start; index < html.length; index += 1) {
    const char = html[index];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) return html.slice(start, index);
    }
  }

  return null;
}

function modFamilyKey(row, affix) {
  return [affix, ...(row.ModFamilyList ?? [row.Name ?? stripTags(row.str ?? "")])].join("|");
}

function toGeneratedMod(row, page, tiersByKey) {
  const affix = affixFromGenerationType(row.ModGenerationTypeID);
  if (!affix) return null;

  const key = modFamilyKey(row, affix);
  const tier = tiersByKey.get(key)?.get(Number(row.Level)) ?? 1;
  const text = stripTags(row.str ?? "");
  if (!text) return null;

  const family = row.ModFamilyList?.[0] ? slug(row.ModFamilyList[0]) : slug(`${row.Name}_${text}`);
  const id = `${page.id}_${family}_t${tier}_${slug(row.Name ?? text)}`;

  return {
    id,
    name: stripTags(row.Name ?? "Modifier"),
    text,
    affix,
    level: Number(row.Level) || 1,
    tier,
    families: [family],
    itemClasses: [page.itemClass],
    weight: row.DropChance === undefined ? null : Number(row.DropChance),
    group: family,
    source: {
      provider: "poe2db",
      ref: row.hover?.replace(/^\?s=Data%5CMods%2F/, "") ?? id,
      url: page.url,
    },
  };
}

function parseModsView(html, page) {
  const payload = extractModsViewPayload(html);
  if (!payload) return { mods: [], rawSize: 0, itemCount: 0, hasModsView: false };

  const data = JSON.parse(payload);
  const rows = (data.normal ?? []).filter((row) => affixFromGenerationType(row.ModGenerationTypeID));
  const groupedLevels = new Map();

  for (const row of rows) {
    const affix = affixFromGenerationType(row.ModGenerationTypeID);
    const key = modFamilyKey(row, affix);
    const level = Number(row.Level) || 1;
    const levels = groupedLevels.get(key) ?? new Set();
    levels.add(level);
    groupedLevels.set(key, levels);
  }

  const tiersByKey = new Map();
  for (const [key, levels] of groupedLevels) {
    const sorted = [...levels].sort((a, b) => b - a);
    tiersByKey.set(key, new Map(sorted.map((level, index) => [level, index + 1])));
  }

  return {
    mods: rows.map((row) => toGeneratedMod(row, page, tiersByKey)).filter(Boolean),
    rawSize: payload.length,
    itemCount: data.baseitem?.name ?? 0,
    hasModsView: true,
  };
}

function findWeaponModifierPages(html) {
  const weaponSection = html.match(/<span class="disabled">One Handed Weapons<\/span>[\s\S]*?<span class="disabled">Jewellery<\/span>/)?.[0] ?? "";
  const links = [...weaponSection.matchAll(/<a\s+[^>]*href="([^"]+)#ModifiersCalc"[^>]*>(.*?)<\/a>/g)];

  return links.map(([, href, label]) => ({
    id: slug(stripTags(label)),
    itemClass: itemClassFromLabel(stripTags(label)),
    label: stripTags(label),
    url: new URL(href, baseUrl).toString() + "#ModifiersCalc",
  }));
}

function summarizeClassPage(html) {
  const title = stripTags(html.match(/<title>(.*?)<\/title>/)?.[1] ?? "Unknown").replace(" - PoE2DB, Path of Exile Wiki us", "");
  const itemTab = html.match(/href="#([^"]*Item)">[^<]*\/([0-9]+)/);
  const hasModsView = html.includes("new ModsView(");
  const embeddedCalculatorBytes = html.match(/new ModsView\([\s\S]*?\);/)?.[0].length ?? 0;

  return {
    title,
    itemCount: itemTab ? Number(itemTab[2]) : 0,
    hasModsView,
    embeddedCalculatorBytes,
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Isengard poe2db scraper prototype",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

const modifiersHtml = await fetchText(modifiersUrl);
const pages = findWeaponModifierPages(modifiersHtml);
const summaries = [];
const profiles = [];

for (const page of pages) {
  const html = await fetchText(page.url.replace("#ModifiersCalc", ""));
  const parsed = parseModsView(html, page);
  summaries.push({
    ...page,
    ...summarizeClassPage(html),
    generatedModifierCount: parsed.mods.length,
  });
  profiles.push({
    id: page.id,
    baseItem: {
      id: page.id,
      name: page.label,
      itemClass: page.itemClass,
      tags: [page.itemClass, "weapon"],
      source: {
        provider: "poe2db",
        ref: page.label,
        url: page.url,
      },
      priceSource: {
        provider: "poe2db",
        ref: page.label,
        url: page.url,
      },
    },
    mods: parsed.mods,
    idealModifierSets: [],
  });
}

await mkdir(new URL("../src/generated/", import.meta.url), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify({ scrapedAt: new Date().toISOString(), source: modifiersUrl, pages: summaries }, null, 2)}\n`,
);
await writeFile(
  dataOutputPath,
  `import type { ItemProfile } from "../types.js";\n\nexport const poe2dbWeaponProfiles = ${JSON.stringify(profiles, null, 2)} satisfies ItemProfile[];\n`,
);
await writeFile(dataJsonOutputPath, `${JSON.stringify({ profiles }, null, 2)}\n`);

console.log(`Wrote ${summaries.length} poe2db weapon page summaries to ${outputPath.pathname}`);
console.log(`Wrote ${profiles.reduce((count, profile) => count + profile.mods.length, 0)} modifiers to ${dataOutputPath.pathname}`);
console.log(`Wrote Rust-loadable JSON data to ${dataJsonOutputPath.pathname}`);
