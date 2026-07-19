// Points of interest near the course — drinking water, toilets, viewpoints —
// fetched from OpenStreetMap via the Overpass API. Pure module: geometry +
// query building + fetch, no React, so every piece unit-tests without a map.
//
// Privacy contract (the app promises "your GPX never leaves your device"):
// the request carries ONLY the course's padded bounding box, never track
// points, and it fires only on an explicit user toggle. The corridor filter
// that needs the actual track runs client-side, after the response arrives.

import { haversine } from "./pacing";

export type PoiKind = "water" | "toilets" | "viewpoint";

export type Poi = {
  lat: number;
  lon: number;
  kind: PoiKind;
  name?: string;
};

export type Bbox = { s: number; w: number; n: number; e: number };

// Public Overpass instances, tried in order — the main one intermittently
// 504s under load (observed while building this), the mirrors pick up.
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// Above this the query would hammer Overpass and return thousands of nodes —
// a plausible ultra never comes close (a 170 km UTMB loop fits in ~40×40 km).
export const MAX_BBOX_KM2 = 2500;

const ENDPOINT_TIMEOUT_MS = 15_000;

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
  // 5 decimals ≈ 1 m — enough precision, and nothing finer leaves the device.
  const box = [b.s, b.w, b.n, b.e].map((v) => v.toFixed(5)).join(",");
  return (
    `[out:json][timeout:25];(` +
    `node["amenity"="drinking_water"](${box});` +
    `node["amenity"="toilets"](${box});` +
    `node["tourism"="viewpoint"](${box});` +
    `);out 400;`
  );
}

type OverpassNode = {
  type?: string;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
};

export function parseOverpassJson(json: unknown): Poi[] {
  const elements = (json as { elements?: OverpassNode[] })?.elements;
  if (!Array.isArray(elements)) return [];
  const pois: Poi[] = [];
  for (const el of elements) {
    if (typeof el?.lat !== "number" || typeof el?.lon !== "number") continue;
    const tags = el.tags ?? {};
    const kind: PoiKind | null =
      tags.amenity === "drinking_water"
        ? "water"
        : tags.amenity === "toilets"
          ? "toilets"
          : tags.tourism === "viewpoint"
            ? "viewpoint"
            : null;
    if (!kind) continue;
    pois.push({ lat: el.lat, lon: el.lon, kind, name: tags.name || undefined });
  }
  return pois;
}

// POST to each endpoint in turn until one answers. A per-endpoint timeout is
// wired manually (AbortSignal.any/timeout aren't everywhere yet); the outer
// signal — the caller toggling off or loading a new course — aborts the whole
// chain immediately instead of falling through to the next mirror.
export async function fetchPois(
  bbox: Bbox,
  outerSignal?: AbortSignal,
  endpoints = OVERPASS_ENDPOINTS,
): Promise<Poi[]> {
  const query = buildOverpassQuery(bbox);
  let lastError: unknown = new Error("no Overpass endpoint configured");
  for (const url of endpoints) {
    if (outerSignal?.aborted) throw new DOMException("aborted", "AbortError");
    const ctl = new AbortController();
    const onOuterAbort = () => ctl.abort();
    outerSignal?.addEventListener("abort", onOuterAbort);
    const timer = setTimeout(() => ctl.abort(), ENDPOINT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`Overpass ${url}: HTTP ${res.status}`);
      return parseOverpassJson(await res.json());
    } catch (err) {
      if (outerSignal?.aborted)
        throw new DOMException("aborted", "AbortError");
      lastError = err; // endpoint down/overloaded/timed out — try the next
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener("abort", onOuterAbort);
    }
  }
  throw lastError;
}

// Keep only POIs within `maxDistM` of the track — the bbox of a loop course
// encloses a lot of land the runner never crosses. Full scan per POI: at the
// caps (400 POIs × ~17k points for a 170 km course) this is a few million
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
