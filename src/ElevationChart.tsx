import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { gradeColor } from "./lib/gradeColor";

// Split out of App.tsx solely so Recharts (~500 kB of the bundle, by far the
// heaviest dependency) loads as its own async chunk via React.lazy — the page
// paints and is interactive before the chart library arrives.

export default function ElevationChart({
  profile,
  units = "metric",
  hikeAboveGrade = 0.18,
  height = 160,
  labels = { elevation: "elevation", powerHike: "power-hike" },
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
  labels?: { elevation: string; powerHike: string };
  // SVG attributes can't use Tailwind variants, so the grid/tooltip colors
  // come from a prop instead of CSS.
  theme?: "dark" | "light";
  // Plan pace for the split containing a metric km — shown in the tooltip so
  // hovering answers "what will I be doing here".
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
  const totalKm = profile.length
    ? profile[profile.length - 1].km - profile[0].km
    : 0;

  // Grade at point i over a ±(w×10 m) window (metric profile, BEFORE unit
  // conversion — ft/mi would skew the ratio).
  const gradeAt = (i: number, w: number) => {
    const a = Math.max(0, i - w);
    const b = Math.min(profile.length - 1, i + w);
    const dKm = profile[b].km - profile[a].km;
    return dKm > 0 ? (profile[b].ele - profile[a].ele) / (dKm * 1000) : 0;
  };

  // Two windows: a wide one (±100 m) keeps the effort colors from
  // flickering, but it would smooth short steep walls below the hike gate —
  // exactly the stretches worth marking. A tight ±30 m check catches those.
  const data = profile.map((p, i) => {
    const band = gradeAt(i, 10);
    const hike = gradeAt(i, 3) >= hikeAboveGrade;
    return {
      km: imperial ? p.km / 1.609344 : p.km,
      kmMetric: p.km,
      ele: imperial ? p.ele * 3.28084 : p.ele,
      grade: band,
      hike,
      pace: paceLabelAt?.(p.km) ?? null,
    };
  });

  // Padded Y domain so the profile uses the panel instead of anchoring at 0.
  let eleMin = Infinity;
  let eleMax = -Infinity;
  for (const d of data) {
    if (d.ele < eleMin) eleMin = d.ele;
    if (d.ele > eleMax) eleMax = d.ele;
  }
  const elePad = Math.max((eleMax - eleMin) * 0.08, 1);
  const eleDomain: [number, number] = Number.isFinite(eleMin)
    ? [Math.floor(eleMin - elePad), Math.ceil(eleMax + elePad)]
    : [0, 1];

  // Grade-colored stroke: a horizontal gradient, run-length encoded — a pair
  // of stops per color CHANGE, not per sample. Uniform sampling missed the
  // point of the feature: on a 70 km course a fixed ~150 samples lands every
  // ~460 m, and Fontainebleau's power-hike walls are 30–100 m long, so the
  // rose zones fell between samples and the chart showed no hiking at all.
  // Scanning a 30 m grid and emitting stops only at transitions marks every
  // wall while keeping the stop count low (bands change rarely).
  const stops: { off: number; color: string }[] = [];
  if (totalKm > 0) {
    const off = (i: number) => (profile[i].km - profile[0].km) / totalKm;
    const colorAt = (i: number) =>
      data[i].hike ? "#f43f5e" : gradeColor(data[i].grade, hikeAboveGrade);
    let prev = "";
    let prevI = 0;
    for (let i = 0; i < profile.length; i += 3) {
      const c = colorAt(i);
      if (c !== prev) {
        // Close the outgoing band at its true edge so colors switch crisply
        // instead of smearing across the whole gap between stops.
        if (prev) stops.push({ off: off(i - 1), color: prev });
        stops.push({ off: off(i), color: c });
        prev = c;
      }
      prevI = i;
    }
    if (prev) stops.push({ off: off(prevI), color: prev });
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        data={data}
        margin={{ top: 5, right: 5, bottom: 0, left: 0 }}
        onMouseMove={(state) => {
          // Recharts v3 exposes the hovered x-value as `activeLabel` on the
          // chart-level mouse state (activePayload is tooltip-only now).
          // The label is in DISPLAY units — convert back to metric km.
          const label = (state as { activeLabel?: number | string })
            ?.activeLabel;
          const v = typeof label === "number" ? label : Number(label);
          if (onHoverKm && Number.isFinite(v))
            onHoverKm(imperial ? v * 1.609344 : v);
        }}
        onMouseLeave={() => onHoverKm?.(null)}
      >
        <defs>
          <linearGradient id="ele" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradeStroke" x1="0" y1="0" x2="1" y2="0">
            {stops.map((s, i) => (
              <stop
                key={i}
                offset={`${(s.off * 100).toFixed(2)}%`}
                stopColor={s.color}
              />
            ))}
          </linearGradient>
        </defs>
        <CartesianGrid stroke={dark ? "#27272a" : "#e4e4e7"} vertical={false} />
        <XAxis
          dataKey="km"
          type="number"
          domain={[0, "dataMax"]}
          tickFormatter={(v: number) => v.toFixed(0)}
          stroke="#71717a"
          fontSize={12}
          tickLine={false}
        />
        {/* Padded explicit domain instead of a forced 0-baseline: a course
            living at 70–160 m otherwise spends half the panel on empty space
            and every hill flattens. */}
        <YAxis
          width={52}
          domain={[eleDomain[0], eleDomain[1]]}
          stroke="#71717a"
          fontSize={12}
          tickLine={false}
          tickFormatter={(v: number) => `${Math.round(v)}${eleUnit}`}
        />
        <Tooltip
          isAnimationActive={false}
          contentStyle={{
            background: dark ? "#18181b" : "#ffffff",
            border: `1px solid ${dark ? "#3f3f46" : "#d4d4d8"}`,
            borderRadius: 8,
            fontSize: 12,
            color: dark ? "#fafafa" : "#18181b",
          }}
          labelStyle={{ color: dark ? "#a1a1aa" : "#52525b" }}
          formatter={(v, _name, item) => {
            const p = item?.payload as {
              grade?: number;
              hike?: boolean;
              pace?: string | null;
            };
            const g = p?.grade ?? 0;
            const pct = `${g > 0 ? "+" : ""}${(g * 100).toFixed(0)}%`;
            const pace = p?.pace ? ` · ${p.pace}` : "";
            return [
              `${Math.round(Number(v))} ${eleUnit} · ${pct}${pace}${p?.hike ? ` · ${labels.powerHike}` : ""}`,
              labels.elevation,
            ];
          }}
          labelFormatter={(v) => `${distUnit} ${Number(v).toFixed(1)}`}
        />
        {/* No path animation: with ~7k resampled points it fights custom
            domains/baselines in Recharts, and it re-played on every input
            keystroke anyway. The page-level fade covers the entrance. */}
        {/* Aid-station markers, above the area so they read on the fill. */}
        {aidKms?.map((k, i) => (
          <ReferenceLine
            key={k}
            x={imperial ? k / 1.609344 : k}
            stroke={dark ? "#a1a1aa" : "#71717a"}
            strokeDasharray="4 4"
            label={{
              value: `R${i + 1}`,
              position: "insideTop",
              fill: dark ? "#d4d4d8" : "#52525b",
              fontSize: 11,
            }}
          />
        ))}
        <Area
          type="monotone"
          dataKey="ele"
          baseValue={eleDomain[0]}
          stroke="url(#gradeStroke)"
          strokeWidth={2.5}
          fill="url(#ele)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
