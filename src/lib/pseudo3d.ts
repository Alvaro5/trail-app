// Hand-rolled 3D projection for the course flyover: local-meter conversion,
// vertical exaggeration, and a yaw+pitch orthographic camera. No three.js —
// a course ribbon needs ~40 lines of math, not 150 kB of library. Pure and
// unit-tested; the SVG rendering lives in Course3D.tsx.

export type P3 = { x: number; y: number; z: number };

// Lat/lon/ele → centered local meters (equirectangular around the centroid;
// fine at course scale). y is elevation above the course minimum, times an
// exaggeration factor — real trail relief reads flat at true scale.
export function toLocalMeters(
  coords: { lat: number; lon: number }[],
  eles: number[],
  exaggeration: number,
): P3[] {
  const n = coords.length;
  if (n === 0) return [];
  let lat0 = 0;
  let lon0 = 0;
  let eleMin = Infinity;
  for (let i = 0; i < n; i++) {
    lat0 += coords[i].lat;
    lon0 += coords[i].lon;
    if (eles[i] < eleMin) eleMin = eles[i];
  }
  lat0 /= n;
  lon0 /= n;
  const mLat = 110_540;
  const mLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return coords.map((c, i) => ({
    x: (c.lon - lon0) * mLon,
    // north = away from the viewer at yaw 0
    z: -(c.lat - lat0) * mLat,
    y: (eles[i] - eleMin) * exaggeration,
  }));
}

// Pick the exaggeration so the relief reads as ~18% of the horizontal span:
// enough that Fontainebleau's 80 m bumps LOOK like the walls they are,
// clamped so alpine courses don't become spikes.
export function autoExaggeration(spanM: number, reliefM: number): number {
  if (!(reliefM > 0)) return 1;
  return Math.min(20, Math.max(1, (spanM * 0.18) / reliefM));
}

// Orthographic camera: yaw spins the course, pitch tilts between near-
// profile (low) and near-map (high). Returns screen-space X/Y (Y grows
// downward, SVG convention) plus depth for optional ordering.
export function projectIso(
  p: P3,
  yaw: number,
  pitch: number,
): { X: number; Y: number; depth: number } {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = p.x * cy + p.z * sy;
  const z1 = -p.x * sy + p.z * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Rotate about the screen X axis: high pitch looks down (map-like).
  const y2 = p.y * cp - z1 * sp;
  const z2 = p.y * sp + z1 * cp;
  return { X: x1, Y: -y2, depth: z2 };
}

// Radius of the widest projected extent across all yaws — used once to fit
// the course in the viewport regardless of rotation (no per-frame refit,
// which would make the ribbon "breathe" while spinning). The 3D norm is a
// tight bound for an orthographic camera at any yaw/pitch.
export function boundingRadius(pts: P3[]): number {
  let r = 0;
  for (const p of pts) {
    const d = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    if (d > r) r = d;
  }
  return r || 1;
}
