import "./App.css";

type TrackPoint = {
  lat: number;
  lon: number;
  ele: number;
};

function parseGpx(xml: string): TrackPoint[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const trkpts = doc.querySelectorAll("trkpt");
  return Array.from(trkpts).map((pt) => ({
    lat: Number(pt.getAttribute("lat")),
    lon: Number(pt.getAttribute("lon")),
    ele: Number(pt.querySelector("ele")?.textContent),
  }));
}

function GpxUpload() {
  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const points = parseGpx(text);
      console.log(`Parsed ${points.length} points`, points[0]);
    });
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
