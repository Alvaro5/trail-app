import { useEffect, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { gradeColor } from "./lib/gradeColor";
import {
  BASEMAPS,
  BASEMAP_IDS,
  basemapMaxZoom,
  type BasemapId,
} from "./lib/basemaps";
import type { Poi, PoiKind } from "./lib/pois";

// Course map, lazy-loaded like the chart so Leaflet (~150 kB) never blocks
// first paint. The route is drawn with the SAME grade→color scale as the
// elevation profile, so rose on the map means "the plan walks here"
// everywhere in the app. Basemap, units, and POI data are all controlled by
// the parent — two instances (inline + fullscreen) must stay in sync.

type AidMarker = { km: number; label: string };

// POI fetch lifecycle, owned by the parent (so toggling fullscreen never
// refetches). null poi prop = overlay off.
export type PoiState = {
  status: "idle" | "loading" | "ok" | "error" | "too-big";
  items: Poi[];
};

// UI strings for the on-map controls, built by the parent from the active
// language table.
export type CourseMapLabels = {
  layers: Record<BasemapId, string>;
  layersAria: string;
  locateLabel: string;
  locateError: string;
  poiToggle: string;
  poiHint: string;
  poiLoading: string;
  poiError: string;
  poiTooBig: string;
  poiEmpty: string;
  poiKind: Record<PoiKind, string>;
};

// Start/finish as inline-SVG divIcons: a white ring + dark outline keeps them
// readable on every basemap (topo greens, satellite forest, pale OSM).
const startIcon = () =>
  L.divIcon({
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<svg width="24" height="24" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))"><rect x="1" y="1" width="22" height="22" rx="7" fill="#10b981" stroke="#ffffff" stroke-width="2"/><path d="M9.3 7.4v9.2l7.6-4.6z" fill="#ffffff"/></svg>`,
  });

const finishIcon = () =>
  L.divIcon({
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<svg width="24" height="24" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))"><rect x="1" y="1" width="22" height="22" rx="7" fill="#ffffff" stroke="#3f3f46" stroke-width="1.5"/><path d="M4 4h4v4H4zM12 4h4v4h-4zM8 8h4v4H8zM16 8h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4zM8 16h4v4H8zM16 16h4v4h-4z" fill="#18181b"/></svg>`,
  });

// One colored circle per kind, hue-coded so a glance separates "drink here"
// from "photo here" from "crew parks here".
const poiCircle = (fill: string, inner: string) =>
  `<svg width="20" height="20" viewBox="0 0 20 20" style="filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45))"><circle cx="10" cy="10" r="9" fill="${fill}" stroke="#ffffff" stroke-width="1.5"/>${inner}</svg>`;

