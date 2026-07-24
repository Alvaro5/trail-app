// Race-day weather: forecast fetch + heat adjustments. Pure module, no React.
//
// Product stance: weather is the one day-of factor a desk plan CAN know in
// advance, but only inside the forecast horizon (~16 days on Open-Meteo).
// Outside it the feature stays quiet with a countdown; inside it the forecast
// widens the SLOW end of the honest range (heat never makes you faster) and
// suggests a fluid bump. The central estimate never moves: a forecast is a
// risk, not a measurement.
//
// Privacy: the request carries a course midpoint rounded to 0.01° (~1 km) and
// the race date. Never track points, never a bounding box tighter than that.
// Open-Meteo is keyless and CORS-open; this is the app's third external
// runtime dependency (map tiles, Overpass, weather).

export type RaceWeather = {
  tMinC: number;
  tMaxC: number;
  precipProbPct: number | null; // max daily probability; null when the model has none
  windMaxKmh: number | null;
};

// Open-Meteo serves ~16 days of daily forecast. Beyond that the UI shows a
// countdown instead of fabricating climatology.
export const FORECAST_HORIZON_DAYS = 16;

// Whole days from today to the date (both "YYYY-MM-DD"); negative = past.
// UTC arithmetic so DST transitions can't make a day count fractional.
export function daysUntil(dateISO: string, todayISO: string): number | null {
  const parse = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const a = parse(dateISO);
  const b = parse(todayISO);
  if (a === null || b === null) return null;
  return Math.round((a - b) / 86_400_000);
}

// Expected slowdown from heat, as a percent of moving time, from the daily
// max. Grounded in marathon/ultra field data (Ely 2007, El Helou 2012):
// recreational pace degrades roughly half a percent to a percent per °C once
// air max clears the mid-teens; we use 0.6%/°C above 16 °C, capped at 12%.
// Conservative middle, applied ONLY to the slow end of the range.
export const HEAT_ONSET_C = 16;
export const HEAT_PCT_PER_C = 0.6;
export const HEAT_PCT_CAP = 12;

export function heatSlowdownPct(tMaxC: number): number {
  if (!Number.isFinite(tMaxC)) return 0;
  return Math.min(HEAT_PCT_CAP, Math.max(0, (tMaxC - HEAT_ONSET_C) * HEAT_PCT_PER_C));
}

// Suggested extra drinking in the heat: +25 ml/h per °C above 18 °C, capped
// at +250 ml/h (sweat-rate guidance tops out; beyond that it's per-athlete).
// A suggestion in copy only — the app never moves the user's slider itself.
export function heatFluidBumpMlPerH(tMaxC: number): number {
  if (!Number.isFinite(tMaxC)) return 0;
  return Math.round(Math.min(250, Math.max(0, (tMaxC - 18) * 25)));
}

// One daily-forecast call for the race date at a rounded midpoint.
// Returns null on any failure — the UI treats weather as strictly optional.
export async function fetchRaceWeather(
  lat: number,
  lon: number,
  dateISO: string,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<RaceWeather | null> {
  const rLat = lat.toFixed(2);
  const rLon = lon.toFixed(2);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${rLat}&longitude=${rLon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max` +
    `&timezone=auto&start_date=${dateISO}&end_date=${dateISO}`;
  try {
    const res = await fetchFn(url, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      daily?: {
        temperature_2m_max?: (number | null)[];
        temperature_2m_min?: (number | null)[];
        precipitation_probability_max?: (number | null)[];
        wind_speed_10m_max?: (number | null)[];
      };
    };
    const tMax = data.daily?.temperature_2m_max?.[0];
    const tMin = data.daily?.temperature_2m_min?.[0];
    if (typeof tMax !== "number" || typeof tMin !== "number") return null;
    const precip = data.daily?.precipitation_probability_max?.[0];
    const wind = data.daily?.wind_speed_10m_max?.[0];
    return {
      tMaxC: tMax,
      tMinC: tMin,
      precipProbPct: typeof precip === "number" ? precip : null,
      windMaxKmh: typeof wind === "number" ? wind : null,
    };
  } catch {
    return null; // network/abort/parse — all non-events for the plan
  }
}
