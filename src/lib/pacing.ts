// Pure pacing engine — no React, no DOM rendering. Unit-testable in isolation.

export type TrackPoint = {
  lat: number;
  lon: number;
  ele: number;
};

export function parseGpx(xml: string): TrackPoint[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Not a valid GPX/XML file");
  }
  const trkpts = doc.querySelectorAll("trkpt");
  return Array.from(trkpts).map((pt) => ({
    lat: Number(pt.getAttribute("lat")),
    lon: Number(pt.getAttribute("lon")),
    ele: Number(pt.querySelector("ele")?.textContent),
  }));
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

export function projectTime(
  grades: number[],
  dists: number[],
  flatPaceSecPerKm: number,
): number {
  let totalSec = 0;
  for (let i = 1; i < dists.length; i++) {
    const segKm = (dists[i] - dists[i - 1]) / 1000;
    // grades[i-1] is the slope of the segment ending at point i
    totalSec += segKm * flatPaceSecPerKm * ratio(grades[i - 1]);
  }
  return totalSec;
}
