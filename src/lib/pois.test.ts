import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bboxAreaKm2,
  bboxOf,
  buildOverpassQuery,
  fetchPois,
  filterToCorridor,
  parseOverpassJson,
  MAX_BBOX_KM2,
} from "./pois";

// A straight ~2 km northward track near Fontainebleau, 10 m spacing.
const TRACK = Array.from({ length: 201 }, (_, i) => ({
  lat: 48.4 + i * 0.00009, // ≈10 m per step
  lon: 2.6,
}));

const OVERPASS_FIXTURE = {
  elements: [
    {
      type: "node",
      lat: 48.401,
      lon: 2.6,
      tags: { amenity: "drinking_water" },
    },
    {
      type: "node",
      lat: 48.402,
      lon: 2.6,
      tags: { amenity: "toilets", name: "WC de la Croix" },
    },
    { type: "node", lat: 48.403, lon: 2.6, tags: { tourism: "viewpoint" } },
    { type: "node", lat: 48.404, lon: 2.6, tags: { amenity: "cafe" } },
    { type: "node", lat: 48.405, lon: 2.6, tags: { natural: "spring" } },
    { type: "node", lat: 48.406, lon: 2.6, tags: { amenity: "shelter" } },
    // Areas come back as ways with a computed center, not lat/lon.
    {
      type: "way",
      center: { lat: 48.407, lon: 2.6 },
      tags: { amenity: "parking", name: "Parking de la Plaine" },
    },
    {
      type: "way",
      center: { lat: 48.408, lon: 2.6 },
      tags: { tourism: "picnic_site" },
    },
    // Untyped tags → dropped, never a crash.
    { type: "node", lat: 48.409, lon: 2.6, tags: { shop: "bakery" } },
    // Missing coordinates → dropped.
    { type: "node", tags: { amenity: "toilets" } },
  ],
};

describe("bboxOf / bboxAreaKm2", () => {
  it("pads the raw extent outward on all four sides", () => {
    const b = bboxOf(TRACK, 250);
    expect(b.s).toBeLessThan(48.4);
    expect(b.n).toBeGreaterThan(48.4 + 200 * 0.00009);
    expect(b.w).toBeLessThan(2.6);
    expect(b.e).toBeGreaterThan(2.6);
  });

  it("measures a plausible course area far below the guard cap", () => {
    const area = bboxAreaKm2(bboxOf(TRACK, 250));
    expect(area).toBeGreaterThan(0);
    expect(area).toBeLessThan(MAX_BBOX_KM2);
  });

  it("flags a continent-sized bbox as over the cap", () => {
    expect(bboxAreaKm2({ s: 43, w: -1, n: 49, e: 7 })).toBeGreaterThan(
      MAX_BBOX_KM2,
    );
  });
});

describe("buildOverpassQuery", () => {
  it("asks for every POI kind via nwr with center output", () => {
    const q = buildOverpassQuery({ s: 48.4, w: 2.5, n: 48.5, e: 2.7 });
    for (const sel of [
      "drinking_water",
      "toilets",
      "viewpoint",
      "cafe",
      "spring",
      "shelter",
      "parking",
      "picnic_site",
    ])
      expect(q).toContain(sel);
    expect(q).toContain("nwr");
    expect(q).toContain("out center");
    expect(q).toContain("48.40000,2.50000,48.50000,2.70000");
  });
});

describe("parseOverpassJson", () => {
  it("types nodes AND way-centers by tag, keeps names, drops junk", () => {
    const pois = parseOverpassJson(OVERPASS_FIXTURE);
    expect(pois.map((p) => p.kind)).toEqual([
      "water",
      "toilets",
      "viewpoint",
      "cafe",
      "spring",
      "shelter",
      "parking",
      "picnic",
    ]);
    expect(pois[1].name).toBe("WC de la Croix");
    expect(pois[6]).toMatchObject({ lat: 48.407, name: "Parking de la Plaine" });
  });

  it("returns empty on malformed payloads", () => {
    expect(parseOverpassJson(null)).toEqual([]);
    expect(parseOverpassJson({})).toEqual([]);
    expect(parseOverpassJson({ elements: "nope" })).toEqual([]);
  });
});

describe("filterToCorridor", () => {
  it("keeps POIs ~100 m off the route and drops ones ~400 m off", () => {
    // 0.0013° of longitude at 48.4°N ≈ 96 m; 0.0055° ≈ 405 m.
    const near = { lat: 48.401, lon: 2.6013, kind: "water" as const };
    const far = { lat: 48.401, lon: 2.6055, kind: "water" as const };
    const kept = filterToCorridor([near, far], TRACK, 200);
    expect(kept).toEqual([near]);
  });
});

describe("fetchPois", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("races endpoints in parallel and returns the first success", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("slow")) {
          // The overloaded primary: slow AND failing.
          await new Promise((r) => setTimeout(r, 50));
          return { ok: false, status: 504, json: async () => ({}) };
        }
        return { ok: true, json: async () => OVERPASS_FIXTURE };
      }),
    );
    const t0 = performance.now();
    const pois = await fetchPois({ s: 48.4, w: 2.5, n: 48.5, e: 2.7 }, undefined, [
      "https://slow.example/api",
      "https://fast.example/api",
    ]);
    // Both fired immediately (parallel, not sequential)…
    expect(calls).toHaveLength(2);
    // …and the fast mirror's answer came back without waiting for the slow one.
    expect(performance.now() - t0).toBeLessThan(45);
    expect(pois.length).toBeGreaterThan(0);
  });

  it("rejects only when every endpoint fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(
      fetchPois({ s: 48.4, w: 2.5, n: 48.5, e: 2.7 }, undefined, [
        "https://a.example/api",
        "https://b.example/api",
      ]),
    ).rejects.toThrow("network down");
  });

  it("reports an abort when the outer signal cancels the fetch", async () => {
    const ctl = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        ctl.abort(); // user toggled off mid-flight
        throw new DOMException("aborted", "AbortError");
      }),
    );
    await expect(
      fetchPois({ s: 48.4, w: 2.5, n: 48.5, e: 2.7 }, ctl.signal, [
        "https://a.example/api",
        "https://b.example/api",
      ]),
    ).rejects.toThrow(/aborted/);
  });
});
