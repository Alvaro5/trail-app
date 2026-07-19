// Race logistics: aid-station dwell time, wall-clock times, cutoff barriers.
// Pure module, no React. Deliberately SEPARATE from pacing.ts:
//  - calibration runs computeSplits to model MOVING time; dwell threading
//    through the engine would silently mis-calibrate every fit.
//  - finishRange scales the moving estimate proportionally; dwell is a chosen
//    constant, not uncertainty, so it is ADDED after the band, never scaled.
// Split.elapsedSec therefore stays moving time everywhere; these helpers
// adjust at the presentation boundary.

export type AdjustedStop = {
  km: number;
  arriveSec: number; // dwell-adjusted arrival (dwell of EARLIER stations only)
  departSec: number; // arrival + this station's own dwell
};

// Stops in course order with dwell from every earlier station folded into
// each arrival. Input may be unsorted; eta is MOVING elapsed seconds.
export function adjustStops(
  stops: { km: number; eta: number }[],
  dwellSec: number,
): AdjustedStop[] {
  return [...stops]
    .sort((a, b) => a.km - b.km)
    .map((s, i) => ({
      km: s.km,
      arriveSec: s.eta + i * dwellSec,
      departSec: s.eta + (i + 1) * dwellSec,
    }));
}

// Total dwell accumulated STRICTLY before a course km: arriving AT a station
// hasn't spent that station's dwell yet.
export function dwellBefore(
  aidKms: number[],
  km: number,
  dwellSec: number,
): number {
  let n = 0;
  for (const a of aidKms) if (a < km) n++;
  return n * dwellSec;
}

export function adjustedElapsedAt(
  movingSec: number | null,
  km: number,
  aidKms: number[],
  dwellSec: number,
): number | null {
  return movingSec === null
    ? null
    : movingSec + dwellBefore(aidKms, km, dwellSec);
}

export function adjustedFinishSec(
  movingFinishSec: number,
  nStations: number,
  dwellSec: number,
): number {
  return movingFinishSec + nStations * dwellSec;
}

// "H:MM" / "HH:MM", 24-hour → seconds since midnight, or null.
export function parseStartTime(text: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : null;
}

// Start-of-day + elapsed → "HH:MM", wrapping past midnight (a finish at
// 25:10 race time reads 01:10 on a watch). Rounds to the NEAREST minute,
// matching fmtClockShort, so "≈ 5:18 · 13:18" can never disagree by one.
export function fmtWallClock(startSec: number, elapsedSec: number): string {
  const min = Math.round((startSec + elapsedSec) / 60) % 1440;
  const h = Math.floor(min / 60);
  return `${String(h).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// Cutoffs as ELAPSED "H:MM" per station, matched by index to the stations in
// course order. An invalid token keeps its slot as null so later stations
// still pair with THEIR cutoff instead of shifting.
export function parseCutoffs(text: string): (number | null)[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split(/[,;]+/).map((tok) => {
    const m = /^(\d{1,2}):([0-5]\d)$/.exec(tok.trim());
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : null;
  });
}

export type CutoffStatus = "ok" | "risk" | "miss";

// Compare a station's dwell-adjusted arrival against its cutoff. The honest
// range scales only the MOVING part (model uncertainty is proportional to
// effort); the dwell already inside `arriveSec` is a chosen constant.
// "risk" = the central plan clears the barrier but the slow end of the honest
// range does not.
export function cutoffStatus(
  arriveSec: number,
  dwellBeforeSec: number,
  highRatio: number, // range.highSec / central finish, ≥ 1
  cutoffSec: number,
): CutoffStatus {
  if (arriveSec > cutoffSec) return "miss";
  const movingPart = arriveSec - dwellBeforeSec;
  const slowArrive = movingPart * highRatio + dwellBeforeSec;
  return slowArrive > cutoffSec ? "risk" : "ok";
}
