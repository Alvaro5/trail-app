// Local plan persistence: the last UPLOADED course (raw GPX text, the source
// of truth) plus every plan setting, in one versioned localStorage entry.
// Reloading the page restores the whole plan instead of dumping the user back
// on the example. Privacy unchanged: localStorage lives on the device.
//
// Bundled examples are deliberately never persisted (a returning example
// viewer should keep getting the fresh example), and a URL-hash plan always
// overrides saved settings (a shared link must show the sender's plan).

export type SavedPlan = {
  v: 1;
  savedAt: number; // epoch ms
  gpxText: string;
  title: string;
  units: "metric" | "imperial";
  paceText: string;
  vam: number;
  gatePct: number;
  terrainFactor: number;
  calibrated: boolean;
  aidText: string;
  dwellMin: number;
  startText: string;
  cutoffText: string;
  carbsGPerH: number;
  fluidMlPerH: number;
  sodiumMgPerH: number;
  caffeineMgPerH?: number; // added later; old saves simply lack it
  fadePctPerH?: number; // added later; old saves simply lack it
  raceDate?: string; // "YYYY-MM-DD"; added later; old saves simply lack it
};

const KEY = "gp-plan-v1";

// Storage can be absent, full, or throwing (private browsing, quota, test
// envs). Persistence is a nicety: report failure, never break the app.
export function savePlan(plan: SavedPlan): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(plan));
    return true;
  } catch {
    return false; // quota exceeded (huge GPX) or storage unavailable
  }
}

export function loadPlan(): SavedPlan | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<SavedPlan>;
    // Shape-check the load-bearing fields; anything off = no restore.
    if (
      p?.v !== 1 ||
      typeof p.gpxText !== "string" ||
      p.gpxText.length < 20 ||
      typeof p.paceText !== "string" ||
      typeof p.vam !== "number" ||
      typeof p.gatePct !== "number" ||
      typeof p.terrainFactor !== "number" ||
      (p.units !== "metric" && p.units !== "imperial")
    )
      return null;
    return p as SavedPlan;
  } catch {
    return null;
  }
}

export function clearPlan(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear or storage unavailable */
  }
}
