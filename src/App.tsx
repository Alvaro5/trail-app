import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  parseGpx,
  cumulativeDistances,
  resampleEven,
  smoothElevationByDistance,
  cumulativeGain,
  gradients,
  computeSplits,
  GpxError,
  type GpxErrorCode,
  type Split,
} from "./lib/pacing";
import { fmtClock, fmtPace } from "./lib/format";
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
    "This file has no recorded track points — it looks like a route, not an activity.",
  "too-few":
    "This track has too few points to build a pacing plan (it needs at least two).",
};

// Elevation-processing length scales (see STATUS.md / the research notes).
const RESAMPLE_INTERVAL_M = 10; // even spacing that kills Δdist gradient spikes
const SMOOTH_WINDOW_M = 30; // physical low-pass; keep ≥ ~3× the resample interval
const D_PLUS_THRESHOLD_M = 5; // hysteresis deadband for D+ (noise floor; 0 = naive sum)

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

// "6:00" -> 360 seconds; falls back to 6:00 if unparseable
function parsePace(text: string): number {
  const [m, s] = text.split(":").map(Number);
  const sec = (m || 0) * 60 + (s || 0);
  return sec > 0 ? sec : 360;
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
  const [paceText, setPaceText] = useState("6:00");
  const [vam, setVam] = useState(750);
  const [hikeAbovePct, setHikeAbovePct] = useState(18);
  const [terrainFactor, setTerrainFactor] = useState(1.0);
  // Course name shown on the shareable image; prefilled on load, editable.
  const [title, setTitle] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  // True while the dashboard shows the bundled course (auto-loaded or clicked),
  // so we can badge it as an example rather than let it pass for the visitor's
  // own race. Cleared the moment a user upload succeeds.
  const [fromExample, setFromExample] = useState(false);

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

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setTitle(file.name.replace(/\.gpx$/i, ""));
    loadGpx(
      file.text(),
      "Couldn't read this file. Please try a different GPX.",
      "upload",
    );
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
        parsePace(paceText),
        Math.max(1, vam),
        hikeAbovePct / 100,
        terrainFactor,
      )
    : [];
  const timeSec = splits.length ? splits[splits.length - 1].elapsedSec : 0;

  // Render the current plan to a branded PNG and share it (native share sheet
  // when available, e.g. mobile) or download it. Every shared card carries the
  // GradePace mark + site URL — the growth loop.
  async function handleShare() {
    if (!track || !splits.length) return;
    setSharing(true);
    setShareError(null);
    try {
      const totalKm = track.distanceKm;
      const hikeMeters = splits.reduce(
        (sum, s) => sum + s.hikeFraction * s.distanceKm * 1000,
        0,
      );
      const data: ShareCardData = {
        title: title.trim() || "Race plan",
        distanceKm: track.distanceKm,
        gainM: track.gainM,
        timeSec,
        hikePct: totalKm > 0 ? (hikeMeters / (totalKm * 1000)) * 100 : 0,
        avgPaceSecPerKm: totalKm > 0 ? timeSec / totalKm : 0,
        profile: track.profile,
        siteUrl: window.location.host,
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
    <>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".gpx"
          onChange={handleFile}
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
        Your GPX is parsed right here in your browser — it never leaves your
        device.
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
                Imperial Trail, Fontainebleau (70k) — upload your own GPX above
                to plan your race.
              </span>
            </div>
          )}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Your pace
            </h2>
            <div className="mt-3">
              <Field
                label="Your easy flat-road pace"
                hint="min/km — a pace you could hold for hours on flat ground. We adjust it for every hill on the course."
              >
                <input
                  value={paceText}
                  onChange={(e) => setPaceText(e.target.value)}
                  className={inputClass}
                />
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
                  hint="how fast you climb when power-hiking, in vertical metres per hour"
                  display={`${vam} m/h`}
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
                  hint="extra time for technical or rough ground (×1.00 = none)"
                  display={`×${terrainFactor.toFixed(2)}`}
                  value={terrainFactor}
                  min={1}
                  max={1.5}
                  step={0.05}
                  onChange={setTerrainFactor}
                />
              </div>
            </details>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart
                data={track.profile}
                margin={{ top: 5, right: 5, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="ele" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#27272a" vertical={false} />
                <XAxis
                  dataKey="km"
                  type="number"
                  domain={[0, "dataMax"]}
                  tickFormatter={(v: number) => v.toFixed(0)}
                  stroke="#71717a"
                  fontSize={12}
                  tickLine={false}
                />
                <YAxis
                  width={52}
                  stroke="#71717a"
                  fontSize={12}
                  tickLine={false}
                  tickFormatter={(v: number) => `${Math.round(v)}m`}
                />
                <Tooltip
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid #3f3f46",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "#a1a1aa" }}
                  formatter={(v) => [`${Math.round(Number(v))} m`, "elevation"]}
                  labelFormatter={(v) => `km ${Number(v).toFixed(1)}`}
                />
                <Area
                  type="monotone"
                  dataKey="ele"
                  stroke="#34d399"
                  strokeWidth={2}
                  fill="url(#ele)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Distance"
              value={`${track.distanceKm.toFixed(2)} km`}
            />
            <StatCard
              label="Elevation gain"
              value={`${track.gainM.toFixed(0)} m`}
            />
            <StatCard label="Projected time" value={fmtClock(timeSec)} />
          </div>

          {/* Share/export: render the plan to a branded PNG. The course name
              feeds the image title; siteUrl is taken at runtime so the
              watermark is correct on any domain. */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
                <span className="text-zinc-300">Course name</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Name your race"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sharing ? "Creating image…" : "Share image"}
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Download a shareable image of your plan — distance, climb, and
              projected finish.
            </p>
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
                  <th className="py-2 pr-4 text-left font-medium">km</th>
                  <th className="py-2 pr-4 text-right font-medium">grade</th>
                  <th className="py-2 pr-4 text-right font-medium">D+</th>
                  <th className="py-2 pr-4 text-right font-medium">hike</th>
                  <th className="py-2 pr-4 text-right font-medium">pace</th>
                  <th className="py-2 text-right font-medium">elapsed</th>
                </tr>
              </thead>
              <tbody>
                {splits.map((s) => (
                  <tr
                    key={s.km}
                    className="border-b border-zinc-800/70 tabular-nums text-zinc-200 hover:bg-zinc-900/40"
                  >
                    <td className="py-1.5 pr-4">
                      {s.km}
                      {s.distanceKm < 0.95
                        ? ` (${s.distanceKm.toFixed(2)})`
                        : ""}
                    </td>
                    <td
                      className={`py-1.5 pr-4 text-right ${gradeClass(s.grade)}`}
                    >
                      {fmtGrade(s.grade)}
                    </td>
                    <td className="py-1.5 pr-4 text-right">
                      {s.gainM.toFixed(0)} m
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
                      {fmtPace(s.paceSecPerKm)}/km
                    </td>
                    <td className="py-1.5 text-right">
                      {fmtClock(s.elapsedSec)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function App() {
  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight">GradePace</h1>
        <p className="mt-3 text-lg text-zinc-200">
          Most pace planners assume you run every hill. You don't — on real
          trails, steep climbs are power-hikes.
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          GradePace turns a course GPX into a grade-adjusted plan: per-km
          paces, hike splits, and a projected finish.
        </p>
        <div className="mt-6">
          <GpxUpload />
        </div>
      </div>
    </main>
  );
}

export default App;
