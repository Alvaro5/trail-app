// @vitest-environment happy-dom
// parseGpx needs a DOMParser; happy-dom supplies one for this file only. The
// pure-math tests below don't care which environment they run in.
import { describe, it, expect } from "vitest";
import {
  minettiCost,
  computeSplits,
  parseGpx,
  parseGpxWaypoints,
  nearestTrackKm,
  GpxError,
  actualSegmentTimes,
  movingTimeSec,
  calibrateTerrainFactor,
  finishRange,
  median,
  resampleEven,
  smoothElevation,
  smoothElevationByDistance,
  elevationChange,
  cumulativeGain,
  gradients,
  cumulativeDistances,
  type TrackPoint,
} from "./pacing";

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

// Build a minimal GPX from [lat, lon, ele, isoTime?] rows. Omitting the time
// column produces a <trkpt> with no <time> child — i.e. a course-planning file.
function gpx(rows: [number, number, number, string?][]): string {
  const pts = rows
    .map(
      ([lat, lon, ele, t]) =>
        `<trkpt lat="${lat}" lon="${lon}"><ele>${ele}</ele>` +
        (t ? `<time>${t}</time>` : "") +
        `</trkpt>`,
    )
    .join("");
  return `<gpx><trk><trkseg>${pts}</trkseg></trk></gpx>`;
}

describe("timestamp capture (self-calibration input)", () => {
  it("parses <time> and derives correct, positive segment times", () => {
    // 30 s then 80 s between fixes.
    const points = parseGpx(
      gpx([
        [48.4, 2.6, 100, "2025-09-13T07:00:00Z"],
        [48.401, 2.6, 110, "2025-09-13T07:00:30Z"],
        [48.402, 2.6, 105, "2025-09-13T07:01:50Z"],
      ]),
    );
    expect(points.every((p) => typeof p.time === "number")).toBe(true);

    const times = actualSegmentTimes(points);
    expect(times).toEqual([30, 80]);
    // parallel to gradients (length n−1) and strictly positive
    expect(times).toHaveLength(points.length - 1);
    expect(times!.every((t) => t > 0)).toBe(true);
  });

  it("parses a course GPX with no <time> and runs the forward model unchanged", () => {
    const points = parseGpx(
      gpx([
        [48.4, 2.6, 100],
        [48.401, 2.6, 110],
        [48.402, 2.6, 105],
      ]),
    );
    // No timestamps captured…
    expect(points.every((p) => p.time === undefined)).toBe(true);
    // …so there is no usable timing signal — null, not a faked/partial array.
    expect(actualSegmentTimes(points)).toBeNull();
    // …yet the geometry pipeline still works exactly as before.
    const dists = cumulativeDistances(points);
    expect(gradients(points, dists)).toHaveLength(points.length - 1);
  });

  it("returns null when only some points carry a timestamp", () => {
    const points = parseGpx(
      gpx([
        [48.4, 2.6, 100, "2025-09-13T07:00:00Z"],
        [48.401, 2.6, 110], // missing <time>
        [48.402, 2.6, 105, "2025-09-13T07:01:50Z"],
      ]),
    );
    expect(actualSegmentTimes(points)).toBeNull();
  });
});

describe("waypoints (aid-station auto-fill)", () => {
  it("parses <wpt> elements with and without names, skipping bad coords", () => {
    const xml =
      `<gpx><wpt lat="48.4" lon="2.6"><name> Ravito 1 </name></wpt>` +
      `<wpt lat="48.41" lon="2.61"/>` +
      `<wpt lat="oops" lon="2.6"><name>bad</name></wpt>` +
      `<trk><trkseg><trkpt lat="48.4" lon="2.6"><ele>100</ele></trkpt>` +
      `<trkpt lat="48.401" lon="2.6"><ele>110</ele></trkpt></trkseg></trk></gpx>`;
    const wpts = parseGpxWaypoints(xml);
    expect(wpts).toHaveLength(2);
    expect(wpts[0]).toEqual({ lat: 48.4, lon: 2.6, name: "Ravito 1" });
    expect(wpts[1].name).toBeNull();
  });

  it("returns [] on unparseable XML instead of throwing", () => {
    expect(parseGpxWaypoints("not xml <<<")).toEqual([]);
  });

  it("projects a nearby waypoint onto the track and rejects far ones", () => {
    // Straight northward track, ~111 m per point, ~1 km total.
    const points: TrackPoint[] = Array.from({ length: 10 }, (_, i) => ({
      lat: 48 + i * 0.001,
      lon: 2.6,
      ele: 100,
    }));
    const dists = cumulativeDistances(points);
    // Waypoint ~30 m east of the halfway point → projects to ~mid-course.
    const mid = nearestTrackKm(points, dists, 48.0045, 2.6004);
    expect(mid).not.toBeNull();
    expect(mid!).toBeGreaterThan(0.3);
    expect(mid!).toBeLessThan(0.7);
    // A waypoint kilometres away is not on the course.
    expect(nearestTrackKm(points, dists, 48.0045, 2.7)).toBeNull();
  });
});

