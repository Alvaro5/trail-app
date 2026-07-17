// Pure pacing engine — no React, no DOM rendering. Unit-testable in isolation.

export type TrackPoint = {
  lat: number;
  lon: number;
  ele: number;
  time?: number; // epoch ms; present only when the GPX carries <time> (a recorded effort)
};

// Distinct, catchable failure modes for the upload path. The UI maps `code`
// to a friendly message; the engine stays free of any rendering concern.
export type GpxErrorCode = "invalid" | "no-track" | "too-few" | "no-elevation";

export class GpxError extends Error {
  readonly code: GpxErrorCode;
  constructor(code: GpxErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "GpxError";
  }
}

export function parseGpx(xml: string): TrackPoint[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new GpxError("invalid", "Not a valid GPX/XML file");
  }
  // Prefer recorded track points, but fall back to route points: race
  // organizers publish courses as <rte>/<rtept>, and a route paces exactly
  // like an untimed track (same lat/lon/ele shape, never a <time>).
  let trkpts = doc.querySelectorAll("trkpt");
  if (trkpts.length === 0) trkpts = doc.querySelectorAll("rtept");
  if (trkpts.length === 0) {
    throw new GpxError("no-track", "GPX has no <trkpt> or <rtept> points");
  }
  const points = Array.from(trkpts).map((pt) => {
    // <time> is ISO 8601 (e.g. 2025-09-13T07:00:00Z). Date.parse → epoch ms,
    // or NaN if absent/malformed. Course-planning GPX files have no timestamps,
    // so we leave `time` undefined there and the forward model never sees it.
    const timeText = pt.querySelector("time")?.textContent;
    const t = timeText ? Date.parse(timeText) : NaN;
    return {
      lat: Number(pt.getAttribute("lat")),
      lon: Number(pt.getAttribute("lon")),
      ele: Number(pt.querySelector("ele")?.textContent),
      ...(Number.isNaN(t) ? {} : { time: t }),
    };
  });

  // No elevation anywhere → refuse rather than pace a silently flat course.
  // Route exports often strip <ele>; grade-adjusting is the whole product, so
  // an honest error ("re-export with elevation") beats a wrong flat plan.
  if (points.every((p) => Number.isNaN(p.ele))) {
    throw new GpxError("no-elevation", "GPX has no elevation data");
  }

  // Forward-fill missing elevations (absent <ele> → NaN) so one gap can't
  // poison gradient → cost → time downstream.
  let lastEle = 0;
  for (const p of points) {
    if (Number.isNaN(p.ele)) p.ele = lastEle;
    else lastEle = p.ele;
  }

  // Need at least two points to form a segment (distance + gradient). A single
  // <trkpt> can't be paced.
  if (points.length < 2) {
    throw new GpxError("too-few", "GPX track has fewer than 2 points");
  }
  return points;
}

export function haversine(a: TrackPoint, b: TrackPoint): number {
  const R = 6371000; // Earth's mean radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function cumulativeDistances(points: TrackPoint[]): number[] {
  const distances = [0]; // first point is the start: 0 meters in
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + haversine(points[i - 1], points[i]));
  }
  return distances;
}

// Resample the track to evenly-spaced stations (every `intervalM` meters along
// the cumulative distance) before gradients are computed. Raw GPS fixes sit ~2–3 m
// apart and near-coincident pairs make Δele/Δdist explode (spikes of hundreds of
// %); a fixed denominator kills those. Stations are linearly interpolated, so we
// never invent elevation — important when the whole point is to REMOVE spurious D+.
//
// Geometry only: the returned points carry no `time`. The timing path
// (actualSegmentTimes) must keep running on the raw, truly-timed points — never
// these. Returned `dists` are exact by construction (i·interval, last = total);
// we do NOT re-derive them via Haversine on interpolated coords.
export function resampleEven(
  points: TrackPoint[],
  dists: number[],
  intervalM: number,
): { points: TrackPoint[]; dists: number[] } {
  if (intervalM <= 0) throw new Error("resampleEven: intervalM must be > 0");
  const total = dists[dists.length - 1];
  if (points.length < 2 || total === 0) return { points, dists }; // nothing to resample

  const out: TrackPoint[] = [];
  const outDists: number[] = [];
  let hi = 1; // bracketing upper index; d is monotonic so this only moves forward
  for (let d = 0; d < total; d += intervalM) {
    while (hi < points.length - 1 && dists[hi] < d) hi++;
    const lo = hi - 1;
    const span = dists[hi] - dists[lo] || 1; // guard coincident points (span 0)
    const t = (d - dists[lo]) / span;
    const a = points[lo];
    const b = points[hi];
    out.push({
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
      ele: a.ele + (b.ele - a.ele) * t,
    });
    outDists.push(d);
  }
  // Always close on the exact final raw point so total distance is preserved
  // (the last segment is a partial interval).
  const last = points[points.length - 1];
  out.push({ lat: last.lat, lon: last.lon, ele: last.ele });
  outDists.push(total);

  return { points: out, dists: outDists };
}

