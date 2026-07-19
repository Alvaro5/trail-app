import { lazy, Suspense, useEffect, useRef, useState } from "react";

// Recharts is ~500 kB — by far the heaviest dependency — so the chart loads as
// its own async chunk and never blocks first paint.
const ElevationChart = lazy(() => import("./ElevationChart"));
import {
  parseGpx,
  cumulativeDistances,
  resampleEven,
  smoothElevationByDistance,
  cumulativeGain,
  gradients,
  computeSplits,
  actualSegmentTimes,
  movingTimeSec,
  calibrateTerrainFactor,
  finishRange,
  GpxError,
  type GpxErrorCode,
  type Split,
} from "./lib/pacing";
import { fmtClock, fmtClockShort, fmtPace } from "./lib/format";
import { GRADE_LEGEND } from "./lib/gradeColor";
// Aliased: `track` is taken by the parsed-GPX state variable in GpxUpload.
import { track as trackEvent } from "./lib/analytics";
import { buildShareCardSvg, type ShareCardData } from "./lib/shareCard";
import { svgToPng } from "./lib/rasterize";

// Friendly, distinct copy for each parse failure. Anything unrecognized falls
// through to a generic line rather than crashing the upload path.
const GPX_ERROR_MESSAGE: Record<GpxErrorCode, string> = {
  invalid:
    "This file isn't valid GPX — it couldn't be read as XML. Make sure you exported a .gpx file.",
  "no-track":
    "This file has no track or route points — there's nothing to pace in it.",
  "too-few":
    "This track has too few points to build a pacing plan (it needs at least two).",
  "no-elevation":
    "This file has no elevation data, so the plan can't be grade-adjusted. Re-export the GPX with elevation included — most route planners have that option.",
};

// Elevation-processing length scales (see STATUS.md / the research notes).
const RESAMPLE_INTERVAL_M = 10; // even spacing that kills Δdist gradient spikes
const SMOOTH_WINDOW_M = 30; // physical low-pass; keep ≥ ~3× the resample interval
const D_PLUS_THRESHOLD_M = 5; // hysteresis deadband for D+ (noise floor; 0 = naive sum)

// Result of fitting the terrain factor against one recorded run.
type Calibration = {
  fileName: string;
  factor: number; // movingSec / predictedSec — the measured terrain factor
  distanceKm: number;
  movingSec: number; // stops filtered out
  elapsedSec: number; // raw clock time, shown so the user sees what was removed
  predictedSec: number; // pure model (×1.00) over the same course
};

// Outside this band the "measurement" is almost certainly not measuring terrain:
// route exports carry synthetic ~15 km/h timestamps (factors like ×0.4), and a
// walked outing fits ×1.9+. We still show the number, but with a warning, and
// clamp what can be applied to the slider's range.
const FACTOR_PLAUSIBLE_MIN = 0.85;
const FACTOR_PLAUSIBLE_MAX = 1.5;

type Track = {
  distances: number[];
  grades: number[];
  distanceKm: number;
  gainM: number;
  profile: { km: number; ele: number }[];
};

// Parse + geometry pipeline (see research notes / STATUS.md):
//  1. resample to even spacing → no Δdist gradient spikes (geometry only; the
//     timed raw points are untouched, used by the calibration path).
//  2. smooth elevation over a fixed PHYSICAL window → grid-independent.
//  3. D+ via hysteresis deadband → density-stable, noise-robust.
// Throws GpxError on bad input; callers map that to a friendly message.
function buildTrack(text: string): Track {
  const points = parseGpx(text);
  const resampled = resampleEven(
    points,
    cumulativeDistances(points),
    RESAMPLE_INTERVAL_M,
  );
  const distances = resampled.dists;
  const smoothed = smoothElevationByDistance(
    resampled.points,
    distances,
    SMOOTH_WINDOW_M,
  );
  const grades = gradients(smoothed, distances);
  return {
    distances,
    grades,
    distanceKm: distances[distances.length - 1] / 1000,
    gainM: cumulativeGain(
      smoothed.map((p) => p.ele),
      D_PLUS_THRESHOLD_M,
    ),
    profile: smoothed.map((p, i) => ({
      km: distances[i] / 1000,
      ele: p.ele,
    })),
  };
}

