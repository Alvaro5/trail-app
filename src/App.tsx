import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { isBasemapId, type BasemapId } from "./lib/basemaps";
import {
  bboxAreaKm2,
  bboxOf,
  fetchPois,
  filterToCorridor,
  MAX_BBOX_KM2,
  type Poi,
} from "./lib/pois";
// Type-only imports from the lazy chunk — erased at build time, so they
// don't pull Leaflet into the main bundle.
import type { CourseMapLabels, PoiState } from "./CourseMap";
import {
  computeNutrition,
  DEFAULT_RATES,
  type NutritionRates,
} from "./lib/nutrition";
import { buildPlanSheetHtml, type SheetTable } from "./lib/planSheet";
import {
  adjustStops,
  cutoffStatus,
  dwellBefore,
  fmtWallClock,
  parseCutoffs,
  parseStartTime,
  type CutoffStatus,
} from "./lib/logistics";
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
  FileIcon,
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
  // Nutrition rates (nc/nfl/ns) — encoded only when they differ from the
  // defaults, so typical links stay short.
  nc?: number;
  nfl?: number;
  ns?: number;
  // Race logistics: minutes per aid station, start time "HH:MM", cutoffs as
  // elapsed "H:MM" list (unit-free, so no imperial conversion like `rav`).
  dw?: number;
  st?: string;
  co?: string;
};

// Aid-station dwell. Default 3 min/station (owner decision, 2026-07): a plan
// that teleports through ravitos is systematically optimistic, so the honest
// default is non-zero. Moves times only once stations are set.
const DWELL_DEFAULT_MIN = 3;
const DWELL_MAX_MIN = 15;

// Slider bounds for the nutrition rates, shared by the UI and the hash
// validation so a crafted link can't smuggle absurd values.
const CARBS_MIN = 30,
  CARBS_MAX = 120;
const FLUID_MIN = 250,
  FLUID_MAX = 1000;
const SODIUM_MIN = 300,
  SODIUM_MAX = 1200;

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
    const nc = Number(p.get("nc"));
    if (nc >= CARBS_MIN && nc <= CARBS_MAX) plan.nc = Math.round(nc);
    const nfl = Number(p.get("nfl"));
    if (nfl >= FLUID_MIN && nfl <= FLUID_MAX) plan.nfl = Math.round(nfl);
    const ns = Number(p.get("ns"));
    if (ns >= SODIUM_MIN && ns <= SODIUM_MAX) plan.ns = Math.round(ns);
    const dw = Number(p.get("dw"));
    if (p.get("dw") !== null && dw >= 0 && dw <= DWELL_MAX_MIN)
      plan.dw = Math.round(dw);
    const st = p.get("st");
    if (st && parseStartTime(st) !== null) plan.st = st;
    const co = p.get("co");
    if (co) {
      const tokens = co.split(",").map((tk) => tk.trim());
      // A link only carries cutoffs when every token was valid at write
      // time; a tampered/partial list would silently shift the pairing.
      if (
        tokens.length &&
        tokens.length <= 30 &&
        tokens.every((tk) => /^\d{1,2}:[0-5]\d$/.test(tk))
      )
        plan.co = tokens.join(", ");
    }
    return plan;
  } catch {
    return {}; // malformed hash → plain defaults, never a crash
  }
}

