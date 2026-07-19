// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPlan, loadPlan, savePlan, type SavedPlan } from "./persistence";

// The test env's localStorage global is non-functional (node's experimental
// storage without a backing file) — substitute a real in-memory one.
function makeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}

const PLAN: SavedPlan = {
  v: 1,
  savedAt: 1_750_000_000_000,
  gpxText: "<gpx><trk><trkseg><trkpt lat='1' lon='1'/></trkseg></trk></gpx>",
  title: "My race",
  units: "metric",
  paceText: "5:45",
  vam: 800,
  gatePct: 20,
  terrainFactor: 1.08,
  calibrated: true,
  aidText: "17, 33",
  dwellMin: 4,
  startText: "8:00",
  cutoffText: "5:30, 8:00",
  carbsGPerH: 80,
  fluidMlPerH: 600,
  sodiumMgPerH: 500,
};

describe("persistence", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = makeStorage();
    vi.stubGlobal("localStorage", storage);
  });

  it("round-trips a plan", () => {
    expect(savePlan(PLAN)).toBe(true);
    expect(loadPlan()).toEqual(PLAN);
  });

  it("returns null when nothing is saved", () => {
    expect(loadPlan()).toBeNull();
  });

  it("rejects malformed or wrong-version payloads", () => {
    localStorage.setItem("gp-plan-v1", "not json{");
    expect(loadPlan()).toBeNull();
    localStorage.setItem("gp-plan-v1", JSON.stringify({ v: 2 }));
    expect(loadPlan()).toBeNull();
    localStorage.setItem(
      "gp-plan-v1",
      JSON.stringify({ ...PLAN, gpxText: 42 }),
    );
    expect(loadPlan()).toBeNull();
  });

  it("reports failure instead of throwing when storage is full", () => {
    const spy = vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(savePlan(PLAN)).toBe(false);
    spy.mockRestore();
  });

  it("clearPlan removes the saved plan", () => {
    savePlan(PLAN);
    clearPlan();
    expect(loadPlan()).toBeNull();
  });
});
