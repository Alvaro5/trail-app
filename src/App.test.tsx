// @vitest-environment happy-dom
// App-level smoke test: the engine is locked by unit tests, but nothing else
// guarded the WIRING — "engine fine, page broken" is exactly what a visitor
// would see. This renders the real <App/> and asserts the auto-load → badge →
// dashboard flow end to end.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// React 19 requires this flag for act() outside a test renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// The chart and map are irrelevant to the wiring under test, and Recharts/
// Leaflet need real layout measurement that happy-dom doesn't do — stub the
// lazy chunks out.
vi.mock("./ElevationChart", () => ({
  default: () => null,
}));
vi.mock("./CourseMap", () => ({
  default: () => null,
}));

// A tiny but structurally real course: ~2.2 km of northward track with a
// climb, enough for the full pipeline (resample → smooth → splits) to run.
const EXAMPLE_GPX = `<gpx><trk><trkseg>${Array.from({ length: 21 }, (_, i) => {
  const lat = 48.4 + i * 0.001; // ≈111 m per step
  const ele = 100 + (i < 10 ? i * 10 : (20 - i) * 10); // up then down
  return `<trkpt lat="${lat}" lon="2.6"><ele>${ele}</ele></trkpt>`;
}).join("")}</trkseg></trk></gpx>`;

async function flush(times = 20) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

