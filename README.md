# GradePace

A grade-adjusted pacing tool for trail races. Upload a course GPX file and get a
per-kilometer pacing plan — target pace, elevation gain, run/hike split, and
cumulative time — plus a projected finish, all computed in the browser.

Built around the [Minetti (2002)](https://doi.org/10.1152/japplphysiol.01177.2001)
energy-cost-of-running model, with a power-hike transition for steep climbs that
pure pace-based planners (e.g. PacePro) don't handle well.

## How it works
1. **Parse** — reads track points (lat/lon/elevation) from the GPX via DOMParser.
2. **Distance** — cumulative horizontal distance via the Haversine formula.
3. **Smooth** — centered moving average on elevation (raw GPS elevation is noisy).
4. **Gradient** — per-segment slope = Δelevation / Δdistance.
5. **Cost → pace** — Minetti grade-adjusted cost gives a per-segment pace relative
   to your flat pace; above a transition grade, segments switch to power-hiking
   at a fixed vertical ascent rate (VAM).
6. **Plan** — aggregates into per-km splits and a projected finish time.

Tunable inputs: flat pace, hike VAM, transition grade, and a terrain factor.

## Getting started
```sh
npm install
npm run dev      # local dev server
npm run build    # production build
npm run test     # run the engine unit tests
npm run lint
```

## Project structure
```text
src/
  lib/pacing.ts        Pure pacing engine (parse, distance, smoothing,
                       gradient, Minetti cost, splits). Unit-tested.
  lib/pacing.test.ts   Vitest coverage (Minetti anchors, clamp, splits).
  App.tsx              UI: upload, effort inputs, elevation chart, splits table.
```

## Status
Active development. Current technical state and roadmap live in
[STATUS.md](./STATUS.md).