const POI_ICON_HTML: Record<PoiKind, string> = {
  water: poiCircle(
    "#0ea5e9",
    `<path d="M10 4.6c1.9 2.5 3.4 4.4 3.4 6.1a3.4 3.4 0 1 1-6.8 0c0-1.7 1.5-3.6 3.4-6.1z" fill="#ffffff"/>`,
  ),
  toilets: poiCircle(
    "#52525b",
    `<text x="10" y="13" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="7.5" font-weight="700" fill="#ffffff">WC</text>`,
  ),
  viewpoint: poiCircle(
    "#8b5cf6",
    `<ellipse cx="10" cy="10" rx="5.2" ry="3.4" fill="none" stroke="#ffffff" stroke-width="1.4"/><circle cx="10" cy="10" r="1.7" fill="#ffffff"/>`,
  ),
  cafe: poiCircle(
    "#d97706",
    `<path d="M6 8h6v3a3 3 0 0 1-6 0z" fill="#ffffff"/><path d="M12 8.8h1.3a1.5 1.5 0 0 1 0 3H12" stroke="#ffffff" stroke-width="1.2" fill="none"/><path d="M6.5 14.5h6" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round"/>`,
  ),
  spring: poiCircle(
    "#14b8a6",
    `<path d="M10 4.8c1.5 2 2.7 3.6 2.7 5a2.7 2.7 0 1 1-5.4 0c0-1.4 1.2-3 2.7-5z" fill="#ffffff"/><path d="M5.5 14.2c1.5 1 3 1 4.5 0s3-1 4.5 0" stroke="#ffffff" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
  ),
  shelter: poiCircle(
    "#a16207",
    `<path d="M4.8 10.5 10 5.8l5.2 4.7" stroke="#ffffff" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.8 9.5v5h6.4v-5" stroke="#ffffff" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
  ),
  parking: poiCircle(
    "#3b82f6",
    `<text x="10" y="14" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="10.5" font-weight="800" fill="#ffffff">P</text>`,
  ),
  picnic: poiCircle(
    "#65a30d",
    `<path d="M4.8 8.2h10.4M8 8.2l-1.8 6M12 8.2l1.8 6M6.6 11.4h6.8" stroke="#ffffff" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
  ),
};

const poiIcon = (kind: PoiKind) =>
  L.divIcon({
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: POI_ICON_HTML[kind],
  });

// Distance markers along the route (Strava-style): a numbered dark pill
// every 5 display units (10 on very long courses).
const kmIcon = (n: number) =>
  L.divIcon({
    className: "",
    iconSize: [22, 16],
    iconAnchor: [11, 8],
    html: `<div style="background:#18181b;color:#fafafa;border:1.5px solid #ffffff;border-radius:9999px;min-width:22px;height:16px;padding:0 3px;display:flex;align-items:center;justify-content:center;font:600 9.5px ui-sans-serif,system-ui;box-shadow:0 1px 2px rgba(0,0,0,.4)">${n}</div>`,
  });

// Floating-control chip style, shared by the layer select and POI toggle —
// matches the expand button the parent passes into topRightSlot.
const chipClass =
  "pointer-events-auto rounded-md border border-zinc-700 bg-zinc-900/85 px-2.5 py-1 text-xs font-medium text-zinc-200 shadow-sm backdrop-blur transition-colors hover:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 light:border-zinc-300 light:bg-white/90 light:text-zinc-700";

export default function CourseMap({
  coords,
  grades,
  hikeAboveGrade = 0.18,
  aid = [],
  startLabel = "Start",
  finishLabel = "Finish",
  ariaLabel = "Course map",
  heightClass = "h-72",
  units = "metric",
  basemap = "terrain",
  onBasemapChange,
  poi = null,
  onPoiToggle,
  labels,
  topRightSlot,
  onRegisterHover,
}: {
  coords: { lat: number; lon: number }[]; // resampled track, 10 m spacing
  grades: number[]; // per-segment, parallel to coords (length n−1)
  hikeAboveGrade?: number;
  aid?: AidMarker[];
  startLabel?: string;
  finishLabel?: string;
  ariaLabel?: string;
  heightClass?: string; // "h-72" inline, "h-full" in the fullscreen view
  units?: "metric" | "imperial"; // drives the scale bar
  basemap?: BasemapId;
  onBasemapChange?: (id: BasemapId) => void;
  poi?: PoiState | null;
  onPoiToggle?: () => void;
  labels?: CourseMapLabels;
  // Extra control rendered at the top of the floating stack — the inline
  // instance puts its expand button here so all map controls share one home.
  topRightSlot?: ReactNode;
  // Imperative hover bridge: the parent registers our marker-mover so the
  // elevation chart can mirror its hovered position WITHOUT a React render
  // per pointer-move (state-per-move made the chart tooltip stutter).
  onRegisterHover?: (fn: ((kmMetric: number | null) => void) | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayersRef = useRef<L.TileLayer[]>([]);
  const routeRef = useRef<L.LayerGroup | null>(null);
  const aidRef = useRef<L.LayerGroup | null>(null);
  const poiRef = useRef<L.LayerGroup | null>(null);
  const kmMarksRef = useRef<L.LayerGroup | null>(null);
  const locateRef = useRef<L.LayerGroup | null>(null);
  const hoverRef = useRef<L.CircleMarker | null>(null);
  const [locateMsg, setLocateMsg] = useState("");

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // Wheel zoom only while the pointer is over the map (Strava behavior):
    // created disabled so a page scroll passing over the map isn't trapped,
    // enabled on hover. Touch pinch is unaffected either way.
    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    map.on("mouseover", () => map.scrollWheelZoom.enable());
    map.on("mouseout", () => map.scrollWheelZoom.disable());
    // Dev-only handle for console debugging / automated verification —
    // Leaflet offers no way to reach the map instance from the DOM.
    if (import.meta.env.DEV)
      (window as unknown as { __gpMap?: L.Map }).__gpMap = map;
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      baseLayersRef.current = [];
      routeRef.current = null;
      aidRef.current = null;
      poiRef.current = null;
      kmMarksRef.current = null;
      locateRef.current = null;
      hoverRef.current = null;
    };
  }, []);

  // Basemap swap: tiles live in Leaflet's tilePane, the route/aid/hover
  // vectors in overlayPane — switching layers never rebuilds the polylines.
  // Attribution follows automatically (each tile layer carries its own).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    baseLayersRef.current.forEach((l) => l.remove());
    baseLayersRef.current = BASEMAPS[basemap].map((spec, i) =>
      L.tileLayer(spec.url, {
        maxZoom: spec.maxZoom,
        attribution: spec.attribution,
        zIndex: i, // hybrid stacks labels above imagery
      }).addTo(map),
    );
    // The zoom ceiling must track the most limited layer (OpenTopoMap stops
    // at 17) or zooming past it shows blank tiles.
    const maxZoom = basemapMaxZoom(basemap);
    map.setMaxZoom(maxZoom);
    if (map.getZoom() > maxZoom) map.setZoom(maxZoom);
  }, [basemap]);

  // Scale bar in the active display unit.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const scale = L.control.scale({
      position: "bottomleft",
      metric: units === "metric",
      imperial: units === "imperial",
    });
    scale.addTo(map);
    return () => {
      scale.remove();
    };
  }, [units]);

  // Route + endpoints. Re-fit bounds only when the course itself changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || coords.length < 2) return;
    routeRef.current?.remove();
    const group = L.layerGroup().addTo(map);
    routeRef.current = group;

    // Same two-window coloring as the chart: wide band for stable effort
    // colors, tight check so short steep walls still read as power-hike.
    const gradeAt = (i: number, w: number) => {
      const a = Math.max(0, i - w);
      const b = Math.min(grades.length - 1, i + w);
      let sum = 0;
      for (let j = a; j <= b; j++) sum += grades[j];
      return sum / (b - a + 1);
    };
    const colorAt = (i: number) =>
      gradeAt(i, 3) >= hikeAboveGrade
        ? "#f43f5e"
        : gradeColor(gradeAt(i, 10), hikeAboveGrade);

    // Run-length encoded colored polylines, sampled every 3 segments (~30 m).
    let runColor = colorAt(0);
    let run: [number, number][] = [[coords[0].lat, coords[0].lon]];
    for (let i = 0; i < grades.length; i += 3) {
      const c = colorAt(i);
      if (c !== runColor) {
        L.polyline(run, { color: runColor, weight: 4, opacity: 0.9 }).addTo(
          group,
        );
        run = [run[run.length - 1]];
        runColor = c;
      }
      const end = Math.min(i + 3, coords.length - 1);
      for (let j = i + 1; j <= end; j++) run.push([coords[j].lat, coords[j].lon]);
    }
    if (run.length > 1)
      L.polyline(run, { color: runColor, weight: 4, opacity: 0.9 }).addTo(
        group,
      );

    // Unmistakable endpoints: ▶ start, checkered finish. zIndexOffset lifts
    // them above the route, aid dots, and POI pins.
    L.marker([coords[0].lat, coords[0].lon], {
      icon: startIcon(),
      zIndexOffset: 1000,
      keyboard: false,
    })
      .bindTooltip(startLabel)
      .addTo(group);
    L.marker([coords[coords.length - 1].lat, coords[coords.length - 1].lon], {
      icon: finishIcon(),
      zIndexOffset: 1000,
      keyboard: false,
    })
      .bindTooltip(finishLabel)
      .addTo(group);

    map.fitBounds(
      L.latLngBounds(coords.map((c) => [c.lat, c.lon] as [number, number])),
      { padding: [16, 16] },
    );
  }, [coords, grades, hikeAboveGrade, startLabel, finishLabel]);

  // Aid markers in their own layer so editing stations never re-fits the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || coords.length < 2) return;
    aidRef.current?.remove();
    const group = L.layerGroup().addTo(map);
    aidRef.current = group;
    const avgSpacing = 10; // resample interval, metres
    for (const a of aid) {
      const idx = Math.min(
        coords.length - 1,
        Math.round((a.km * 1000) / avgSpacing),
      );
      L.circleMarker([coords[idx].lat, coords[idx].lon], {
        radius: 6,
        color: "#ffffff",
        weight: 2,
        fillColor: "#f59e0b",
        fillOpacity: 1,
      })
        .bindTooltip(a.label)
        .addTo(group);
    }
  }, [aid, coords]);

  // POI overlay (water / toilets / viewpoints), fetched by the parent.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    poiRef.current?.remove();
    poiRef.current = null;
    if (!poi || poi.status !== "ok" || !poi.items.length) return;
    const group = L.layerGroup().addTo(map);
    poiRef.current = group;
    for (const p of poi.items) {
      const kindLabel = labels?.poiKind[p.kind] ?? p.kind;
      L.marker([p.lat, p.lon], { icon: poiIcon(p.kind), keyboard: false })
        .bindTooltip(p.name ? `${kindLabel} · ${p.name}` : kindLabel)
        .addTo(group);
    }
  }, [poi, labels]);

  // Distance markers every 5 display units (10 beyond 100 units), skipping
  // ones that would crowd the finish flag.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || coords.length < 2) return;
    kmMarksRef.current?.remove();
    const group = L.layerGroup().addTo(map);
    kmMarksRef.current = group;
    const unitM = units === "imperial" ? 1609.344 : 1000;
    const totalM = (coords.length - 1) * 10; // resample interval
    const step = totalM / unitM > 100 ? 10 : 5;
    for (let u = step; u * unitM < totalM - unitM * 0.3; u += step) {
      const idx = Math.round((u * unitM) / 10);
      if (idx <= 0 || idx >= coords.length) continue;
      L.marker([coords[idx].lat, coords[idx].lon], {
        icon: kmIcon(u),
        interactive: false,
        keyboard: false,
        zIndexOffset: 200,
      }).addTo(group);
    }
  }, [coords, units]);

  // On-demand geolocation for on-site course recon. Privacy: fires only on
  // the button, position never leaves the device.
  function handleLocate() {
    const map = mapRef.current;
    if (!map) return;
    if (!("geolocation" in navigator)) {
      setLocateMsg(labels?.locateError ?? "");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocateMsg("");
        locateRef.current?.remove();
        const g = L.layerGroup().addTo(map);
        locateRef.current = g;
        const ll: [number, number] = [
          pos.coords.latitude,
          pos.coords.longitude,
        ];
        L.circle(ll, {
          radius: pos.coords.accuracy,
          color: "#3b82f6",
          weight: 1,
          fillColor: "#3b82f6",
          fillOpacity: 0.12,
          interactive: false,
        }).addTo(g);
        L.circleMarker(ll, {
          radius: 7,
          color: "#ffffff",
          weight: 2,
          fillColor: "#3b82f6",
          fillOpacity: 1,
          interactive: false,
        }).addTo(g);
        map.flyTo(ll, Math.max(map.getZoom(), 14));
      },
      () => setLocateMsg(labels?.locateError ?? ""),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  // Hover mirror: register a marker-mover with the parent. One reusable
  // marker, moved rather than recreated — this runs at pointer-move
  // frequency, entirely outside React's render loop.
  useEffect(() => {
    if (!onRegisterHover) return;
    const move = (kmMetric: number | null) => {
      const map = mapRef.current;
      if (!map || coords.length < 2) return;
      if (kmMetric == null) {
        hoverRef.current?.remove();
        hoverRef.current = null;
        return;
      }
      const idx = Math.min(
        coords.length - 1,
        Math.max(0, Math.round((kmMetric * 1000) / 10)),
      );
      const ll: [number, number] = [coords[idx].lat, coords[idx].lon];
      if (!hoverRef.current) {
        hoverRef.current = L.circleMarker(ll, {
          radius: 6,
          color: "#ffffff",
          weight: 2,
          fillColor: "#34d399",
          fillOpacity: 1,
          interactive: false,
        }).addTo(map);
      } else {
        hoverRef.current.setLatLng(ll);
      }
    };
    onRegisterHover(move);
    return () => onRegisterHover(null);
  }, [coords, onRegisterHover]);

  // POI status line under the controls; empty string = nothing to say.
  const poiMessage = !poi
    ? ""
    : poi.status === "error"
      ? (labels?.poiError ?? "")
      : poi.status === "too-big"
        ? (labels?.poiTooBig ?? "")
        : poi.status === "ok" && poi.items.length === 0
          ? (labels?.poiEmpty ?? "")
          : "";

  // Outer wrapper keeps the `relative z-0` stacking fix (Leaflet's internal
  // panes use z-indexes in the hundreds and would otherwise paint OVER the
  // page's fullscreen overlays at z-50). The inner Leaflet div gets its own
  // explicit z-0 so those panes are flattened into one context — the sibling
  // controls then only need z-10, and map drag/wheel handlers never see
  // their events because they're NOT inside Leaflet's container.
  return (
    <div className={`relative z-0 w-full overflow-hidden rounded-lg ${heightClass}`}>
      <div
        ref={containerRef}
        role="img"
        aria-label={ariaLabel}
        className="absolute inset-0 z-0"
      />
      <div className="pointer-events-none absolute right-2 top-2 z-10 flex flex-col items-end gap-1.5">
        {topRightSlot}
        {labels && onBasemapChange && (
          <select
            value={basemap}
            onChange={(e) => onBasemapChange(e.target.value as BasemapId)}
            aria-label={labels.layersAria}
            className={`${chipClass} cursor-pointer`}
          >
            {BASEMAP_IDS.map((id) => (
              <option key={id} value={id}>
                {labels.layers[id]}
              </option>
            ))}
          </select>
        )}
        {labels && onPoiToggle && (
          <button
            type="button"
            onClick={onPoiToggle}
            aria-pressed={poi !== null}
            title={labels.poiHint}
            className={`${chipClass} ${
              poi !== null
                ? "border-emerald-500 text-emerald-400 light:text-emerald-700"
                : ""
            }`}
          >
            {poi?.status === "loading" ? labels.poiLoading : labels.poiToggle}
          </button>
        )}
        {labels && (
          <button
            type="button"
            onClick={handleLocate}
            title={labels.locateLabel}
            aria-label={labels.locateLabel}
            className={chipClass}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-3.5 w-3.5"
              aria-hidden
            >
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
              <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
            </svg>
          </button>
        )}
        {locateMsg && (
          <span className="max-w-56 rounded-md border border-amber-500/40 bg-zinc-900/85 px-2.5 py-1 text-right text-xs text-amber-300 shadow-sm backdrop-blur light:bg-white/90 light:text-amber-700">
            {locateMsg}
          </span>
        )}
        {poiMessage && (
          <span className="max-w-56 rounded-md border border-amber-500/40 bg-zinc-900/85 px-2.5 py-1 text-right text-xs text-amber-300 shadow-sm backdrop-blur light:bg-white/90 light:text-amber-700">
            {poiMessage}
          </span>
        )}
      </div>
    </div>
  );
}
