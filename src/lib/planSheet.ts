// Printable race-day plan sheet: one self-contained HTML document (inline
// CSS, inline SVG, no external requests) that the app opens in a new tab and
// hands to the browser's print dialog. Saving it as PDF, or printing it to
// tape onto a bottle or drop bag, is the whole point: everything the plan
// knows (profile, aid ETAs, nutrition, splits) on paper, race-day legible.

import { gradeColor } from "./gradeColor";

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export type SheetTable = {
  title: string;
  cols: string[];
  // Column 0 is left-aligned, the rest right-aligned (numeric).
  rows: string[][];
  totalRow?: string[];
  notes?: string[];
};

export type PlanSheetData = {
  lang: string;
  title: string;
  finishLabel: string;
  finish: string;
  rangeLine: string;
  stats: { label: string; value: string }[];
  settingsTitle: string;
  settings: { label: string; value: string }[];
  // Smoothed profile at even spacing, metric; drawn with the app's grade
  // colors so the sheet matches the dashboard.
  profile: { km: number; ele: number }[];
  hikeAboveGrade: number;
  // X-axis tick and aid-station marker positions as fractions of the course.
  ticks: { frac: number; label: string }[];
  aidMarks: { frac: number; label: string }[];
  legend: { color: string; label: string }[];
  aidTable: SheetTable | null;
  nutritionTable: SheetTable | null;
  splitsTable: SheetTable;
  footer: string;
};