function initialBasemap(): BasemapId {
  try {
    const saved = localStorage.getItem("gp-basemap");
    if (isBasemapId(saved)) return saved;
  } catch {
    /* storage unavailable — terrain default */
  }
  return "terrain";
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
const btnPrimaryClass = `inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-emerald-950/40 transition hover:bg-emerald-500 hover:shadow-md hover:shadow-emerald-900/40 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 light:shadow-emerald-600/20 ${focusRing}`;
const btnSecondaryClass = `inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 shadow-sm shadow-black/20 transition hover:border-emerald-500 hover:bg-zinc-700/70 hover:text-white active:scale-[0.97] light:border-zinc-300 light:bg-white light:text-zinc-700 light:shadow-zinc-300/40 light:hover:text-emerald-700 ${focusRing}`;
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
  // Drives the custom track's progress fill (see .gp-range in index.css) —
  // native accent-color can't be styled cross-browser, so the fill point is
  // handed to CSS as a variable.
  const fillPct = max > min ? ((value - min) / (max - min)) * 100 : 0;
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
        className="gp-range"
        style={{ "--fill": `${fillPct}%` } as React.CSSProperties}
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
  // Nutrition rates (per hour). Like the effort inputs, a shared link can
  // carry them; otherwise the sports-science mid-band defaults apply.
  const [nutriRates, setNutriRates] = useState<NutritionRates>({
    carbsGPerH: hashPlan.nc ?? DEFAULT_RATES.carbsGPerH,
    fluidMlPerH: hashPlan.nfl ?? DEFAULT_RATES.fluidMlPerH,
    sodiumMgPerH: hashPlan.ns ?? DEFAULT_RATES.sodiumMgPerH,
  });
  // Race logistics: minutes per station, optional start time (wall-clock
  // display) and per-station cutoff barriers (elapsed H:MM, course order).
  const [dwellMin, setDwellMin] = useState(hashPlan.dw ?? DWELL_DEFAULT_MIN);
  const [startText, setStartText] = useState(hashPlan.st ?? "");
  const [cutoffText, setCutoffText] = useState(hashPlan.co ?? "");
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
  // Basemap preference is lifted here (not in CourseMap) because two map
  // instances can be live at once — inline + fullscreen must stay in sync.
  const [basemap, setBasemap] = useState<BasemapId>(initialBasemap);
  // POI overlay (water/toilets/viewpoints from OpenStreetMap). Opt-in per
  // session and deliberately NOT persisted: the app promises the GPX never
  // leaves the device, so no request may fire without a fresh click — and
  // even then only the course's bounding box is sent (see lib/pois.ts).
  // Fetch state lives here too so toggling fullscreen never refetches.
  const [poiOn, setPoiOn] = useState(false);
  const [poiStatus, setPoiStatus] = useState<
    "idle" | "loading" | "ok" | "error" | "too-big"
  >("idle");
  const [poiItems, setPoiItems] = useState<Poi[]>([]);
  const poiAbort = useRef<AbortController | null>(null);

  function switchBasemap(next: BasemapId) {
    setBasemap(next);
    try {
      localStorage.setItem("gp-basemap", next);
    } catch {
      /* storage unavailable — the switch still works for this session */
    }
    trackEvent("switch-basemap", { to: next });
  }

  function togglePoi() {
    if (poiOn) {
      setPoiOn(false);
      // Leaving an error state resets it, so the next toggle retries.
      if (poiStatus === "error") setPoiStatus("idle");
      return;
    }
    setPoiOn(true);
    if (!track || poiStatus === "ok" || poiStatus === "loading") return;
    const bbox = bboxOf(track.coords);
    if (bboxAreaKm2(bbox) > MAX_BBOX_KM2) {
      setPoiStatus("too-big");
      return;
    }
    setPoiStatus("loading");
    poiAbort.current?.abort();
    const ctl = new AbortController();
    poiAbort.current = ctl;
    fetchPois(bbox, ctl.signal)
      .then((items) => {
        // The bbox of a loop encloses land the runner never crosses — keep
        // only POIs within ~200 m of the actual route.
        const near = filterToCorridor(items, track.coords);
        setPoiItems(near);
        setPoiStatus("ok");
        trackEvent("poi-load", { found: near.length });
      })
      .catch((err) => {
        if (ctl.signal.aborted) return; // toggled off / new course — not an error
        console.error(err);
        setPoiStatus("error");
      });
  }
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
    // Nutrition rates travel only when customized — links stay short.
    if (nutriRates.carbsGPerH !== DEFAULT_RATES.carbsGPerH)
      params.set("nc", String(nutriRates.carbsGPerH));
    if (nutriRates.fluidMlPerH !== DEFAULT_RATES.fluidMlPerH)
      params.set("nfl", String(nutriRates.fluidMlPerH));
    if (nutriRates.sodiumMgPerH !== DEFAULT_RATES.sodiumMgPerH)
      params.set("ns", String(nutriRates.sodiumMgPerH));
    // Logistics: dwell when customized, start when valid, cutoffs only when
    // stations exist AND every token is valid (a partial list would shift
    // the station↔cutoff pairing for the recipient).
    if (dwellMin !== DWELL_DEFAULT_MIN) params.set("dw", String(dwellMin));
    if (startText.trim() && parseStartTime(startText) !== null)
      params.set("st", startText.trim());
    const coTokens = cutoffText
      .split(/[,;]+/)
      .map((tk) => tk.trim())
      .filter(Boolean);
    if (
      aidNums.length &&
      coTokens.length &&
      coTokens.every((tk) => /^\d{1,2}:[0-5]\d$/.test(tk))
    )
      params.set("co", coTokens.join(","));
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
        // POIs belong to a course — a new course resets the overlay (and
        // cancels any fetch in flight) so stale pins can't linger.
        poiAbort.current?.abort();
        setPoiOn(false);
        setPoiStatus("idle");
        setPoiItems([]);
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

  // Dwell-adjusted logistics. The engine and calibration stay on MOVING time
  // (dwell threading through computeSplits would mis-calibrate every fit, and
  // the honest range scales moving time only; dwell is a chosen constant
  // ADDED after the band, never multiplied). See lib/logistics.ts.
  const dwellSec = Math.max(0, dwellMin) * 60;
  const adjStops = adjustStops(aidStops, dwellSec);
  const totalDwellSec = aidStops.length * dwellSec;
  const adjFinishSec = timeSec + totalDwellSec;
  const adjRange = {
    lowSec: range.lowSec + totalDwellSec,
    highSec: range.highSec + totalDwellSec,
  };
  // Elapsed at the END of a table row must include the dwell of a station
  // sitting exactly on the boundary — hence the epsilon past strict `<`.
  const rowElapsed = (movingSec: number, endKmMetric: number) =>
    movingSec + dwellBefore(aidKms, endKmMetric + 1e-6, dwellSec);
  const rowEndKms = splits.reduce<number[]>((arr, s) => {
    arr.push((arr.length ? arr[arr.length - 1] : 0) + s.distanceKm);
    return arr;
  }, []);
  const rowAdjElapsed = splits.map((s, i) =>
    rowElapsed(s.elapsedSec, rowEndKms[i]),
  );
  const startSec = parseStartTime(startText);
  const startValid = startText.trim() === "" || startSec !== null;
  const clockAt = (elapsed: number) =>
    startSec === null ? null : fmtWallClock(startSec, elapsed);
  // Cutoffs pair by index with the sorted stations; the range warning scales
  // only the moving part of the arrival (see cutoffStatus).
  const highRatio = timeSec > 0 ? range.highSec / timeSec : 1;
  const cutoffSecs = parseCutoffs(cutoffText).slice(0, adjStops.length);
  const stopStatus: CutoffStatus[] = adjStops.map((s, i) => {
    const cutoff = cutoffSecs[i];
    return cutoff == null
      ? "ok"
      : cutoffStatus(s.arriveSec, i * dwellSec, highRatio, cutoff);
  });
  const cutoffWarnings = adjStops.flatMap((s, i) => {
    const cutoff = cutoffSecs[i];
    if (cutoff == null || stopStatus[i] === "ok") return [];
    const cutoffStr = `${fmtClockShort(cutoff)}${clockAt(cutoff) ? ` (${clockAt(cutoff)})` : ""}`;
    return [
      stopStatus[i] === "miss"
        ? { kind: "miss" as const, text: t.cutoffMissLine(`R${i + 1}`, fmtClockShort(s.arriveSec), cutoffStr) }
        : { kind: "risk" as const, text: t.cutoffRiskLine(`R${i + 1}`, cutoffStr) },
    ];
  });

  // Nutrition plan: hourly targets × each leg's projected duration, on the
  // DWELL-ADJUSTED clock (intake at the R1 stop fuels the R1→R2 leg, and a
  // 12 h day needs 12 h of fuel). Cheap enough to derive every render.
  const nutrition = track
    ? computeNutrition(
        adjFinishSec,
        track.distanceKm,
        adjStops.map((s) => ({ km: s.km, eta: s.arriveSec })),
        nutriRates,
      )
    : null;
  // Leg endpoint names: Start → R1 → … → Finish.
  const legName = (i: number, last: number) =>
    `${i === 0 ? t.mapStart : `R${i}`} → ${i === last ? t.mapFinish : `R${i + 1}`}`;
  const carbsStr = (g: number) => `${Math.round(g)} g`;
  const fluidStr = (ml: number) =>
    units === "imperial"
      ? `${Math.round(ml / 29.5735)} oz`
      : ml >= 1000
        ? `${(ml / 1000).toLocaleString(numLocale, { maximumFractionDigits: 1 })} L`
        : `${Math.round(ml / 10) * 10} ml`;
  const sodiumStr = (mg: number) => `${Math.round(mg / 10) * 10} mg`;

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
        // Dwell-adjusted: the PNG must agree with the dashboard's headline.
        timeSec: adjFinishSec,
        rangeLowSec: adjRange.lowSec,
        rangeHighSec: adjRange.highSec,
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
        title: `${data.title} · GradePace`,
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

  // Render the whole plan (stats, settings, profile, aid ETAs, nutrition,
  // every split) as a printable sheet in a new tab; the browser's print
  // dialog turns it into a PDF or paper for race day.
  function handleExportSheet() {
    if (!track || !splits.length) return;
    const unitShort = units === "imperial" ? "mi" : "km";
    const displayTotal =
      units === "imperial" ? track.distanceKm / KM_PER_MI : track.distanceKm;
    // A gridline every 10 display-units, skipping one within 4% of the end.
    const ticks: { frac: number; label: string }[] = [];
    for (let u = 10; u < displayTotal * 0.96; u += 10)
      ticks.push({ frac: u / displayTotal, label: `${u}` });
    const legendRow = GRADE_LEGEND.map((g) => ({
      color: g.color,
      label: legendLabel[g.label],
    }));
    // Depart column only when dwell is set, cutoff column only when cutoffs
    // exist; clock suffixes only when a start time is set.
    const withClock = (sec: number) =>
      clockAt(sec) ? ` (${clockAt(sec)})` : "";
    const anyCutoff = cutoffSecs.some((c) => c != null);
    const aidTable: SheetTable | null = adjStops.length
      ? {
          title: t.aidLabel,
          cols: [
            t.aidLabel,
            unitShort,
            t.sheetEta,
            ...(dwellSec > 0 ? [t.sheetDepart] : []),
            ...(anyCutoff ? [t.sheetCutoff] : []),
          ],
          rows: adjStops.map((s, i) => [
            `R${i + 1}`,
            (units === "imperial" ? s.km / KM_PER_MI : s.km).toFixed(1),
            `≈ ${fmtClockShort(s.arriveSec)}${withClock(s.arriveSec)}`,
            ...(dwellSec > 0
              ? [`${fmtClockShort(s.departSec)}${withClock(s.departSec)}`]
              : []),
            ...(anyCutoff
              ? [
                  cutoffSecs[i] != null
                    ? `${fmtClockShort(cutoffSecs[i]!)}${withClock(cutoffSecs[i]!)}`
                    : "·",
                ]
              : []),
          ]),
        }
      : null;
    const nutritionTable: SheetTable | null = nutrition?.legs.length
      ? {
          title: t.nutritionTitle,
          cols: [
            t.legLabel,
            t.colDuration,
            t.colCarbs,
            t.colFluid,
            t.colSodium,
            t.colKcal,
          ],
          rows: nutrition.legs.map((leg, i) => [
            `${legName(i, nutrition.legs.length - 1)} (${distStr(leg.toKm - leg.fromKm)})`,
            fmtClockShort(leg.durationSec),
            carbsStr(leg.carbsG),
            fluidStr(leg.fluidMl),
            sodiumStr(leg.sodiumMg),
            String(Math.round(leg.kcal)),
          ]),
          totalRow:
            nutrition.legs.length > 1
              ? [
                  t.nutritionTotal,
                  fmtClockShort(nutrition.totals.durationSec),
                  carbsStr(nutrition.totals.carbsG),
                  fluidStr(nutrition.totals.fluidMl),
                  sodiumStr(nutrition.totals.sodiumMg),
                  String(Math.round(nutrition.totals.kcal)),
                ]
              : undefined,
          notes: [t.gelsHint(Math.round(nutrition.gels)), t.nutritionDisclaimer],
        }
      : null;
    const splitsTable: SheetTable = {
      title: t.sheetSplitsTitle,
      cols: [unitShort, t.thGrade, t.thDplus, t.thHike, t.thPace, t.thElapsed],
      rows: splits.map((s, i) => [
        `${s.km}${aidByBucket.get(s.km)?.length ? `  ·  R${aidByBucket.get(s.km)!.join(", R")}` : ""}`,
        fmtGrade(s.grade),
        gainStr(s.gainM),
        s.hikeFraction > 0 ? `${(s.hikeFraction * 100).toFixed(0)}%` : "·",
        paceStr(s.paceSecPerKm),
        `${fmtClock(rowAdjElapsed[i])}${withClock(rowAdjElapsed[i])}`,
      ]),
    };
    const html = buildPlanSheetHtml({
      lang,
      title: title.trim() || t.racePlan,
      finishLabel: t.statFinish,
      finish: `${fmtClock(adjFinishSec)}${withClock(adjFinishSec)}`,
      rangeLine: `${t.expect} ${fmtClockShort(adjRange.lowSec)} – ${fmtClockShort(adjRange.highSec)}${calibrated ? ` ${t.calibratedTag}` : ""}`,
      stats: [
        { label: t.statDistance, value: distStr(track.distanceKm) },
        { label: t.statGain, value: gainStr(track.gainM) },
        {
          label: t.statHike,
          value: `${distStr(hikeMeters / 1000)} (${hikePct < 10 ? hikePct.toFixed(1) : hikePct.toFixed(0)}%)`,
        },
      ],
      settingsTitle: t.sheetSettings,
      settings: [
        {
          label: t.paceLabel,
          value: `${fmtPace(effectivePaceSec)}/${unitShort === "mi" ? "mi" : "km"}`,
        },
        {
          label: t.vamLabel,
          value:
            units === "imperial"
              ? `${Math.round(vam * FT_PER_M)} ft/h`
              : `${vam} m/h`,
        },
        { label: t.gateLabel, value: `${hikeAbovePct}%` },
        { label: t.terrainLabel, value: `×${terrainFactor.toFixed(2)}` },
        ...(aidStops.length && dwellSec > 0
          ? [{ label: t.dwellLabel, value: `${dwellMin} min` }]
          : []),
        ...(startSec !== null
          ? [{ label: t.startLabel, value: startText.trim() }]
          : []),
      ],
      profile: track.profile,
      hikeAboveGrade: hikeAbovePct / 100,
      ticks,
      aidMarks: aidKms.map((km, i) => ({
        frac: km / track.distanceKm,
        label: `R${i + 1}`,
      })),
      legend: legendRow,
      aidTable,
      nutritionTable,
      splitsTable,
      footer: t.sheetFooter(window.location.host),
    });
    const w = window.open("", "_blank");
    if (!w) {
      setShareError(t.popupBlocked);
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    trackEvent("export-sheet");
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

  // Memoized so CourseMap's effects (keyed on these props) don't re-run on
  // every unrelated render of this component.
  const mapLabels: CourseMapLabels = useMemo(
    () => ({
      layers: {
        terrain: t.mapLayerTerrain,
        standard: t.mapLayerStandard,
        satellite: t.mapLayerSatellite,
        hybrid: t.mapLayerHybrid,
      },
      layersAria: t.mapLayersAria,
      poiToggle: t.mapPoiToggle,
      poiHint: t.mapPoiHint,
      poiLoading: t.mapPoiLoading,
      poiError: t.mapPoiError,
      poiTooBig: t.mapPoiTooBig,
      poiEmpty: t.mapPoiEmpty,
      poiKind: {
        water: t.poiWater,
        toilets: t.poiToilets,
        viewpoint: t.poiViewpoint,
        cafe: t.poiCafe,
        spring: t.poiSpring,
        shelter: t.poiShelter,
        parking: t.poiParking,
        picnic: t.poiPicnic,
      },
    }),
    [t],
  );
  const poi: PoiState | null = useMemo(
    () => (poiOn ? { status: poiStatus, items: poiItems } : null),
    [poiOn, poiStatus, poiItems],
  );

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
                      {factor !== null ? `×${factor.toFixed(2)}` : "·"}
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
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 p-2 light:border-zinc-200 light:bg-white">
            {/* Skeleton shimmer, not a blank: the lazy chunk takes a beat on
                first visit and an empty box reads as broken. */}
            <Suspense
              fallback={
                <div className="h-72 animate-pulse rounded-lg bg-zinc-800/50 light:bg-zinc-200/60" />
              }
            >
              <CourseMap
                coords={track.coords}
                grades={track.grades}
                hikeAboveGrade={hikeAbovePct / 100}
                aid={adjStops.map((s, i) => ({
                  km: s.km,
                  label: `R${i + 1} · ${distStr(s.km)} · ≈ ${fmtClockShort(s.arriveSec)}${clockAt(s.arriveSec) ? ` · ${clockAt(s.arriveSec)}` : ""}`,
                }))}
                startLabel={t.mapStart}
                finishLabel={t.mapFinish}
                ariaLabel={t.mapAria}
                units={units}
                basemap={basemap}
                onBasemapChange={switchBasemap}
                poi={poi}
                onPoiToggle={togglePoi}
                labels={mapLabels}
                onRegisterHover={registerHoverTarget}
                topRightSlot={
                  <button
                    type="button"
                    onClick={() => setMapZoom(true)}
                    className={`pointer-events-auto inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/85 px-2.5 py-1 text-xs font-medium text-zinc-200 shadow-sm backdrop-blur transition-colors hover:border-emerald-500 hover:text-white light:border-zinc-300 light:bg-white/90 light:text-zinc-700 light:hover:text-emerald-700 ${focusRing}`}
                  >
                    <ExpandIcon className="h-3.5 w-3.5" />
                    {t.expandChart}
                  </button>
                }
              />
            </Suspense>
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
                      aid={adjStops.map((s, i) => ({
                        km: s.km,
                        label: `R${i + 1} · ${distStr(s.km)} · ≈ ${fmtClockShort(s.arriveSec)}${clockAt(s.arriveSec) ? ` · ${clockAt(s.arriveSec)}` : ""}`,
                      }))}
                      startLabel={t.mapStart}
                      finishLabel={t.mapFinish}
                      ariaLabel={t.mapAria}
                      units={units}
                      basemap={basemap}
                      onBasemapChange={switchBasemap}
                      poi={poi}
                      onPoiToggle={togglePoi}
                      labels={mapLabels}
                      heightClass="h-full"
                    />
                  </Suspense>
                </div>
              </div>,
              document.body,
            )}

          <div className={cardClass}>
            {/* Fixed-height fallback so the layout doesn't jump when the
                chart chunk arrives; shimmer so it reads as loading. */}
            <Suspense
              fallback={
                <div className="h-72 animate-pulse rounded-lg bg-zinc-800/50 light:bg-zinc-200/60" />
              }
            >
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
              {/* Minutes lost per station: folded into every downstream time
                  (ETAs, finish, nutrition legs, PDF). Default 3 min (owner
                  decision): zero-dwell plans are systematically optimistic. */}
              <label
                className="flex items-center gap-2 text-xs text-zinc-400 light:text-zinc-500"
                title={t.dwellHint}
              >
                <span className="uppercase tracking-wider">{t.dwellLabel}</span>
                <input
                  type="number"
                  min={0}
                  max={DWELL_MAX_MIN}
                  step={1}
                  value={dwellMin}
                  onChange={(e) =>
                    setDwellMin(
                      Math.min(
                        DWELL_MAX_MIN,
                        Math.max(0, Number(e.target.value) || 0),
                      ),
                    )
                  }
                  aria-label={t.dwellLabel}
                  className="w-14 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm tabular-nums text-zinc-100 transition-colors focus:border-emerald-500 focus:outline-none light:border-zinc-300 light:bg-white light:text-zinc-900"
                />
                <span>min</span>
              </label>
              {/* Optional start time: turns every ETA into a wall-clock time
                  (chips, table, PDF). Empty = feature off. */}
              <label className="flex items-center gap-2 text-xs text-zinc-400 light:text-zinc-500">
                <span className="uppercase tracking-wider">{t.startLabel}</span>
                <input
                  value={startText}
                  onChange={(e) => setStartText(e.target.value)}
                  placeholder="8:00"
                  aria-label={t.startLabel}
                  aria-invalid={!startValid}
                  className={`w-16 rounded-md border bg-zinc-800 px-2 py-1 text-sm tabular-nums text-zinc-100 transition-colors focus:outline-none light:bg-white light:text-zinc-900 ${
                    startValid
                      ? "border-zinc-700 focus:border-emerald-500 light:border-zinc-300"
                      : "border-rose-500 focus:border-rose-500"
                  }`}
                />
              </label>
              {!startValid && (
                <span className="w-full text-xs text-rose-400 light:text-rose-600">
                  {t.startInvalid}
                </span>
              )}
              {adjStops.map((s, i) => (
                <span
                  key={s.km}
                  title={
                    dwellSec > 0
                      ? t.chipArrDep(
                          fmtClockShort(s.arriveSec),
                          fmtClockShort(s.departSec),
                        )
                      : undefined
                  }
                  className={`rounded-md border px-2 py-1 text-xs tabular-nums ${
                    stopStatus[i] === "miss"
                      ? "border-rose-500/60 bg-rose-500/10 text-rose-300 light:text-rose-700"
                      : stopStatus[i] === "risk"
                        ? "border-amber-500/60 bg-amber-500/10 text-amber-300 light:text-amber-700"
                        : "border-zinc-700 bg-zinc-800/60 text-zinc-300 light:border-zinc-300 light:bg-zinc-100 light:text-zinc-700"
                  }`}
                >
                  <span className="font-semibold text-emerald-400 light:text-emerald-600">
                    R{i + 1}
                  </span>{" "}
                  {units === "imperial"
                    ? `${(s.km / KM_PER_MI).toFixed(1)} mi`
                    : `${s.km.toFixed(1)} km`}{" "}
                  · ≈ {fmtClockShort(s.arriveSec)}
                  {clockAt(s.arriveSec) && (
                    <span className="text-zinc-500"> · {clockAt(s.arriveSec)}</span>
                  )}
                </span>
              ))}
              {/* Cutoff barriers appear only once stations exist: elapsed
                  H:MM per station in course order, warnings beneath. */}
              {aidKms.length > 0 && (
                <>
                  <label className="flex items-center gap-2 text-xs text-zinc-400 light:text-zinc-500">
                    <span className="uppercase tracking-wider">
                      {t.cutoffLabel}
                    </span>
                    <input
                      value={cutoffText}
                      onChange={(e) => setCutoffText(e.target.value)}
                      placeholder={t.cutoffPlaceholder}
                      aria-label={t.cutoffLabel}
                      title={t.cutoffHint}
                      className="w-36 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm tabular-nums text-zinc-100 transition-colors focus:border-emerald-500 focus:outline-none light:border-zinc-300 light:bg-white light:text-zinc-900"
                    />
                  </label>
                  {cutoffWarnings.map((w, i) => (
                    <span
                      key={i}
                      role={w.kind === "miss" ? "alert" : undefined}
                      className={`w-full text-xs ${
                        w.kind === "miss"
                          ? "text-rose-400 light:text-rose-600"
                          : "text-amber-300 light:text-amber-700"
                      }`}
                    >
                      {w.text}
                    </span>
                  ))}
                </>
              )}
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
                {fmtClock(adjFinishSec)}
              </div>
              <div className="mt-0.5 text-sm tabular-nums text-zinc-400 light:text-zinc-600">
                {t.expect} {fmtClockShort(adjRange.lowSec)} –{" "}
                {fmtClockShort(adjRange.highSec)}
                {calibrated && (
                  <span className="text-emerald-400 light:text-emerald-600">
                    {" "}
                    {t.calibratedTag}
                  </span>
                )}
                {clockAt(adjFinishSec) && (
                  <span> · {t.finishClock(clockAt(adjFinishSec)!)}</span>
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
              <button
                type="button"
                onClick={handleExportSheet}
                className={btnSecondaryClass}
              >
                <FileIcon />
                {t.exportSheet}
              </button>
            </div>
            {shareError && (
              <div role="alert" className={`mt-3 ${alertClass}`}>
                {shareError}
              </div>
            )}
          </div>

          {/* Nutrition plan: collapsed by default (same pattern as the
              calibration card) — it's a planning tool, not landing-page
              content. Legs follow the aid stations; without any, the whole
              race is one leg and the totals still teach the hourly targets. */}
          {nutrition && nutrition.legs.length > 0 && (
            <details
              className={cardClass}
              onToggle={(e) =>
                (e.currentTarget as HTMLDetailsElement).open &&
                trackEvent("nutrition-open")
              }
            >
              <summary className="flex cursor-pointer flex-wrap items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-200 light:text-zinc-500 light:hover:text-zinc-800">
                <ChevronIcon className="chev h-3.5 w-3.5" />
                {t.nutritionTitle}
                <span className="ml-1 font-normal normal-case tracking-normal text-zinc-500">
                  {t.nutritionSubtitle}
                </span>
              </summary>
              <p className="mt-3 text-sm text-zinc-400 light:text-zinc-600">
                {t.nutritionIntro}
              </p>
              {/* One segment means no stations were set: say how to get the
                  real per-segment breakdown instead of showing a one-row
                  table that duplicates its own total. */}
              {nutrition.legs.length === 1 && (
                <p className="mt-2 text-sm text-emerald-400/90 light:text-emerald-700">
                  {t.nutritionNoStations}
                </p>
              )}
              <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <SliderField
                  label={t.carbsLabel}
                  hint={t.carbsHint}
                  display={`${nutriRates.carbsGPerH} g/h`}
                  value={nutriRates.carbsGPerH}
                  min={CARBS_MIN}
                  max={CARBS_MAX}
                  step={5}
                  onChange={(n) =>
                    setNutriRates((r) => ({ ...r, carbsGPerH: n }))
                  }
                />
                <SliderField
                  label={t.fluidLabel}
                  hint={t.fluidHint}
                  display={`${nutriRates.fluidMlPerH} ml/h`}
                  value={nutriRates.fluidMlPerH}
                  min={FLUID_MIN}
                  max={FLUID_MAX}
                  step={50}
                  onChange={(n) =>
                    setNutriRates((r) => ({ ...r, fluidMlPerH: n }))
                  }
                />
                <SliderField
                  label={t.sodiumLabel}
                  hint={t.sodiumHint}
                  display={`${nutriRates.sodiumMgPerH} mg/h`}
                  value={nutriRates.sodiumMgPerH}
                  min={SODIUM_MIN}
                  max={SODIUM_MAX}
                  step={50}
                  onChange={(n) =>
                    setNutriRates((r) => ({ ...r, sodiumMgPerH: n }))
                  }
                />
              </div>
              <div className="-mx-4 mt-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <table className="w-full min-w-[30rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700 text-xs uppercase tracking-wider text-zinc-400 light:border-zinc-300 light:text-zinc-500">
                      <th className="py-2 pr-4 text-left font-medium">
                        {t.legLabel}
                      </th>
                      <th className="py-2 pr-4 text-right font-medium">
                        {t.colDuration}
                      </th>
                      <th className="py-2 pr-4 text-right font-medium">
                        {t.colCarbs}
                      </th>
                      <th className="py-2 pr-4 text-right font-medium">
                        {t.colFluid}
                      </th>
                      <th className="py-2 pr-4 text-right font-medium">
                        {t.colSodium}
                      </th>
                      <th className="py-2 text-right font-medium">
                        {t.colKcal}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {nutrition.legs.map((leg, i) => (
                      <tr
                        key={leg.startSec}
                        className="border-b border-zinc-800/70 tabular-nums text-zinc-200 transition-colors hover:bg-zinc-900/40 light:border-zinc-200 light:text-zinc-800 light:hover:bg-zinc-100"
                      >
                        <td className="py-1.5 pr-4">
                          {legName(i, nutrition.legs.length - 1)}
                          <span className="ml-1.5 text-xs text-zinc-500">
                            {distStr(leg.toKm - leg.fromKm)}
                          </span>
                        </td>
                        <td className="py-1.5 pr-4 text-right">
                          {fmtClockShort(leg.durationSec)}
                        </td>
                        <td className="py-1.5 pr-4 text-right">
                          {carbsStr(leg.carbsG)}
                        </td>
                        <td className="py-1.5 pr-4 text-right">
                          {fluidStr(leg.fluidMl)}
                        </td>
                        <td className="py-1.5 pr-4 text-right">
                          {sodiumStr(leg.sodiumMg)}
                        </td>
                        <td className="py-1.5 text-right">
                          {Math.round(leg.kcal)}
                        </td>
                      </tr>
                    ))}
                    {/* With a single segment the totals row would repeat the
                        row above it verbatim, which reads as a bug. */}
                    {nutrition.legs.length > 1 && (
                      <tr className="font-semibold tabular-nums text-zinc-100 light:text-zinc-900">
                        <td className="py-2 pr-4">{t.nutritionTotal}</td>
                        <td className="py-2 pr-4 text-right">
                          {fmtClockShort(nutrition.totals.durationSec)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {carbsStr(nutrition.totals.carbsG)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {fluidStr(nutrition.totals.fluidMl)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {sodiumStr(nutrition.totals.sodiumMg)}
                        </td>
                        <td className="py-2 text-right">
                          {Math.round(nutrition.totals.kcal)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-sm text-zinc-400 light:text-zinc-600">
                {t.gelsHint(Math.round(nutrition.gels))}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {t.nutritionDisclaimer}
              </p>
            </details>
          )}

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
                {(showAllSplits ? splits : splits.slice(0, 12)).map((s, i) => (
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
                          ·
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-4 text-right">
                      {paceStr(s.paceSecPerKm)}
                    </td>
                    <td className="py-1.5 text-right">
                      {fmtClock(rowAdjElapsed[i])}
                      {clockAt(rowAdjElapsed[i]) && (
                        <span className="text-zinc-500">
                          {" "}
                          · {clockAt(rowAdjElapsed[i])}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {splits.length > 12 && (
              <div className="relative">
                {/* Fade over the last visible rows: says "there's more"
                    before the eye even reaches the button. */}
                {!showAllSplits && (
                  <div className="pointer-events-none absolute -top-24 left-0 right-0 h-24 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent light:from-zinc-50 light:via-zinc-50/60" />
                )}
                <button
                  type="button"
                  onClick={() => setShowAllSplits((v) => !v)}
                  className={`relative mx-auto mt-3 flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-5 py-2 text-sm font-medium text-zinc-300 shadow-sm shadow-black/20 transition hover:border-emerald-500 hover:text-white active:scale-[0.97] light:border-zinc-300 light:bg-white light:text-zinc-600 light:shadow-zinc-300/40 light:hover:text-emerald-700 ${focusRing}`}
                >
                  <ChevronIcon
                    className={`h-4 w-4 transition-transform ${showAllSplits ? "-rotate-90" : "rotate-90"}`}
                  />
                  {showAllSplits ? t.showFewer : t.showAll(splits.length)}
                </button>
              </div>
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
