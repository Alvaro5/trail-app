import { useEffect, useMemo, useRef, useState } from "react";
import { gradeColor } from "./lib/gradeColor";
import { cumulativeGainSeries } from "./lib/pacing";

// Hand-rolled SVG elevation chart. This replaced Recharts (the app's
// heaviest chunk, ~100 kB gzip, used for exactly one area chart) with ~300
// lines we fully control. Same visual contract as before: grade-colored
// stroke (rose = the plan walks here), soft emerald area fill, horizontal
// gridlines, aid-station markers, and a tooltip that answers "what will I
// be doing HERE". Hover is fully IMPERATIVE: pointer-moves mutate the
// tooltip/cursor DOM through refs and never touch React state, so tracking
// stays at input speed no matter how big the dashboard gets.

const AXIS_LEFT = 52;
const AXIS_BOTTOM = 22;
const PAD_TOP = 8;
const PAD_RIGHT = 5;

// A tick step that lands on 1/2/2.5/5×10^k, aiming for a given tick count.
function niceStep(range: number, targetTicks: number): number {
  if (!(range > 0)) return 1;
  const raw = range / Math.max(1, targetTicks);
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

export default function ElevationChart({
  profile,
  units = "metric",
  hikeAboveGrade = 0.18,
  height = 160,
  labels = { elevation: "elevation", powerHike: "power-hike", dplusLeft: "D+ left" },
  theme = "dark",
  paceLabelAt,
  aidKms,
  onHoverKm,
}: {
  profile: { km: number; ele: number }[];
  units?: "metric" | "imperial";
  // The plan's run→hike transition grade. Rose on the chart means "the plan
  // walks here", so it must track the actual setting, not a fixed steepness.
  hikeAboveGrade?: number;
  // Number of px, or "100%" to fill a sized parent (the fullscreen view).
  height?: number | `${number}%`;
  // Tooltip words, provided by the caller so the chart follows the app language.
  labels?: { elevation: string; powerHike: string; dplusLeft: string };
  theme?: "dark" | "light";
  // Plan pace for the split containing a metric km — shown in the tooltip.
  paceLabelAt?: (kmMetric: number) => string | null;
  // Aid-station positions in metric km — dashed markers labeled R1, R2, …
  aidKms?: number[];
  // Reports the hovered course position (metric km, null on leave) so the
  // map can mirror it with a marker.
  onHoverKm?: (kmMetric: number | null) => void;
}) {
  const dark = theme === "dark";
  const imperial = units === "imperial";
  const eleUnit = imperial ? "ft" : "m";
  const distUnit = imperial ? "mi" : "km";

  // Measured pixel size of the container; the SVG is drawn in real pixels so
  // text never scales oddly. Fallback for environments without
  // ResizeObserver (tests) and for the first pre-measure render.
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: typeof height === "number" ? height : 300 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0)
        setSize((prev) =>
          Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
            ? prev
            : { w: r.width, h: r.height },
        );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = size.w;
  const H = size.h;
  const plotW = Math.max(10, W - AXIS_LEFT - PAD_RIGHT);
  const plotH = Math.max(10, H - PAD_TOP - AXIS_BOTTOM);

  const geom = useMemo(() => {
    if (profile.length < 2) return null;
    const km0 = profile[0].km;
    const totalKm = profile[profile.length - 1].km - km0;
    if (!(totalKm > 0)) return null;

    // Grade at point i over a ±(w×10 m) window (metric profile). Two
    // windows: a wide one (±100 m) keeps effort colors stable; a tight
    // ±30 m check still catches the short steep walls worth marking.
    const gradeAt = (i: number, w: number) => {
      const a = Math.max(0, i - w);
      const b = Math.min(profile.length - 1, i + w);
      const dKm = profile[b].km - profile[a].km;
      return dKm > 0 ? (profile[b].ele - profile[a].ele) / (dKm * 1000) : 0;
    };
    const hikeAt = (i: number) => gradeAt(i, 3) >= hikeAboveGrade;
    const colorAt = (i: number) =>
      hikeAt(i) ? "#f43f5e" : gradeColor(gradeAt(i, 10), hikeAboveGrade);

    // Padded Y domain so the profile uses the panel instead of hugging 0.
    let eleMin = Infinity;
    let eleMax = -Infinity;
    for (const p of profile) {
      if (p.ele < eleMin) eleMin = p.ele;
      if (p.ele > eleMax) eleMax = p.ele;
    }
    const pad = Math.max((eleMax - eleMin) * 0.08, 1);
    const y0 = Math.floor(eleMin - pad);
    const y1 = Math.ceil(eleMax + pad);

    const x = (km: number) => AXIS_LEFT + ((km - km0) / totalKm) * plotW;
    const y = (ele: number) => PAD_TOP + (1 - (ele - y0) / (y1 - y0)) * plotH;

    // Path, downsampled to ~2 points per horizontal pixel: invisible at
    // render, meaningfully lighter for the DOM on 7k-point courses.
    const stride = Math.max(1, Math.floor(profile.length / (plotW * 2)));
    const pts: string[] = [];
    for (let i = 0; i < profile.length; i += stride)
      pts.push(`${x(profile[i].km).toFixed(1)},${y(profile[i].ele).toFixed(1)}`);
    const last = profile[profile.length - 1];
    pts.push(`${x(last.km).toFixed(1)},${y(last.ele).toFixed(1)}`);
    const line = `M${pts.join("L")}`;
    const baseY = PAD_TOP + plotH;
    const area = `${line}L${(AXIS_LEFT + plotW).toFixed(1)},${baseY}L${AXIS_LEFT},${baseY}Z`;

    // Grade-colored stroke: run-length encoded gradient stops on a 30 m
    // grid — a pair per color CHANGE, so short walls survive without
    // thousands of stops.
    const stops: { off: number; color: string }[] = [];
    let prev = "";
    let prevI = 0;
    for (let i = 0; i < profile.length; i += 3) {
      const c = colorAt(i);
      if (c !== prev) {
        if (prev)
          stops.push({ off: (profile[i - 1].km - km0) / totalKm, color: prev });
        stops.push({ off: (profile[i].km - km0) / totalKm, color: c });
        prev = c;
      }
      prevI = i;
    }
    if (prev) stops.push({ off: (profile[prevI].km - km0) / totalKm, color: prev });

    // Axis ticks.
    const displayTotal = imperial ? totalKm / 1.609344 : totalKm;
    const xStep = niceStep(displayTotal, Math.max(3, Math.floor(plotW / 90)));
    const xTicks: { px: number; label: string }[] = [];
    for (let u = 0; u <= displayTotal + 1e-9; u += xStep) {
      const km = km0 + (imperial ? u * 1.609344 : u);
      xTicks.push({ px: x(km), label: String(Math.round(u)) });
    }
    const yStep = niceStep(
      (imperial ? (y1 - y0) * 3.28084 : y1 - y0),
      Math.max(2, Math.floor(plotH / 55)),
    );
    const yTicks: { py: number; label: string }[] = [];
    const dispY0 = imperial ? y0 * 3.28084 : y0;
    const dispY1 = imperial ? y1 * 3.28084 : y1;
    for (
      let v = Math.ceil(dispY0 / yStep) * yStep;
      v <= dispY1 + 1e-9;
      v += yStep
    ) {
      const ele = imperial ? v / 3.28084 : v;
      yTicks.push({ py: y(ele), label: `${Math.round(v)}${eleUnit}` });
    }

    // Climbing left from any point, consistent with the headline D+ (same
    // 5 m hysteresis the app-level cumulativeGain uses).
    const gainSeries = cumulativeGainSeries(
      profile.map((p) => p.ele),
      5,
    );
    const gainTotal = gainSeries[gainSeries.length - 1] ?? 0;
    return {
      totalKm,
      km0,
      x,
      y,
      line,
      area,
      stops,
      xTicks,
      yTicks,
      gradeAt,
      hikeAt,
      gainSeries,
      gainTotal,
    };
  }, [profile, hikeAboveGrade, imperial, plotW, plotH, eleUnit]);

  // Entrance: the profile draws itself left to right on a new course (the
  // first thing a visitor sees doing something). Imperative dash animation,
  // cleared afterwards so the gradient stroke is untouched; skipped for
  // reduced-motion users and environments without getTotalLength (tests).
  const strokeRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);
  const drawnKey = useRef("");
  useEffect(() => {
    const path = strokeRef.current;
    if (!path || !geom) return;
    const key = `${profile.length}:${profile[profile.length - 1]?.km}`;
    if (drawnKey.current === key) return; // resize re-renders don't replay
    drawnKey.current = key;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches)
      return;
    let len = 0;
    try {
      len = path.getTotalLength();
    } catch {
      return;
    }
    if (!len) return;
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
    if (areaRef.current) areaRef.current.style.opacity = "0";
    const t0 = performance.now();
    const D = 1100;
    let raf = 0;
    const step = (now: number) => {
      const f = Math.min(1, (now - t0) / D);
      const e = 1 - Math.pow(1 - f, 3);
      path.style.strokeDashoffset = String(len * (1 - e));
      if (areaRef.current) areaRef.current.style.opacity = String(e * e);
      if (f < 1) raf = requestAnimationFrame(step);
      else {
        path.style.strokeDasharray = "";
        path.style.strokeDashoffset = "";
        if (areaRef.current) areaRef.current.style.opacity = "";
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the course, not on resize-driven geometry
  }, [profile]);

  // ---- Imperative hover machinery: no React state past this line. ----
  const tooltipRef = useRef<HTMLDivElement>(null);
  const cursorLineRef = useRef<SVGLineElement>(null);
  const cursorDotRef = useRef<SVGCircleElement>(null);

  const hideHover = () => {
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
    cursorLineRef.current?.setAttribute("visibility", "hidden");
    cursorDotRef.current?.setAttribute("visibility", "hidden");
    onHoverKm?.(null);
  };

  const handleMove = (e: React.PointerEvent) => {
    if (!geom || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < AXIS_LEFT || px > AXIS_LEFT + plotW) {
      hideHover();
      return;
    }
    const frac = (px - AXIS_LEFT) / plotW;
    const km = geom.km0 + frac * geom.totalKm;
    // Profile points are evenly spaced → direct index lookup.
    const idx = Math.min(
      profile.length - 1,
      Math.max(0, Math.round(((km - geom.km0) / geom.totalKm) * (profile.length - 1))),
    );
    const p = profile[idx];
    const cx = geom.x(p.km);
    const cy = geom.y(p.ele);
    const line = cursorLineRef.current;
    if (line) {
      line.setAttribute("x1", String(cx));
      line.setAttribute("x2", String(cx));
      line.setAttribute("visibility", "visible");
    }
    const dot = cursorDotRef.current;
    if (dot) {
      dot.setAttribute("cx", String(cx));
      dot.setAttribute("cy", String(cy));
      dot.setAttribute("visibility", "visible");
    }
    const tip = tooltipRef.current;
    if (tip) {
      const g = geom.gradeAt(idx, 10);
      const pct = `${g > 0 ? "+" : ""}${(g * 100).toFixed(0)}%`;
      const eleStr = imperial
        ? `${Math.round(p.ele * 3.28084)} ${eleUnit}`
        : `${Math.round(p.ele)} ${eleUnit}`;
      const kmStr = (imperial ? p.km / 1.609344 : p.km).toFixed(1);
      const pace = paceLabelAt?.(p.km);
      tip.querySelector("[data-tip-label]")!.textContent = `${distUnit} ${kmStr}`;
      const leftM = Math.max(0, geom.gainTotal - geom.gainSeries[idx]);
      const leftStr = imperial
        ? `${Math.round(leftM * 3.28084)} ft`
        : `${Math.round(leftM)} m`;
      tip.querySelector("[data-tip-value]")!.textContent =
        `${eleStr} · ${pct}${pace ? ` · ${pace}` : ""} · ${labels.dplusLeft} ${leftStr}${geom.hikeAt(idx) ? ` · ${labels.powerHike}` : ""}`;
      tip.style.display = "block";
      // Flip sides near the right edge so the tooltip never clips.
      const tipW = tip.offsetWidth;
      const flip = px + 14 + tipW > W;
      tip.style.left = `${flip ? px - tipW - 12 : px + 12}px`;
      tip.style.top = `${Math.max(4, Math.min(e.clientY - rect.top - 40, H - 60))}px`;
    }
    onHoverKm?.(p.km);
  };

  const gridColor = dark ? "#27272a" : "#e4e4e7";
  const axisText = "#71717a";
  const containerStyle =
    typeof height === "number" ? { height } : { height: "100%" as const };

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none"
      style={containerStyle}
      onPointerMove={handleMove}
      onPointerLeave={hideHover}
    >
      {geom && (
        <svg width={W} height={H} className="block" aria-hidden>
          <defs>
            <linearGradient id="gp-ele-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
            <linearGradient
              id="gp-ele-stroke"
              x1={AXIS_LEFT}
              y1="0"
              x2={AXIS_LEFT + plotW}
              y2="0"
              gradientUnits="userSpaceOnUse"
            >
              {geom.stops.map((s, i) => (
                <stop
                  key={i}
                  offset={`${(s.off * 100).toFixed(2)}%`}
                  stopColor={s.color}
                />
              ))}
            </linearGradient>
          </defs>
          {geom.yTicks.map((tk) => (
            <g key={tk.py}>
              <line
                x1={AXIS_LEFT}
                x2={AXIS_LEFT + plotW}
                y1={tk.py}
                y2={tk.py}
                stroke={gridColor}
              />
              <text
                x={AXIS_LEFT - 6}
                y={tk.py + 4}
                textAnchor="end"
                fontSize={12}
                fill={axisText}
              >
                {tk.label}
              </text>
            </g>
          ))}
          {geom.xTicks.map((tk) => (
            <text
              key={tk.px}
              x={tk.px}
              y={H - 6}
              textAnchor="middle"
              fontSize={12}
              fill={axisText}
            >
              {tk.label}
            </text>
          ))}
          <path ref={areaRef} d={geom.area} fill="url(#gp-ele-fill)" />
          <path
            ref={strokeRef}
            d={geom.line}
            fill="none"
            stroke="url(#gp-ele-stroke)"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Aid-station markers, above the area so they read on the fill. */}
          {aidKms?.map((k, i) => (
            <g key={k}>
              <line
                x1={geom.x(k)}
                x2={geom.x(k)}
                y1={PAD_TOP}
                y2={PAD_TOP + plotH}
                stroke={dark ? "#a1a1aa" : "#71717a"}
                strokeDasharray="4 4"
              />
              <text
                x={geom.x(k)}
                y={PAD_TOP + 12}
                textAnchor="middle"
                fontSize={11}
                fill={dark ? "#d4d4d8" : "#52525b"}
              >
                {`R${i + 1}`}
              </text>
            </g>
          ))}
          {/* Hover cursor, moved imperatively. */}
          <line
            ref={cursorLineRef}
            y1={PAD_TOP}
            y2={PAD_TOP + plotH}
            stroke={dark ? "#52525b" : "#a1a1aa"}
            strokeDasharray="3 3"
            visibility="hidden"
          />
          <circle
            ref={cursorDotRef}
            r={4}
            fill="#34d399"
            stroke="#ffffff"
            strokeWidth={1.5}
            visibility="hidden"
          />
        </svg>
      )}
      {/* Tooltip, positioned imperatively; hidden until the first hover. */}
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-10 rounded-lg border px-2.5 py-1.5 text-xs shadow-md"
        style={{
          display: "none",
          background: dark ? "#18181b" : "#ffffff",
          borderColor: dark ? "#3f3f46" : "#d4d4d8",
        }}
      >
        <div data-tip-label style={{ color: dark ? "#a1a1aa" : "#52525b" }} />
        <div
          data-tip-value
          className="mt-0.5 font-medium tabular-nums"
          style={{ color: dark ? "#fafafa" : "#18181b" }}
        />
      </div>
    </div>
  );
}
