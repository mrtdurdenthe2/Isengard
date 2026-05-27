# POE2 Craft Optimizer

TypeScript MVP for modeling POE2 crafting routes as probabilistic item-state transitions. Runtime data validation uses Effect Schema.

## What Is Implemented

- Base item, modifier, target, state, and currency action models.
- Eligibility filtering by item level, item class, required tags, blocked tags, affix limits, and mod groups.
- Weighted modifier rolls with `equal-weight` and visible-weight style modes.
- Currency transitions for Transmute, Augment, Regal, Alchemy, Exalt, and perfect variants.
- Fixed route evaluation by success probability, expected attempts, and expected cost.
- Confidence bands for variance-aware cost estimates.
- Sample Voltaic Staff data for proving the engine shape.
- Effect Schema validation for base item, modifier, and target data.
- poe2db-backed item profiles with selectable ideal modifier sets.
- Modifier set matching can require exactly the specified modifiers or allow specified modifiers plus random extras.

## Commands

```sh
npm test
npm run demo
npm run dev
npm run build
npm run preview
npm run scrape:poe2db
```

## Local Website

Development server:

```sh
npm run dev
```

The dev server binds to `0.0.0.0:5173`, so it is reachable from other devices on the LAN.

Production build:

```sh
npm run build
```

Static website output is written to `dist-web/`. On the Pi, run the same build command and serve `dist-web/` with any static file server. Vite preview is available with:

```sh
npm run preview
```

## Current Assumptions

- Sample poe2db item and modifier snapshots are intentionally small.
- Weights are approximate. The demo uses `equal-weight`.
- Multi-mod rolls are modeled as sequential draws from the currently eligible pool.
- Failed items are discarded.
- Resale value is ignored.
- poe2db source refs are stored on item/modifier records so pricing import can reuse the same keys later.
- poe2db weapon modifier pages are scraped because the site is rendered HTML/JS rather than a clean public API.

## Vendored Reference

Effect source is cloned locally at `repos/effect` for reference when writing Effect code. Treat it as read-only reference material; application code imports from the published `effect` package.

## Next Steps

1. Expand poe2db snapshot coverage.
2. Add poe2db pricing import using the stored item source refs.
3. Add Monte Carlo mode for large pools.
4. Add optimizer/value-iteration mode after fixed-route results are trusted.
5. Build a UI around the engine once data quality is good enough.
