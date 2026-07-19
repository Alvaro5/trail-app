import { describe, expect, it } from "vitest";
import { buildPlanSheetHtml, type PlanSheetData } from "./planSheet";

const DATA: PlanSheetData = {
  lang: "en",
  title: "Imperial <Trail>",
  finishLabel: "Projected finish",
  finish: "7:35:30",
  rangeLine: "expect 6:59 – 8:21",
  stats: [
    { label: "Distance", value: "68.75 km" },
    { label: "Elevation gain", value: "1 193 m" },
  ],
  settingsTitle: "Settings",
  settings: [{ label: "Pace", value: "6:00/km" }],
  profile: Array.from({ length: 200 }, (_, i) => ({
    km: i * 0.01,
    ele: 100 + Math.sin(i / 20) * 30,
  })),
  hikeAboveGrade: 0.18,
  ticks: [{ frac: 0.5, label: "1" }],
  aidMarks: [{ frac: 0.25, label: "R1" }],
  legend: [{ color: "#34d399", label: "runnable" }],
  aidTable: {
    title: "Aid stations",
    cols: ["Aid", "km", "ETA"],
    rows: [["R1", "17.0", "≈ 1:52"]],
  },
  nutritionTable: {
    title: "Nutrition plan",
    cols: ["segment", "time", "carbs"],
    rows: [["Start → R1", "1:52", "131 g"]],
    totalRow: ["Total", "7:36", "531 g"],
    notes: ["≈ 21 gels over the race."],
  },
  splitsTable: {
    title: "Pacing table",
    cols: ["km", "grade", "pace"],
    rows: [
      ["1", "+1%", "6:28/km"],
      ["2 · R1", "+0%", "6:28/km"],
    ],
  },
  footer: "Built with GradePace · gradepace.vercel.app",
};

describe("buildPlanSheetHtml", () => {
  it("renders every section as a self-contained document", () => {
    const html = buildPlanSheetHtml(DATA);
    expect(html).toContain("<!doctype html>");
    for (const s of [
      "7:35:30",
      "expect 6:59 – 8:21",
      "68.75 km",
      "Aid stations",
      "Nutrition plan",
      "Pacing table",
      "531 g",
      "gradepace.vercel.app",
    ])
      expect(html).toContain(s);
    // Profile SVG made it in, with the aid marker.
    expect(html).toContain("<svg");
    expect(html).toContain("R1");
    // No external requests: everything inline.
    expect(html).not.toMatch(/src="http/);
    expect(html).not.toMatch(/href="http/);
  });

  it("escapes HTML in user-supplied text", () => {
    const html = buildPlanSheetHtml(DATA);
    expect(html).toContain("Imperial &lt;Trail&gt;");
    expect(html).not.toContain("Imperial <Trail>");
  });

  it("contains no em dashes (owner style rule)", () => {
    expect(buildPlanSheetHtml(DATA)).not.toContain("—");
  });

  it("omits optional tables when null", () => {
    const html = buildPlanSheetHtml({
      ...DATA,
      aidTable: null,
      nutritionTable: null,
    });
    expect(html).not.toContain("Aid stations");
    expect(html).not.toContain("Nutrition plan");
    expect(html).toContain("Pacing table");
  });
});
