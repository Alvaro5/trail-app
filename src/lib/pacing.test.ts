import { describe, it, expect } from "vitest";
import { minettiCost, computeSplits } from "./pacing";

describe("minettiCost", () => {
  // The seven anchor values verified against Minetti et al. (2002).
  // If a coefficient is ever mistyped, these fail loudly instead of
  // silently shifting every projected pace.
  const anchors: [grade: number, cost: number][] = [
    [-0.45, 4.03],
    [-0.2, 1.8],
    [-0.1, 2.15],
    [0, 3.6],
    [0.1, 5.97],
    [0.2, 9.01],
    [0.45, 19.43],
  ];

  for (const [grade, cost] of anchors) {
    it(`cost at gradient ${grade} ≈ ${cost}`, () => {
      expect(minettiCost(grade)).toBeCloseTo(cost, 2);
    });
  }

  it("clamps gradients beyond ±0.45 to the validated range", () => {
    expect(minettiCost(54)).toBeCloseTo(minettiCost(0.45), 5);
    expect(minettiCost(-54)).toBeCloseTo(minettiCost(-0.45), 5);
  });
});

describe("computeSplits", () => {
  const FLAT = 360; // 6:00/km
  const VAM = 750; // m/h
  const GATE = 0.18; // hike above +18%
  const NONE = 1; // terrain factor, no penalty

  it("runs a flat course at exactly the flat pace", () => {
    const splits = computeSplits([0, 1000, 2000], [0, 0], FLAT, VAM, GATE, NONE);
    expect(splits).toHaveLength(2);
    expect(splits[0].paceSecPerKm).toBeCloseTo(FLAT, 5);
    expect(splits[1].elapsedSec).toBeCloseTo(720, 5); // 2 km × 360 s
    expect(splits[0].hikeFraction).toBe(0);
  });

  it("runs a climb below the transition grade (no hiking)", () => {
    const splits = computeSplits([0, 1000], [0.1], FLAT, VAM, GATE, NONE);
    expect(splits[0].hikeFraction).toBe(0);
    // pace = flat × cost ratio
    expect(splits[0].paceSecPerKm).toBeCloseTo(
      FLAT * (minettiCost(0.1) / minettiCost(0)),
      5,
    );
  });

  it("forces a power-hike above the transition grade, slower than running", () => {
    const splits = computeSplits([0, 1000], [0.25], FLAT, VAM, GATE, NONE);
    expect(splits[0].hikeFraction).toBe(1);
    // hike time = rise / VAM = 250 m ÷ (750/3600 m/s) = 1200 s
    expect(splits[0].paceSecPerKm).toBeCloseTo(1200, 5);
    // and that is slower than running the same grade would have been
    expect(splits[0].paceSecPerKm).toBeGreaterThan(
      FLAT * (minettiCost(0.25) / minettiCost(0)),
    );
  });

  it("scales all moving time by the terrain factor (and nothing else)", () => {
    const dists = [0, 1000, 2000];
    const grades = [0, 0];
    const base = computeSplits(dists, grades, FLAT, VAM, GATE, 1);
    const rough = computeSplits(dists, grades, FLAT, VAM, GATE, 1.2);
    expect(rough[1].elapsedSec).toBeCloseTo(base[1].elapsedSec * 1.2, 5);
    expect(rough[0].paceSecPerKm).toBeCloseTo(base[0].paceSecPerKm * 1.2, 5);
    expect(rough[0].grade).toBe(base[0].grade); // terrain doesn't touch grade
    expect(rough[0].hikeFraction).toBe(base[0].hikeFraction);
  });

  // Total-time invariant — replaces the cross-check lost when projectTime was
  // deleted. Each split's own time is paceSecPerKm × distanceKm; the splits must
  // reconcile with the cumulative elapsedSec, so the per-km numbers shown in the
  // table can never silently drift from the projected finish.
  it("reconciles per-km times with the cumulative elapsed (total-time invariant)", () => {
    // A mixed course in 250 m segments: flat, gentle climb, descent, and a
    // wall above the gate (power-hike). Spans >3 km so multiple buckets flush.
    const grades = [
      0, 0.05, 0.1, -0.08, 0, 0.25, 0.3, -0.15, 0.12, 0, 0.07, -0.2, 0.18, 0.0,
    ];
    const dists = [0];
    for (let i = 0; i < grades.length; i++) dists.push(dists[i] + 250);

    const splits = computeSplits(dists, grades, FLAT, VAM, GATE, 1.1);

    // Each split's elapsed equals the running sum of per-km times before it.
    let running = 0;
    for (const s of splits) {
      running += s.paceSecPerKm * s.distanceKm;
      expect(s.elapsedSec).toBeCloseTo(running, 6);
    }

    // And the whole table sums to the final projected finish.
    const total = splits.reduce(
      (sum, s) => sum + s.paceSecPerKm * s.distanceKm,
      0,
    );
    expect(total).toBeCloseTo(splits[splits.length - 1].elapsedSec, 6);
  });
});
