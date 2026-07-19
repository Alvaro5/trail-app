# GradePace

Grade-adjusted pacing plans for trail races — live at
[gradepace.vercel.app](https://gradepace.vercel.app/).

Most pace planners assume you run every hill. On real trails, steep climbs are
power-hikes. GradePace takes a course GPX (a recorded track *or* a route
export) and produces a plan that admits this: per-km or per-mile splits with
target pace, climb, and run/hike share, plus a projected finish shown as an
honest **range**, not a false-precision single number. Everything runs in the
browser — no backend, and your GPX never leaves your device.

## What makes it different

- **Power-hikes are planned, not ignored.** Above a transition grade
  (default 18%), iso-effort running is physically unavailable — the plan
  switches to hiking at a fixed vertical speed (VAM). The elevation profile
  is colored by what you'll *do* (descent / runnable / climb / power-hike).
- **Self-calibration instead of guessed knobs.** Upload a run you recorded
  and GradePace inverts its own model against it: it measures your personal
  terrain factor (with stopped time filtered out) rather than asking you to
  invent one. Route exports with synthetic timestamps are detected by a
  plausibility band and refused.
- **Honest uncertainty.** Pre-race prediction can't beat day-of biology
  (sleep, heat, fueling swing a 70k by 20–40 min). The finish is a range —
  −8%/+10% uncalibrated, −5%/+7% once calibrated — with the model's central
  estimate in the middle.

## How it works

1. **Parse** — `<trkpt>` (or `<rtept>` fallback) → lat/lon/ele, optional
   timestamps for the calibration path.
2. **Distance** — cumulative Haversine.
3. **Resample** — even 10 m stations (kills gradient spikes from
   near-coincident GPS fixes).
4. **Smooth** — centered moving average over a fixed 30 m *physical* window.
5. **Gradient** — Δelevation / Δdistance per segment; D+ via a 5 m
   hysteresis deadband (density-stable, noise-robust).
6. **Cost → pace** — [Minetti (2002)](https://doi.org/10.1152/japplphysiol.01177.2001)
   energy-cost polynomial (clamped to its validated ±45% range) scales your
   flat pace; above the transition grade, segments hard-switch to
   power-hiking at fixed VAM.
7. **Plan** — aggregate into km or mile splits, project the finish, wrap it
   in the uncertainty range.

Calibration inverts the same forward model: predicted total (at terrain ×1.00)
vs. your actual *moving* time → measured terrain factor, one click to apply.

## Getting started

```sh
npm install
npm run dev      # local dev server
npm run build    # production build
npm run test     # engine + app tests (Vitest)
npm run lint
```

Useful scripts (run with `npx tsx` — the engine uses extensionless TS imports):

```sh
npx tsx scripts/gen-og.mjs                     # regenerate og.png from the live share card
npx tsx scripts/render-card-preview.mjs a.gpx out.png   # preview the share card for any course
node scripts/calibrate-scan.ts efforts/*.gpx   # fit terrain factors across recorded runs
node scripts/prior-scan.ts efforts/*.gpx       # course-signal vs factor analysis (negative result)
```

## Project structure

```text
src/
  lib/pacing.ts        Pure engine: parse, distance, resample, smoothing,
                       gradients, Minetti cost, splits, moving time,
                       calibration fit, finish range. No React. Unit-tested.
  lib/format.ts        Time/pace formatters shared by UI and share card.
  lib/shareCard.ts     Shareable plan image as a self-contained SVG.
  lib/rasterize.ts     SVG → PNG in the browser.
  lib/gradeColor.ts    Shared grade→color scale (chart + share card).
  lib/basemaps.ts      Basemap catalog: terrain / standard / satellite / hybrid.
  lib/pois.ts          Overpass POIs (water, toilets, viewpoints): bbox query,
                       endpoint fallback, client-side route-corridor filter.
  App.tsx              UI: upload, effort inputs, calibration, share, table.
  ElevationChart.tsx   Grade-colored profile (lazy-loaded Recharts chunk).
  CourseMap.tsx        Map with the grade-colored route, aid stations, basemap
                       switcher, scale bar, opt-in POI overlay (lazy Leaflet).
  ErrorBoundary.tsx    Styled fallback instead of a white screen.
```

## Status

Active development. Current technical state and roadmap live in
[STATUS.md](./STATUS.md).