// Same two-window coloring idea as the dashboard chart: wide band for stable
// colors, tight check so short steep walls still read as power-hike.
function profileSvg(d: PlanSheetData): string {
  const { profile } = d;
  if (profile.length < 2) return "";
  const W = 1000;
  const H = 200;
  const PAD_B = 18; // room for tick labels
  const totalKm = profile[profile.length - 1].km - profile[0].km;
  let eleMin = Infinity;
  let eleMax = -Infinity;
  for (const p of profile) {
    if (p.ele < eleMin) eleMin = p.ele;
    if (p.ele > eleMax) eleMax = p.ele;
  }
  const pad = Math.max((eleMax - eleMin) * 0.08, 1);
  eleMin -= pad;
  eleMax += pad;
  const x = (km: number) => ((km - profile[0].km) / totalKm) * W;
  const y = (ele: number) =>
    (H - PAD_B) * (1 - (ele - eleMin) / (eleMax - eleMin));

  const gradeAt = (i: number, w: number) => {
    const a = Math.max(0, i - w);
    const b = Math.min(profile.length - 1, i + w);
    const dKm = profile[b].km - profile[a].km;
    return dKm > 0 ? (profile[b].ele - profile[a].ele) / (dKm * 1000) : 0;
  };
  const colorAt = (i: number) =>
    gradeAt(i, 3) >= d.hikeAboveGrade
      ? "#f43f5e"
      : gradeColor(gradeAt(i, 10), d.hikeAboveGrade);

  // Run-length encoded gradient stops: a pair per color CHANGE.
  const stops: string[] = [];
  let prev = "";
  let prevI = 0;
  for (let i = 0; i < profile.length; i += 3) {
    const c = colorAt(i);
    if (c !== prev) {
      const off = ((profile[i].km - profile[0].km) / totalKm) * 100;
      if (prev)
        stops.push(
          `<stop offset="${(((profile[i - 1].km - profile[0].km) / totalKm) * 100).toFixed(2)}%" stop-color="${prev}"/>`,
        );
      stops.push(`<stop offset="${off.toFixed(2)}%" stop-color="${c}"/>`);
      prev = c;
    }
    prevI = i;
  }
  if (prev)
    stops.push(
      `<stop offset="${(((profile[prevI].km - profile[0].km) / totalKm) * 100).toFixed(2)}%" stop-color="${prev}"/>`,
    );

  // Downsample the path (every 3rd point ≈ 30 m) — print resolution doesn't
  // need 10 m fidelity and the file stays light.
  const pts: string[] = [];
  for (let i = 0; i < profile.length; i += 3)
    pts.push(`${x(profile[i].km).toFixed(1)},${y(profile[i].ele).toFixed(1)}`);
  const last = profile[profile.length - 1];
  pts.push(`${x(last.km).toFixed(1)},${y(last.ele).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${W},${H - PAD_B} L0,${H - PAD_B} Z`;

  const tickEls = d.ticks
    .map(
      (tk) =>
        `<line x1="${(tk.frac * W).toFixed(1)}" y1="0" x2="${(tk.frac * W).toFixed(1)}" y2="${H - PAD_B}" stroke="#e4e4e7" stroke-width="1"/>
<text x="${(tk.frac * W).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="11" fill="#71717a">${esc(tk.label)}</text>`,
    )
    .join("\n");
  const aidEls = d.aidMarks
    .map(
      (a) =>
        `<line x1="${(a.frac * W).toFixed(1)}" y1="10" x2="${(a.frac * W).toFixed(1)}" y2="${H - PAD_B}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="5 4"/>
<text x="${(a.frac * W).toFixed(1)}" y="9" text-anchor="middle" font-size="11" font-weight="700" fill="#b45309">${esc(a.label)}</text>`,
    )
    .join("\n");

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
<defs>
<linearGradient id="stroke" x1="0" y1="0" x2="1" y2="0">${stops.join("")}</linearGradient>
<linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#10b981" stop-opacity="0.14"/>
<stop offset="1" stop-color="#10b981" stop-opacity="0.02"/>
</linearGradient>
</defs>
${tickEls}
<path d="${area}" fill="url(#fill)"/>
<path d="${line}" fill="none" stroke="url(#stroke)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
${aidEls}
</svg>`;
}

function table(t: SheetTable): string {
  const head = t.cols
    .map(
      (c, i) =>
        `<th style="text-align:${i === 0 ? "left" : "right"}">${esc(c)}</th>`,
    )
    .join("");
  const body = t.rows
    .map(
      (r) =>
        `<tr>${r
          .map(
            (cell, i) =>
              `<td style="text-align:${i === 0 ? "left" : "right"}">${esc(cell)}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("\n");
  const total = t.totalRow
    ? `<tr class="total">${t.totalRow
        .map(
          (cell, i) =>
            `<td style="text-align:${i === 0 ? "left" : "right"}">${esc(cell)}</td>`,
        )
        .join("")}</tr>`
    : "";
  const notes = (t.notes ?? [])
    .map((n) => `<p class="note">${esc(n)}</p>`)
    .join("\n");
  return `<section>
<h2>${esc(t.title)}</h2>
<table><thead><tr>${head}</tr></thead><tbody>${body}${total}</tbody></table>
${notes}
</section>`;
}

export function buildPlanSheetHtml(d: PlanSheetData): string {
  const statChips = d.stats
    .map(
      (s) =>
        `<div class="stat"><div class="statlabel">${esc(s.label)}</div><div class="statvalue">${esc(s.value)}</div></div>`,
    )
    .join("\n");
  const settings = d.settings
    .map((s) => `<span><b>${esc(s.label)}:</b> ${esc(s.value)}</span>`)
    .join('<span class="sep">·</span>');
  const legend = d.legend
    .map(
      (l) =>
        `<span class="leg"><span class="dot" style="background:${l.color}"></span>${esc(l.label)}</span>`,
    )
    .join("");

  return `<!doctype html>
<html lang="${esc(d.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.title)} · GradePace</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; margin: 0; }
@page { margin: 12mm; }
body {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #27272a; background: #ffffff;
  max-width: 1000px; margin: 0 auto; padding: 24px 20px 40px;
  font-size: 13px; line-height: 1.45;
}
header { display: flex; align-items: center; gap: 14px; }
.mark { width: 44px; height: 44px; border-radius: 11px; background: #18181b; flex: none;
  display: flex; align-items: center; justify-content: center; }
.brand { font-size: 12px; font-weight: 700; letter-spacing: 1.5px;
  text-transform: uppercase; color: #10b981; }
h1 { font-size: 24px; letter-spacing: -0.02em; color: #18181b; }
.finish { margin-left: auto; text-align: right; }
.finishlabel { font-size: 10px; font-weight: 600; letter-spacing: 1.2px;
  text-transform: uppercase; color: #71717a; }
.finishvalue { font-size: 28px; font-weight: 800; color: #059669; font-variant-numeric: tabular-nums; }
.range { font-size: 12px; color: #52525b; font-variant-numeric: tabular-nums; }
.stats { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
.stat { flex: 1; min-width: 120px; border: 1px solid #e4e4e7; border-radius: 10px; padding: 8px 12px; }
.statlabel { font-size: 10px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; color: #71717a; }
.statvalue { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.settings { margin-top: 10px; font-size: 12px; color: #52525b; }
.settings b { color: #27272a; font-weight: 600; }
.sep { margin: 0 8px; color: #d4d4d8; }
figure { margin-top: 18px; break-inside: avoid; }
.legendrow { margin-top: 4px; font-size: 11px; color: #71717a; }
.leg { margin-right: 14px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 99px; margin-right: 5px; vertical-align: baseline; }
section { margin-top: 20px; }
h2 { font-size: 13px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase;
  color: #3f3f46; margin-bottom: 6px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
thead { display: table-header-group; }
th { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;
  color: #71717a; padding: 5px 8px; border-bottom: 1.5px solid #d4d4d8; }
td { padding: 4px 8px; border-bottom: 1px solid #f0f0f1; }
tbody tr:nth-child(even) td { background: #fafafa; }
tr { break-inside: avoid; }
tr.total td { font-weight: 700; border-top: 1.5px solid #d4d4d8; background: #ffffff; }
.note { margin-top: 6px; font-size: 11px; color: #71717a; }
footer { margin-top: 28px; font-size: 11px; color: #a1a1aa; text-align: center; }
@media print {
  body { padding: 0; font-size: 11.5px; }
  .stat { padding: 6px 10px; }
}
</style>
</head>
<body>
<header>
  <div class="mark">
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
      <defs><linearGradient id="mk" x1="3" y1="0" x2="21" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#34d399"/><stop offset="0.42" stop-color="#fbbf24"/>
        <stop offset="0.62" stop-color="#f43f5e"/><stop offset="1" stop-color="#38bdf8"/>
      </linearGradient></defs>
      <path d="M3 18.5 L8 11 L10.5 13.5 L14.5 5.5 L21 18.5" stroke="url(#mk)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>
  <div>
    <div class="brand">GradePace</div>
    <h1>${esc(d.title)}</h1>
  </div>
  <div class="finish">
    <div class="finishlabel">${esc(d.finishLabel)}</div>
    <div class="finishvalue">${esc(d.finish)}</div>
    <div class="range">${esc(d.rangeLine)}</div>
  </div>
</header>
<div class="stats">
${statChips}
</div>
<div class="settings"><b>${esc(d.settingsTitle)}</b><span class="sep">·</span>${settings}</div>
<figure>
${profileSvg(d)}
<div class="legendrow">${legend}</div>
</figure>
${d.aidTable ? table(d.aidTable) : ""}
${d.nutritionTable ? table(d.nutritionTable) : ""}
${table(d.splitsTable)}
<footer>${esc(d.footer)}</footer>
<script>addEventListener("load", () => setTimeout(() => print(), 300));</script>
</body>
</html>`;
}
