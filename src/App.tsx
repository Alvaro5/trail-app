import { useState } from "react";
import "./App.css";
import {
  parseGpx,
  cumulativeDistances,
  smoothElevation,
  elevationChange,
  gradients,
  computeSplits,
  type Split,
} from "./lib/pacing";

type Plan = {
  distanceKm: number;
  gainM: number;
  timeSec: number;
  splits: Split[];
};

const FLAT_PACE_S_PER_KM = 360; // 6:00/km — the effort input (a UI field later)
const HIKE_VAM_M_PER_H = 750; // power-hike vertical ascent rate (a UI field later)
const HIKE_TRANSITION_GRADE = 0.18; // above this grade, switch to power-hiking

const pad = (n: number) => String(n).padStart(2, "0");

const fmtClock = (s: number) => {
  const t = Math.round(s);
  return `${Math.floor(t / 3600)}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
};

const fmtPace = (s: number) => {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${pad(t % 60)}`;
};

const fmtGrade = (g: number) => `${g > 0 ? "+" : ""}${(g * 100).toFixed(0)}%`;

function GpxUpload() {
  const [plan, setPlan] = useState<Plan | null>(null);

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
        const splits = computeSplits(
          distances,
          grades,
          FLAT_PACE_S_PER_KM,
          HIKE_VAM_M_PER_H,
          HIKE_TRANSITION_GRADE,
        );

        setPlan({
          distanceKm: distances[distances.length - 1] / 1000,
          gainM: elevationChange(smoothed).gain,
          timeSec: splits.length ? splits[splits.length - 1].elapsedSec : 0,
          splits,
        });
      })
      .catch((err) => console.error(err));
  }

  return (
    <>
      <input type="file" accept=".gpx" onChange={handleFile} />
      {plan && (
        <>
          <dl>
            <dt>Distance</dt>
            <dd>{plan.distanceKm.toFixed(2)} km</dd>
            <dt>Elevation gain (D+)</dt>
            <dd>{plan.gainM.toFixed(0)} m</dd>
            <dt>Projected time @6:00/km</dt>
            <dd>{fmtClock(plan.timeSec)}</dd>
          </dl>
          <table>
            <thead>
              <tr>
                <th>km</th>
                <th>grade</th>
                <th>D+</th>
                <th>hike</th>
                <th>pace</th>
                <th>elapsed</th>
              </tr>
            </thead>
            <tbody>
              {plan.splits.map((s) => (
                <tr key={s.km}>
                  <td>
                    {s.km}
                    {s.distanceKm < 0.95 ? ` (${s.distanceKm.toFixed(2)} km)` : ""}
                  </td>
                  <td>{fmtGrade(s.grade)}</td>
                  <td>{s.gainM.toFixed(0)} m</td>
                  <td>{s.hikeFraction > 0 ? `${(s.hikeFraction * 100).toFixed(0)}%` : "—"}</td>
                  <td>{fmtPace(s.paceSecPerKm)}/km</td>
                  <td>{fmtClock(s.elapsedSec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
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
