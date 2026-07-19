// Shared grade→color scale, used by BOTH the on-page chart and the share-card
// SVG so the two can never drift apart. Thresholds echo the product language:
// blues = descent, emerald = runnable, amber/orange = climbing, rose = the
// power-hike zone — which is defined by the PLAN's transition gate, not a
// fixed steepness, so the chart marks where the plan actually walks.
export function gradeColor(g: number, hikeGate = 0.18): string {
  if (g >= hikeGate) return "#f43f5e"; // rose-500 — power-hike (the plan walks)
  if (g > 0.08) return "#fb923c"; // orange-400 — hard climb
  if (g > 0.03) return "#fbbf24"; // amber-400 — climb
  if (g < -0.08) return "#38bdf8"; // sky-400 — steep descent
  if (g < -0.03) return "#7dd3fc"; // sky-300 — descent
  return "#34d399"; // emerald-400 — flat / runnable
}

// Legend entries for the chart, in course order of effort. Kept here beside
// the scale itself so a color tweak can't silently orphan the legend.
export const GRADE_LEGEND = [
  { label: "descent", color: "#38bdf8" },
  { label: "runnable", color: "#34d399" },
  { label: "climb", color: "#fbbf24" },
  { label: "power-hike", color: "#f43f5e" },
] as const;
