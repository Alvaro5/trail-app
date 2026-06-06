import "./App.css";

type TrackPoint = {
  lat: number;
  lon: number;
  ele: number;
};

function parseGpx(xml: string): TrackPoint[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Not a valid GPX/XML file");
  }
  const trkpts = doc.querySelectorAll("trkpt");
  return Array.from(trkpts).map((pt) => ({
    lat: Number(pt.getAttribute("lat")),
    lon: Number(pt.getAttribute("lon")),
    ele: Number(pt.querySelector("ele")?.textContent),
  }));
}

function haversine(a: TrackPoint, b: TrackPoint): number {
  const R = 6371000; // Earth's mean radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function cumulativeDistances(points: TrackPoint[]): number[] {
  const distances = [0]; // first point is the start: 0 meters in
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + haversine(points[i - 1], points[i]));
  }
  return distances;
}

function smoothElevation(points: TrackPoint[], window: number): TrackPoint[] {
  const half = Math.floor(window / 2);
  return points.map((pt, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(points.length - 1, i + half);
    let sum = 0;
    for (let j = start; j <= end; j++) sum += points[j].ele;
    const avg = sum / (end - start + 1);
    return { ...pt, ele: avg }; // keep lat/lon, replace only ele
  });
}

function elevationChange(points: TrackPoint[]): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].ele - points[i - 1].ele;
    if (delta > 0) gain += delta;
    else loss += delta; // delta is negative here, so loss stays negative
  }
  return { gain, loss };
}

function gradients(points: TrackPoint[], dists: number[]): number[] {
  const grades: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dEle = points[i].ele - points[i - 1].ele;
    const dDist = dists[i] - dists[i - 1];
    grades.push(dDist === 0 ? 0 : dEle / dDist); // zero-length segment = flat
  }
  return grades;
}

function minettiCost(i: number): number {
  const x = Math.max(-0.45, Math.min(0.45, i)); // clamp to validated range
  // Minetti cost function: 155.4 x⁵ − 30.4 x⁴ − 43.3 x³ + 46.3 x² + 19.5 x + 3.6
  const cost =
    155.4 * x ** 5 -
    30.4 * x ** 4 -
    43.3 * x ** 3 +
    46.3 * x ** 2 +
    19.5 * x +
    3.6;
  return cost;
}

for (const i of [-0.45, -0.2, -0.1, 0, 0.1, 0.2, 0.45])
  console.log(i, minettiCost(i).toFixed(2));

const FLAT_PACE_S_PER_KM = 360; // 6:00/km — the effort input (a UI field later)

const ratio = (i: number) => minettiCost(i) / minettiCost(0);

function projectTime(grades: number[], dists: number[]): number {
  let totalSec = 0;
  for (let i = 1; i < dists.length; i++) {
    const segKm = (dists[i] - dists[i - 1]) / 1000;
    // TODO (you): add this segment's time to totalSec —
    //   segKm * FLAT_PACE_S_PER_KM * ratio(grades[i - 1])
    totalSec += segKm * FLAT_PACE_S_PER_KM * ratio(grades[i - 1]);
    void segKm; // remove once you use segKm above
  }
  return totalSec;
}

const fmt = (s: number) =>
  `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;

function GpxUpload() {
  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file
      .text()
      .then((text) => {
        const points = parseGpx(text);
        const distances = cumulativeDistances(points);
        const totalKm = distances[distances.length - 1] / 1000;
        const smoothed = smoothElevation(points, 5);
        const grades = gradients(smoothed, distances);
        const raw = elevationChange(points);
        const smoothEC = elevationChange(smoothed);
        const minGrade = Math.min(...grades);
        const maxGrade = Math.max(...grades);

        console.log(`Parsed ${points.length} points`, points[0]);
        console.log(`Total distance: ${totalKm.toFixed(2)} km`);
        console.log(
          `D+ raw ${raw.gain.toFixed(0)} m  ->  smoothed ${smoothEC.gain.toFixed(0)} m`,
        );
        console.log(
          `Grade range: ${(minGrade * 100).toFixed(0)}% to ${(maxGrade * 100).toFixed(0)}%`,
        );
        console.log(
          `Projected time @6:00/km flat: ${fmt(projectTime(grades, distances))}`,
        );
      })
      .catch((err) => console.error(err));
  }
  return <input type="file" accept=".gpx" onChange={handleFile} />;
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
