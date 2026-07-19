import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Recharts is ~500 kB — by far the heaviest dependency — so the chart loads as
// its own async chunk and never blocks first paint. Same for Leaflet.
const ElevationChart = lazy(() => import("./ElevationChart"));
const CourseMap = lazy(() => import("./CourseMap"));
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
  median,
  finishRange,
  parseGpxWaypoints,
  nearestTrackKm,
  GpxError,
  type GpxErrorCode,
  type Split,
} from "./lib/pacing";
import { fmtClock, fmtClockShort, fmtPace } from "./lib/format";
import { GRADE_LEGEND } from "./lib/gradeColor";
import { MESSAGES, initialLang, type Lang, type Messages } from "./lib/i18n";
// Aliased: `track` is taken by the parsed-GPX state variable in GpxUpload.
import { track as trackEvent } from "./lib/analytics";
import { buildShareCardSvg, type ShareCardData } from "./lib/shareCard";
import { svgToPng } from "./lib/rasterize";
import {
  SunIcon,
  MoonIcon,
  UploadIcon,
  ExpandIcon,
  CloseIcon,
  ChevronIcon,
  ImageIcon,
  LinkIcon,
  CheckIcon,
  LogoMark,
} from "./icons";

// Friendly, distinct copy for each parse failure, in the active language.
function gpxErrorMsg(t: Messages, code: GpxErrorCode): string {
  return {
    invalid: t.errInvalid,
    "no-track": t.errNoTrack,
    "too-few": t.errTooFew,
    "no-elevation": t.errNoElevation,
  }[code];
}

// Elevation-processing length scales (see STATUS.md / the research notes).
const RESAMPLE_INTERVAL_M = 10; // even spacing that kills Δdist gradient spikes
const SMOOTH_WINDOW_M = 30; // physical low-pass; keep ≥ ~3× the resample interval
const D_PLUS_THRESHOLD_M = 5; // hysteresis deadband for D+ (noise floor; 0 = naive sum)

// Uncalibrated default terrain factor. ×1.04 is the MEDIAN measured across
// the project's four calibrated real runs (owner decision, 2026-07: pure
// Minetti at ×1.00 flatters everyone; the measured median is the honest
// cold-start default). Calibrating replaces it with a personal value.
const DEFAULT_TERRAIN_FACTOR = 1.04;

// The bundled demo courses. Imperial is the auto-loaded default (the owner's
// race); 25 Bosses is the steep showcase — 42% of its distance is >12% grade,
// so the power-hike planning actually shows. Both are course geometry only
// (no timestamps), served from public/ and fetched lazily.
const EXAMPLES = {
  imperial: { file: "example-imperial-trail.gpx", title: "Imperial Trail" },
  bosses: { file: "example-25-bosses.gpx", title: "25 Bosses" },
} as const;
type ExampleKey = keyof typeof EXAMPLES;

// One processed calibration run. The geometry (dists/grades) is kept so the
// factor can be RE-DERIVED from the current effort inputs on every render —
// upload a run once and its fit follows your pace/VAM/gate instead of going
// stale. Only movingSec/elapsedSec are fixed at upload: timing is ground
// truth and never depends on the inputs. Memory cost is two float arrays per
// run (~1–7k entries) — negligible for the handful of runs this holds.
type CalibRun = {
  id: number;
  fileName: string;
  dateMs: number | null; // first timestamp, so the list can show run dates
  movingSec: number; // stops filtered out
  elapsedSec: number; // raw clock time
  dists: number[];
  grades: number[];
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
  coords: { lat: number; lon: number }[]; // resampled positions, for the map
  // Aid-station km auto-detected from the file's <wpt> waypoints (usually
  // empty — most route exports carry none). Pre-fills the ravitaillements
  // field; always user-editable afterwards.
  fileAidKms: number[];
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
  const totalKm = distances[distances.length - 1] / 1000;
  // File waypoints → course km, dropping anything off-course (>200 m away)
  // or within 200 m of the start/finish (départ/arrivée markers, not aid).
  const fileAidKms = [
    ...new Set(
      parseGpxWaypoints(text)
        .map((w) => nearestTrackKm(resampled.points, distances, w.lat, w.lon))
        .filter(
          (k): k is number => k !== null && k > 0.2 && k < totalKm - 0.2,
        )
        .map((k) => +k.toFixed(1)),
    ),
  ].sort((a, b) => a - b);
  return {
    distances,
    grades,
    distanceKm: totalKm,
    gainM: cumulativeGain(
      smoothed.map((p) => p.ele),
      D_PLUS_THRESHOLD_M,
    ),
    profile: smoothed.map((p, i) => ({
      km: distances[i] / 1000,
      ele: p.ele,
    })),
    coords: resampled.points.map((p) => ({ lat: p.lat, lon: p.lon })),
    fileAidKms,
  };
}

const fmtGrade = (g: number) => `${g > 0 ? "+" : ""}${(g * 100).toFixed(0)}%`;

const gradeClass = (g: number) =>
  g > 0.005
    ? "text-rose-400 light:text-rose-600"
    : g < -0.005
      ? "text-sky-400 light:text-sky-600"
      : "text-zinc-400 light:text-zinc-500";

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

// Dark is the brand default; light is opt-in (class on <html>, see index.css).
type Theme = "dark" | "light";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("gp-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* fall through to the system preference */
  }
  return window.matchMedia?.("(prefers-color-scheme: light)")?.matches
    ? "light"
    : "dark";
}

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
  rav?: number[]; // aid-station positions, metric km (canonical in the hash)
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
    const rav = p.get("rav");
    if (rav) {
      const kms = rav
        .split(",")
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0 && n < 1000)
        .slice(0, 30);
      if (kms.length) plan.rav = kms;
    }
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

