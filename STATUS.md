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
- Elevation smoothing (centered moving average, window 3 — D+ 835 m on 25 Bosses,
  matches official ~700–900) + D+/D−
- Per-segment gradients (Δele / Δdist)
- Minetti grade-adjusted cost model, clamped to ±0.45 — verified against the 2002 paper
- Engine extracted to `src/lib/pacing.ts` (pure, no React); Minetti anchors + clamp +
  computeSplits behavior locked in Vitest (`npm test`)
- Total-time invariant test: Σ (paceSecPerKm × distanceKm) over splits === last
  split's elapsedSec, asserted per-km on a mixed run/descent/hike course. Replaces
  the cross-check lost when projectTime was deleted; locks the table columns to the
  projected finish so they can't silently drift apart
- Per-segment pace from cost ratio → projected finish time on screen
- Per-km splits table (km / grade / D+ / hike% / pace / elapsed)
- Run/hike transition: HARD SWITCH to power-hike above transition grade at VAM
  (not min(run,hike) — correct, since iso-effort run always "wins" at VAM 750)
- Tailwind dark dashboard UI; effort inputs as live fields + sliders (pace / VAM / gate / terrain)
- Terrain factor (single multiplier) accuracy knob — **default now ×1.00** (pure Minetti
  baseline on load; was silently ×1.20, moved the headline number, so reset to 1.00)
- Elevation profile chart (Recharts)
- **Validated on the real race GPX** (Imperial Trail, Fontainebleau): parses to
  68.75 km / 1426 m D+ — matches the ~70 km / ~1130 m billing. Pipeline proven
  end-to-end on a point-to-point course, not just the 25 Bosses loop.
- Docs: CLAUDE.md added (decisions, working style, do-not-list); README rewritten
  to current behavior; removed leftover Vite DEFAULT_README.
- **Self-calibration groundwork — timestamp capture.** `TrackPoint` gained an
  optional `time?` (epoch ms); `parseGpx` now reads the `<time>` child of each
  `<trkpt>` (ISO 8601 → epoch ms) when present, undefined when absent — course
  GPX files with no timestamps parse and run the forward model exactly as before.
  New pure fn `actualSegmentTimes(points)` returns per-segment elapsed seconds
  (parallel to gradients, length n−1), or **null if any point lacks a timestamp**
  (all-or-nothing: a partially-timed track can't anchor a fit and zero-filling
  would bias solved params fast). Tests added under a `happy-dom` env docblock
  (new dev-only dep, supplies DOMParser): timestamped track → correct positive
  segment times; no-time course → null + forward pipeline intact; partial timing
  → null. `actualSegmentTimes` is the ground-truth input the calibration fit will
  consume next.

## Next
- **Self-calibration fit (engine).** Given a recorded effort, run the forward
  model on that course and SOLVE for the terrain/efficiency factor that makes our
  prediction match `actualSegmentTimes`. Inputs now exist (timestamp capture done
  above); next is the fit itself — still pure engine, no UI yet. Keep terrain and
  fatigue separable: one calibration point can't identify both (see CLAUDE.md).
- Calibration: decide a believable terrain factor for Fontainebleau using the
  68.75 km finish as a gut-check (7:17 @1.00 vs 8:44 @1.20 — which matches reality?)
- Fatigue-fade model — ONLY after a second calibration point exists (known split
  or past race time). Do not fit terrain + fatigue against one finish time.
- Resample track to even spacing (kills gradient spikes; unblocks a gradient-colored
  profile chart)
- Bundle ~530 kB (Recharts heavy) → code-split the chart if load time matters
- Polish: pace stepper, hover tooltips on splits, mobile layout

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
- Hike gate keys off raw (unclamped) grade, so a surviving GPS spike above the
  transition grade can overstate a km's hikeFraction. Time is unaffected
  (hike time = rise/VAM = exactly Δele). Resolved by the resample fix above.

## Open decisions
- PWA later; native/watch only if validated
