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

## Next
- Cost → pace → projected finish time (multiply flat pace by cost ratio)
- Run/hike transition logic (the wedge vs PacePro) — builds on the baseline finish time

## Known issues
- Gradient array contains spurious spikes (saw +3722%) from near-coincident GPS points.
  Harmless now: clamp bounds the cost, tiny segment length bounds its weight.
  Real fix = resample track to even spacing before drawing the gradient profile chart;
  clamp grade for display. Future item, not blocking.
- Model assumes running every gradient at iso-effort; power-hike transition is the next build.

## Open decisions
- PWA later; native/watch only if validated