export function smoothElevation(
  points: TrackPoint[],
  windowSize: number,
): TrackPoint[] {
  const half = Math.floor(windowSize / 2);
  return points.map((pt, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(points.length - 1, i + half);
    let sum = 0;
    for (let j = start; j <= end; j++) sum += points[j].ele;
    const avg = sum / (end - start + 1);
    return { ...pt, ele: avg }; // keep lat/lon, replace only ele
  });
}

// Smooth elevation over a fixed PHYSICAL window (meters), not a point count. The
// old `smoothElevation(window=3)` averages 3 samples regardless of spacing, so its
// real reach swings with GPS density — on a dense 2.5 m track it smooths ~7 m, on a
// sparse 20 m track ~60 m, which is why D+ moved when we changed the grid. Anchoring
// the window to a distance makes the low-pass scale explicit and grid-independent.
// On an even 10 m grid, windowM=30 averages points within ±15 m ≈ the old window-3.
export function smoothElevationByDistance(
  points: TrackPoint[],
  dists: number[],
  windowM: number,
): TrackPoint[] {
  const half = windowM / 2;
  return points.map((pt, i) => {
    let sum = 0;
    let n = 0;
    // walk out in both directions while still inside the half-window
    for (let j = i; j >= 0 && dists[i] - dists[j] <= half; j--) {
      sum += points[j].ele;
      n++;
    }
    for (let k = i + 1; k < points.length && dists[k] - dists[i] <= half; k++) {
      sum += points[k].ele;
      n++;
    }
    return { ...pt, ele: sum / n };
  });
}

export function elevationChange(points: TrackPoint[]): {
  gain: number;
  loss: number;
} {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].ele - points[i - 1].ele;
    if (delta > 0) gain += delta;
    else loss += delta; // delta is negative here, so loss stays negative
  }
  return { gain, loss };
}

// Density-stable cumulative elevation gain (D+) via a hysteresis "deadband":
// only bank a climb once it rises more than `thresholdM` above the last confirmed
// reference; reversals deeper than the band re-anchor the reference downward, so
// wiggles smaller than the band (GPS/baro noise) never count. This is the
// industry-standard fix for the coastline paradox — naive Σ(positive Δele) keeps
// rising as you add points (Strava uses 10 m without baro / 2 m with; swisstopo
// notes ~5 m accuracy makes sub-5 m diffs meaningless). With `thresholdM = 0` this
// reduces exactly to the naive sum (== elevationChange().gain), so it's a strict
// generalization. Takes a plain elevation array (already smoothed/resampled).
export function cumulativeGain(eles: number[], thresholdM: number): number {
  if (eles.length < 2) return 0;
  let gain = 0;
  let ref = eles[0]; // last confirmed reference (a banked top or a fresh valley)
  for (const e of eles) {
    const delta = e - ref;
    if (delta > thresholdM) {
      gain += delta; // climbed clear of the band — bank it and step the reference up
      ref = e;
    } else if (delta < 0) {
      ref = e; // new low — re-anchor down so the next climb is measured from here
    }
    // 0 ≤ delta ≤ thresholdM: within the band, treat as noise and ignore
  }
  return gain;
}

export function gradients(points: TrackPoint[], dists: number[]): number[] {
  const grades: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dEle = points[i].ele - points[i - 1].ele;
    const dDist = dists[i] - dists[i - 1];
    grades.push(dDist === 0 ? 0 : dEle / dDist); // zero-length segment = flat
  }
  return grades;
}

