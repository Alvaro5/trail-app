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

// The chart is irrelevant to the wiring under test, and Recharts needs real
// layout measurement that happy-dom doesn't do — stub the lazy chunk out.
vi.mock("./ElevationChart", () => ({
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
    window.location.hash = "#p=5:00&vam=900&gate=25&tf=1.10&u=metric";
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
      const paceInput =
        container.querySelector<HTMLInputElement>("input[aria-invalid]");
      expect(paceInput?.value).toBe("5:00");
    } finally {
      window.location.hash = "";
    }
  });
});
