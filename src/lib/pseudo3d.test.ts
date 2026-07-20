import { describe, expect, it } from "vitest";
import {
  autoExaggeration,
  boundingRadius,
  projectIso,
  toLocalMeters,
} from "./pseudo3d";

const COORDS = [
  { lat: 48.4, lon: 2.6 },
  { lat: 48.41, lon: 2.61 },
  { lat: 48.42, lon: 2.6 },
];
const ELES = [100, 150, 120];

describe("toLocalMeters", () => {
  it("centers the course on its centroid with y from the minimum elevation", () => {
    const pts = toLocalMeters(COORDS, ELES, 2);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    expect(cx).toBeCloseTo(0, 6);
    expect(cz).toBeCloseTo(0, 6);
    expect(Math.min(...pts.map((p) => p.y))).toBe(0);
    expect(pts[1].y).toBeCloseTo(100, 6); // (150-100) × 2
  });

  it("converts a degree of latitude to ~110.5 km", () => {
    const pts = toLocalMeters(
      [
        { lat: 48, lon: 2 },
        { lat: 49, lon: 2 },
      ],
      [0, 0],
      1,
    );
    expect(Math.abs(pts[1].z - pts[0].z)).toBeCloseTo(110_540, 0);
  });
});

describe("projectIso", () => {
  it("yaw rotation preserves horizontal radius", () => {
    const p = { x: 300, y: 0, z: 400 };
    for (const yaw of [0, 0.7, 2.1, 4.4]) {
      const q = projectIso(p, yaw, 0);
      // pitch 0: screen X/Y span the rotated horizontal plane directly
      const r = Math.sqrt(q.X * q.X + q.depth * q.depth);
      expect(r).toBeCloseTo(500, 6);
    }
  });

  it("full pitch looks straight down: screen Y follows -z, ignores elevation", () => {
    const q = projectIso({ x: 10, y: 999, z: -50 }, 0, Math.PI / 2);
    expect(q.X).toBeCloseTo(10, 6);
    expect(q.Y).toBeCloseTo(-50, 6);
  });

  it("zero pitch is a pure profile: screen Y follows -y", () => {
    const q = projectIso({ x: 10, y: 80, z: 1234 }, 0, 0);
    expect(q.Y).toBeCloseTo(-80, 6);
  });
});

describe("autoExaggeration", () => {
  it("targets ~18% relief and clamps both ends", () => {
    // Fontainebleau-ish: 15 km span, 80 m relief → strong boost, capped.
    expect(autoExaggeration(15_000, 80)).toBe(20);
    // Alpine: 30 km span, 3000 m relief → no shrinking below 1.
    expect(autoExaggeration(30_000, 3000)).toBe(1.8);
    expect(autoExaggeration(1000, 5000)).toBe(1);
  });
});

describe("boundingRadius", () => {
  it("covers the farthest point at any rotation", () => {
    const pts = [
      { x: 100, y: 20, z: 0 },
      { x: 0, y: 0, z: -300 },
    ];
    expect(boundingRadius(pts)).toBeCloseTo(300, 6);
    expect(boundingRadius([])).toBe(1);
  });
});