describe("App smoke test", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => EXAMPLE_GPX })),
    );
  });

  it("auto-loads the example course and renders the full dashboard", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(<App />);
    });
    await flush();

    const text = container.textContent ?? "";
    expect(text).toContain("GradePace");
    // The bundled course was fetched through the same path as an upload…
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("example-imperial-trail.gpx"),
    );
    // …and is honestly badged as an example.
    expect(text).toContain("Example");
    // The dashboard rendered: stats, range line, and the splits table.
    expect(text).toContain("Projected finish");
    expect(text).toContain("expect");
    expect(text).toContain("Elevation gain");
    expect(container.querySelectorAll("table tbody tr").length).toBeGreaterThan(
      0,
    );
  });

  it("restores a shared plan from the URL hash", async () => {
    // Stations must sit INSIDE the ~2.2 km test course or they're filtered
    // out (and the cutoff row only renders when stations exist).
    window.location.hash =
      "#p=5:00&vam=900&gate=25&tf=1.10&u=metric&rav=1,2&dw=6&st=8:30&co=1:00,2:00";
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      await act(async () => {
        createRoot(container).render(<App />);
      });
      await flush();

      const text = container.textContent ?? "";
      // Advanced-settings content is in the DOM even while collapsed.
      expect(text).toContain("×1.10");
      expect(text).toContain("900 m/h");
      expect(text).toContain("25%");
      // First aria-invalid-capable input in DOM order is the pace field
      // (the start-time input also carries aria-invalid now, but renders
      // further down the page).
      const paceInput =
        container.querySelector<HTMLInputElement>("input[aria-invalid]");
      expect(paceInput?.value).toBe("5:00");
      // Aid stations travel with the link too (metric canonical in the hash).
      const aidInput = container.querySelector<HTMLInputElement>(
        'input[aria-label="Aid stations"]',
      );
      expect(aidInput?.value).toBe("1, 2");
      // Logistics travel too: dwell minutes, start time, cutoffs.
      expect(
        container.querySelector<HTMLInputElement>(
          'input[aria-label="Stop time"]',
        )?.value,
      ).toBe("6");
      expect(
        container.querySelector<HTMLInputElement>('input[aria-label="Start"]')
          ?.value,
      ).toBe("8:30");
      expect(
        container.querySelector<HTMLInputElement>(
          'input[aria-label="Cutoffs"]',
        )?.value,
      ).toBe("1:00, 2:00");
      // Start time set → wall-clock times appear on the aid chips
      // (a few minutes into an 8:30 start → 08:xx).
      expect(text).toMatch(/08:\d{2}/);
    } finally {
      window.location.hash = "";
    }
  });

  it("restores a saved plan instead of the example, hash still winning", async () => {
    // The env's localStorage global is non-functional; give the app a real
    // in-memory one for this test.
    const m = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
    } as unknown as Storage);
    const saved = {
      v: 1,
      savedAt: 1,
      gpxText: EXAMPLE_GPX,
      title: "My saved race",
      units: "metric",
      paceText: "5:45",
      vam: 850,
      gatePct: 22,
      terrainFactor: 1.12,
      calibrated: true,
      aidText: "1",
      dwellMin: 4,
      startText: "7:30",
      cutoffText: "",
      carbsGPerH: 85,
      fluidMlPerH: 550,
      sodiumMgPerH: 500,
    };
    localStorage.setItem("gp-plan-v1", JSON.stringify(saved));
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      await act(async () => {
        createRoot(container).render(<App />);
      });
      await flush();

      const text = container.textContent ?? "";
      // No example fetch: the saved course rendered instead.
      expect(fetch).not.toHaveBeenCalled();
      expect(text).not.toContain("Example");
      expect(text).toContain("Saved");
      expect(text).toContain("Forget this plan");
      // Settings restored.
      expect(
        container.querySelector<HTMLInputElement>("input[aria-invalid]")
          ?.value,
      ).toBe("5:45");
      expect(text).toContain("×1.12");
      expect(text).toContain("850 m/h");
      // Calibrated flag survived the restore (narrow band tag).
      expect(text).toContain("calibrated");

      // Hash overrides saved for the settings it carries.
      localStorage.setItem("gp-plan-v1", JSON.stringify(saved));
      window.location.hash = "#p=4:30&tf=1.00";
      const c2 = document.createElement("div");
      document.body.appendChild(c2);
      await act(async () => {
        createRoot(c2).render(<App />);
      });
      await flush();
      window.location.hash = "";
      expect(
        c2.querySelector<HTMLInputElement>("input[aria-invalid]")?.value,
      ).toBe("4:30");
      expect(c2.textContent).toContain("×1.00");
      // A hash terrain factor is a guess, not the saved measurement.
      expect(c2.textContent).not.toContain("calibrated");
    } finally {
      vi.unstubAllGlobals();
      window.location.hash = "";
    }
  });

  it("shifts the finish by dwell times the station count", async () => {
    // Two stations at default 3 min dwell = +6 min vs the same plan with
    // dwell 0. Compare the two rendered finish times.
    const renderWithHash = async (hash: string) => {
      window.location.hash = hash;
      const container = document.createElement("div");
      document.body.appendChild(container);
      await act(async () => {
        createRoot(container).render(<App />);
      });
      await flush();
      window.location.hash = "";
      return container;
    };
    const noDwell = await renderWithHash("#rav=1,2&dw=0");
    const withDwell = await renderWithHash("#rav=1,2&dw=3");
    const finishOf = (c: HTMLElement) => {
      // The hero card value is the only H:MM:SS inside the stats grid.
      const m = (c.textContent ?? "").match(/(\d+):(\d{2}):(\d{2})/);
      if (!m) return null;
      return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    };
    const a = finishOf(noDwell);
    const b = finishOf(withDwell);
    expect(a).not.toBeNull();
    expect(b! - a!).toBe(360);
  });

  it("renders the nutrition card with legs from the aid stations", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(<App />);
    });
    await flush();

    const text = container.textContent ?? "";
    expect(text).toContain("Nutrition plan");
    // No stations on the example → a single Start → Finish segment, WITHOUT
    // a totals row (it would duplicate the only row), plus the hint that
    // adding aid stations breaks the table into segments.
    expect(text).toContain("Start → Finish");
    expect(text).not.toContain("Total");
    expect(text).toContain("Add your aid stations");
    // Defaults visible on the sliders.
    expect(text).toContain("70 g/h");
    expect(text).toContain("500 ml/h");
    expect(text).toContain("450 mg/h");
    expect(text).toContain("gels");
  });

  it("restores customized nutrition rates from the URL hash", async () => {
    window.location.hash = "#nc=90&nfl=750&ns=800";
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      await act(async () => {
        createRoot(container).render(<App />);
      });
      await flush();

      const text = container.textContent ?? "";
      expect(text).toContain("90 g/h");
      expect(text).toContain("750 ml/h");
      expect(text).toContain("800 mg/h");
    } finally {
      window.location.hash = "";
    }
  });
});
