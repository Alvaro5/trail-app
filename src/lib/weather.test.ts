import { describe, expect, it, vi } from "vitest";
import {
  daysUntil,
  fetchRaceWeather,
  heatFluidBumpMlPerH,
  heatSlowdownPct,
  HEAT_PCT_CAP,
} from "./weather";

describe("daysUntil", () => {
  it("counts whole days, same day is 0", () => {
    expect(daysUntil("2026-09-12", "2026-09-12")).toBe(0);
    expect(daysUntil("2026-09-13", "2026-09-12")).toBe(1);
    expect(daysUntil("2026-10-01", "2026-09-24")).toBe(7);
  });

  it("is negative for past dates and crosses month/year boundaries", () => {
    expect(daysUntil("2026-09-11", "2026-09-12")).toBe(-1);
    expect(daysUntil("2027-01-02", "2026-12-31")).toBe(2);
  });

  it("rejects malformed dates", () => {
    expect(daysUntil("2026-9-12", "2026-09-12")).toBeNull();
    expect(daysUntil("someday", "2026-09-12")).toBeNull();
  });
});

describe("heatSlowdownPct", () => {
  it("is zero at or below the onset", () => {
    expect(heatSlowdownPct(10)).toBe(0);
    expect(heatSlowdownPct(16)).toBe(0);
  });

  it("grows 0.6%/°C above 16 °C", () => {
    expect(heatSlowdownPct(26)).toBeCloseTo(6, 5);
    expect(heatSlowdownPct(31)).toBeCloseTo(9, 5);
  });

  it("caps at the ceiling and survives garbage", () => {
    expect(heatSlowdownPct(60)).toBe(HEAT_PCT_CAP);
    expect(heatSlowdownPct(NaN)).toBe(0);
  });
});

describe("heatFluidBumpMlPerH", () => {
  it("zero in the cool, +25 ml/h per °C above 18, capped at 250", () => {
    expect(heatFluidBumpMlPerH(15)).toBe(0);
    expect(heatFluidBumpMlPerH(24)).toBe(150);
    expect(heatFluidBumpMlPerH(40)).toBe(250);
  });
});

describe("fetchRaceWeather", () => {
  const daily = {
    temperature_2m_max: [27.3],
    temperature_2m_min: [13.9],
    precipitation_probability_max: [20],
    wind_speed_10m_max: [18.4],
  };

  it("requests a rounded coordinate for the exact date and parses the day", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ daily }),
    })) as unknown as typeof fetch;
    const w = await fetchRaceWeather(48.404871, 2.691234, "2026-09-12", fetchFn);
    expect(w).toEqual({
      tMaxC: 27.3,
      tMinC: 13.9,
      precipProbPct: 20,
      windMaxKmh: 18.4,
    });
    const url = (fetchFn as unknown as { mock: { calls: [string][] } }).mock
      .calls[0][0];
    // Privacy: two decimals only — never the full-precision midpoint.
    expect(url).toContain("latitude=48.40");
    expect(url).toContain("longitude=2.69");
    expect(url).not.toContain("48.404871");
    expect(url).toContain("start_date=2026-09-12");
    expect(url).toContain("end_date=2026-09-12");
  });

  it("returns null on HTTP errors, missing temps, and thrown fetches", async () => {
    const bad = vi.fn(async () => ({ ok: false })) as unknown as typeof fetch;
    expect(await fetchRaceWeather(48, 2, "2026-09-12", bad)).toBeNull();

    const empty = vi.fn(async () => ({
      ok: true,
      json: async () => ({ daily: { temperature_2m_max: [null] } }),
    })) as unknown as typeof fetch;
    expect(await fetchRaceWeather(48, 2, "2026-09-12", empty)).toBeNull();

    const boom = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchRaceWeather(48, 2, "2026-09-12", boom)).toBeNull();
  });

  it("tolerates a missing precipitation probability (late-horizon days)", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        daily: {
          temperature_2m_max: [22],
          temperature_2m_min: [9],
          precipitation_probability_max: [null],
        },
      }),
    })) as unknown as typeof fetch;
    const w = await fetchRaceWeather(48, 2, "2026-09-12", fetchFn);
    expect(w?.tMaxC).toBe(22);
    expect(w?.precipProbPct).toBeNull();
    expect(w?.windMaxKmh).toBeNull();
  });
});
