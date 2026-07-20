import { Fragment, useEffect, useMemo, useRef } from "react";
import { gradeColor } from "./lib/gradeColor";
import {
  autoExaggeration,
  boundingRadius,
  projectIso,
  toLocalMeters,
  type P3,
} from "./lib/pseudo3d";

// 3D course flyover: the race as a slowly orbiting ribbon, colored by the
// same grade scale as everything else, floating above its own ground shadow.
// Hand-rolled on purpose: ~40 lines of projection math (lib/pseudo3d.ts,
// unit-tested) drive plain SVG paths, so this weighs a few kB instead of a
// three.js chunk. All motion is imperative rAF writing path `d` attributes
// through refs — React renders this component exactly once per course.
//
// Interaction: drag to orbit (yaw free, pitch clamped between near-profile
// and near-map), auto-rotation resumes a beat after you let go. Reduced
// motion: no auto-rotation, still draggable.

const AUTO_YAW_PER_FRAME = 0.0035;
const PITCH_MIN = 0.35;
const PITCH_MAX = 1.35;

export default function Course3D({
  coords,
  eles,
  hikeAboveGrade = 0.18,
  aidKms = [],
  theme = "dark",
  ariaLabel = "3D course flyover",
}: {
  coords: { lat: number; lon: number }[]; // resampled track, 10 m spacing
  eles: number[]; // smoothed elevations, parallel to coords
  hikeAboveGrade?: number;
  aidKms?: number[];
  theme?: "dark" | "light";
  ariaLabel?: string;
}) {
  const dark = theme === "dark";
  const containerRef = useRef<HTMLDivElement>(null);
  const routeGroupRef = useRef<SVGGElement>(null);
  const floorRef = useRef<SVGPathElement>(null);
  const aidGroupRef = useRef<SVGGElement>(null);
  const startRef = useRef<SVGCircleElement>(null);
  const finishRef = useRef<SVGCircleElement>(null);

  // Static per-course geometry: downsample to ~600 stations, convert to
  // exaggerated local meters, and run-length-encode the grade colors so the
  // ribbon is a few dozen paths, not thousands.
  const geom = useMemo(() => {
    const n = coords.length;
    if (n < 2 || eles.length !== n) return null;
    const stride = Math.max(1, Math.floor(n / 600));
    const idxs: number[] = [];
    for (let i = 0; i < n; i += stride) idxs.push(i);
    if (idxs[idxs.length - 1] !== n - 1) idxs.push(n - 1);
    const dCoords = idxs.map((i) => coords[i]);
    const dEles = idxs.map((i) => eles[i]);
    let eleMin = Infinity;
    let eleMax = -Infinity;
    for (const e of dEles) {
      if (e < eleMin) eleMin = e;
      if (e > eleMax) eleMax = e;
    }
    // Horizontal span from the raw local conversion (exaggeration 1).
    const flat = toLocalMeters(dCoords, dEles, 1);
    const spanM = 2 * boundingRadius(flat.map((p) => ({ ...p, y: 0 })));
    const ex = autoExaggeration(spanM, eleMax - eleMin);
    const pts = toLocalMeters(dCoords, dEles, ex);
    const radius = boundingRadius(pts);

    // Grade per downsampled point (Δele/Δ2D-dist over ±1 neighbor), then
    // RLE color runs. The hike gate uses the same tight-vs-wide idea as the
    // chart, collapsed to one window at this resolution.
    const dist2 = (a: P3, b: P3) => Math.hypot(b.x - a.x, b.z - a.z);
    const gradeAt = (i: number) => {
      const a = Math.max(0, i - 1);
      const b = Math.min(pts.length - 1, i + 1);
      const d = dist2(flat[a], flat[b]);
      return d > 0 ? (dEles[b] - dEles[a]) / d : 0;
    };
    const colorAt = (i: number) => {
      const g = gradeAt(i);
      return g >= hikeAboveGrade ? "#f43f5e" : gradeColor(g, hikeAboveGrade);
    };
    const runs: { color: string; from: number; to: number }[] = [];
    let runStart = 0;
    let runColor = colorAt(0);
    for (let i = 1; i < pts.length; i++) {
      const c = colorAt(i);
      if (c !== runColor) {
        runs.push({ color: runColor, from: runStart, to: i });
        runStart = i - 1; // share the joint so runs connect
        runColor = c;
      }
    }
    runs.push({ color: runColor, from: runStart, to: pts.length - 1 });

    const aidIdx = aidKms
      .map((km) => {
        const raw = Math.round((km * 1000) / 10);
        let best = 0;
        for (let j = 0; j < idxs.length; j++)
          if (Math.abs(idxs[j] - raw) < Math.abs(idxs[best] - raw)) best = j;
        return best;
      })
      .filter((i) => i > 0 && i < pts.length - 1);

    return { pts, runs, radius, aidIdx };
  }, [coords, eles, hikeAboveGrade, aidKms]);

  // The orbit loop. Everything below is imperative: no React state.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !geom) return;
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    const cam = { yaw: 0.9, pitch: 0.95, auto: !reduced };
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let resumeTimer = 0;
    let raf = 0;

    const draw = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (W === 0 || H === 0) return;
      const scale = (Math.min(W, H) * 0.52) / geom.radius;
      const cx = W / 2;
      const cy = H / 2 + H * 0.06; // ribbon rides slightly high of center
      const P = (p: P3) => {
        const q = projectIso(p, cam.yaw, cam.pitch);
        return [cx + q.X * scale, cy + q.Y * scale] as const;
      };
      const lineOf = (from: number, to: number, flatY: boolean) => {
        const parts: string[] = [];
        for (let i = from; i <= to; i++) {
          const p = geom.pts[i];
          const [X, Y] = P(flatY ? { x: p.x, y: 0, z: p.z } : p);
          parts.push(`${X.toFixed(1)},${Y.toFixed(1)}`);
        }
        return `M${parts.join("L")}`;
      };
      // Ground shadow first (single path over all points)…
      floorRef.current?.setAttribute(
        "d",
        lineOf(0, geom.pts.length - 1, true),
      );
      // …then the colored ribbon runs.
      const g = routeGroupRef.current;
      if (g)
        for (let r = 0; r < geom.runs.length; r++) {
          const run = geom.runs[r];
          (g.children[r] as SVGPathElement)?.setAttribute(
            "d",
            lineOf(run.from, run.to, false),
          );
        }
      // Aid stations: dashed droplines from the shadow to the ribbon + label.
      const ag = aidGroupRef.current;
      if (ag)
        geom.aidIdx.forEach((idx, i) => {
          const p = geom.pts[idx];
          const [x1, y1] = P({ x: p.x, y: 0, z: p.z });
          const [x2, y2] = P(p);
          const line = ag.children[i * 2] as SVGLineElement | undefined;
          const text = ag.children[i * 2 + 1] as SVGTextElement | undefined;
          line?.setAttribute("x1", x1.toFixed(1));
          line?.setAttribute("y1", y1.toFixed(1));
          line?.setAttribute("x2", x2.toFixed(1));
          line?.setAttribute("y2", y2.toFixed(1));
          text?.setAttribute("x", x2.toFixed(1));
          text?.setAttribute("y", (y2 - 8).toFixed(1));
        });
      const [sx, sy] = P(geom.pts[0]);
      const [fx, fy] = P(geom.pts[geom.pts.length - 1]);
      startRef.current?.setAttribute("cx", sx.toFixed(1));
      startRef.current?.setAttribute("cy", sy.toFixed(1));
      finishRef.current?.setAttribute("cx", fx.toFixed(1));
      finishRef.current?.setAttribute("cy", fy.toFixed(1));
    };

    const step = () => {
      if (cam.auto && !dragging) cam.yaw += AUTO_YAW_PER_FRAME;
      draw();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    const down = (e: PointerEvent) => {
      dragging = true;
      cam.auto = false;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      cam.yaw += (e.clientX - lastX) * 0.006;
      cam.pitch = Math.min(
        PITCH_MAX,
        Math.max(PITCH_MIN, cam.pitch + (e.clientY - lastY) * 0.004),
      );
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const up = () => {
      dragging = false;
      window.clearTimeout(resumeTimer);
      if (!reduced)
        resumeTimer = window.setTimeout(() => {
          cam.auto = true;
        }, 2500);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(resumeTimer);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [geom]);

  if (!geom) return null;
  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
    >
      <svg width="100%" height="100%" className="block" aria-hidden>
        <path
          ref={floorRef}
          fill="none"
          stroke={dark ? "#3f3f46" : "#d4d4d8"}
          strokeWidth={1.5}
          opacity={0.8}
        />
        {/* Flat line/text pairs: the draw loop indexes children as i*2. */}
        <g ref={aidGroupRef}>
          {geom.aidIdx.map((idx, i) => (
            <Fragment key={idx}>
              <line
                stroke={dark ? "#a1a1aa" : "#71717a"}
                strokeDasharray="3 4"
                strokeWidth={1}
              />
              <text
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill={dark ? "#d4d4d8" : "#52525b"}
              >
                {`R${i + 1}`}
              </text>
            </Fragment>
          ))}
        </g>
        <g
          ref={routeGroupRef}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {geom.runs.map((run, i) => (
            <path key={i} stroke={run.color} />
          ))}
        </g>
        <circle ref={startRef} r={5} fill="#10b981" stroke="#fff" strokeWidth={2} />
        <circle
          ref={finishRef}
          r={5}
          fill={dark ? "#fafafa" : "#18181b"}
          stroke={dark ? "#18181b" : "#fafafa"}
          strokeWidth={2}
        />
      </svg>
    </div>
  );
}
