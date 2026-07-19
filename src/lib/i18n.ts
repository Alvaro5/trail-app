// UI strings, English + French. The `Messages` type is derived from the
// English table, so a key added to one language without the other is a type
// error — the two can never drift apart. Interpolated strings are functions.
// The share-card image deliberately stays English (single brand surface).
//
// House style: no em dashes in user-facing copy (owner rule). Use periods,
// colons, commas or parentheses instead. En dashes stay ONLY inside numeric
// ranges ("60–90 g/h", "7:00 – 8:15") where they are standard typography.

export type Lang = "en" | "fr";

export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("gp-lang");
    if (saved === "en" || saved === "fr") return saved;
  } catch {
    /* storage unavailable — fall through to the locale default */
  }
  return navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

const en = {
  tagline:
    "Most pace planners assume you run every hill. You don't. GradePace plans the power-hikes too, from your course GPX.",
  dropHint: "Or drop a .gpx anywhere. Parsed in your browser, never uploaded.",
  uploadCourseAria: "Upload a course GPX file",
  exampleBadge: "Example",
  exampleImperial:
    "Imperial Trail, Fontainebleau (70k). Upload yours to plan your race.",
  exampleBosses:
    "25 Bosses, Fontainebleau: 15 km of sandstone walls, the power-hike showcase.",
  loadImperial: "Imperial Trail (70k)",
  loadBosses: "25 Bosses (steep)",
  yourPace: "Your pace",
  unitsLabel: "Units",
  paceLabel: "Your easy flat-road pace",
  paceHintMetric: "min/km, a pace you could hold for hours on flat ground",
  paceHintImperial: "min/mile, a pace you could hold for hours on flat ground",
  paceInvalid: (example: string, current: string) =>
    `Enter a pace like ${example}. Still using ${current}.`,
  advanced: "Advanced settings",
  vamLabel: "Uphill hiking speed",
  vamHintMetric:
    "how fast you climb when power-hiking, in vertical metres per hour",
  vamHintImperial:
    "how fast you climb when power-hiking, in vertical feet per hour",
  gateLabel: "Switch to hiking when steeper than",
  gateHint: "above this steepness, the plan walks instead of runs",
  terrainLabel: "Terrain slowdown",
  terrainHint:
    "extra time for technical or rough ground (default ×1.04, measured on real trail runs). Best measured yourself: see “Calibrate from a real run”.",
  calibTitle: "Calibrate from a real run",
  calibMeasure: "· measure your terrain factor",
  calibApplied: (factor: string) => `· applied ×${factor}`,
  calibIntro:
    "Upload one or more runs you recorded (with timestamps). We compare each against the model, stops filtered out, and measure your personal terrain factor. One run is one day; several runs make the measurement steady.",
  calibUploadAria: "Upload recorded run GPX files for calibration",
  calibNoTime: (file: string) =>
    `${file}: no timestamps, so it looks like a planned route. Export the recorded activity (Strava, Garmin, COROS…) instead.`,
  calibUnreadable: (file: string) => `${file}: couldn't read this file.`,
  moving: "moving",
  implausible:
    "implausible, so it's excluded from the median. Route export with estimated timestamps? Flat pace far off for that day?",
  removeRun: (file: string) => `Remove ${file}`,
  useFactor: (factor: string) => `Use ×${factor}`,
  medianOfRuns: (n: number) => ` (median of ${n} runs)`,
  forThisPlan: " for this plan",
  spread: "spread",
  expandChart: "Expand",
  closeChart: "Close",
  legendDescent: "descent",
  legendRunnable: "runnable",
  legendClimb: "climb",
  legendPowerHike: "power-hike",
  elevationWord: "elevation",
  powerHikeWord: "power-hike",
  statDistance: "Distance",
  statGain: "Elevation gain",
  statHike: "Power-hike",
  statFinish: "Projected finish",
  walkedPct: (pct: string) => `${pct}% of the course walked`,
  expect: "expect",
  calibratedTag: "· calibrated",
  rangeNote:
    "A range, not a promise: day-of conditions swing a long race by 20–40 min. Calibrating narrows it.",
  courseNamePlaceholder: "Course name",
  courseNameAria: "Course name for the share image",
  shareImage: "Share image",
  creatingImage: "Creating image…",
  copyLink: "Copy link",
  copied: "Copied",
  shareText: (title: string) => `My ${title} race plan, built with GradePace`,
  shareFailed: "Couldn't create the share image. Please try again.",
  copyFallback:
    "Couldn't copy automatically. The link is in your address bar now.",
  racePlan: "Race plan",
  thGrade: "grade",
  thDplus: "D+",
  thHike: "hike",
  thPace: "pace",
  thElapsed: "elapsed",
  showAll: (n: number) => `Show all ${n} splits`,
  showFewer: "Show fewer",
  errInvalid:
    "This file isn't valid GPX: it couldn't be read as XML. Make sure you exported a .gpx file.",
  errNoTrack:
    "This file has no track or route points, so there's nothing to pace.",
  errTooFew:
    "This track has too few points to build a pacing plan (it needs at least two).",
  errNoElevation:
    "This file has no elevation data, so the plan can't be grade-adjusted. Re-export the GPX with elevation included; most route planners have that option.",
  errGeneric: "Couldn't read this file. Please try a different GPX.",
  errExample: "Couldn't load the example course. Please try again.",
  errNotGpx: "That doesn't look like a .gpx file. Drop a GPX export.",
  footerBuiltBy: "Built by",
  footerTraining: "while training for the Imperial Trail 70k, Fontainebleau.",
  footerOpenSource: "Open source on GitHub",
  themeToLight: "Switch to light mode",
  themeToDark: "Switch to dark mode",
  uploadCourse: "Upload GPX",
  calibAdd: "Add recorded runs",
  aidLabel: "Aid stations",
  aidPlaceholder: "e.g. 17, 33, 47",
  mapStart: "Start",
  mapFinish: "Finish",
  mapAria: "Course map",
  mapLayersAria: "Map style",
  mapLayerTerrain: "Terrain",
  mapLayerStandard: "Standard",
  mapLayerSatellite: "Satellite",
  mapLayerHybrid: "Hybrid",
  mapPoiToggle: "Points of interest",
  mapPoiHint:
    "Water, toilets, viewpoints, cafés and more from OpenStreetMap. Only the course area (a bounding box) is sent, never your track.",
  mapPoiLoading: "Loading…",
  mapPoiError: "Couldn't load points of interest. Toggle again to retry.",
  mapPoiTooBig: "Course area too large for points of interest.",
  mapPoiEmpty: "No points of interest mapped near this course.",
  poiWater: "drinking water",
  poiToilets: "toilets",
  poiViewpoint: "viewpoint",
  poiCafe: "café",
  poiSpring: "spring",
  poiShelter: "shelter",
  poiParking: "parking",
  poiPicnic: "picnic area",
  nutritionTitle: "Nutrition plan",
  nutritionSubtitle: "· carbs, fluids, sodium per segment",
  nutritionIntro:
    "Hourly targets applied to each segment of your plan (a segment is the stretch between two aid stations): this is what to carry and consume on each. Amounts follow the projected time, not the distance.",
  nutritionNoStations:
    "Add your aid stations in the field under the elevation profile and this table breaks into one row per segment between stations, each with its own amounts.",
  carbsLabel: "Carbohydrates",
  carbsHint:
    "g per hour. 60–90 g/h is the ultra range; above 90 needs a trained gut",
  fluidLabel: "Fluids",
  fluidHint: "ml per hour. Raise in heat, lower in cold",
  sodiumLabel: "Sodium",
  sodiumHint:
    "mg of sodium per hour (1 g of salt ≈ 390 mg sodium). Salty sweaters need more",
  legLabel: "segment",
  colDuration: "time",
  colCarbs: "carbs",
  colFluid: "fluids",
  colSodium: "sodium",
  colKcal: "kcal",
  nutritionTotal: "Total",
  gelsHint: (n: number) =>
    `≈ ${n} gels over the race (25 g of carbs each). Mix with drinks, bars and real food to taste.`,
  nutritionDisclaimer:
    "General guidance, not medical advice. Train your race nutrition on long outings.",
  exportSheet: "Export PDF",
  popupBlocked:
    "Couldn't open the export view. Allow pop-ups for this site and try again.",
  sheetSettings: "Settings",
  sheetEta: "ETA",
  sheetSplitsTitle: "Pacing table",
  sheetFooter: (host: string) => `Built with GradePace · ${host}`,
  dwellLabel: "Stop time",
  dwellHint:
    "Minutes lost at each aid station (refill, food, queue). Added to every time after that station.",
  startLabel: "Start",
  startInvalid: "Enter a start time like 8:00 (24h).",
  finishClock: (clock: string) => `finish ≈ ${clock}`,
  cutoffLabel: "Cutoffs",
  cutoffPlaceholder: "e.g. 5:30, 8:00",
  cutoffHint:
    "barrier times as elapsed race time (H:MM), one per station in course order",
  cutoffMissLine: (station: string, arr: string, cutoff: string) =>
    `${station}: projected arrival ${arr} is past the ${cutoff} cutoff.`,
  cutoffRiskLine: (station: string, cutoff: string) =>
    `${station}: the slow end of your range misses the ${cutoff} cutoff.`,
  chipArrDep: (arr: string, dep: string) => `arrive ${arr}, leave ${dep}`,
  sheetDepart: "depart",
  sheetCutoff: "cutoff",
};