// Elapsed seconds for each segment of a *recorded* effort — the ground truth the
// self-calibration fit will compare our forward prediction against. Parallel to
// the gradients array (length n−1).
//
// All-or-nothing on timestamps: if any point lacks <time> we return null rather
// than stitch real and invented deltas together. A half-timed track can't anchor
// a fit, and silently zero-filling the gaps would bias the solved parameters
// toward "faster than reality" — worse than admitting we have no usable signal.
//
// Deferred (raw deltas are fine this session): timestamps include stopped time —
// aid-station stops, photo breaks, a paused watch. Those inflate segment times
// without reflecting terrain difficulty, so the calibration layer will later need
// a moving-time filter (e.g. drop near-zero-speed segments). Noted, not solved now.
export function actualSegmentTimes(points: TrackPoint[]): number[] | null {
  if (points.some((p) => p.time === undefined)) return null;
  const times: number[] = [];
  for (let i = 1; i < points.length; i++) {
    times.push((points[i].time! - points[i - 1].time!) / 1000);
  }
  return times;
}

// A segment slower than this is "stopped", not moving. 0.3 m/s (~1.1 km/h) sits
// well below the slowest deliberate movement the model can produce — power-hiking
// at VAM 750 on the 45% clamp grade still advances ≈0.46 m/s horizontally — while
// GPS jitter during an aid-station stop (metres of drift over minutes) stays far
// under it. Both stop shapes fall to the same test: a standing watch records many
// tiny-distance segments, a paused watch one huge-time segment.
export const STOPPED_SPEED_MS = 0.3;

// Moving time of a recorded effort: total elapsed seconds excluding stopped
// segments. This is the number a calibration fit must trust — raw elapsed time
// includes aid stops, photo breaks, and paused-watch gaps, none of which say
// anything about terrain difficulty, and all of which would bias a fitted
// terrain factor high. Speeds are derived from the RAW points (the timing path
// always runs on raw, truly-timed points — never resampled geometry).
// Same all-or-nothing discipline as actualSegmentTimes: null without full timing.
export function movingTimeSec(
  points: TrackPoint[],
  minSpeedMs: number = STOPPED_SPEED_MS,
): number | null {
  const times = actualSegmentTimes(points);
  if (times === null) return null;
  const dists = cumulativeDistances(points);
  let total = 0;
  for (let i = 0; i < times.length; i++) {
    const dt = times[i];
    if (dt <= 0) continue; // duplicate/out-of-order timestamps carry no signal
    if ((dists[i + 1] - dists[i]) / dt >= minSpeedMs) total += dt;
  }
  return total;
}

export function minettiCost(i: number): number {
  const x = Math.max(-0.45, Math.min(0.45, i)); // clamp to the paper's validated range
  // Minetti 2002: 155.4 x⁵ − 30.4 x⁴ − 43.3 x³ + 46.3 x² + 19.5 x + 3.6
  return (
    155.4 * x ** 5 -
    30.4 * x ** 4 -
    43.3 * x ** 3 +
    46.3 * x ** 2 +
    19.5 * x +
    3.6
  );
}

const ratio = (i: number) => minettiCost(i) / minettiCost(0);

// Time for one segment. Below the transition grade you run. Above it,
// iso-effort running is a fantasy (you can't hold that power up a wall),
// so you power-hike at a fixed vertical rate (VAM) — slower, but real.
function segmentTimeSec(
  grade: number,
  meters: number,
  flatPaceSecPerKm: number,
  hikeVamMperH: number,
  transitionGrade: number,
): { sec: number; hiked: boolean } {
  if (grade < transitionGrade) {
    const runSec = (meters / 1000) * flatPaceSecPerKm * ratio(grade);
    return { sec: runSec, hiked: false };
  }
  // VAM is a vertical rate, so hike time = vertical gain / VAM; horizontal cancels.
  const vamMs = hikeVamMperH / 3600; // vertical m/s
  const rise = grade * meters; // vertical meters climbed in this segment
  return { sec: rise / vamMs, hiked: true };
}

