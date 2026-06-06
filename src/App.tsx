import { useState } from "react";
import "./App.css";
import {
  parseGpx,
  cumulativeDistances,
  smoothElevation,
  elevationChange,
  gradients,
  projectTime,
} from "./lib/pacing";

type Summary = {
  distanceKm: number;
  gainM: number;
  timeSec: number;
};

const FLAT_PACE_S_PER_KM = 360; // 6:00/km — the effort input (a UI field later)

const fmt = (s: number) =>
  `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;

function GpxUpload() {
  const [summary, setSummary] = useState<Summary | null>(null);

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file
      .text()
      .then((text) => {
        const points = parseGpx(text);
        const distances = cumulativeDistances(points);
        const smoothed = smoothElevation(points, 3);
        const grades = gradients(smoothed, distances);

        setSummary({
          distanceKm: distances[distances.length - 1] / 1000,
          gainM: elevationChange(smoothed).gain,
          timeSec: projectTime(grades, distances, FLAT_PACE_S_PER_KM),
        });
      })
      .catch((err) => console.error(err));
  }

  return (
    <>
      <input type="file" accept=".gpx" onChange={handleFile} />
      {summary && (
        <dl>
          <dt>Distance</dt>
          <dd>{summary.distanceKm.toFixed(2)} km</dd>
          <dt>Elevation gain (D+)</dt>
          <dd>{summary.gainM.toFixed(0)} m</dd>
          <dt>Projected time @6:00/km</dt>
          <dd>{fmt(summary.timeSec)}</dd>
        </dl>
      )}
    </>
  );
}

function App() {
  return (
    <>
      <section id="center">
        <div className="hero"></div>
        <div>
          <h1>Get started</h1>
          <GpxUpload />
        </div>
      </section>
    </>
  );
}

export default App;