const fmtGrade = (g: number) => `${g > 0 ? "+" : ""}${(g * 100).toFixed(0)}%`;

const gradeClass = (g: number) =>
  g > 0.005 ? "text-rose-400" : g < -0.005 ? "text-sky-400" : "text-zinc-400";

// "6:30" → 390 s, bare "6" → 360 s. NaN when unparseable — no silent fallback:
// the caller keeps the last valid pace and shows an invalid state, so a typo
// can't quietly reset the whole plan to 6:00/km.
function parsePace(text: string): number {
  const t = text.trim();
  if (!/^\d{1,3}(:[0-5]?\d)?$/.test(t)) return NaN;
  const [m, s] = t.split(":").map(Number);
  const sec = m * 60 + (s || 0);
  return sec > 0 ? sec : NaN;
}

// "Imperial_Trail-2025.gpx" → "Imperial Trail 2025". The filename prefills the
// course name, which feeds the share image — underscores shouldn't leak there.
const titleFromFilename = (name: string) =>
  name
    .replace(/\.gpx$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Display units. Engine math is metric everywhere; imperial converts only at
// the presentation layer (and switches the splits table to mile buckets).
type Units = "metric" | "imperial";
const KM_PER_MI = 1.609344;
const FT_PER_M = 3.28084;
const MILE_M = 1609.344;

// Plan settings encoded in the URL hash (#p=6:00&vam=750&gate=18&tf=1.08&u=metric)
// so a plan can travel as a LINK, not just a PNG. Only the effort inputs are
// encoded: a link can't carry an uploaded GPX file, and the calibrated flag
// deliberately doesn't travel — the recipient didn't calibrate, so they get
// the honest wide band even when the sender's factor was measured.
type HashPlan = {
  pace?: string;
  vam?: number;
  gate?: number;
  tf?: number;
  units?: Units;
};

function readPlanFromHash(): HashPlan {
  try {
    const p = new URLSearchParams(window.location.hash.slice(1));
    const plan: HashPlan = {};
    const pace = p.get("p");
    if (pace && !Number.isNaN(parsePace(pace))) plan.pace = pace;
    const vam = Number(p.get("vam"));
    if (vam >= 300 && vam <= 1200) plan.vam = Math.round(vam);
    const gate = Number(p.get("gate"));
    if (gate >= 5 && gate <= 40) plan.gate = Math.round(gate);
    const tf = Number(p.get("tf"));
    if (tf >= 0.8 && tf <= 1.6) plan.tf = tf;
    const u = p.get("u");
    if (u === "metric" || u === "imperial") plan.units = u;
    return plan;
  } catch {
    return {}; // malformed hash → plain defaults, never a crash
  }
}

function initialUnits(): Units {
  // Storage can be absent or throw (private browsing, test envs) — the
  // preference is a nicety, never worth crashing over.
  try {
    const saved = localStorage.getItem("gp-units");
    if (saved === "metric" || saved === "imperial") return saved;
  } catch {
    /* fall through to the locale default */
  }
  // US visitors think in miles; everyone else gets metric.
  return navigator.language === "en-US" ? "imperial" : "metric";
}

const inputClass =
  "w-28 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-100 tabular-nums focus:border-emerald-500 focus:outline-none";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-xs uppercase tracking-wider text-zinc-400">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex w-56 flex-col gap-1 text-sm">
      <span className="text-zinc-300">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

function SliderField({
  label,
  hint,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex w-56 flex-col gap-1 text-sm">
      <span className="flex justify-between text-zinc-300">
        <span>{label}</span>
        <span className="tabular-nums text-zinc-200">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-emerald-500"
      />
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

function GpxUpload() {
  const [track, setTrack] = useState<Track | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A shared-plan link overrides the defaults for every effort input below.
  const [hashPlan] = useState(readPlanFromHash);
  const [units, setUnits] = useState<Units>(() => hashPlan.units ?? initialUnits());
  // A sensible easy default in the active unit (6:00/km ≈ 9:39/mi).
  const [paceText, setPaceText] = useState(
    hashPlan.pace ?? (units === "imperial" ? "9:40" : "6:00"),
  );
  const [vam, setVam] = useState(hashPlan.vam ?? 750);
  const [hikeAbovePct, setHikeAbovePct] = useState(hashPlan.gate ?? 18);
  const [terrainFactor, setTerrainFactor] = useState(hashPlan.tf ?? 1.0);
  // Course name shown on the shareable image; prefilled on load, editable.
  const [title, setTitle] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  // The full table is ~70 rows for a 70k — collapsed by default so the page
  // ends near the stats instead of scrolling forever.
  const [showAllSplits, setShowAllSplits] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // Share the current effort settings as a URL (see readPlanFromHash for
  // what travels and what deliberately doesn't).
  async function handleCopyLink() {
    const params = new URLSearchParams({
      p: paceText,
      vam: String(vam),
      gate: String(hikeAbovePct),
      tf: terrainFactor.toFixed(2),
      u: units,
    });
    const url = `${window.location.origin}${window.location.pathname}#${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
      trackEvent("copy-link");
    } catch {
      // Clipboard can be blocked (permissions, non-secure context). Put the
      // hash in the address bar so the user can copy it from there.
      window.location.hash = params.toString();
      setShareError(
        "Couldn't copy automatically — the link is in your address bar now.",
      );
    }
  }
  // True while the dashboard shows the bundled course (auto-loaded or clicked),
  // so we can badge it as an example rather than let it pass for the visitor's
  // own race. Cleared the moment a user upload succeeds.
  const [fromExample, setFromExample] = useState(false);
  const [calib, setCalib] = useState<Calibration | null>(null);
  const [calibError, setCalibError] = useState<string | null>(null);
  // True while the terrain factor comes from a measured fit — narrows the
  // finish range. Manually touching the terrain slider makes it a guess again.
  const [calibrated, setCalibrated] = useState(false);

  // Pace text validates on every keystroke; while it's invalid (mid-edit or a
  // typo) the plan keeps using the last valid pace instead of silently
  // resetting, and the field shows an inline invalid state. The last valid
  // value is state, updated in onChange — not a ref written during render.
  const [lastValidPaceSec, setLastValidPaceSec] = useState(() => {
    const fromHash = parsePace(hashPlan.pace ?? "");
    if (!Number.isNaN(fromHash)) return fromHash;
    return units === "imperial" ? 580 : 360;
  });
  const paceSec = parsePace(paceText);
  const paceValid = !Number.isNaN(paceSec);
  const effectivePaceSec = paceValid ? paceSec : lastValidPaceSec;
  // Entered pace is in the active unit; the engine always takes sec/km.
  const enginePaceSecPerKm =
    units === "imperial" ? effectivePaceSec / KM_PER_MI : effectivePaceSec;

  function handlePaceChange(text: string) {
    setPaceText(text);
    const sec = parsePace(text);
    if (!Number.isNaN(sec)) setLastValidPaceSec(sec);
  }

  function switchUnits(next: Units) {
    if (next === units) return;
    setUnits(next);
    try {
      localStorage.setItem("gp-units", next);
    } catch {
      /* storage unavailable — the toggle still works for this session */
    }
    // Convert the pace field so the physical pace stays the same
    // (6:00/km ↔ 9:39/mi), instead of silently reinterpreting the number.
    const converted = Math.round(
      next === "imperial"
        ? effectivePaceSec * KM_PER_MI
        : effectivePaceSec / KM_PER_MI,
    );
    setPaceText(fmtPace(converted));
    setLastValidPaceSec(converted);
    trackEvent("switch-units", { to: next });
  }

  // Display helpers for the active unit — data underneath stays metric.
  const distStr = (km: number) =>
    units === "imperial"
      ? `${(km / KM_PER_MI).toFixed(2)} mi`
      : `${km.toFixed(2)} km`;
  const gainStr = (m: number) =>
    units === "imperial"
      ? `${Math.round(m * FT_PER_M)} ft`
      : `${m.toFixed(0)} m`;
  const paceStr = (secPerKm: number) =>
    units === "imperial"
      ? `${fmtPace(secPerKm * KM_PER_MI)}/mi`
      : `${fmtPace(secPerKm)}/km`;
  const bucketMeters = units === "imperial" ? MILE_M : 1000;
  const bucketKm = bucketMeters / 1000;

  // Fit the terrain factor against a recorded run: run the forward model (at
  // ×1.00) over THAT run's course with the current pace inputs, then divide the
  // run's actual MOVING time by the prediction. The fit deliberately uses the
  // raw points for timing and the resampled geometry for prediction — same
  // discipline as the engine (see calibrateTerrainFactor).
  function handleCalibFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setCalibError(null);
    setCalib(null);
    file
      .text()
      .then((text) => {
        const points = parseGpx(text);
        const resampled = resampleEven(
          points,
          cumulativeDistances(points),
          RESAMPLE_INTERVAL_M,
        );
        const dists = resampled.dists;
        const grades = gradients(
          smoothElevationByDistance(resampled.points, dists, SMOOTH_WINDOW_M),
          dists,
        );
        const factor = calibrateTerrainFactor(
          points,
          dists,
          grades,
          enginePaceSecPerKm,
          Math.max(1, vam),
          hikeAbovePct / 100,
        );
        if (factor === null) {
          setCalibError(
            "This GPX has no timestamps — it looks like a planned route, not a recorded run. Export the recorded activity (Strava, Garmin, COROS…) instead.",
          );
          trackEvent("calibrate-error", { code: "no-time" });
          return;
        }
        const movingSec = movingTimeSec(points)!;
        const elapsedSec = actualSegmentTimes(points)!.reduce(
          (sum, t) => sum + t,
          0,
        );
        setCalib({
          fileName: file.name,
          factor,
          distanceKm: dists[dists.length - 1] / 1000,
          movingSec,
          elapsedSec,
          predictedSec: movingSec / factor,
        });
        trackEvent("calibrate-run", { factor: Number(factor.toFixed(3)) });
      })
      .catch((err) => {
        setCalibError(
          err instanceof GpxError
            ? GPX_ERROR_MESSAGE[err.code]
            : "Couldn't read this file. Please try a different GPX.",
        );
        trackEvent("calibrate-error", {
          code: err instanceof GpxError ? err.code : "other",
        });
        console.error(err);
      });
  }

  function applyCalibration() {
    if (!calib) return;
    // Keep the applied value inside the slider's range; the raw measurement
    // stays visible in the result line either way.
    const clamped = Math.min(1.6, Math.max(0.8, calib.factor));
    setTerrainFactor(Math.round(clamped * 100) / 100);
    setCalibrated(true);
    trackEvent("calibrate-apply", { factor: Number(calib.factor.toFixed(2)) });
  }

  // Run any GPX text through the pipeline and reflect the result (or a friendly
  // error) in state. Shared by file upload and the bundled example so both take
  // the exact same path. `genericMsg` is the fallback for non-GpxError failures.
  // `source` labels the analytics events three ways — the first-visit auto-load
  // fires for every visitor, so merging it with the example *click* would drown
  // the intent signal. On auto failure we also stay silent (no error banner):
  // the visitor did nothing, so they shouldn't see a failure they can't explain —
  // they just get the normal empty state.
  function loadGpx(
    textPromise: Promise<string>,
    genericMsg: string,
    source: "upload" | "example" | "auto",
  ) {
    setError(null);
    textPromise
      .then((text) => {
        setTrack(buildTrack(text));
        setFromExample(source !== "upload");
        trackEvent(
          { upload: "upload-gpx", example: "load-example", auto: "auto-example" }[
            source
          ],
        );
      })
      .catch((err) => {
        // Map known parse failures to friendly inline copy; anything else gets a
        // generic message so the upload never crashes the page.
        setTrack(null);
        if (source !== "auto") {
          setError(
            err instanceof GpxError ? GPX_ERROR_MESSAGE[err.code] : genericMsg,
          );
        }
        // The error code tells us WHICH failure users actually hit in the wild
        // (e.g. how many bring route-only GPX files) — that data decides whether
        // rtept support is worth building.
        trackEvent("gpx-error", {
          source,
          code: err instanceof GpxError ? err.code : "other",
        });
        console.error(err);
      });
  }

  // Shared by the file input and drag-and-drop — one path for user uploads.
  function loadUserFile(file: File) {
    setTitle(titleFromFilename(file.name));
    loadGpx(
      file.text(),
      "Couldn't read this file. Please try a different GPX.",
      "upload",
    );
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) loadUserFile(file);
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (!/\.gpx$/i.test(file.name)) {
      setError("That doesn't look like a .gpx file — drop a GPX export.");
      return;
    }
    loadUserFile(file);
  }

  // Fetch the bundled course. The GPX is fetched (not import-bundled) so it
  // never weighs on the JS bundle; BASE_URL keeps the path correct under any
  // Vite base/deploy subpath.
  function loadExample(source: "example" | "auto" = "example") {
    setTitle("Imperial Trail");
    loadGpx(
      fetch(`${import.meta.env.BASE_URL}example-imperial-trail.gpx`).then(
        (res) => {
          if (!res.ok) throw new Error(`example fetch failed: ${res.status}`);
          return res.text();
        },
      ),
      "Couldn't load the example course. Please try again.",
      source,
    );
  }

  // First visit: open on the full dashboard (the example course) instead of an
  // empty page — most visitors arrive from a link on a phone with no GPX file,
  // so the example IS the demo. Ref-guarded so StrictMode's double-mount in dev
  // doesn't fetch twice.
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (autoLoaded.current) return;
    autoLoaded.current = true;
    loadExample("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);

  // Derive the plan from the parsed track + the effort inputs, so editing a
  // field recomputes without re-uploading. Cheap enough to run every render.
  const splits: Split[] = track
    ? computeSplits(
        track.distances,
        track.grades,
        enginePaceSecPerKm,
        Math.max(1, vam),
        hikeAbovePct / 100,
        terrainFactor,
        bucketMeters,
      )
    : [];
  const timeSec = splits.length ? splits[splits.length - 1].elapsedSec : 0;
  // Honest range around the central estimate; calibration narrows the band.
  const range = finishRange(timeSec, calibrated);
  // How much of the course the plan walks — the header's whole promise, so it
  // gets its own stat card (and feeds the share image).
  const hikeMeters = splits.reduce(
    (sum, s) => sum + s.hikeFraction * s.distanceKm * 1000,
    0,
  );
  const hikePct =
    track && track.distanceKm > 0
      ? (hikeMeters / (track.distanceKm * 1000)) * 100
      : 0;

  // Render the current plan to a branded PNG and share it (native share sheet
  // when available, e.g. mobile) or download it. Every shared card carries the
  // GradePace mark + site URL — the growth loop.
  async function handleShare() {
    if (!track || !splits.length) return;
    setSharing(true);
    setShareError(null);
    try {
      const totalKm = track.distanceKm;
      const data: ShareCardData = {
        title: title.trim() || "Race plan",
        distanceKm: track.distanceKm,
        gainM: track.gainM,
        timeSec,
        rangeLowSec: range.lowSec,
        rangeHighSec: range.highSec,
        hikePct,
        avgPaceSecPerKm: totalKm > 0 ? timeSec / totalKm : 0,
        profile: track.profile,
        siteUrl: window.location.host,
        units,
        hikeAboveGrade: hikeAbovePct / 100,
      };
      const blob = await svgToPng(buildShareCardSvg(data), 1200, 630);
      const file = new File([blob], "gradepace-plan.png", {
        type: "image/png",
      });
      const shareData = {
        files: [file],
        title: `${data.title} — GradePace`,
        text: `My ${data.title} race plan — built with GradePace`,
      };
      if (navigator.canShare?.(shareData)) {
        // Fires only if share() resolves — dismissing the sheet throws
        // AbortError and skips this, so the count is real shares.
        await navigator.share(shareData);
        trackEvent("share-image", { method: "native" });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "gradepace-plan.png";
        a.click();
        URL.revokeObjectURL(url);
        trackEvent("share-image", { method: "download" });
      }
    } catch (err) {
      // The user dismissing the native share sheet is not an error.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error(err);
        setShareError("Couldn't create the share image. Please try again.");
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    // The whole section is a drop target: dragging a GPX anywhere onto the
    // page content loads it, no need to aim for the file input.
    <div onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".gpx"
          onChange={handleFile}
          aria-label="Upload a course GPX file"
          className="block text-sm text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-600 file:px-4 file:py-2 file:font-medium file:text-white hover:file:bg-emerald-500"
        />
        {/* Pointless while the example is already on screen; reappears after a
            user upload as the way back. */}
        {!(track && fromExample) && (
          <button
            type="button"
            onClick={() => loadExample()}
            className="rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-emerald-500 hover:text-white"
          >
            Back to the example
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Or drop a .gpx anywhere — parsed in your browser, never uploaded.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          {error}
        </div>
      )}

      {track && (
        <div className="mt-8 space-y-6">
          {fromExample && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-emerald-300">
                Example
              </span>
              <span className="text-zinc-400">
                Imperial Trail, Fontainebleau (70k) — upload yours to plan
                your race.
              </span>
            </div>
          )}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Your pace
              </h2>
              <div className="flex overflow-hidden rounded-md border border-zinc-700 text-xs">
                {(["metric", "imperial"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => switchUnits(u)}
                    className={`px-2.5 py-1 font-medium ${
                      units === u
                        ? "bg-emerald-600 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {u === "metric" ? "km" : "mi"}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3">
              <Field
                label="Your easy flat-road pace"
                hint={`min/${units === "imperial" ? "mile" : "km"}, a pace you could hold for hours on flat ground`}
              >
                <input
                  value={paceText}
                  onChange={(e) => handlePaceChange(e.target.value)}
                  aria-invalid={!paceValid}
                  className={`${inputClass} ${paceValid ? "" : "border-rose-500 focus:border-rose-500"}`}
                />
                {!paceValid && (
                  <span className="text-xs text-rose-400">
                    Enter a pace like {units === "imperial" ? "9:40" : "6:30"}{" "}
                    — still using {fmtPace(effectivePaceSec)}/
                    {units === "imperial" ? "mi" : "km"}.
                  </span>
                )}
              </Field>
            </div>

            {/* Jargon controls tucked away — the default view needs none of them.
                Native <details> keeps it collapsed on load with no extra state. */}
            <details className="mt-4 border-t border-zinc-800 pt-3">
              <summary className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-200">
                Advanced settings
              </summary>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-4">
                <SliderField
                  label="Uphill hiking speed"
                  hint={`how fast you climb when power-hiking, in vertical ${units === "imperial" ? "feet" : "metres"} per hour`}
                  display={
                    units === "imperial"
                      ? `${Math.round(vam * FT_PER_M)} ft/h`
                      : `${vam} m/h`
                  }
                  value={vam}
                  min={300}
                  max={1200}
                  step={50}
                  onChange={setVam}
                />
                <SliderField
                  label="Switch to hiking when steeper than"
                  hint="above this steepness, the plan walks instead of runs"
                  display={`${hikeAbovePct}%`}
                  value={hikeAbovePct}
                  min={5}
                  max={40}
                  step={1}
                  onChange={setHikeAbovePct}
                />
                <SliderField
                  label="Terrain slowdown"
                  hint="extra time for technical or rough ground (×1.00 = none; below = faster than the model). Best measured, not guessed — see “Calibrate from a real run”."
                  display={`×${terrainFactor.toFixed(2)}`}
                  value={terrainFactor}
                  min={0.8}
                  max={1.6}
                  step={0.01}
                  onChange={(n) => {
                    setTerrainFactor(n);
                    setCalibrated(false); // hand-set = a guess again → wide band
                  }}
                />
              </div>
            </details>
          </div>

          {/* Self-calibration: measure the terrain factor from a recorded run
              instead of guessing the slider. Collapsed by default — it's a
              power feature and the expanded paragraph was landing-page
              clutter for first-time visitors. */}
          <details className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200">
              Calibrate from a real run
              <span className="ml-2 font-normal normal-case tracking-normal text-zinc-500">
                {calibrated
                  ? `· applied ×${terrainFactor.toFixed(2)}`
                  : "· measure your terrain factor"}
              </span>
            </summary>
            <p className="mt-3 text-sm text-zinc-400">
              Upload a run you <span className="text-zinc-200">recorded</span>{" "}
              (with timestamps). We compare it against the model — stops
              filtered out — and measure your personal terrain factor.
            </p>
            <input
              type="file"
              accept=".gpx"
              onChange={handleCalibFile}
              aria-label="Upload a recorded run GPX for calibration"
              className="mt-3 block text-sm text-zinc-400 file:mr-3 file:rounded-md file:border file:border-zinc-600 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-200 hover:file:border-emerald-500"
            />
            {calibError && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
              >
                {calibError}
              </div>
            )}
            {calib && (
              <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2.5 text-sm text-zinc-300">
                <p>
                  <span className="font-medium text-zinc-100">
                    {calib.fileName}
                  </span>{" "}
                  — {distStr(calib.distanceKm)}, moving{" "}
                  {fmtClock(calib.movingSec)}
                  {calib.elapsedSec - calib.movingSec >= 60 &&
                    ` (${fmtClock(calib.elapsedSec)} on the clock — stops removed)`}
                  . The model at ×1.00 predicts {fmtClock(calib.predictedSec)},
                  so your measured terrain factor is{" "}
                  <span className="font-semibold text-emerald-400">
                    ×{calib.factor.toFixed(2)}
                  </span>
                  .
                </p>
                {/* Outside the plausible band the number isn't measuring
                    terrain (synthetic route timestamps, a walked outing, a
                    badly wrong flat pace) — warn and offer NO apply button
                    rather than apply a knowingly bogus value. */}
                {calib.factor < FACTOR_PLAUSIBLE_MIN ||
                calib.factor > FACTOR_PLAUSIBLE_MAX ? (
                  <p className="mt-2 text-amber-300">
                    That number looks implausible for a run, so it can't be
                    applied. Check that this is a genuinely recorded activity —
                    route exports often carry estimated timestamps — and that
                    the flat pace above matches the shape you were in that day.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={applyCalibration}
                    className="mt-2 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
                  >
                    Use ×{calib.factor.toFixed(2)} for this plan
                  </button>
                )}
              </div>
            )}
          </details>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            {/* Fixed-height fallback so the layout doesn't jump when the
                chart chunk arrives. */}
            <Suspense fallback={<div className="h-40" />}>
              <ElevationChart
                profile={track.profile}
                units={units}
                hikeAboveGrade={hikeAbovePct / 100}
              />
            </Suspense>
            {/* Names the colors — "power-hike" appears right where you look
                for it, on the profile itself. */}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
              {GRADE_LEGEND.map((g) => (
                <span key={g.label} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: g.color }}
                  />
                  {g.label}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Distance" value={distStr(track.distanceKm)} />
            <StatCard label="Elevation gain" value={gainStr(track.gainM)} />
            {/* The header's promise, quantified: how much of this course the
                plan walks instead of pretending you'll run it. */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="text-xs uppercase tracking-wider text-zinc-400">
                Power-hike
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {distStr(hikeMeters / 1000)}
              </div>
              <div className="mt-0.5 text-sm tabular-nums text-zinc-400">
                {hikePct < 10 ? hikePct.toFixed(1) : hikePct.toFixed(0)}% of
                the course walked
              </div>
            </div>
            {/* The range IS the product thesis: a to-the-second finish would
                be false precision. Center = the model's central estimate. */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="text-xs uppercase tracking-wider text-zinc-400">
                Projected finish
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {fmtClock(timeSec)}
              </div>
              <div className="mt-0.5 text-sm tabular-nums text-zinc-400">
                expect {fmtClockShort(range.lowSec)} –{" "}
                {fmtClockShort(range.highSec)}
                {calibrated && (
                  <span className="text-emerald-400"> · calibrated</span>
                )}
              </div>
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            A range, not a promise — day-of conditions swing a long race by
            20–40 min. Calibrating narrows it.
          </p>

          {/* Share/export: render the plan to a branded PNG. The course name
              feeds the image title; siteUrl is taken at runtime so the
              watermark is correct on any domain. */}
          {/* Compact one-row share bar — the button label says what it does,
              so no explainer paragraph. */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Course name"
                aria-label="Course name for the share image"
                className="min-w-[12rem] flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sharing ? "Creating image…" : "Share image"}
              </button>
              <button
                type="button"
                onClick={handleCopyLink}
                className="rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-emerald-500 hover:text-white"
              >
                {linkCopied ? "Copied ✓" : "Copy link"}
              </button>
            </div>
            {shareError && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
              >
                {shareError}
              </div>
            )}
          </div>

          {/* On a phone six columns can't fit; let the table keep a readable
              min-width and scroll horizontally inside its own box so the page
              layout never breaks. */}
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-700 text-xs uppercase tracking-wider text-zinc-400">
                  <th className="py-2 pr-4 text-left font-medium">
                    {units === "imperial" ? "mi" : "km"}
                  </th>
                  <th className="py-2 pr-4 text-right font-medium">grade</th>
                  <th className="py-2 pr-4 text-right font-medium">D+</th>
                  <th className="py-2 pr-4 text-right font-medium">hike</th>
                  <th className="py-2 pr-4 text-right font-medium">pace</th>
                  <th className="py-2 text-right font-medium">elapsed</th>
                </tr>
              </thead>
              <tbody>
                {(showAllSplits ? splits : splits.slice(0, 12)).map((s) => (
                  <tr
                    key={s.km}
                    className="border-b border-zinc-800/70 tabular-nums text-zinc-200 hover:bg-zinc-900/40"
                  >
                    <td className="py-1.5 pr-4">
                      {s.km}
                      {s.distanceKm < bucketKm * 0.95
                        ? ` (${(units === "imperial" ? s.distanceKm / KM_PER_MI : s.distanceKm).toFixed(2)})`
                        : ""}
                    </td>
                    <td
                      className={`py-1.5 pr-4 text-right ${gradeClass(s.grade)}`}
                    >
                      {fmtGrade(s.grade)}
                    </td>
                    <td className="py-1.5 pr-4 text-right">
                      {gainStr(s.gainM)}
                    </td>
                    <td className="py-1.5 pr-4 text-right">
                      {s.hikeFraction > 0 ? (
                        <span className="text-emerald-400">
                          {(s.hikeFraction * 100).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-4 text-right">
                      {paceStr(s.paceSecPerKm)}
                    </td>
                    <td className="py-1.5 text-right">
                      {fmtClock(s.elapsedSec)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {splits.length > 12 && (
              <button
                type="button"
                onClick={() => setShowAllSplits((v) => !v)}
                className="mt-3 w-full rounded-md border border-zinc-800 py-2 text-sm text-zinc-400 hover:border-emerald-500 hover:text-zinc-200"
              >
                {showAllSplits
                  ? "Show fewer"
                  : `Show all ${splits.length} splits`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight">GradePace</h1>
        <p className="mt-2 text-zinc-300">
          Most pace planners assume you run every hill. You don't — GradePace
          plans the power-hikes too, from your course GPX.
        </p>
        <div className="mt-6">
          <GpxUpload />
        </div>
        <footer className="mt-14 border-t border-zinc-800 pt-6 text-sm text-zinc-500">
          <p>
            Built by{" "}
            <a
              href="https://x.com/AlvaroSerero"
              target="_blank"
              rel="noopener noreferrer"
              data-umami-event="click-x"
              className="font-medium text-zinc-300 underline decoration-zinc-600 underline-offset-2 hover:text-emerald-400"
            >
              Alvaro Serero
            </a>{" "}
            while training for the Imperial Trail 70k, Fontainebleau —{" "}
            <a
              href="https://github.com/Alvaro5/trail-app"
              target="_blank"
              rel="noopener noreferrer"
              data-umami-event="click-github"
              className="font-medium text-zinc-300 underline decoration-zinc-600 underline-offset-2 hover:text-emerald-400"
            >
              open source on GitHub
            </a>
            .
          </p>
        </footer>
      </div>
    </main>
  );
}

export default App;
