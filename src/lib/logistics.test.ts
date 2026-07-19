import { describe, expect, it } from "vitest";
import {
  adjustStops,
  adjustedElapsedAt,
  adjustedFinishSec,
  cutoffStatus,
  dwellBefore,
  fmtWallClock,
  parseCutoffs,
  parseStartTime,
} from "./logistics";
import { computeNutrition, DEFAULT_RATES } from "./nutrition";

const H = 3600;

describe("adjustStops", () => {
  it("is the identity on ETAs when dwell is 0", () => {
    const stops = [
      { km: 17, eta: 2 * H },
      { km: 33, eta: 4 * H },
    ];
    const adj = adjustStops(stops, 0);
    expect(adj.map((s) => s.arriveSec)).toEqual([2 * H, 4 * H]);
    expect(adj.map((s) => s.departSec)).toEqual([2 * H, 4 * H]);
  });

  it("folds each earlier station's dwell into the arrival, own dwell into departure", () => {
    const adj = adjustStops(
      [
        { km: 17, eta: 2 * H },
        { km: 33, eta: 4 * H },
        { km: 47, eta: 5.5 * H },
      ],
      180,
    );
    expect(adj[0]).toEqual({ km: 17, arriveSec: 2 * H, departSec: 2 * H + 180 });
    expect(adj[1].arriveSec).toBe(4 * H + 180); // R1's dwell only
    expect(adj[1].departSec).toBe(4 * H + 360);
    expect(adj[2].arriveSec).toBe(5.5 * H + 360); // R1 + R2
  });

  it("sorts unsorted input by course km", () => {
    const adj = adjustStops(
      [
        { km: 33, eta: 4 * H },
        { km: 17, eta: 2 * H },
      ],
      60,
    );
    expect(adj.map((s) => s.km)).toEqual([17, 33]);
    expect(adj[0].arriveSec).toBe(2 * H); // first in course order, no prior dwell
  });
});

describe("dwellBefore / adjustedElapsedAt", () => {
  it("counts stations STRICTLY before the km: arriving at one excludes its own dwell", () => {
    const aid = [17, 33];
    expect(dwellBefore(aid, 17, 180)).toBe(0);
    expect(dwellBefore(aid, 17.01, 180)).toBe(180);
    expect(dwellBefore(aid, 33, 180)).toBe(180);
    expect(dwellBefore(aid, 50, 180)).toBe(360);
  });

  it("passes null through (past track end)", () => {
    expect(adjustedElapsedAt(null, 10, [5], 180)).toBeNull();
    expect(adjustedElapsedAt(1000, 10, [5], 180)).toBe(1180);
  });
});

describe("adjustedFinishSec", () => {
  it("adds n stations times dwell; no-op at zero stations", () => {
    expect(adjustedFinishSec(7 * H, 3, 180)).toBe(7 * H + 540);
    expect(adjustedFinishSec(7 * H, 0, 180)).toBe(7 * H);
  });
});

describe("parseStartTime", () => {
  it("accepts 24h H:MM and HH:MM", () => {
    expect(parseStartTime("7:05")).toBe(7 * H + 300);
    expect(parseStartTime("07:05")).toBe(7 * H + 300);
    expect(parseStartTime("23:59")).toBe(23 * H + 59 * 60);
    expect(parseStartTime(" 8:00 ")).toBe(8 * H);
  });

  it("rejects out-of-range and malformed input", () => {
    for (const bad of ["24:00", "7", "7:5", "07:60", "", "8h00", "-1:00"])
      expect(parseStartTime(bad)).toBeNull();
  });
});

describe("fmtWallClock", () => {
  it("formats start + elapsed as HH:MM", () => {
    expect(fmtWallClock(8 * H, 1 * H + 52 * 60)).toBe("09:52");
  });

  it("wraps past midnight", () => {
    expect(fmtWallClock(22 * H, 3 * H)).toBe("01:00");
  });
});

describe("parseCutoffs", () => {
  it("parses elapsed H:MM tokens in order", () => {
    expect(parseCutoffs("5:30, 8:00, 10:15")).toEqual([
      5.5 * H,
      8 * H,
      10 * H + 900,
    ]);
  });

  it("keeps invalid tokens as null SLOTS so later indexes still pair", () => {
    expect(parseCutoffs("5:30, oops, 10:15")).toEqual([
      5.5 * H,
      null,
      10 * H + 900,
    ]);
  });

  it("returns empty for empty input", () => {
    expect(parseCutoffs("")).toEqual([]);
    expect(parseCutoffs("   ")).toEqual([]);
  });
});

describe("cutoffStatus", () => {
  // Central arrival 5:00 elapsed of which 6 min is dwell; range high ratio 1.1.
  const arrive = 5 * H;
  const dwell = 360;

  it("miss when the central arrival is past the cutoff", () => {
    expect(cutoffStatus(arrive, dwell, 1.1, 5 * H - 60)).toBe("miss");
  });

  it("risk when only the slow end of the range misses", () => {
    // slow arrival = (5h - 6min) × 1.1 + 6min = 5:29:24 → cutoff 5:15 = risk
    expect(cutoffStatus(arrive, dwell, 1.1, 5 * H + 900)).toBe("risk");
  });

  it("ok when even the slow end clears", () => {
    expect(cutoffStatus(arrive, dwell, 1.1, 6 * H)).toBe("ok");
  });

  it("does NOT scale the dwell part by the range ratio", () => {
    // All-moving vs heavy-dwell arrivals at the same central time: the
    // heavy-dwell one has a SMALLER slow arrival, so a cutoff between the
    // two slow values must read risk for all-moving but ok for heavy-dwell.
    const cutoff = 5.4 * H; // between 5h×1.1=5.5h and (5h-1h)×1.1+1h=5.4h
    expect(cutoffStatus(5 * H, 0, 1.1, cutoff)).toBe("risk");
    expect(cutoffStatus(5 * H, 3600, 1.1, cutoff)).toBe("ok");
  });
});

describe("dwell x nutrition integration", () => {
  it("legs partition the adjusted finish and R1's dwell lands in the R1→R2 leg", () => {
    const dwell = 300;
    const stops = [
      { km: 20, eta: 2 * H },
      { km: 40, eta: 4 * H },
    ];
    const adj = adjustStops(stops, dwell);
    const adjFinish = adjustedFinishSec(6 * H, stops.length, dwell);
    const plan = computeNutrition(
      adjFinish,
      60,
      adj.map((s) => ({ km: s.km, eta: s.arriveSec })),
      DEFAULT_RATES,
    );
    expect(plan.legs).toHaveLength(3);
    // Leg 2 (R1→R2): moving 2 h plus R1's 5 min dwell.
    expect(plan.legs[1].durationSec).toBe(2 * H + dwell);
    // Partition: legs sum exactly to the adjusted finish.
    const sum = plan.legs.reduce((s, l) => s + l.durationSec, 0);
    expect(sum).toBe(adjFinish);
  });
});
