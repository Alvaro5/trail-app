import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { gradeColor } from "./lib/gradeColor";

// Course map, lazy-loaded like the chart so Leaflet (~150 kB) never blocks
// first paint. OpenTopoMap tiles — the topographic look is the right basemap
// for a trail tool — with the attribution their license requires. The route
// is drawn with the SAME grade→color scale as the elevation profile, so rose
// on the map means "the plan walks here" everywhere in the app.

type AidMarker = { km: number; label: string };

export default function CourseMap({
  coords,
  grades,
  hikeAboveGrade = 0.18,
  aid = [],
  startLabel = "Start",
  finishLabel = "Finish",
  ariaLabel = "Course map",
  heightClass = "h-72",
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
  // Imperative hover bridge: the parent registers our marker-mover so the
  // elevation chart can mirror its hovered position WITHOUT a React render
  // per pointer-move (state-per-move made the chart tooltip stutter).
  onRegisterHover?: (fn: ((kmMetric: number | null) => void) | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeRef = useRef<L.LayerGroup | null>(null);
  const aidRef = useRef<L.LayerGroup | null>(null);
  const hoverRef = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // scrollWheelZoom off: the map sits mid-page and would otherwise trap
    // the page scroll. Pinch/double-click/buttons still zoom.
    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      routeRef.current = null;
      aidRef.current = null;
    };
  }, []);

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

    const endpoint = (idx: number, color: string, label: string) =>
      L.circleMarker([coords[idx].lat, coords[idx].lon], {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: color,
        fillOpacity: 1,
      })
        .bindTooltip(label)
        .addTo(group);
    endpoint(0, "#10b981", startLabel);
    endpoint(coords.length - 1, "#18181b", finishLabel);

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

  // `relative z-0` creates a stacking context: Leaflet's internal panes use
  // z-indexes in the hundreds and would otherwise paint OVER the fullscreen
  // chart overlay (z-50).
  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      className={`relative z-0 w-full rounded-lg ${heightClass}`}
    />
  );
}
