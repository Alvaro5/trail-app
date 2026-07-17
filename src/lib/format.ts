// Shared time/pace formatters, used by both the UI (src/App.tsx) and the
// shareable plan image (src/lib/shareCard.ts) so the two never drift.

export const pad = (n: number) => String(n).padStart(2, "0");

// Seconds -> "H:MM:SS"
export const fmtClock = (s: number) => {
  const t = Math.round(s);
  return `${Math.floor(t / 3600)}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
};

// Seconds -> "H:MM", rounded to the nearest minute. For range endpoints —
// showing seconds on an uncertainty band would be false precision.
export const fmtClockShort = (s: number) => {
  const min = Math.round(s / 60);
  return `${Math.floor(min / 60)}:${pad(min % 60)}`;
};

// Seconds -> "M:SS" (used for per-km pace)
export const fmtPace = (s: number) => {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${pad(t % 60)}`;
};