export type Messages = typeof en;

const fr: Messages = {
  tagline:
    "La plupart des outils d'allure supposent que vous courez chaque côte. En vrai, non. GradePace planifie aussi les portions de marche, à partir du GPX de votre parcours.",
  dropHint:
    "Ou déposez un .gpx n'importe où. Analysé dans votre navigateur, jamais envoyé.",
  uploadCourseAria: "Importer un fichier GPX de parcours",
  exampleBadge: "Exemple",
  exampleImperial:
    "Imperial Trail, Fontainebleau (70 km). Importez le vôtre pour planifier votre course.",
  exampleBosses:
    "25 Bosses, Fontainebleau : 15 km de murs de grès, la vitrine de la marche rapide.",
  loadImperial: "Imperial Trail (70 km)",
  loadBosses: "25 Bosses (raide)",
  yourPace: "Votre allure",
  unitsLabel: "Unités",
  paceLabel: "Votre allure facile sur plat",
  paceHintMetric: "min/km, une allure tenable pendant des heures sur le plat",
  paceHintImperial:
    "min/mile, une allure tenable pendant des heures sur le plat",
  paceInvalid: (example: string, current: string) =>
    `Entrez une allure comme ${example}. On garde ${current} en attendant.`,
  advanced: "Réglages avancés",
  vamLabel: "Vitesse de montée en marchant",
  vamHintMetric:
    "vitesse ascensionnelle en marche rapide, en mètres verticaux par heure",
  vamHintImperial:
    "vitesse ascensionnelle en marche rapide, en pieds verticaux par heure",
  gateLabel: "Marcher au-delà de",
  gateHint: "au-dessus de cette pente, le plan marche au lieu de courir",
  terrainLabel: "Ralentissement terrain",
  terrainHint:
    "temps en plus pour terrain technique (défaut ×1,04, mesuré sur de vraies sorties). L'idéal : mesurez le vôtre, voir « Calibrer avec une vraie sortie ».",
  calibTitle: "Calibrer avec une vraie sortie",
  calibMeasure: "· mesurez votre facteur terrain",
  calibApplied: (factor: string) => `· appliqué ×${factor}`,
  calibIntro:
    "Importez une ou plusieurs sorties enregistrées (avec horodatage). Chacune est comparée au modèle, arrêts filtrés, pour mesurer votre facteur terrain personnel. Une sortie = un jour ; plusieurs sorties stabilisent la mesure.",
  calibUploadAria:
    "Importer des sorties enregistrées (GPX) pour la calibration",
  calibNoTime: (file: string) =>
    `${file} : pas d'horodatage, cela ressemble à un itinéraire planifié. Exportez l'activité enregistrée (Strava, Garmin, COROS…).`,
  calibUnreadable: (file: string) => `${file} : fichier illisible.`,
  moving: "en mouvement",
  implausible:
    "invraisemblable, donc exclu de la médiane. Itinéraire avec horodatage estimé ? Allure de référence très différente ce jour-là ?",
  removeRun: (file: string) => `Retirer ${file}`,
  useFactor: (factor: string) => `Utiliser ×${factor}`,
  medianOfRuns: (n: number) => ` (médiane de ${n} sorties)`,
  forThisPlan: " pour ce plan",
  spread: "étendue",
  expandChart: "Agrandir",
  closeChart: "Fermer",
  legendDescent: "descente",
  legendRunnable: "courable",
  legendClimb: "montée",
  legendPowerHike: "marche rapide",
  elevationWord: "altitude",
  powerHikeWord: "marche",
  statDistance: "Distance",
  statGain: "Dénivelé positif",
  statHike: "Marche rapide",
  statFinish: "Arrivée estimée",
  walkedPct: (pct: string) => `${pct}% du parcours en marchant`,
  expect: "comptez",
  calibratedTag: "· calibré",
  rangeNote:
    "Une fourchette, pas une promesse : les conditions du jour font varier une longue course de 20 à 40 min. Calibrer la resserre.",
  courseNamePlaceholder: "Nom du parcours",
  courseNameAria: "Nom du parcours pour l'image partagée",
  shareImage: "Partager l'image",
  creatingImage: "Création…",
  copyLink: "Copier le lien",
  copied: "Copié",
  shareText: (title: string) =>
    `Mon plan de course ${title}, créé avec GradePace`,
  shareFailed: "Impossible de créer l'image. Réessayez.",
  copyFallback: "Copie impossible. Le lien est dans la barre d'adresse.",
  racePlan: "Plan de course",
  thGrade: "pente",
  thDplus: "D+",
  thHike: "marche",
  thPace: "allure",
  thElapsed: "cumulé",
  showAll: (n: number) => `Afficher les ${n} tronçons`,
  showFewer: "Réduire",
  errInvalid:
    "Ce fichier n'est pas un GPX valide : impossible de le lire comme XML. Vérifiez que vous avez exporté un fichier .gpx.",
  errNoTrack:
    "Ce fichier ne contient ni trace ni itinéraire : rien à planifier.",
  errTooFew:
    "Cette trace a trop peu de points pour construire un plan (il en faut au moins deux).",
  errNoElevation:
    "Ce fichier n'a pas de données d'altitude, impossible d'ajuster à la pente. Ré-exportez le GPX avec l'altitude ; la plupart des outils le proposent.",
  errGeneric: "Impossible de lire ce fichier. Essayez un autre GPX.",
  errExample: "Impossible de charger le parcours d'exemple. Réessayez.",
  errNotGpx:
    "Ceci ne ressemble pas à un fichier .gpx. Déposez un export GPX.",
  footerBuiltBy: "Créé par",
  footerTraining: "en préparant l'Imperial Trail 70k à Fontainebleau.",
  footerOpenSource: "Open source sur GitHub",
  themeToLight: "Passer en mode clair",
  themeToDark: "Passer en mode sombre",
  uploadCourse: "Importer un GPX",
  calibAdd: "Ajouter des sorties",
  aidLabel: "Ravitaillements",
  aidPlaceholder: "ex. 17, 33, 47",
  mapStart: "Départ",
  mapFinish: "Arrivée",
  mapAria: "Carte du parcours",
  mapLayersAria: "Style de carte",
  mapLayerTerrain: "Terrain",
  mapLayerStandard: "Standard",
  mapLayerSatellite: "Satellite",
  mapLayerHybrid: "Hybride",
  mapPoiToggle: "Points d'intérêt",
  mapPoiHint:
    "Eau, WC, points de vue, cafés et plus depuis OpenStreetMap. Seule la zone du parcours (un rectangle) est envoyée, jamais votre trace.",
  mapPoiLoading: "Chargement…",
  mapPoiError:
    "Impossible de charger les points d'intérêt. Réactivez pour réessayer.",
  mapPoiTooBig: "Zone du parcours trop étendue pour les points d'intérêt.",
  mapPoiEmpty: "Aucun point d'intérêt cartographié près de ce parcours.",
  poiWater: "eau potable",
  poiToilets: "toilettes",
  poiViewpoint: "point de vue",
  poiCafe: "café",
  poiSpring: "source",
  poiShelter: "abri",
  poiParking: "parking",
  poiPicnic: "aire de pique-nique",
  nutritionTitle: "Plan nutrition",
  nutritionSubtitle: "· glucides, hydratation, sodium par tronçon",
  nutritionIntro:
    "Des objectifs horaires appliqués à chaque tronçon du plan (un tronçon = la portion entre deux ravitaillements) : voilà quoi emporter et consommer sur chacun. Les quantités suivent le temps projeté, pas la distance.",
  nutritionNoStations:
    "Ajoutez vos ravitaillements dans le champ sous le profil et ce tableau se découpe en une ligne par tronçon entre ravitos, chacune avec ses quantités.",
  carbsLabel: "Glucides",
  carbsHint:
    "g par heure. 60–90 g/h pour l'ultra ; au-delà de 90, intestin entraîné obligatoire",
  fluidLabel: "Hydratation",
  fluidHint: "ml par heure. Davantage par forte chaleur, moins par temps froid",
  sodiumLabel: "Sodium",
  sodiumHint:
    "mg de sodium par heure (1 g de sel ≈ 390 mg de sodium). Transpiration salée = besoins plus élevés",
  legLabel: "tronçon",
  colDuration: "durée",
  colCarbs: "glucides",
  colFluid: "boisson",
  colSodium: "sodium",
  colKcal: "kcal",
  nutritionTotal: "Total",
  gelsHint: (n: number) =>
    `≈ ${n} gels sur la course (25 g de glucides chacun). À panacher avec boissons, barres et solide selon vos goûts.`,
  nutritionDisclaimer:
    "Des repères généraux, pas un avis médical. Entraînez votre nutrition de course sur vos sorties longues.",
  exportSheet: "Exporter en PDF",
  popupBlocked:
    "Impossible d'ouvrir la vue d'export. Autorisez les pop-ups pour ce site et réessayez.",
  sheetSettings: "Réglages",
  sheetEta: "passage",
  sheetSplitsTitle: "Tableau d'allure",
  sheetFooter: (host: string) => `Créé avec GradePace · ${host}`,
  dwellLabel: "Temps d'arrêt",
  dwellHint:
    "Minutes perdues à chaque ravitaillement (remplissage, nourriture, file). Ajoutées à tous les temps après ce ravito.",
  startLabel: "Départ",
  startInvalid: "Entrez une heure de départ comme 8:00 (24 h).",
  finishClock: (clock: string) => `arrivée ≈ ${clock}`,
  cutoffLabel: "Barrières",
  cutoffPlaceholder: "ex. 5:30, 8:00",
  cutoffHint:
    "barrières horaires en temps de course écoulé (H:MM), une par ravito dans l'ordre du parcours",
  cutoffMissLine: (station: string, arr: string, cutoff: string) =>
    `${station} : arrivée estimée ${arr}, après la barrière de ${cutoff}.`,
  cutoffRiskLine: (station: string, cutoff: string) =>
    `${station} : le haut de votre fourchette dépasse la barrière de ${cutoff}.`,
  chipArrDep: (arr: string, dep: string) => `arrivée ${arr}, départ ${dep}`,
  sheetDepart: "départ",
  sheetCutoff: "barrière",
};

export const MESSAGES: Record<Lang, Messages> = { en, fr };
