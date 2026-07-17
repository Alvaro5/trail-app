import { describe, it, expect } from "vitest";
import { buildShareCardSvg, type ShareCardData } from "./shareCard";
import { fmtClock } from "./format";

const base: ShareCardData = {
  title: "Imperial Trail",
  distanceKm: 25.4,
  gainM: 1234,
  timeSec: 12345,
  hikePct: 18,
  avgPaceSecPerKm: 360,
  profile: [
    { km: 0, ele: 100 },
    { km: 1, ele: 150 },
    { km: 2, ele: 120 },
  ],
  siteUrl: "trail-app-two.vercel.app",
};

describe("buildShareCardSvg", () => {
  it("renders a 1200x630 svg with brand, title, finish, and watermark", () => {
    const svg = buildShareCardSvg(base);
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
    expect(svg).toContain("GradePace");
    expect(svg).toContain("Imperial Trail");
    expect(svg).toContain(fmtClock(12345));
    expect(svg).toContain("25.4 km");
    expect(svg).toContain("trail-app-two.vercel.app");
  });

  it("renders the expect-range line only when a range is provided", () => {
    expect(buildShareCardSvg(base)).not.toContain("expect");
    const withRange = buildShareCardSvg({
      ...base,
      rangeLowSec: 11357, // 3:09:17 → 3:09
      rangeHighSec: 13580, // 3:46:20 → 3:46
    });
    expect(withRange).toContain("expect 3:09 – 3:46");
  });

  it("escapes title markup and falls back when empty", () => {
    expect(buildShareCardSvg({ ...base, title: "A & B <x>" })).toContain(
      "A &amp; B &lt;x&gt;",
    );
    expect(buildShareCardSvg({ ...base, title: "  " })).toContain("Race plan");
  });

  it("handles empty / single-point profiles without producing NaN", () => {
    for (const profile of [[], [{ km: 0, ele: 100 }]]) {
      expect(buildShareCardSvg({ ...base, profile })).not.toContain("NaN");
    }
  });
});
