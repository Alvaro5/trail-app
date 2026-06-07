# Trail App — Status

## Stack (current)
- Vite + React + TypeScript
- Tailwind, Recharts (charting)
- Deployed: Vercel (auto-deploy from GitHub main)
- Pacing model: Minetti grade-adjusted cost

## Done
- Scaffold deployed live on Vercel
- GPX upload + parse (DOMParser → {lat, lon, ele}), with parser-error guard
- Cumulative distance (Haversine)
- Elevation smoothing (centered moving average, window 3 — D+ 835 m, matches official ~700–900) + D+/D−
- Per-segment gradients (Δele / Δdist)
- Minetti grade-adjusted cost model, clamped to ±0.45 — verified against the 2002 paper
- Engine extracted to `src/lib/pacing.ts` (pure, no React); 7 Minetti anchors + clamp locked in Vitest (`npm test`)
- Per-segment pace from cost ratio → projected finish time on screen
- Per-km splits table (km / grade / D+ / hike% / pace / elapsed)
- Run/hike transition: forced power-hike above +18% grade at 750 m/h VAM → 1:57 on the 25 Bosses

## Next
- Effort inputs as UI fields (flat pace, VAM, transition grade) instead of constants
- Terrain/fatigue layer to close the remaining gap to real-world 2–3h
- `computeSplits` unit test (currently untested — the binning + gait logic)

## Known issues
- Gradient array contains spurious spikes (saw +3722%) from near-coincident GPS points.
  Harmless now: clamp bounds the cost, tiny segment length bounds its weight.
  Real fix = resample track to even spacing before drawing the gradient profile chart;
  clamp grade for display. Future item, not blocking.
- Per-km splits don't split the segment straddling a 1000 m boundary, so each km is
  ~1000–1020 m and distanceKm drifts <2% above 1.0. Principled fix = proportional split at
  the boundary; deferred for v0. Interim: the final partial km shows its actual distance.
- parseGpx forward-fills missing <ele>; fine for clean files, revisit if the messier
  September race file has long elevation gaps.

## Open decisions
- PWA later; native/watch only if validated
