// Builds the shareable plan image as a self-contained SVG string.
//
// Why an SVG built here (not a screenshot of the dashboard): Tailwind v4
// compiles to oklch() colors, which the DOM-screenshot libraries
// (html2canvas / html-to-image) choke on. This card uses only explicit hex
// colors and a system-font stack, so it rasterizes cleanly in any browser
// (see src/lib/rasterize.ts). The visual language mirrors public/og.svg.

import { fmtClock, fmtClockShort, fmtPace } from "./format";

export type ShareCardData = {
  title: string;
  distanceKm: number;
  gainM: number;
  timeSec: number;
  // Optional uncertainty band around timeSec; when present, the card shows
  // "EXPECT L – H" under the hero finish (the honest-range product thesis).
  rangeLowSec?: number;
  rangeHighSec?: number;
  hikePct: number; // 0–100
  avgPaceSecPerKm: number;
  profile: { km: number; ele: number }[];
  siteUrl: string;
};

const W = 1200;
const H = 630;
const FONT = "'DejaVu Sans', 'Liberation Sans', 'Helvetica Neue', Arial, sans-serif";

// Profile band geometry (x: left→right, y: top→bottom of the band).
const PX0 = 80;
const PX1 = 1120;
const PY_TOP = 490;
const PY_BOTTOM = 565;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// Evenly pick up to n items so the path stays light even for thousands of
// resampled points.
function sample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  }
  return out;
}

// Two SVG paths for the elevation motif: a stroked line and a filled area.
// Degenerate profiles (0 or 1 point, flat elevation) collapse to a midline.
function profilePaths(profile: { km: number; ele: number }[]): {
  line: string;
  area: string;
} {
  const yMid = (PY_TOP + PY_BOTTOM) / 2;
  if (profile.length < 2) {
    const line = `M${PX0} ${yMid} L${PX1} ${yMid}`;
    return { line, area: `${line} L${PX1} ${PY_BOTTOM} L${PX0} ${PY_BOTTOM} Z` };
  }
  const pts = sample(profile, 90);
  const kmMin = pts[0].km;
  const kmSpan = pts[pts.length - 1].km - kmMin || 1;
  let eleMin = Infinity;
  let eleMax = -Infinity;
  for (const p of pts) {
    if (p.ele < eleMin) eleMin = p.ele;
    if (p.ele > eleMax) eleMax = p.ele;
  }
  const eleSpan = eleMax - eleMin || 1;
  const xy = pts.map((p) => {
    const x = PX0 + ((p.km - kmMin) / kmSpan) * (PX1 - PX0);
    const y = PY_BOTTOM - ((p.ele - eleMin) / eleSpan) * (PY_BOTTOM - PY_TOP);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const line = `M${xy.join(" L")}`;
  const area = `${line} L${PX1.toFixed(1)} ${PY_BOTTOM} L${PX0.toFixed(1)} ${PY_BOTTOM} Z`;
  return { line, area };
}

export function buildShareCardSvg(d: ShareCardData): string {
  const { line, area } = profilePaths(d.profile);
  const title = esc(truncate(d.title.trim() || "Race plan", 28));
  const finish = fmtClock(d.timeSec);
  const dist = `${d.distanceKm.toFixed(1)} km`;
  const gain = `${Math.round(d.gainM).toLocaleString("en-US")} m`;
  const pace = `${fmtPace(d.avgPaceSecPerKm)}/km`;
  const hike = `${Math.round(d.hikePct)}%`;
  const site = esc(d.siteUrl);

  const stat = (x: number, label: string, value: string) =>
    `  <text x="${x}" y="430" font-family="${FONT}" font-size="18" font-weight="600" letter-spacing="1.5" fill="#71717a">${label}</text>
  <text x="${x}" y="470" font-family="${FONT}" font-size="34" font-weight="700" fill="#fafafa">${value}</text>`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="100%" stop-color="#18181b"/>
    </linearGradient>
    <linearGradient id="ele" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#34d399" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#34d399" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- brand mark + wordmark -->
  <g transform="translate(80 60)">
    <rect width="52" height="52" rx="12" fill="#18181b" stroke="#27272a" stroke-width="1"/>
    <path d="M11 39 L20 22 L29 30 L44 11" fill="none" stroke="#34d399" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <text x="148" y="95" font-family="${FONT}" font-size="34" font-weight="700" fill="#fafafa">GradePace</text>

  <!-- course title -->
  <text x="80" y="200" font-family="${FONT}" font-size="50" font-weight="800" fill="#fafafa">${title}</text>

  <!-- hero: projected finish (+ honest range when provided) -->
  <text x="80" y="262" font-family="${FONT}" font-size="20" font-weight="600" letter-spacing="2" fill="#71717a">PROJECTED FINISH</text>
  <text x="80" y="362" font-family="${FONT}" font-size="104" font-weight="800" fill="#34d399">${finish}</text>${
    d.rangeLowSec !== undefined && d.rangeHighSec !== undefined
      ? `\n  <text x="80" y="398" font-family="${FONT}" font-size="24" font-weight="600" fill="#a1a1aa">expect ${fmtClockShort(d.rangeLowSec)} – ${fmtClockShort(d.rangeHighSec)}</text>`
      : ""
  }

  <!-- stat strip -->
${stat(80, "DISTANCE", dist)}
${stat(340, "ELEV GAIN", gain)}
${stat(600, "AVG PACE", pace)}
${stat(860, "POWER-HIKE", hike)}

  <!-- elevation profile -->
  <path d="${area}" fill="url(#ele)"/>
  <path d="${line}" fill="none" stroke="#34d399" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- watermark -->
  <text x="1120" y="600" text-anchor="end" font-family="${FONT}" font-size="22" font-weight="500" fill="#52525b">${site}</text>
</svg>`;
}
