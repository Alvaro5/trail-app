// Pure pacing engine — no React, no DOM rendering. Unit-testable in isolation.

export type TrackPoint = {
  lat: number;
  lon: number;
  ele: number;
  time?: number; // epoch ms; present only when the GPX carries <time> (a recorded effort)
};

export function parseGpx(xml: string): TrackPoint[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Not a valid GPX/XML file");
  }
  const trkpts = doc.querySelectorAll("trkpt");
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

  // Forward-fill missing elevations (absent <ele> → NaN) so one gap can't
  // poison gradient → cost → time downstream.
  let lastEle = 0;
  for (const p of points) {
    if (Number.isNaN(p.ele)) p.ele = lastEle;
    else lastEle = p.ele;
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