// Shared class fragments — each carries its dark default + light override so
// the two themes can't drift apart per-instance, plus the same transition +
// focus treatment so every interactive element feels like one system.
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";
const cardClass =
  "rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 light:border-zinc-200 light:bg-white";
// The projected-finish card is the hero number — it alone gets the accent.
const heroCardClass =
  "rounded-xl border border-emerald-600/40 bg-zinc-900/50 p-4 light:border-emerald-500/40 light:bg-white";
const inputClass =
  "w-28 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-100 tabular-nums transition-colors focus:border-emerald-500 focus:outline-none light:border-zinc-300 light:bg-white light:text-zinc-900";
const btnPrimaryClass = `inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;
const btnSecondaryClass = `inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-emerald-500 hover:text-white active:scale-[0.98] light:border-zinc-300 light:bg-white light:text-zinc-700 light:hover:text-emerald-700 ${focusRing}`;
const alertClass =
  "rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 light:text-amber-800";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={cardClass}>
      <div className="text-xs uppercase tracking-wider text-zinc-400 light:text-zinc-500">
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
      <span className="text-zinc-300 light:text-zinc-700">{label}</span>
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
    <label className="flex w-full min-w-0 flex-col gap-1 text-sm">
      <span className="flex justify-between text-zinc-300 light:text-zinc-700">
        <span>{label}</span>
        <span className="tabular-nums text-zinc-200 light:text-zinc-800">
          {display}
        </span>
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

function GpxUpload({
  t,
  lang,
  theme,
}: {
  t: Messages;
  lang: Lang;
  theme: Theme;
}) {
  const [track, setTrack] = useState<Track | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A shared-plan link overrides the defaults for every effort input below.
  const [hashPlan] = useState(readPlanFromHash);
  const [units, setUnits] = useState<Units>(
    () => hashPlan.units ?? initialUnits(),
  );
  // A sensible easy default in the active unit (6:00/km ≈ 9:39/mi).
  const [paceText, setPaceText] = useState(
    hashPlan.pace ?? (units === "imperial" ? "9:40" : "6:00"),
  );
  const [vam, setVam] = useState(hashPlan.vam ?? 750);
  const [hikeAbovePct, setHikeAbovePct] = useState(hashPlan.gate ?? 18);
  const [terrainFactor, setTerrainFactor] = useState(
    hashPlan.tf ?? DEFAULT_TERRAIN_FACTOR,
  );
  // Course name shown on the shareable image; prefilled on load, editable.
  const [title, setTitle] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  // The full table is ~70 rows for a 70k — collapsed by default so the page
  // ends near the stats instead of scrolling forever.
  const [showAllSplits, setShowAllSplits] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // Fullscreen overlays — the inline views are deliberately compact, these
  // are the "actually study the course" modes.
  const [chartZoom, setChartZoom] = useState(false);
  const [mapZoom, setMapZoom] = useState(false);
  // Chart→map hover bridge, deliberately IMPERATIVE: pointer-moves happen at
  // 60+ Hz, and routing them through React state re-rendered the whole
  // dashboard per move — which rebuilt the chart's data and made its tooltip
  // stutter. The chart instead calls straight into the map's marker-mover;
  // React never hears about a hover.
  const hoverFnRef = useRef<((km: number | null) => void) | null>(null);
  const onHoverKm = (km: number | null) => hoverFnRef.current?.(km);
  const registerHoverTarget = useCallback(
    (fn: ((km: number | null) => void) | null) => {
      hoverFnRef.current = fn;
    },
    [],
  );
  // Effort sliders: always visible on desktop (lg), toggled below that.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Aid stations ("ravitaillements") as free text in the ACTIVE unit —
  // "17, 33, 47". Parsed leniently every render; the hash stores metric km.
  const [aidText, setAidText] = useState(() => {
    if (!hashPlan.rav?.length) return "";
    const vals =
      (hashPlan.units ?? initialUnits()) === "imperial"
        ? hashPlan.rav.map((k) => +(k / KM_PER_MI).toFixed(1))
        : hashPlan.rav.map((k) => +k.toFixed(1));
    return vals.join(", ");
  });

  const parseAidText = (text: string) =>
    text
      .split(/[,;\s]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);

  useEffect(() => {
    if (!chartZoom && !mapZoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setChartZoom(false);
        setMapZoom(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chartZoom, mapZoom]);

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
    // Stations travel with the plan, canonically in metric km.
    const aidNums = parseAidText(aidText);
    if (aidNums.length) {
      const kms =
        units === "imperial" ? aidNums.map((v) => v * KM_PER_MI) : aidNums;
      params.set("rav", kms.map((k) => +k.toFixed(1)).join(","));
    }
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
      setShareError(t.copyFallback);
    }
  }
  // Which bundled example the dashboard currently shows (null = user upload),
  // so it's badged honestly and the example switcher hides the active one.
  const [exampleShown, setExampleShown] = useState<ExampleKey | null>(null);
  const [calibRuns, setCalibRuns] = useState<CalibRun[]>([]);
  const [calibError, setCalibError] = useState<string | null>(null);
  const calibId = useRef(0);
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
    // Aid-station positions follow too (they're typed in the active unit).
    const aidNums = parseAidText(aidText);
    if (aidNums.length) {
      const conv =
        next === "imperial"
          ? aidNums.map((v) => v / KM_PER_MI)
          : aidNums.map((v) => v * KM_PER_MI);
      setAidText(conv.map((v) => +v.toFixed(1)).join(", "));
    }
    trackEvent("switch-units", { to: next });
  }

  // Display helpers for the active unit — data underneath stays metric.
  // Thousands separators follow the UI language (1,193 ft / 1 193 ft).
  const numLocale = lang === "fr" ? "fr-FR" : "en-US";
  const distStr = (km: number) =>
    units === "imperial"
      ? `${(km / KM_PER_MI).toFixed(2)} mi`
      : `${km.toFixed(2)} km`;
  const gainStr = (m: number) =>
    units === "imperial"
      ? `${Math.round(m * FT_PER_M).toLocaleString(numLocale)} ft`
      : `${Math.round(m).toLocaleString(numLocale)} m`;
  const paceStr = (secPerKm: number) =>
    units === "imperial"
      ? `${fmtPace(secPerKm * KM_PER_MI)}/mi`
      : `${fmtPace(secPerKm)}/km`;
  const bucketMeters = units === "imperial" ? MILE_M : 1000;
  const bucketKm = bucketMeters / 1000;

  // Every stored run's factor, re-derived from the CURRENT inputs: predicted
  // time at terrain ×1.00 over that run's course, actual moving time on top.
  // A handful of computeSplits calls per render is a few ms — the payoff is
  // that fits can never go stale when the pace/VAM/gate change.
  const calibFits = calibRuns.map((run) => {
    const predicted = computeSplits(
      run.dists,
      run.grades,
      enginePaceSecPerKm,
      Math.max(1, vam),
      hikeAbovePct / 100,
      1,
    );
    const predictedSec = predicted.length
      ? predicted[predicted.length - 1].elapsedSec
      : 0;
    const factor = predictedSec > 0 ? run.movingSec / predictedSec : null;
    const plausible =
      factor !== null &&
      factor >= FACTOR_PLAUSIBLE_MIN &&
      factor <= FACTOR_PLAUSIBLE_MAX;
    return { run, factor, plausible };
  });
  const plausibleFactors = calibFits
    .filter((f) => f.plausible)
    .map((f) => f.factor!);
  // Median, not mean: 2–4 samples with one synthetic-timestamp file or one
  // terrible day shouldn't drag the applied value.
  const medianFactor = median(plausibleFactors);

  function applyCalibration() {
    if (medianFactor === null) return;
    // Keep the applied value inside the slider's range; the raw measurements
    // stay visible in the run list either way.
    const clamped = Math.min(1.6, Math.max(0.8, medianFactor));
    setTerrainFactor(Math.round(clamped * 100) / 100);
    setCalibrated(true);
    trackEvent("calibrate-apply", {
      factor: Number(medianFactor.toFixed(2)),
      runs: plausibleFactors.length,
    });
  }

  // Ingest one or several recorded runs. Per file: parse, take the MOVING
  // time from the raw timed points (ground truth, fixed forever), and keep
  // the resampled geometry so the fit itself can be re-derived from whatever
  // the effort inputs currently say (see CalibRun). Files that fail — no
  // timestamps, unreadable — are reported by name without blocking the rest.
  function handleCalibFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // allow re-picking the same file later
    if (!files.length) return;
    setCalibError(null);
    Promise.all(
      files.map(async (file) => {
        try {
          const points = parseGpx(await file.text());
          const movingSec = movingTimeSec(points);
          if (movingSec === null || movingSec === 0) {
            trackEvent("calibrate-error", { code: "no-time" });
            return { err: t.calibNoTime(file.name) };
          }
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
          const elapsedSec = actualSegmentTimes(points)!.reduce(
            (sum, t2) => sum + t2,
            0,
          );
          const run: CalibRun = {
            id: ++calibId.current,
            fileName: file.name,
            dateMs: points[0].time ?? null,
            movingSec,
            elapsedSec,
            dists,
            grades,
          };
          return { run };
        } catch (err) {
          console.error(err);
          trackEvent("calibrate-error", {
            code: err instanceof GpxError ? err.code : "other",
          });
          return {
            err:
              err instanceof GpxError
                ? `${file.name}: ${gpxErrorMsg(t, err.code)}`
                : t.calibUnreadable(file.name),
          };
        }
      }),
    ).then((results) => {
      const runs = results.flatMap((r) => ("run" in r && r.run ? [r.run] : []));
      const errs = results.flatMap((r) => ("err" in r && r.err ? [r.err] : []));
      if (runs.length) {
        setCalibRuns((prev) => [...prev, ...runs]);
        trackEvent("calibrate-run", { count: runs.length });
      }
      if (errs.length) setCalibError(errs.join(" "));
    });
  }

  // Run any GPX text through the pipeline and reflect the result (or a friendly
  // error) in state. Shared by file upload and the bundled examples so all take
  // the exact same path. `source` labels the analytics events three ways — the
  // first-visit auto-load fires for every visitor, so merging it with the
  // example *click* would drown the intent signal. On auto failure we also stay
  // silent (no error banner): the visitor did nothing, so they shouldn't see a
  // failure they can't explain — they just get the normal empty state.
  function loadGpx(
    textPromise: Promise<string>,
    genericMsg: string,
    source: "upload" | "example" | "auto",
    exampleKey: ExampleKey | null,
  ) {
    setError(null);
    textPromise
      .then((text) => {
        const built = buildTrack(text);
        setTrack(built);
        setExampleShown(exampleKey);
        // Aid stations are course data: a new course either brings its own
        // (file waypoints → auto-fill) or invalidates the previous entries.
        // The first-visit auto-load is exempt so a shared link's stations
        // (hash `rav`) survive landing on the example.
        if (built.fileAidKms.length) {
          setAidText(
            built.fileAidKms
              .map((k) =>
                units === "imperial" ? +(k / KM_PER_MI).toFixed(1) : k,
              )
              .join(", "),
          );
          trackEvent("aid-autofill", { count: built.fileAidKms.length });
        } else if (source !== "auto") {
          setAidText("");
        }
        trackEvent(
          {
            upload: "upload-gpx",
            example: "load-example",
            auto: "auto-example",
          }[source],
          exampleKey ? { course: exampleKey } : undefined,
        );
      })
      .catch((err) => {
        // Map known parse failures to friendly inline copy; anything else gets a
        // generic message so the upload never crashes the page.
        setTrack(null);
        if (source !== "auto") {
          setError(
            err instanceof GpxError ? gpxErrorMsg(t, err.code) : genericMsg,
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
    loadGpx(file.text(), t.errGeneric, "upload", null);
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
      setError(t.errNotGpx);
      return;
    }
    loadUserFile(file);
  }

  // Fetch a bundled course. The GPX is fetched (not import-bundled) so it
  // never weighs on the JS bundle; BASE_URL keeps the path correct under any
  // Vite base/deploy subpath.
  function loadExample(key: ExampleKey, source: "example" | "auto" = "example") {
    setTitle(EXAMPLES[key].title);
    loadGpx(
      fetch(`${import.meta.env.BASE_URL}${EXAMPLES[key].file}`).then((res) => {
        if (!res.ok) throw new Error(`example fetch failed: ${res.status}`);
        return res.text();
      }),
      t.errExample,
      source,
      key,
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
    loadExample("imperial", "auto");
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

  // The plan's pace for the split containing a given course km — lets the
  // chart tooltip answer "what will I be doing HERE", not just "how high is
  // this point".
  const paceLabelAt = (kmMetric: number): string | null => {
    if (!splits.length) return null;
    const idx = Math.min(
      Math.floor((kmMetric * 1000) / bucketMeters),
      splits.length - 1,
    );
    return paceStr(splits[idx].paceSecPerKm);
  };

  // Aid stations with projected arrival: elapsed time interpolated inside
  // the split containing each station — the plan already knows WHEN you'll
  // reach a ravitaillement, not just where it is.
  const elapsedAtKm = (km: number): number | null => {
    let prevEnd = 0;
    let prevElapsed = 0;
    for (const s of splits) {
      const end = prevEnd + s.distanceKm;
      if (km <= end) return prevElapsed + (km - prevEnd) * s.paceSecPerKm;
      prevEnd = end;
      prevElapsed = s.elapsedSec;
    }
    return null;
  };
  const aidKms = (() => {
    const raw = parseAidText(aidText);
    const kms = units === "imperial" ? raw.map((v) => v * KM_PER_MI) : raw;
    const total = track?.distanceKm ?? 0;
    return [...new Set(kms.map((k) => +k.toFixed(2)))]
      .filter((k) => k > 0 && k < total)
      .sort((a, b) => a - b)
      .slice(0, 30);
  })();
  const aidStops = aidKms
    .map((km) => ({ km, eta: elapsedAtKm(km) }))
    .filter((s): s is { km: number; eta: number } => s.eta !== null);
  // Which 1-based table bucket holds each station, for the row badges.
  const aidByBucket = new Map<number, number[]>();
  aidKms.forEach((km, i) => {
    if (!splits.length) return;
    const idx =
      Math.min(Math.floor((km * 1000) / bucketMeters), splits.length - 1) + 1;
    const list = aidByBucket.get(idx) ?? [];
    list.push(i + 1);
    aidByBucket.set(idx, list);
  });

  // Render the current plan to a branded PNG and share it (native share sheet
  // when available, e.g. mobile) or download it. Every shared card carries the
  // GradePace mark + site URL — the growth loop. The card itself is always
  // dark: a single brand surface, whatever the viewer's theme.
  async function handleShare() {
    if (!track || !splits.length) return;
    setSharing(true);
    setShareError(null);
    try {
      const totalKm = track.distanceKm;
      const data: ShareCardData = {
        title: title.trim() || t.racePlan,
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
        text: t.shareText(data.title),
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
        setShareError(t.shareFailed);
      }
    } finally {
      setSharing(false);
    }
  }

  const legendLabel: Record<string, string> = {
    descent: t.legendDescent,
    runnable: t.legendRunnable,
    climb: t.legendClimb,
    "power-hike": t.legendPowerHike,
  };
  const chartLegend = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
      {GRADE_LEGEND.map((g) => (
        <span key={g.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: g.color }}
          />
          {legendLabel[g.label]}
        </span>
      ))}
    </div>
  );
  const chartLabels = { elevation: t.elevationWord, powerHike: t.powerHikeWord };

  return (
    // The whole section is a drop target: dragging a GPX anywhere onto the
    // page content loads it, no need to aim for the file input.
    <div onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      <div className="flex flex-wrap items-center gap-3">
        {/* A styled label wrapping a visually-hidden input: the native file
            control ("Choose File / No file chosen") is unstylable AND stays
            English in the French UI. */}
        <label
          className={`${btnPrimaryClass} cursor-pointer focus-within:ring-2 focus-within:ring-emerald-500/60`}
        >
          <UploadIcon />
          {t.uploadCourse}
          <input
            type="file"
            accept=".gpx"
            onChange={handleFile}
            aria-label={t.uploadCourseAria}
            className="sr-only"
          />
        </label>
        {/* Example switcher: offer whichever bundled course isn't on screen.
            Imperial is the owner's race; 25 Bosses is the steep showcase. */}
        {(Object.keys(EXAMPLES) as ExampleKey[])
          .filter((key) => exampleShown !== key)
          .map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => loadExample(key)}
              className={btnSecondaryClass}
            >
              {key === "imperial" ? t.loadImperial : t.loadBosses}
            </button>
          ))}
      </div>
      <p className="mt-2 text-xs text-zinc-500">{t.dropHint}</p>

      {error && (
        <div role="alert" className={`mt-4 ${alertClass}`}>
          {error}
        </div>
      )}

      {track && (
        // Keyed by course so switching plans replays the entrance animation.
        <div
          key={`${track.distanceKm.toFixed(3)}-${track.gainM.toFixed(0)}`}
          className="animate-fade-up mt-8 space-y-6"
        >
          {/* Quiet editorial label, not a sticker: small emerald caps + a
              plain sentence. */}
          {exampleShown && (
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-widest text-emerald-500">
                {t.exampleBadge}
              </span>
              <span className="text-zinc-400 light:text-zinc-600">
                {exampleShown === "imperial"
                  ? t.exampleImperial
                  : t.exampleBosses}
              </span>
            </div>
          )}
          <div className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 light:text-zinc-500">
                {t.yourPace}
              </h2>
              {/* Units: labeled + aria-pressed so the switch reads as a
                  setting, not two mystery chips. */}
              <div className="flex items-center gap-2 text-xs text-zinc-400 light:text-zinc-500">
                <span className="uppercase tracking-wider">{t.unitsLabel}</span>
                <div className="flex overflow-hidden rounded-md border border-zinc-700 light:border-zinc-300">
                  {(["metric", "imperial"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => switchUnits(u)}
                      aria-pressed={units === u}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                        units === u
                          ? "bg-emerald-600 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 light:bg-white light:text-zinc-500 light:hover:text-zinc-800"
                      }`}
                    >
                      {u === "metric" ? "km" : "mi"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <Field
                label={t.paceLabel}
                hint={
                  units === "imperial" ? t.paceHintImperial : t.paceHintMetric
                }
              >
                {/* Unit suffix lives INSIDE the field — this is the app's one
                    important input, so it reads as a unit-aware control, not
                    an anonymous text box. */}
                <span className="relative inline-block w-36">
                  <input
                    value={paceText}
                    onChange={(e) => handlePaceChange(e.target.value)}
                    aria-invalid={!paceValid}
                    className={`${inputClass} w-full pr-16 text-base ${paceValid ? "" : "border-rose-500 focus:border-rose-500"}`}
                  />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
                    min/{units === "imperial" ? "mi" : "km"}
                  </span>
                </span>
                {!paceValid && (
                  <span className="text-xs text-rose-400 light:text-rose-600">
                    {t.paceInvalid(
                      units === "imperial" ? "9:40" : "6:30",
                      `${fmtPace(effectivePaceSec)}/${units === "imperial" ? "mi" : "km"}`,
                    )}
                  </span>
                )}
              </Field>
            </div>

            {/* Effort sliders: ALWAYS visible on desktop — the card had acres
                of empty space, and these are the product's actual knobs.
                Below lg they collapse behind a toggle, since on a phone they
                are jargon-y noise for a first-time visitor. */}
            <div className="mt-4 border-t border-zinc-800 pt-3 light:border-zinc-200">
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                aria-expanded={advancedOpen}
                className={`flex items-center gap-1.5 rounded text-sm text-zinc-400 transition-colors hover:text-zinc-200 light:text-zinc-600 light:hover:text-zinc-900 lg:hidden ${focusRing}`}
              >
                <ChevronIcon
                  className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-90" : ""}`}
                />
                {t.advanced}
              </button>
              <div
                className={`${advancedOpen ? "grid" : "hidden"} mt-3 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid lg:grid-cols-3`}
              >
                <SliderField
                  label={t.vamLabel}
                  hint={
                    units === "imperial" ? t.vamHintImperial : t.vamHintMetric
                  }
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
                  label={t.gateLabel}
                  hint={t.gateHint}
                  display={`${hikeAbovePct}%`}
                  value={hikeAbovePct}
                  min={5}
                  max={40}
                  step={1}
                  onChange={setHikeAbovePct}
                />
                <SliderField
                  label={t.terrainLabel}
                  hint={t.terrainHint}
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
            </div>
          </div>

          {/* Self-calibration: measure the terrain factor from recorded runs
              instead of guessing the slider. Collapsed by default — it's a
              power feature and the expanded paragraph was landing-page
              clutter for first-time visitors. */}
          <details className={cardClass}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-200 light:text-zinc-500 light:hover:text-zinc-800">
              <ChevronIcon className="chev h-3.5 w-3.5" />
              {t.calibTitle}
              <span className="ml-1 font-normal normal-case tracking-normal text-zinc-500">
                {calibrated
                  ? t.calibApplied(terrainFactor.toFixed(2))
                  : t.calibMeasure}
              </span>
            </summary>
            <p className="mt-3 text-sm text-zinc-400 light:text-zinc-600">
              {t.calibIntro}
            </p>
            <label
              className={`${btnSecondaryClass} mt-3 cursor-pointer focus-within:ring-2 focus-within:ring-emerald-500/60`}
            >
              <UploadIcon />
              {t.calibAdd}
              <input
                type="file"
                accept=".gpx"
                multiple
                onChange={handleCalibFiles}
                aria-label={t.calibUploadAria}
                className="sr-only"
              />
            </label>
            {calibError && (
              <div role="alert" className={`mt-3 ${alertClass}`}>
                {calibError}
              </div>
            )}
            {calibFits.length > 0 && (
              <div className="mt-3 space-y-2">
                {calibFits.map(({ run, factor, plausible }) => (
                  <div
                    key={run.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-sm text-zinc-300 light:border-zinc-300 light:bg-zinc-100 light:text-zinc-700"
                  >
                    <span className="font-medium text-zinc-100 light:text-zinc-900">
                      {run.fileName}
                    </span>
                    {run.dateMs !== null && (
                      <span className="text-zinc-500">
                        {new Date(run.dateMs).toLocaleDateString(
                          lang === "fr" ? "fr-FR" : "en-US",
                          { year: "numeric", month: "short" },
                        )}
                      </span>
                    )}
                    <span className="text-zinc-500">
                      {distStr(run.dists[run.dists.length - 1] / 1000)} ·{" "}
                      {t.moving} {fmtClock(run.movingSec)}
                    </span>
                    <span
                      className={`ml-auto font-semibold tabular-nums ${
                        plausible
                          ? "text-emerald-400 light:text-emerald-600"
                          : "text-amber-300 light:text-amber-700"
                      }`}
                    >
                      {factor !== null ? `×${factor.toFixed(2)}` : "—"}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setCalibRuns((prev) =>
                          prev.filter((r) => r.id !== run.id),
                        )
                      }
                      aria-label={t.removeRun(run.fileName)}
                      className={`text-zinc-500 transition-colors hover:text-zinc-200 light:hover:text-zinc-800 ${focusRing} rounded`}
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                    {/* Outside the plausible band the number isn't measuring
                        terrain (synthetic route timestamps, a walked outing,
                        a badly wrong flat pace) — keep it visible, exclude it
                        from the median. */}
                    {!plausible && (
                      <span className="w-full text-xs text-amber-300 light:text-amber-700">
                        {t.implausible}
                      </span>
                    )}
                  </div>
                ))}
                {medianFactor !== null && (
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={applyCalibration}
                      className={btnPrimaryClass}
                    >
                      {t.useFactor(
                        Math.min(1.6, Math.max(0.8, medianFactor)).toFixed(2),
                      )}
                      {plausibleFactors.length > 1
                        ? t.medianOfRuns(plausibleFactors.length)
                        : t.forThisPlan}
                    </button>
                    {plausibleFactors.length > 1 && (
                      <span className="text-xs tabular-nums text-zinc-500">
                        {t.spread} ×{Math.min(...plausibleFactors).toFixed(2)} –
                        ×{Math.max(...plausibleFactors).toFixed(2)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </details>

          {/* Course map: same grade colors as the profile (rose = the plan
              walks), aid stations with their ETAs in tooltips. Lazy chunk —
              Leaflet + tiles load after the page is interactive. */}
          <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 p-2 light:border-zinc-200 light:bg-white">
            <Suspense fallback={<div className="h-72" />}>
              <CourseMap
                coords={track.coords}
                grades={track.grades}
                hikeAboveGrade={hikeAbovePct / 100}
                aid={aidStops.map((s, i) => ({
                  km: s.km,
                  label: `R${i + 1} · ${distStr(s.km)} · ≈ ${fmtClockShort(s.eta)}`,
                }))}
                startLabel={t.mapStart}
                finishLabel={t.mapFinish}
                ariaLabel={t.mapAria}
                onRegisterHover={registerHoverTarget}
              />
            </Suspense>
            <button
              type="button"
              onClick={() => setMapZoom(true)}
              className={`absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/90 px-3 py-1 text-xs font-medium text-zinc-300 transition-colors hover:border-emerald-500 hover:text-white light:border-zinc-300 light:bg-white/90 light:text-zinc-600 light:hover:text-emerald-700 ${focusRing}`}
            >
              <ExpandIcon className="h-3.5 w-3.5" />
              {t.expandChart}
            </button>
          </div>

          {/* Fullscreen map, same overlay pattern as the chart (portal to
              <body>, opaque, Escape/backdrop closes). */}
          {mapZoom &&
            createPortal(
              <div
                className="animate-fade-in fixed inset-0 z-50 flex flex-col gap-3 bg-zinc-950 p-4 light:bg-zinc-50 sm:p-8"
                onClick={() => setMapZoom(false)}
              >
                <div
                  className="flex items-center justify-between"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h2 className="text-lg font-semibold">
                    {title || EXAMPLES.imperial.title}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setMapZoom(false)}
                    className={btnSecondaryClass}
                  >
                    <CloseIcon className="h-4 w-4" />
                    {t.closeChart}
                  </button>
                </div>
                <div
                  className="min-h-0 flex-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Suspense fallback={null}>
                    <CourseMap
                      coords={track.coords}
                      grades={track.grades}
                      hikeAboveGrade={hikeAbovePct / 100}
                      aid={aidStops.map((s, i) => ({
                        km: s.km,
                        label: `R${i + 1} · ${distStr(s.km)} · ≈ ${fmtClockShort(s.eta)}`,
                      }))}
                      startLabel={t.mapStart}
                      finishLabel={t.mapFinish}
                      ariaLabel={t.mapAria}
                      heightClass="h-full"
                    />
                  </Suspense>
                </div>
              </div>,
              document.body,
            )}

          <div className={cardClass}>
            {/* Fixed-height fallback so the layout doesn't jump when the
                chart chunk arrives. */}
            <Suspense fallback={<div className="h-72" />}>
              <ElevationChart
                profile={track.profile}
                units={units}
                hikeAboveGrade={hikeAbovePct / 100}
                height={288}
                labels={chartLabels}
                theme={theme}
                paceLabelAt={paceLabelAt}
                aidKms={aidKms}
                onHoverKm={onHoverKm}
              />
            </Suspense>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              {/* Names the colors — "power-hike" appears right where you look
                  for it, on the profile itself. */}
              {chartLegend}
              <button
                type="button"
                onClick={() => setChartZoom(true)}
                className={`inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-300 transition-colors hover:border-emerald-500 hover:text-white light:border-zinc-300 light:bg-white light:text-zinc-600 light:hover:text-emerald-700 ${focusRing}`}
              >
                <ExpandIcon className="h-3.5 w-3.5" />
                {t.expandChart}
              </button>
            </div>
            {/* Ravitaillements: positions typed in the active unit; each chip
                shows the PROJECTED arrival — the plan's real added value over
                the roadbook's km marks. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-800 pt-3 light:border-zinc-200">
              <label className="flex items-center gap-2 text-xs text-zinc-400 light:text-zinc-500">
                <span className="uppercase tracking-wider">{t.aidLabel}</span>
                <input
                  value={aidText}
                  onChange={(e) => setAidText(e.target.value)}
                  placeholder={t.aidPlaceholder}
                  aria-label={t.aidLabel}
                  className="w-36 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 transition-colors focus:border-emerald-500 focus:outline-none light:border-zinc-300 light:bg-white light:text-zinc-900"
                />
                <span>{units === "imperial" ? "mi" : "km"}</span>
              </label>
              {aidStops.map((s, i) => (
                <span
                  key={s.km}
                  className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-xs tabular-nums text-zinc-300 light:border-zinc-300 light:bg-zinc-100 light:text-zinc-700"
                >
                  <span className="font-semibold text-emerald-400 light:text-emerald-600">
                    R{i + 1}
                  </span>{" "}
                  {units === "imperial"
                    ? `${(s.km / KM_PER_MI).toFixed(1)} mi`
                    : `${s.km.toFixed(1)} km`}{" "}
                  · ≈ {fmtClockShort(s.eta)}
                </span>
              ))}
            </div>
          </div>

          {/* Fullscreen course-study view. Backdrop click or Escape closes.
              Fully opaque — a translucent backdrop reads as ghosting on big
              bright displays. Rendered through a PORTAL to <body>: the
              dashboard's entrance animation gives it a transform, and a
              transformed ancestor becomes the containing block for
              position:fixed — without the portal the "fullscreen" overlay is
              trapped inside the content column. */}
          {chartZoom &&
            createPortal(
              <div
                className="animate-fade-in fixed inset-0 z-50 flex flex-col gap-3 bg-zinc-950 p-4 light:bg-zinc-50 sm:p-8"
                onClick={() => setChartZoom(false)}
              >
              <div
                className="flex items-center justify-between"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="text-lg font-semibold">
                  {title || EXAMPLES.imperial.title}
                </h2>
                <button
                  type="button"
                  onClick={() => setChartZoom(false)}
                  className={btnSecondaryClass}
                >
                  <CloseIcon className="h-4 w-4" />
                  {t.closeChart}
                </button>
              </div>
              <div
                className="min-h-0 flex-1"
                onClick={(e) => e.stopPropagation()}
              >
                <ElevationChart
                  profile={track.profile}
                  units={units}
                  hikeAboveGrade={hikeAbovePct / 100}
                  height="100%"
                  labels={chartLabels}
                  theme={theme}
                  paceLabelAt={paceLabelAt}
                  aidKms={aidKms}
                />
              </div>
              <div onClick={(e) => e.stopPropagation()}>{chartLegend}</div>
              </div>,
              document.body,
            )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t.statDistance} value={distStr(track.distanceKm)} />
            <StatCard label={t.statGain} value={gainStr(track.gainM)} />
            {/* The header's promise, quantified: how much of this course the
                plan walks instead of pretending you'll run it. */}
            <div className={cardClass}>
              <div className="text-xs uppercase tracking-wider text-zinc-400 light:text-zinc-500">
                {t.statHike}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {distStr(hikeMeters / 1000)}
              </div>
              <div className="mt-0.5 text-sm tabular-nums text-zinc-400 light:text-zinc-600">
                {t.walkedPct(
                  hikePct < 10 ? hikePct.toFixed(1) : hikePct.toFixed(0),
                )}
              </div>
            </div>
            {/* The range IS the product thesis: a to-the-second finish would
                be false precision. Center = the model's central estimate.
                Hero card — the one number everyone came for. */}
            <div className={heroCardClass}>
              <div className="text-xs uppercase tracking-wider text-zinc-400 light:text-zinc-500">
                {t.statFinish}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {fmtClock(timeSec)}
              </div>
              <div className="mt-0.5 text-sm tabular-nums text-zinc-400 light:text-zinc-600">
                {t.expect} {fmtClockShort(range.lowSec)} –{" "}
                {fmtClockShort(range.highSec)}
                {calibrated && (
                  <span className="text-emerald-400 light:text-emerald-600">
                    {" "}
                    {t.calibratedTag}
                  </span>
                )}
              </div>
            </div>
          </div>
          <p className="text-xs text-zinc-500">{t.rangeNote}</p>

          {/* Compact one-row share bar — the button label says what it does,
              so no explainer paragraph. siteUrl is taken at runtime so the
              watermark is correct on any domain. */}
          <div className={cardClass}>
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t.courseNamePlaceholder}
                aria-label={t.courseNameAria}
                className="min-w-[12rem] flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none light:border-zinc-300 light:bg-white light:text-zinc-900"
              />
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing}
                className={btnPrimaryClass}
              >
                <ImageIcon />
                {sharing ? t.creatingImage : t.shareImage}
              </button>
              <button
                type="button"
                onClick={handleCopyLink}
                className={btnSecondaryClass}
              >
                {linkCopied ? (
                  <CheckIcon className="h-4 w-4 text-emerald-500" />
                ) : (
                  <LinkIcon />
                )}
                {linkCopied ? t.copied : t.copyLink}
              </button>
            </div>
            {shareError && (
              <div role="alert" className={`mt-3 ${alertClass}`}>
                {shareError}
              </div>
            )}
          </div>

          {/* On a phone six columns can't fit; let the table keep a readable
              min-width and scroll horizontally inside its own box so the page
              layout never breaks. */}
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              {/* Sticky + opaque: with all ~70 splits open you'd otherwise
                  lose which column is which three screens down. */}
              <thead className="sticky top-0 z-10 bg-zinc-950 light:bg-zinc-50">
                <tr className="border-b border-zinc-700 text-xs uppercase tracking-wider text-zinc-400 light:border-zinc-300 light:text-zinc-500">
                  <th className="py-2 pr-4 text-left font-medium">
                    {units === "imperial" ? "mi" : "km"}
                  </th>
                  <th className="py-2 pr-4 text-right font-medium">
                    {t.thGrade}
                  </th>
                  <th className="py-2 pr-4 text-right font-medium">
                    {t.thDplus}
                  </th>
                  <th className="py-2 pr-4 text-right font-medium">
                    {t.thHike}
                  </th>
                  <th className="py-2 pr-4 text-right font-medium">
                    {t.thPace}
                  </th>
                  <th className="py-2 text-right font-medium">{t.thElapsed}</th>
                </tr>
              </thead>
              <tbody>
                {(showAllSplits ? splits : splits.slice(0, 12)).map((s) => (
                  <tr
                    key={s.km}
                    className="border-b border-zinc-800/70 tabular-nums text-zinc-200 transition-colors hover:bg-zinc-900/40 light:border-zinc-200 light:text-zinc-800 light:hover:bg-zinc-100"
                  >
                    <td className="py-1.5 pr-4">
                      {s.km}
                      {s.distanceKm < bucketKm * 0.95
                        ? ` (${(units === "imperial" ? s.distanceKm / KM_PER_MI : s.distanceKm).toFixed(2)})`
                        : ""}
                      {aidByBucket.get(s.km)?.map((n) => (
                        <span
                          key={n}
                          title={`${t.aidLabel} R${n}`}
                          className="ml-1.5 rounded bg-emerald-500/15 px-1 text-[10px] font-semibold text-emerald-400 light:text-emerald-600"
                        >
                          R{n}
                        </span>
                      ))}
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
                        <span className="text-emerald-400 light:text-emerald-600">
                          {(s.hikeFraction * 100).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-zinc-600 light:text-zinc-400">
                          —
                        </span>
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
                className={`mt-3 w-full rounded-md border border-zinc-800 py-2 text-sm text-zinc-400 transition-colors hover:border-emerald-500 hover:text-zinc-200 light:border-zinc-200 light:text-zinc-500 light:hover:text-zinc-800 ${focusRing}`}
              >
                {showAllSplits ? t.showFewer : t.showAll(splits.length)}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const t = MESSAGES[lang];

  // Keep the document language honest for screen readers / translators.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // The `light` class on <html> drives the light: variant (see index.css).
  // theme-color follows along so mobile browser chrome matches the page.
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "light" ? "#fafafa" : "#18181b");
  }, [theme]);

  function switchLang(next: Lang) {
    if (next === lang) return;
    setLang(next);
    try {
      localStorage.setItem("gp-lang", next);
    } catch {
      /* storage unavailable — the toggle still works for this session */
    }
    trackEvent("switch-lang", { to: next });
  }

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("gp-theme", next);
    } catch {
      /* storage unavailable — the toggle still works for this session */
    }
    trackEvent("switch-theme", { to: next });
  }

  return (
    <main className="min-h-screen px-4 py-10">
      {/* max-w-5xl: the previous 3xl column read as a narrow stripe on large
          desktop screens (owner feedback from a 27" 1440p display). */}
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* The same trend-line mark as the share card — one brand. */}
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 light:border-zinc-200 light:bg-white">
              <LogoMark />
            </span>
            <h1 className="text-3xl font-bold tracking-tight">GradePace</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? t.themeToLight : t.themeToDark}
              title={theme === "dark" ? t.themeToLight : t.themeToDark}
              className={`rounded-md border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-400 transition-colors hover:text-zinc-100 light:border-zinc-300 light:bg-white light:text-zinc-500 light:hover:text-zinc-900 ${focusRing}`}
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
            <div className="flex overflow-hidden rounded-md border border-zinc-700 text-xs light:border-zinc-300">
              {(["en", "fr"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => switchLang(l)}
                  aria-pressed={lang === l}
                  className={`px-2.5 py-1.5 font-medium uppercase transition-colors ${
                    lang === l
                      ? "bg-zinc-700 text-white light:bg-zinc-800"
                      : "bg-zinc-900 text-zinc-500 hover:text-zinc-200 light:bg-white light:hover:text-zinc-800"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-2 text-zinc-300 light:text-zinc-700">{t.tagline}</p>
        <div className="mt-6">
          <GpxUpload t={t} lang={lang} theme={theme} />
        </div>
        <footer className="mt-14 border-t border-zinc-800 pt-6 text-sm text-zinc-500 light:border-zinc-200">
          <p>
            {t.footerBuiltBy}{" "}
            <a
              href="https://x.com/AlvaroSerero"
              target="_blank"
              rel="noopener noreferrer"
              data-umami-event="click-x"
              className="font-medium text-zinc-300 underline decoration-zinc-600 underline-offset-2 hover:text-emerald-400 light:text-zinc-700 light:decoration-zinc-400 light:hover:text-emerald-700"
            >
              Alvaro Serero
            </a>{" "}
            {t.footerTraining}{" "}
            <a
              href="https://github.com/Alvaro5/grade-pace"
              target="_blank"
              rel="noopener noreferrer"
              data-umami-event="click-github"
              className="font-medium text-zinc-300 underline decoration-zinc-600 underline-offset-2 hover:text-emerald-400 light:text-zinc-700 light:decoration-zinc-400 light:hover:text-emerald-700"
            >
              {t.footerOpenSource}
            </a>
            .
          </p>
        </footer>
      </div>
    </main>
  );
}

export default App;
