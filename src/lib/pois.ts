// Points of interest near the course, fetched from OpenStreetMap via the
// Overpass API. Pure module: geometry + query building + fetch, no React, so
// every piece unit-tests without a map.
//
// Privacy contract (the app promises "your GPX never leaves your device"):
// the request carries ONLY the course's padded bounding box, never track
// points, and it fires only on an explicit user toggle. The corridor filter
// that needs the actual track runs client-side, after the response arrives.

import { haversine } from "./pacing";

// The kinds a trail runner (and their race-day crew) actually cares about.
export type PoiKind =
  | "water"
  | "toilets"
  | "viewpoint"
  | "cafe"
  | "spring"
  | "shelter"
  | "parking"
  | "picnic";

export type Poi = {
  lat: number;
  lon: number;
  kind: PoiKind;
  name?: string;
};

export type Bbox = { s: number; w: number; n: number; e: number };

// Public Overpass instances. The main one intermittently 504s under load
// (observed repeatedly while building this), so fetchPois races ALL of them
// in parallel and takes the first success: the user waits for the fastest
// healthy mirror, not for each one to fail in turn.
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// Above this the query would hammer Overpass and return thousands of nodes.
// A plausible ultra never comes close (a 170 km UTMB loop fits in ~40×40 km).
export const MAX_BBOX_KM2 = 2500;

const ENDPOINT_TIMEOUT_MS = 15_000;

// OSM selectors per kind. `nwr` (node|way|relation) + `out center` matters:
// parking lots, toilet blocks and picnic sites are usually mapped as AREAS,
// which a node-only query silently misses.
const SELECTORS: [string, PoiKind][] = [
  ['["amenity"="drinking_water"]', "water"],
  ['["amenity"="toilets"]', "toilets"],
  ['["tourism"="viewpoint"]', "viewpoint"],
  ['["amenity"="cafe"]', "cafe"],
  ['["natural"="spring"]', "spring"],
  ['["amenity"="shelter"]', "shelter"],
  ['["amenity"="parking"]', "parking"],
  ['["tourism"="picnic_site"]', "picnic"],
];

// Bounding box of the track, padded outward so POIs just past the outermost
// point still land inside. Degrees per metre varies with latitude for
// longitude only.
export function bboxOf(
  coords: { lat: number; lon: number }[],
  padM = 250,
): Bbox {
  let s = Infinity,
    w = Infinity,
    n = -Infinity,
    e = -Infinity;
  for (const c of coords) {
    if (c.lat < s) s = c.lat;
    if (c.lat > n) n = c.lat;
    if (c.lon < w) w = c.lon;
    if (c.lon > e) e = c.lon;
  }
  const latPad = padM / 111_320;
  const lonPad = padM / (111_320 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  return { s: s - latPad, w: w - lonPad, n: n + latPad, e: e + lonPad };
}

export function bboxAreaKm2(b: Bbox): number {
  const midLat = (((b.s + b.n) / 2) * Math.PI) / 180;
  return (b.n - b.s) * 111.32 * (b.e - b.w) * 111.32 * Math.cos(midLat);
}

export function buildOverpassQuery(b: Bbox): string {
  // 5 decimals ≈ 1 m: enough precision, and nothing finer leaves the device.
  const box = [b.s, b.w, b.n, b.e].map((v) => v.toFixed(5)).join(",");
  const parts = SELECTORS.map(([sel]) => `nwr${sel}(${box});`).join("");
  return `[out:json][timeout:20];(${parts});out center 600;`;
}

type OverpassElement = {
  type?: string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

function kindOf(tags: Record<string, string>): PoiKind | null {
  if (tags.amenity === "drinking_water") return "water";
  if (tags.amenity === "toilets") return "toilets";
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (tags.amenity === "cafe") return "cafe";
  if (tags.natural === "spring") return "spring";
  if (tags.amenity === "shelter") return "shelter";
  if (tags.amenity === "parking") return "parking";
  if (tags.tourism === "picnic_site") return "picnic";
  return null;
}

export function parseOverpassJson(json: unknown): Poi[] {
  const elements = (json as { elements?: OverpassElement[] })?.elements;
  if (!Array.isArray(elements)) return [];
  const pois: Poi[] = [];
  for (const el of elements) {
    // Nodes carry lat/lon directly; ways/relations carry a computed center.
    const lat = typeof el?.lat === "number" ? el.lat : el?.center?.lat;
    const lon = typeof el?.lon === "number" ? el.lon : el?.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const kind = kindOf(el.tags ?? {});
    if (!kind) continue;
    pois.push({ lat, lon, kind, name: el.tags?.name || undefined });
  }
  return pois;
}

// Race every endpoint in parallel; first success wins and the losers are
// aborted. The user's wait is min(healthy mirrors), not sum(dead ones) — the
// sequential version stalled ~8-15 s whenever the primary was overloaded,
// which killed the moment of looking at the course. The outer signal (toggle
// off, new course) aborts everything at once.
export async function fetchPois(
  bbox: Bbox,
  outerSignal?: AbortSignal,
  endpoints = OVERPASS_ENDPOINTS,
): Promise<Poi[]> {
  const query = buildOverpassQuery(bbox);
  if (outerSignal?.aborted) throw new DOMException("aborted", "AbortError");
  const ctls = endpoints.map(() => new AbortController());
  const abortAll = () => ctls.forEach((c) => c.abort());
  outerSignal?.addEventListener("abort", abortAll);
  const attempts = endpoints.map(async (url, i) => {
    const timer = setTimeout(() => ctls[i].abort(), ENDPOINT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        signal: ctls[i].signal,
      });
      if (!res.ok) throw new Error(`Overpass ${url}: HTTP ${res.status}`);
      return parseOverpassJson(await res.json());
    } finally {
      clearTimeout(timer);
    }
  });
  try {
    const pois = await Promise.any(attempts);
    abortAll(); // cancel the slower mirrors, their answer is redundant
    return pois;
  } catch (err) {
    if (outerSignal?.aborted) throw new DOMException("aborted", "AbortError");
    throw err instanceof AggregateError ? (err.errors[0] ?? err) : err;
  } finally {
    outerSignal?.removeEventListener("abort", abortAll);
    // Swallow the losers' rejections so they never surface as unhandled.
    attempts.forEach((p) => p.catch(() => {}));
  }
}

// Keep only POIs within `maxDistM` of the track — the bbox of a loop course
// encloses a lot of land the runner never crosses. Full scan per POI: at the
// caps (600 POIs × ~17k points for a 170 km course) this is a few million
// cheap haversines, run once per fetch.
export function filterToCorridor(
  pois: Poi[],
  coords: { lat: number; lon: number }[],
  maxDistM = 200,
): Poi[] {
  return pois.filter((p) => {
    const target = { lat: p.lat, lon: p.lon, ele: 0 };
    for (const c of coords) {
      if (haversine({ lat: c.lat, lon: c.lon, ele: 0 }, target) <= maxDistM)
        return true;
    }
    return false;
  });
}
