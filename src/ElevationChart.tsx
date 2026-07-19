import {
  Area,
  AreaChart,
  CartesianGrid,
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
}: {
  profile: { km: number; ele: number }[];
  units?: "metric" | "imperial";
  // The plan's run→hike transition grade. Rose on the chart means "the plan
  // walks here", so it must track the actual setting, not a fixed steepness.
  hikeAboveGrade?: number;
}) {
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
      ele: imperial ? p.ele * 3.28084 : p.ele,
      grade: band,
      hike,
    };
  });

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
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
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
          tickFormatter={(v: number) => `${Math.round(v)}${eleUnit}`}
        />
        <Tooltip
          contentStyle={{
            background: "#18181b",
            border: "1px solid #3f3f46",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "#a1a1aa" }}
          formatter={(v, _name, item) => {
            const p = item?.payload as { grade?: number; hike?: boolean };
            const g = p?.grade ?? 0;
            const pct = `${g > 0 ? "+" : ""}${(g * 100).toFixed(0)}%`;
            return [
              `${Math.round(Number(v))} ${eleUnit} · ${pct}${p?.hike ? " · power-hike" : ""}`,
              "elevation",
            ];
          }}
          labelFormatter={(v) => `${distUnit} ${Number(v).toFixed(1)}`}
        />
        <Area
          type="monotone"
          dataKey="ele"
          stroke="url(#gradeStroke)"
          strokeWidth={2.5}
          fill="url(#ele)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
