// Basemap catalog for the course map. All four serve without an API key —
// verified individually (2026-07). Terrain stays the default: topo relief is
// the right first read for a trail tool. "hybrid" stacks two tile layers
// (imagery + a labels-only reference layer), which is why each entry is a
// LIST of layers, not a single URL.

export type BasemapId = "terrain" | "standard" | "satellite" | "hybrid";

export type BasemapLayer = {
  url: string;
  attribution: string;
  maxZoom: number;
};

const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
// Esri's keyless tile services require this credit line (ArcGIS ToS).
const ESRI_IMAGERY = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "&copy; Esri, Maxar, Earthstar Geographics",
  maxZoom: 19,
};

export const BASEMAPS: Record<BasemapId, BasemapLayer[]> = {
  terrain: [
    {
      url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attribution: `${OSM_ATTR}, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
      maxZoom: 17,
    },
  ],
  standard: [
    {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: OSM_ATTR,
      maxZoom: 19,
    },
  ],
  satellite: [ESRI_IMAGERY],
  hybrid: [
    ESRI_IMAGERY,
    {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      attribution: "&copy; Esri",
      maxZoom: 19,
    },
  ],
};

export const BASEMAP_IDS = Object.keys(BASEMAPS) as BasemapId[];

// The map's zoom ceiling must follow the most limited layer of the active
// set, or users zooming past it see blank tiles.
export const basemapMaxZoom = (id: BasemapId) =>
  Math.min(...BASEMAPS[id].map((l) => l.maxZoom));

export function isBasemapId(v: unknown): v is BasemapId {
  return typeof v === "string" && v in BASEMAPS;
}