describe("parseGpx failure modes (graceful upload path)", () => {
  it("throws GpxError 'invalid' on non-XML / malformed input", () => {
    try {
      parseGpx("this is not xml at all <<<");
      throw new Error("expected parseGpx to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(GpxError);
      expect((e as GpxError).code).toBe("invalid");
    }
  });

  it("parses a route-only file (<rtept>) like an untimed track", () => {
    // Race organizers publish courses as routes; they must pace like tracks.
    const route =
      `<gpx><rte><rtept lat="48.4" lon="2.6"><ele>100</ele></rtept>` +
      `<rtept lat="48.401" lon="2.6"><ele>110</ele></rtept></rte></gpx>`;
    const points = parseGpx(route);
    expect(points).toHaveLength(2);
    expect(points[0].ele).toBe(100);
    expect(points[1].ele).toBe(110);
    expect(points[0].time).toBeUndefined();
  });

  it("prefers <trkpt> when a file carries both a track and a route", () => {
    const both =
      `<gpx><trk><trkseg><trkpt lat="48.4" lon="2.6"><ele>100</ele></trkpt>` +
      `<trkpt lat="48.401" lon="2.6"><ele>120</ele></trkpt></trkseg></trk>` +
      `<rte><rtept lat="10" lon="10"><ele>1</ele></rtept>` +
      `<rtept lat="10.1" lon="10"><ele>2</ele></rtept></rte></gpx>`;
    const points = parseGpx(both);
    expect(points).toHaveLength(2);
    expect(points[0].ele).toBe(100); // track's elevations, not the route's
  });

  it("throws GpxError 'no-track' on a waypoint-only file", () => {
    const wptOnly =
      `<gpx><wpt lat="48.4" lon="2.6"><ele>100</ele></wpt>` +
      `<wpt lat="48.401" lon="2.6"><ele>110</ele></wpt></gpx>`;
    try {
      parseGpx(wptOnly);
      throw new Error("expected parseGpx to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(GpxError);
      expect((e as GpxError).code).toBe("no-track");
    }
  });

  it("throws GpxError 'no-elevation' when no point carries <ele>", () => {
    // Common in route exports. A flat plan would be silently wrong — the whole
    // product is grade adjustment — so this must be an explicit error.
    const noEle =
      `<gpx><rte><rtept lat="48.4" lon="2.6"/>` +
      `<rtept lat="48.401" lon="2.6"/></rte></gpx>`;
    try {
      parseGpx(noEle);
      throw new Error("expected parseGpx to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(GpxError);
      expect((e as GpxError).code).toBe("no-elevation");
    }
  });

  it("throws GpxError 'too-few' on a single-point track", () => {
    try {
      parseGpx(gpx([[48.4, 2.6, 100]]));
      throw new Error("expected parseGpx to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(GpxError);
      expect((e as GpxError).code).toBe("too-few");
    }
  });
});

describe("calibrateTerrainFactor", () => {
  const FLAT = 360;
  const VAM = 750;
  const GATE = 0.18;

  it("recovers the factor from a track timed at a known multiple of the model", () => {
    // 1000 m segments so each is its own km bucket → split[i] time IS segment i's
    // model time. Mixed grades (flat, climb, descent) to prove it's grade-agnostic.
    const grades = [0, 0.1, -0.1, 0.15];
    const dists = [0];
    for (let i = 0; i < grades.length; i++) dists.push(dists[i] + 1000);

    // Per-segment model seconds at terrainFactor = 1.0 (distanceKm === 1 here).
    const splits = computeSplits(dists, grades, FLAT, VAM, GATE, 1);
    const segModelSec = splits.map((s) => s.paceSecPerKm * s.distanceKm);

    // Build a recorded effort that took EXACTLY 1.15× the model, segment by
    // segment. Raw points need REAL spacing now: the moving-time filter derives
    // per-segment speed from raw coordinates, and coincident points would all
    // read as "stopped". 0.009° of latitude ≈ 1000 m.
    const TRUTH = 1.15;
    const points: TrackPoint[] = [{ lat: 0, lon: 0, ele: 0, time: 0 }];
    let cumMs = 0;
    segModelSec.forEach((sec, i) => {
      cumMs += sec * TRUTH * 1000;
      points.push({ lat: (i + 1) * 0.009, lon: 0, ele: 0, time: cumMs });
    });

    const factor = calibrateTerrainFactor(points, dists, grades, FLAT, VAM, GATE);
    expect(factor).not.toBeNull();
    expect(factor!).toBeCloseTo(TRUTH, 6);
  });

  it("excludes stopped time from the fit (aid-station standstill)", () => {
    const grades = [0, 0.1, -0.1, 0.15];
    const dists = [0];
    for (let i = 0; i < grades.length; i++) dists.push(dists[i] + 1000);
    const splits = computeSplits(dists, grades, FLAT, VAM, GATE, 1);
    const segModelSec = splits.map((s) => s.paceSecPerKm * s.distanceKm);

    const TRUTH = 1.15;
    const base: TrackPoint[] = [{ lat: 0, lon: 0, ele: 0, time: 0 }];
    let cumMs = 0;
    segModelSec.forEach((sec, i) => {
      cumMs += sec * TRUTH * 1000;
      base.push({ lat: (i + 1) * 0.009, lon: 0, ele: 0, time: cumMs });
    });

    // Insert a 10-minute standstill after the 2nd point: the clock advances,
    // the coordinates don't. Every later timestamp shifts by the stop length.
    const stop = base[1];
    const points = [
      base[0],
      base[1],
      { ...stop, time: stop.time! + 300_000 },
      { ...stop, time: stop.time! + 600_000 },
      ...base.slice(2).map((p) => ({ ...p, time: p.time! + 600_000 })),
    ];

    // A raw-elapsed fit would inflate the factor by the stop; the moving-time
    // fit must still recover exactly the true multiple.
    const factor = calibrateTerrainFactor(points, dists, grades, FLAT, VAM, GATE);
    expect(factor!).toBeCloseTo(TRUTH, 6);
  });

  it("returns null when the effort has no usable timing", () => {
    const grades = [0, 0.1];
    const dists = [0, 1000, 2000];
    const points: TrackPoint[] = [
      { lat: 0, lon: 0, ele: 0 }, // no time
      { lat: 0, lon: 0, ele: 0 },
      { lat: 0, lon: 0, ele: 0 },
    ];
    expect(
      calibrateTerrainFactor(points, dists, grades, FLAT, VAM, GATE),
    ).toBeNull();
  });
});

describe("computeSplits bucketMeters", () => {
  // ~2.01 miles of flat course in 100 m segments.
  const dists = Array.from({ length: 33 }, (_, i) => i * 100.5);
  const grades = Array.from({ length: 32 }, () => 0);

  it("buckets by miles when asked, with total time invariant", () => {
    const km = computeSplits(dists, grades, 360, 750, 0.18, 1);
    const mi = computeSplits(dists, grades, 360, 750, 0.18, 1, 1609.344);
    expect(mi.length).toBe(2); // 3216 m → one full mile + a partial
    // Full buckets are now EXACTLY one mile (boundary segments are split).
    expect(mi[0].distanceKm * 1000).toBeCloseTo(1609.344, 6);
    // Same course, same physics — bucketing must not change the finish time.
    expect(mi[mi.length - 1].elapsedSec).toBeCloseTo(
      km[km.length - 1].elapsedSec,
      6,
    );
  });
});

describe("computeSplits boundary split", () => {
  // 100.5 m segments deliberately misaligned with the 1000 m grid: without
  // proportional splitting every "km" ran long by up to one segment.
  const dists = Array.from({ length: 33 }, (_, i) => i * 100.5);
  const flat = Array.from({ length: 32 }, () => 0);

  it("makes every full bucket exactly 1000 m, remainder in the last", () => {
    const splits = computeSplits(dists, flat, 360, 750, 0.18, 1);
    expect(splits).toHaveLength(4); // 3216 m → 3 full km + 216 m
    for (const s of splits.slice(0, -1))
      expect(s.distanceKm).toBeCloseTo(1, 9);
    expect(splits[3].distanceKm * 1000).toBeCloseTo(216, 6);
    expect(
      splits.reduce((sum, s) => sum + s.distanceKm, 0) * 1000,
    ).toBeCloseTo(32 * 100.5, 6);
  });

  it("splits time and gain proportionally at the boundary", () => {
    // Constant 10% climb: uniform cost per meter, so pace must be identical
    // across buckets and gain exactly 10% of each bucket's distance.
    const grades = Array.from({ length: 32 }, () => 0.1);
    const splits = computeSplits(dists, grades, 360, 750, 0.18, 1);
    for (const s of splits) {
      expect(s.paceSecPerKm).toBeCloseTo(splits[0].paceSecPerKm, 6);
      expect(s.gainM).toBeCloseTo(0.1 * s.distanceKm * 1000, 6);
    }
    // The locked invariant, now with exact buckets: Σ pace×dist === finish.
    const sum = splits.reduce(
      (acc, s) => acc + s.paceSecPerKm * s.distanceKm,
      0,
    );
    expect(sum).toBeCloseTo(splits[splits.length - 1].elapsedSec, 6);
  });

  it("handles a single segment longer than the bucket", () => {
    const splits = computeSplits([0, 2500], [0], 360, 750, 0.18, 1);
    expect(splits.map((s) => +(s.distanceKm * 1000).toFixed(3))).toEqual([
      1000, 1000, 500,
    ]);
  });
});

describe("median", () => {
  it("picks the middle of odd samples, averages the two middles of even", () => {
    expect(median([1.08, 0.99, 1.01])).toBe(1.01);
    expect(median([1.08, 0.99, 1.01, 1.06])).toBeCloseTo(1.035, 10);
  });
  it("is robust to one wild outlier", () => {
    expect(median([0.99, 1.01, 1.08, 0.43])).toBeCloseTo(1.0, 10);
  });
  it("returns null on empty input and leaves the input unsorted", () => {
    expect(median([])).toBeNull();
    const arr = [3, 1, 2];
    median(arr);
    expect(arr).toEqual([3, 1, 2]);
  });
});

describe("finishRange", () => {
  it("brackets the central estimate with the uncalibrated band (−8%/+10%)", () => {
    const r = finishRange(10000, false);
    expect(r.likelySec).toBe(10000); // center never moves
    expect(r.lowSec).toBeCloseTo(9200, 6);
    expect(r.highSec).toBeCloseTo(11000, 6);
  });

  it("narrows the band when calibrated (−5%/+7%)", () => {
    const cal = finishRange(10000, true);
    expect(cal.lowSec).toBeCloseTo(9500, 6);
    expect(cal.highSec).toBeCloseTo(10700, 6);
    const uncal = finishRange(10000, false);
    expect(cal.highSec - cal.lowSec).toBeLessThan(
      uncal.highSec - uncal.lowSec,
    );
  });
});

describe("movingTimeSec", () => {
  it("equals total elapsed time when there are no stops", () => {
    // 1000 m in 400 s (2.5 m/s), twice.
    const points: TrackPoint[] = [
      { lat: 0, lon: 0, ele: 0, time: 0 },
      { lat: 0.009, lon: 0, ele: 0, time: 400_000 },
      { lat: 0.018, lon: 0, ele: 0, time: 800_000 },
    ];
    expect(movingTimeSec(points)).toBeCloseTo(800, 6);
  });

  it("drops a paused-watch gap (huge Δt, negligible Δdist)", () => {
    const points: TrackPoint[] = [
      { lat: 0, lon: 0, ele: 0, time: 0 },
      { lat: 0.009, lon: 0, ele: 0, time: 400_000 },
      // Watch paused for 15 min; resumed a couple of metres away.
      { lat: 0.009_02, lon: 0, ele: 0, time: 1_300_000 },
      { lat: 0.018, lon: 0, ele: 0, time: 1_700_000 },
    ];
    // Only the two real 400 s segments count.
    expect(movingTimeSec(points)).toBeCloseTo(800, 6);
  });

  it("returns null on an untimed course", () => {
    const points: TrackPoint[] = [
      { lat: 0, lon: 0, ele: 0 },
      { lat: 0.009, lon: 0, ele: 0 },
    ];
    expect(movingTimeSec(points)).toBeNull();
  });
});

describe("resampleEven", () => {
  // A straight +10% ramp sampled at UNEVEN raw distances. Elevation is linear in
  // cumulative distance, so a correct resample keeps it linear → constant gradient
  // (the whole point: no near-coincident-point spikes). Total 95 m is not a
  // multiple of 10, so the final station is a partial interval.
  const rawDists = [0, 7, 23, 50, 78, 95];
  const ELE = (d: number) => 0.1 * d;
  const rawPoints: TrackPoint[] = rawDists.map((d) => ({
    lat: 48 + d / 1e5,
    lon: 2,
    ele: ELE(d),
  }));

  it("produces evenly-spaced stations with a partial final interval", () => {
    const { dists } = resampleEven(rawPoints, rawDists, 10);
    expect(dists[0]).toBe(0);
    for (let i = 1; i < dists.length - 1; i++) {
      expect(dists[i] - dists[i - 1]).toBeCloseTo(10, 9);
    }
    const lastGap = dists[dists.length - 1] - dists[dists.length - 2];
    expect(lastGap).toBeGreaterThan(0);
    expect(lastGap).toBeLessThanOrEqual(10);
  });

  it("linearly interpolates ele → constant gradient (spike removal)", () => {
    const { points, dists } = resampleEven(rawPoints, rawDists, 10);
    points.forEach((p, i) => expect(p.ele).toBeCloseTo(ELE(dists[i]), 6));
    for (const grade of gradients(points, dists)) {
      expect(grade).toBeCloseTo(0.1, 9);
    }
  });

  it("preserves the start and the exact final point (total distance)", () => {
    const { points, dists } = resampleEven(rawPoints, rawDists, 10);
    expect(dists[0]).toBe(0);
    expect(points[0].ele).toBeCloseTo(ELE(0), 9);
    expect(dists[dists.length - 1]).toBeCloseTo(95, 9);
    expect(points[points.length - 1].ele).toBeCloseTo(ELE(95), 9);
  });

  it("carries no timestamps — geometry only, never the timing path", () => {
    const { points } = resampleEven(rawPoints, rawDists, 10);
    expect(points.every((p) => p.time === undefined)).toBe(true);
  });

  it("returns degenerate tracks unchanged", () => {
    const one: TrackPoint[] = [{ lat: 0, lon: 0, ele: 0 }];
    expect(resampleEven(one, [0], 10).points).toBe(one); // single point, total 0
    expect(resampleEven([], [], 10).points).toEqual([]);
  });

  it("throws on a non-positive interval", () => {
    expect(() => resampleEven(rawPoints, rawDists, 0)).toThrow();
  });
});

describe("smoothElevationByDistance", () => {
  it("reduces to window-3 MA on an even 10 m grid when windowM=30", () => {
    const eles = [0, 5, 2, 9, 4, 7, 3];
    const dists = eles.map((_, i) => i * 10);
    const pts: TrackPoint[] = eles.map((ele) => ({ lat: 1, lon: 2, ele }));
    const byDist = smoothElevationByDistance(pts, dists, 30);
    const byCount = smoothElevation(pts, 3);
    byDist.forEach((p, i) => expect(p.ele).toBeCloseTo(byCount[i].ele, 9));
    expect(byDist[0].lat).toBe(1); // lat/lon preserved
  });

  it("leaves a straight ramp unchanged at interior points (line in → line out)", () => {
    const dists = [0, 10, 20, 30, 40];
    const pts: TrackPoint[] = dists.map((d) => ({ lat: 0, lon: 0, ele: 0.1 * d }));
    const out = smoothElevationByDistance(pts, dists, 30);
    // Endpoints get a one-sided window (like any centered MA) so they shift; the
    // line-preserving property holds where the window is symmetric.
    for (let i = 1; i < dists.length - 1; i++) {
      expect(out[i].ele).toBeCloseTo(0.1 * dists[i], 9);
    }
  });
});

describe("cumulativeGain", () => {
  const asPoints = (eles: number[]): TrackPoint[] =>
    eles.map((ele) => ({ lat: 0, lon: 0, ele }));

  it("equals the naive positive-sum when threshold is 0", () => {
    const eles = [0, 10, 7, 20, 18, 25]; // positive diffs: 10 + 13 + 7 = 30
    expect(cumulativeGain(eles, 0)).toBeCloseTo(
      elevationChange(asPoints(eles)).gain,
      9,
    );
  });

  it("ignores oscillations smaller than the threshold (coastline noise)", () => {
    const eles = [100, 101, 99, 100.5, 98.5, 100]; // jitter well under 3 m
    expect(cumulativeGain(eles, 3)).toBe(0);
  });

  it("still banks a real climb made of sub-threshold steps", () => {
    const eles = Array.from({ length: 101 }, (_, i) => i); // 0→100 in 1 m steps
    const g = cumulativeGain(eles, 3);
    expect(g).toBeGreaterThan(100 - 3);
    expect(g).toBeLessThanOrEqual(100);
  });

  it("measures re-ascents from the valley (up-down-up)", () => {
    const eles = [0, 50, 0, 50, 0]; // two genuine 50 m climbs
    expect(cumulativeGain(eles, 3)).toBeGreaterThan(100 - 6);
  });

  it("returns 0 for degenerate input", () => {
    expect(cumulativeGain([], 3)).toBe(0);
    expect(cumulativeGain([42], 3)).toBe(0);
  });
});