export type Split = {
  km: number; // 1, 2, 3, ... (the final entry may be a partial km)
  distanceKm: number; // actual length — ~1, last is partial
  grade: number; // net grade across the km (rise / run)
  gainM: number; // D+ climbed within the km (positive rises only)
  hikeFraction: number; // 0–1: share of the km spent power-hiking
  paceSecPerKm: number;
  elapsedSec: number; // cumulative time at the end of this km
};

export function computeSplits(
  dists: number[],
  grades: number[],
  flatPaceSecPerKm: number,
  hikeVamMperH: number,
  transitionGrade: number,
  terrainFactor: number,
): Split[] {
  const splits: Split[] = [];
  let kmMeters = 0;
  let kmRise = 0;
  let kmGain = 0;
  let kmHikeMeters = 0;
  let kmTimeSec = 0;
  let elapsedSec = 0;
  let kmIndex = 1;

  const flush = () => {
    splits.push({
      km: kmIndex,
      distanceKm: kmMeters / 1000,
      grade: kmRise / kmMeters, // distance-weighted average = net rise / run
      gainM: kmGain,
      hikeFraction: kmHikeMeters / kmMeters,
      paceSecPerKm: kmTimeSec / (kmMeters / 1000),
      elapsedSec,
    });
    kmIndex++;
    kmMeters = 0;
    kmRise = 0;
    kmGain = 0;
    kmHikeMeters = 0;
    kmTimeSec = 0;
  };

  for (let i = 1; i < dists.length; i++) {
    const segMeters = dists[i] - dists[i - 1];
    const grade = grades[i - 1];
    const rise = grade * segMeters; // signed: + climbing, − descending
    const { sec, hiked } = segmentTimeSec(
      grade,
      segMeters,
      flatPaceSecPerKm,
      hikeVamMperH,
      transitionGrade,
    );

    const adjSec = sec * terrainFactor; // technical/soft ground slows all moving time

    kmMeters += segMeters;
    kmRise += rise; // net (signed) rise for the km
    if (rise > 0) kmGain += rise; // D+ counts only the climbs
    if (hiked) kmHikeMeters += segMeters;
    kmTimeSec += adjSec;
    elapsedSec += adjSec;

    if (kmMeters >= 1000) flush(); // close the bucket once we've banked a km
  }

  if (kmMeters > 0) flush(); // final partial km

  return splits;
}

// Self-calibration, simplest form: invert the forward model against a past
// recorded effort to MEASURE the terrain factor instead of making the runner
// guess it. We run pure Minetti (terrainFactor = 1.0) over the same course, then
// scale to whatever the runner actually did.
//
// Why a single division is exact, not an approximation: terrainFactor multiplies
// every segment's time uniformly (adjSec = sec × terrainFactor), so the predicted
// total is strictly linear in it. The factor that makes predicted == actual is
// therefore exactly actualTotal / predictedTotal — no search needed. This one
// scalar absorbs everything the model can't see for THIS runner on THIS course
// (surface, technicality, true fitness) into one measured number.
//
// All-or-nothing on timing, same discipline as actualSegmentTimes: a partially
// timed track yields null rather than a fit anchored on invented deltas.
//
// The actual side is MOVING time (movingTimeSec), not raw elapsed: stopped time
// says nothing about terrain and would bias the factor high. The predicted side
// still covers the whole course — segments where the runner stood still span
// near-zero distance, so their predicted time is negligible and the division
// stays honest.
export function calibrateTerrainFactor(
  points: TrackPoint[],
  dists: number[],
  grades: number[],
  flatPaceSecPerKm: number,
  hikeVamMperH: number,
  transitionGrade: number,
): number | null {
  const actualTotal = movingTimeSec(points);
  if (actualTotal === null || actualTotal === 0) return null;

  const predicted = computeSplits(
    dists,
    grades,
    flatPaceSecPerKm,
    hikeVamMperH,
    transitionGrade,
    1, // baseline: pure Minetti, no terrain fudge — that's what we're solving for
  );
  const predictedTotal = predicted.length
    ? predicted[predicted.length - 1].elapsedSec
    : 0;
  if (predictedTotal === 0) return null; // degenerate course (no movement) — can't divide

  return actualTotal / predictedTotal;
}
