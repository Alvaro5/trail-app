// One-off: run calibrateTerrainFactor over a set of timed GPX files and print the
// fitted factor for each, so a human can eyeball stability across efforts.
// NOT part of the app — a throwaway harness around the pure engine.
//
// Usage (Node 25+, TS runs natively):
//   node scripts/calibrate-scan.ts path/to/a.gpx path/to/b.gpx ...
//   node scripts/calibrate-scan.ts efforts/*.gpx
//
// Optional effort assumptions (same knobs the engine takes), via env:
//   FLAT=360  VAM=750  GATE=0.18   node scripts/calibrate-scan.ts ...
//   (FLAT = flat pace sec/km, VAM = power-hike m/h, GATE = hike-above grade)

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Window } from "happy-dom";

// parseGpx uses DOMParser (a browser global). Supply one before importing the
// engine so the import-time module graph has it available.
const win = new Window();
(globalThis as unknown as { DOMParser: typeof win.DOMParser }).DOMParser =
  win.DOMParser;

const {
  parseGpx,
  cumulativeDistances,
  resampleEven,
  smoothElevationByDistance,
  gradients,
  minettiCost,
  actualSegmentTimes,
  movingTimeSec,
  calibrateTerrainFactor,
} = await import("../src/lib/pacing.ts");

const FLAT = Number(process.env.FLAT ?? 360); // flat pace, sec/km
const VAM = Number(process.env.VAM ?? 750); // power-hike vertical rate, m/h
const GATE = Number(process.env.GATE ?? 0.18); // hike above this grade

// Reporting-only band: |grade| ≤ 1% is counted as "flat" when splitting the run
// buckets. The engine has no such band (it Minetti-costs every grade); this only
// decides which column a segment's time is shown under, not the time itself.
const FLAT_BAND = 0.01;

// Re-derive the engine's per-segment predicted time (at terrainFactor 1.0) so we
// can attribute it to a bucket. This MIRRORS segmentTimeSec in pacing.ts exactly
// — that fn is private, so we replicate its two cases rather than touch the
// engine. The four buckets sum to the same predict total shown in the summary.
function bucketPredict(dists: number[], grades: number[]) {
  const ratio = (g: number) => minettiCost(g) / minettiCost(0);
  const vamMs = VAM / 3600; // vertical m/s
  let uphillHike = 0;
  let uphillRun = 0;
  let flatRun = 0;
  let downhillRun = 0;

  for (let i = 1; i < dists.length; i++) {
    const meters = dists[i] - dists[i - 1];
    const grade = grades[i - 1];

    if (grade >= GATE) {
      // power-hike: time = rise / VAM (horizontal cancels) — engine's hike branch
      uphillHike += (grade * meters) / vamMs;
      continue;
    }
    // run: flat pace scaled by Minetti cost ratio — engine's run branch
    const sec = (meters / 1000) * FLAT * ratio(grade);
    if (grade > FLAT_BAND) uphillRun += sec;
    else if (grade < -FLAT_BAND) downhillRun += sec;
    else flatRun += sec;
  }
  return { uphillHike, uphillRun, flatRun, downhillRun };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error(
    "usage: node scripts/calibrate-scan.ts <file1.gpx> [file2.gpx ...]",
  );
  process.exit(1);
}

const fmtHMS = (sec: number) => {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

console.log(
  `assumptions: flat=${FLAT}s/km  vam=${VAM}m/h  gate=${GATE}\n` +
    `${"file".padEnd(28)} ${"dist".padStart(8)} ${"elapsed".padStart(9)} ${"moving".padStart(9)} ${"predict".padStart(9)} ${"factor".padStart(8)}`,
);

type Breakdown = ReturnType<typeof bucketPredict>;
const breakdowns: { name: string; b: Breakdown }[] = [];

for (const file of files) {
  const name = basename(file);
  try {
    const points = parseGpx(readFileSync(file, "utf8"));
    // Match the app pipeline: resample to even 10 m → smooth (window 3) → grades.
    // Geometry runs on the resampled track; the timing path (actualSegmentTimes)
    // stays on the raw, truly-timed points.
    const resampled = resampleEven(points, cumulativeDistances(points), 10);
    const dists = resampled.dists;
    const grades = gradients(
      smoothElevationByDistance(resampled.points, dists, 30),
      dists,
    );

    const factor = calibrateTerrainFactor(
      points, // raw points → actual total (real <time>)
      dists, // resampled geometry → predicted total
      grades,
      FLAT,
      VAM,
      GATE,
    );

    const distKm = (dists[dists.length - 1] / 1000).toFixed(2) + "km";
    const actual = actualSegmentTimes(points);

    if (factor === null) {
      console.log(
        `${name.padEnd(28)} ${distKm.padStart(8)} ${"—".padStart(9)} ${"—".padStart(9)} ${"—".padStart(9)} ${"NO TIME".padStart(8)}`,
      );
      continue;
    }

    const elapsedTotal = actual!.reduce((s, t) => s + t, 0);
    const movingTotal = movingTimeSec(points)!;
    // factor = movingTotal / predictedTotal  ⇒  predictedTotal = movingTotal / factor
    const predictedTotal = movingTotal / factor;
    console.log(
      `${name.padEnd(28)} ${distKm.padStart(8)} ${fmtHMS(elapsedTotal).padStart(9)} ${fmtHMS(movingTotal).padStart(9)} ${fmtHMS(predictedTotal).padStart(9)} ${factor.toFixed(3).padStart(8)}`,
    );

    breakdowns.push({ name, b: bucketPredict(dists, grades) });
  } catch (err) {
    console.log(
      `${name.padEnd(28)} ${"".padStart(8)} ${"".padStart(9)} ${"".padStart(9)} ${"ERROR".padStart(8)}  ${(err as Error).message}`,
    );
  }
}

// Where does the pure-Minetti predicted time actually go? Split per file into
// four buckets, each as seconds and % of that file's predict total.
const cell = (sec: number, total: number) =>
  `${String(Math.round(sec)).padStart(5)}s (${(total ? (100 * sec) / total : 0).toFixed(1).padStart(5)}%)`;

console.log(
  `\npredict breakdown (pure Minetti @ terrain 1.0)\n` +
    `${"file".padEnd(28)} ${"uphill_hike".padStart(13)} ${"uphill_run".padStart(13)} ${"flat_run".padStart(13)} ${"downhill_run".padStart(13)}`,
);
for (const { name, b } of breakdowns) {
  const total = b.uphillHike + b.uphillRun + b.flatRun + b.downhillRun;
  console.log(
    `${name.padEnd(28)} ${cell(b.uphillHike, total)} ${cell(b.uphillRun, total)} ${cell(b.flatRun, total)} ${cell(b.downhillRun, total)}`,
  );
}
