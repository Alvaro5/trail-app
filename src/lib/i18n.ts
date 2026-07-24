// UI strings, English + French. The `Messages` type is derived from the
// English table, so a key added to one language without the other is a type
// error — the two can never drift apart. Interpolated strings are functions.
// The share-card image deliberately stays English (single brand surface).
//
// House style: no em dashes in user-facing copy (owner rule). Use periods,
// colons, commas or parentheses instead. En dashes stay ONLY inside numeric
// ranges ("60–90 g/h", "7:00 – 8:15") where they are standard typography.

export type Lang = "en" | "fr" | "es" | "de" | "it";

export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("gp-lang");
    if (
      saved === "en" ||
      saved === "fr" ||
      saved === "es" ||
      saved === "de" ||
      saved === "it"
    )
      return saved;
  } catch {
    /* storage unavailable — fall through to the locale default */
  }
  const nav = navigator.language?.toLowerCase() ?? "";
  if (nav.startsWith("fr")) return "fr";
  if (nav.startsWith("es")) return "es";
  if (nav.startsWith("de")) return "de";
  if (nav.startsWith("it")) return "it";
  return "en";
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
  climbsTitle: "Key climbs",
  climbsSubtitle: "· where the race is decided",
  climbsMore: (n: number) => `+ ${n} smaller climbs not listed`,
  colLength: "length",
  colVam: "VAM",
  compareTitle: "Post-race check",
  compareSubtitle: "· predicted vs what you ran",
  compareIntro:
    "After the race, upload the activity you recorded. You'll see where the plan held and where reality drifted, split by split.",
  compareAdd: "Upload the recorded race",
  compareUploadAria: "Upload the recorded race GPX for comparison",
  compareSummary: (pred: string, act: string, delta: string) =>
    `Predicted ${pred} · you ran ${act} · ${delta}`,
  compareStops: (t: string) => `time not moving ${t}`,
  compareWorst: (lost: string, span: string) =>
    `Biggest gap: ${lost} lost between ${span}.`,
  compareBest: (gain: string, span: string) =>
    `Strongest stretch: ${gain} gained between ${span}.`,
  comparePartial:
    "The recording is shorter than the course. The comparison covers the recorded part only.",
  compareMismatch:
    "The recording is much longer than the course, so distances are compared as absolute.",
  compareClear: "Clear comparison",
  thActual: "actual",
  naiveLine: (naive: string, real: string) =>
    `A flat-pace calculator would promise ${naive}. This course makes it ${real}.`,
  fadeLabel: "Late-race fade",
  fadeHint:
    "extra slowdown per hour after hour 4, for tiredness (default 2%/h from ultra pacing studies). 0 = constant effort",
  calibWeight: (pct: number) => `weight ${pct}%`,
  replayLabel: "Replay the race",
  replayStop: "Stop replay",
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
  threeDTitle: "3D flyover",
  expandChart: "Expand",
  closeChart: "Close",
  legendDescent: "descent",
  legendRunnable: "runnable",
  legendClimb: "climb",
  legendPowerHike: "power-hike",
  elevationWord: "elevation",
  powerHikeWord: "power-hike",
  chartDplusLeft: "D+ left",
  statDistance: "Distance",
  statGain: "Elevation gain",
  statHike: "Power-hike",
  statFinish: "Projected finish",
  walkedPct: (pct: string) => `${pct}% of the course walked`,
  expect: "expect",
  calibratedTag: "· calibrated",
  rangeNote:
    "A range, not a promise: day-of conditions swing a long race by 20–40 min. Calibrating narrows it.",
  sensitivityLabel: "With a different flat pace:",
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
  aidPlaceholder: "e.g. 17, 33(8), 47",
  mapStart: "Start",
  mapFinish: "Finish",
  mapAria: "Course map",
  mapLayersAria: "Map style",
  mapLocate: "Show my position",
  mapLocateError: "Position unavailable. Allow location access and retry.",
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
  caffeineLabel: "Caffeine",
  caffeineHint:
    "mg per hour, 0 = off. Save it for the back half; keep the event total moderate (3 to 6 mg per kg)",
  colCaffeine: "caffeine",
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
  exportGpx: "Watch GPX",
  popupBlocked:
    "Couldn't open the export view. Allow pop-ups for this site and try again.",
  sheetSettings: "Settings",
  sheetEta: "ETA",
  sheetSplitsTitle: "Pacing table",
  sheetFooter: (host: string) => `Built with GradePace · ${host}`,
  dwellLabel: "Stop time",
  dwellHint:
    "Minutes lost at each aid station (refill, food, queue). Added to every time after that station. One station different? Write 33(8) in the stations field: 8 min at that one.",
  startLabel: "Start",
  startInvalid: "Enter a start time like 8:00 (24h).",
  raceDateLabel: "Race date",
  raceDateHint:
    "Within 16 days of the race, the day's forecast is fetched for a rounded course midpoint. Your GPX never leaves the device.",
  weatherCountdown: (days: number) =>
    days === 1
      ? "Race-day forecast opens tomorrow."
      : `Race-day forecast opens in ${days} days.`,
  weatherLine: (temps: string, rain: string | null) =>
    rain === null
      ? `Race-day forecast: ${temps}.`
      : `Race-day forecast: ${temps}, rain ${rain}.`,
  weatherHeat: (extra: string, fluid: string) =>
    `Heat could add up to +${extra}. Consider drinking +${fluid}.`,
  weatherError: "Race-day forecast is unavailable right now.",
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
  savedBadge: "Saved",
  savedNote:
    "Your plan is stored on this device and restored on your next visit.",
  savedForget: "Forget this plan",
  howTitle: "How it works",
  howSubtitle: "· the model behind the plan",
  howModel:
    "Pace comes from physics, not vibes: the Minetti energy-cost curve (lab-measured) prices every grade, anchored by your easy flat pace. Above the hiking gate the plan switches to power-hiking at your vertical speed, because past that steepness running stops being the efficient option.",
  howCalib:
    "The terrain factor is measured, not guessed: upload a recorded run and GradePace inverts its own model against it, stops filtered out. Several runs make the measurement steady.",
  howRange:
    "The finish is a range on purpose. Day-of conditions (sleep, heat, fueling) swing a long race by 20 to 40 minutes; a to-the-second prediction would be theater. Calibrating narrows the band.",
  howMore: "Full methodology and source on GitHub",
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
  climbsTitle: "Montées clés",
  climbsSubtitle: "· là où la course se joue",
  climbsMore: (n: number) => `+ ${n} montées plus petites non listées`,
  colLength: "longueur",
  colVam: "VAM",
  compareTitle: "Après la course",
  compareSubtitle: "· prévu vs couru",
  compareIntro:
    "Après la course, importez l'activité enregistrée. Vous verrez où le plan a tenu et où la réalité a dérivé, tronçon par tronçon.",
  compareAdd: "Importer la course enregistrée",
  compareUploadAria: "Importer le GPX de la course enregistrée pour comparaison",
  compareSummary: (pred: string, act: string, delta: string) =>
    `Prévu ${pred} · couru ${act} · ${delta}`,
  compareStops: (t: string) => `temps à l'arrêt ${t}`,
  compareWorst: (lost: string, span: string) =>
    `Plus gros écart : ${lost} perdues entre ${span}.`,
  compareBest: (gain: string, span: string) =>
    `Meilleure portion : ${gain} gagnées entre ${span}.`,
  comparePartial:
    "L'enregistrement est plus court que le parcours. La comparaison couvre la partie enregistrée seulement.",
  compareMismatch:
    "L'enregistrement est bien plus long que le parcours, les distances sont donc comparées en absolu.",
  compareClear: "Retirer la comparaison",
  thActual: "réel",
  naiveLine: (naive: string, real: string) =>
    `Un calculateur d'allure plate promettrait ${naive}. Ce parcours en fait ${real}.`,
  fadeLabel: "Fatigue de fin de course",
  fadeHint:
    "ralentissement supplémentaire par heure après la 4e heure (défaut 2 %/h, d'après les études d'allure en ultra). 0 = effort constant",
  calibWeight: (pct: number) => `poids ${pct}%`,
  replayLabel: "Rejouer la course",
  replayStop: "Arrêter",
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
  threeDTitle: "Survol 3D",
  expandChart: "Agrandir",
  closeChart: "Fermer",
  legendDescent: "descente",
  legendRunnable: "courable",
  legendClimb: "montée",
  legendPowerHike: "marche rapide",
  elevationWord: "altitude",
  powerHikeWord: "marche",
  chartDplusLeft: "D+ restant",
  statDistance: "Distance",
  statGain: "Dénivelé positif",
  statHike: "Marche rapide",
  statFinish: "Arrivée estimée",
  walkedPct: (pct: string) => `${pct}% du parcours en marchant`,
  expect: "comptez",
  calibratedTag: "· calibré",
  rangeNote:
    "Une fourchette, pas une promesse : les conditions du jour font varier une longue course de 20 à 40 min. Calibrer la resserre.",
  sensitivityLabel: "Avec une autre allure de base :",
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
  aidPlaceholder: "ex. 17, 33(8), 47",
  mapStart: "Départ",
  mapFinish: "Arrivée",
  mapAria: "Carte du parcours",
  mapLayersAria: "Style de carte",
  mapLocate: "Afficher ma position",
  mapLocateError:
    "Position indisponible. Autorisez la localisation et réessayez.",
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
  caffeineLabel: "Caféine",
  caffeineHint:
    "mg par heure, 0 = désactivé. Gardez-la pour la seconde moitié ; total modéré sur l'épreuve (3 à 6 mg par kg)",
  colCaffeine: "caféine",
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
  exportGpx: "GPX montre",
  popupBlocked:
    "Impossible d'ouvrir la vue d'export. Autorisez les pop-ups pour ce site et réessayez.",
  sheetSettings: "Réglages",
  sheetEta: "passage",
  sheetSplitsTitle: "Tableau d'allure",
  sheetFooter: (host: string) => `Créé avec GradePace · ${host}`,
  dwellLabel: "Temps d'arrêt",
  dwellHint:
    "Minutes perdues à chaque ravitaillement (remplissage, nourriture, file). Ajoutées à tous les temps après ce ravito. Un ravito différent ? Écrivez 33(8) dans le champ des ravitos : 8 min à celui-là.",
  startLabel: "Départ",
  startInvalid: "Entrez une heure de départ comme 8:00 (24 h).",
  raceDateLabel: "Date de course",
  raceDateHint:
    "À moins de 16 jours de la course, la météo du jour est récupérée pour un point milieu arrondi du parcours. Votre GPX ne quitte jamais l'appareil.",
  weatherCountdown: (days: number) =>
    days === 1
      ? "La météo du jour J ouvre demain."
      : `La météo du jour J ouvre dans ${days} jours.`,
  weatherLine: (temps: string, rain: string | null) =>
    rain === null
      ? `Météo du jour J : ${temps}.`
      : `Météo du jour J : ${temps}, pluie ${rain}.`,
  weatherHeat: (extra: string, fluid: string) =>
    `La chaleur peut ajouter jusqu'à +${extra}. Pensez à boire +${fluid}.`,
  weatherError: "Météo du jour J indisponible pour le moment.",
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
  savedBadge: "Enregistré",
  savedNote:
    "Votre plan est conservé sur cet appareil et restauré à votre prochaine visite.",
  savedForget: "Oublier ce plan",
  howTitle: "Comment ça marche",
  howSubtitle: "· le modèle derrière le plan",
  howModel:
    "L'allure vient de la physique, pas du doigt mouillé : la courbe de coût énergétique de Minetti (mesurée en laboratoire) donne le prix de chaque pente, ancré par votre allure facile sur plat. Au-delà du seuil de marche, le plan passe en marche rapide à votre vitesse ascensionnelle, car courir n'y est plus l'option efficace.",
  howCalib:
    "Le facteur terrain est mesuré, pas deviné : importez une sortie enregistrée et GradePace inverse son propre modèle dessus, arrêts filtrés. Plusieurs sorties stabilisent la mesure.",
  howRange:
    "L'arrivée est une fourchette, volontairement. Les conditions du jour (sommeil, chaleur, alimentation) font varier une longue course de 20 à 40 minutes ; une prédiction à la seconde serait du théâtre. Calibrer resserre la fourchette.",
  howMore: "Méthodologie complète et code source sur GitHub",
};

const es: Messages = {
  tagline:
    "La mayoría de las herramientas de ritmo asumen que corres cada cuesta. En realidad, no. GradePace también planifica los tramos andando, a partir del GPX de tu recorrido.",
  dropHint:
    "O suelta un .gpx en cualquier parte. Se analiza en tu navegador, nunca se sube.",
  uploadCourseAria: "Subir un archivo GPX del recorrido",
  exampleBadge: "Ejemplo",
  exampleImperial:
    "Imperial Trail, Fontainebleau (70 km). Sube el tuyo para planificar tu carrera.",
  exampleBosses:
    "25 Bosses, Fontainebleau: 15 km de muros de arenisca, el escaparate de la marcha rápida.",
  loadImperial: "Imperial Trail (70 km)",
  loadBosses: "25 Bosses (empinado)",
  yourPace: "Tu ritmo",
  unitsLabel: "Unidades",
  paceLabel: "Tu ritmo cómodo en llano",
  paceHintMetric: "min/km, un ritmo sostenible durante horas en llano",
  paceHintImperial: "min/milla, un ritmo sostenible durante horas en llano",
  paceInvalid: (example: string, current: string) =>
    `Introduce un ritmo como ${example}. Seguimos usando ${current}.`,
  advanced: "Ajustes avanzados",
  vamLabel: "Velocidad de ascenso andando",
  vamHintMetric:
    "velocidad de ascenso en marcha rápida, en metros verticales por hora",
  vamHintImperial:
    "velocidad de ascenso en marcha rápida, en pies verticales por hora",
  gateLabel: "Andar por encima de",
  gateHint: "por encima de esta pendiente, el plan anda en lugar de correr",
  terrainLabel: "Penalización de terreno",
  terrainHint:
    "tiempo extra por terreno técnico (por defecto ×1,04, medido en salidas reales). Lo ideal: mídelo tú mismo, ver “Calibrar con una salida real”.",
  climbsTitle: "Subidas clave",
  climbsSubtitle: "· donde se decide la carrera",
  climbsMore: (n: number) => `+ ${n} subidas menores no listadas`,
  colLength: "longitud",
  colVam: "VAM",
  compareTitle: "Tras la carrera",
  compareSubtitle: "· previsto vs corrido",
  compareIntro:
    "Después de la carrera, sube la actividad grabada. Verás dónde aguantó el plan y dónde la realidad se desvió, tramo a tramo.",
  compareAdd: "Subir la carrera grabada",
  compareUploadAria: "Subir el GPX de la carrera grabada para comparar",
  compareSummary: (pred: string, act: string, delta: string) =>
    `Previsto ${pred} · corriste ${act} · ${delta}`,
  compareStops: (t: string) => `tiempo parado ${t}`,
  compareWorst: (lost: string, span: string) =>
    `Mayor desfase: ${lost} perdidos entre ${span}.`,
  compareBest: (gain: string, span: string) =>
    `Mejor tramo: ${gain} ganados entre ${span}.`,
  comparePartial:
    "La grabación es más corta que el recorrido. La comparación cubre solo la parte grabada.",
  compareMismatch:
    "La grabación es mucho más larga que el recorrido, así que las distancias se comparan en absoluto.",
  compareClear: "Quitar la comparación",
  thActual: "real",
  naiveLine: (naive: string, real: string) =>
    `Una calculadora de ritmo plano prometería ${naive}. Este recorrido lo convierte en ${real}.`,
  fadeLabel: "Fatiga de final de carrera",
  fadeHint:
    "ralentización extra por hora después de la hora 4 (por defecto 2%/h, según estudios de ritmo en ultras). 0 = esfuerzo constante",
  calibWeight: (pct: number) => `peso ${pct}%`,
  replayLabel: "Reproducir la carrera",
  replayStop: "Detener",
  calibTitle: "Calibrar con una salida real",
  calibMeasure: "· mide tu factor de terreno",
  calibApplied: (factor: string) => `· aplicado ×${factor}`,
  calibIntro:
    "Sube una o varias salidas grabadas (con marcas de tiempo). Cada una se compara con el modelo, filtrando las paradas, para medir tu factor de terreno personal. Una salida = un día; varias salidas estabilizan la medición.",
  calibUploadAria: "Subir salidas grabadas (GPX) para calibrar",
  calibNoTime: (file: string) =>
    `${file}: sin marcas de tiempo, parece una ruta planificada. Exporta la actividad grabada (Strava, Garmin, COROS…).`,
  calibUnreadable: (file: string) => `${file}: no se pudo leer el archivo.`,
  moving: "en movimiento",
  implausible:
    "inverosímil, excluido de la mediana. ¿Ruta con tiempos estimados? ¿Ritmo de referencia muy distinto ese día?",
  removeRun: (file: string) => `Quitar ${file}`,
  useFactor: (factor: string) => `Usar ×${factor}`,
  medianOfRuns: (n: number) => ` (mediana de ${n} salidas)`,
  forThisPlan: " para este plan",
  spread: "rango",
  threeDTitle: "Vuelo en 3D",
  expandChart: "Ampliar",
  closeChart: "Cerrar",
  legendDescent: "bajada",
  legendRunnable: "corrible",
  legendClimb: "subida",
  legendPowerHike: "marcha rápida",
  elevationWord: "altitud",
  powerHikeWord: "marcha",
  chartDplusLeft: "D+ restante",
  statDistance: "Distancia",
  statGain: "Desnivel positivo",
  statHike: "Marcha rápida",
  statFinish: "Llegada estimada",
  walkedPct: (pct: string) => `${pct}% del recorrido andando`,
  expect: "cuenta con",
  calibratedTag: "· calibrado",
  rangeNote:
    "Una horquilla, no una promesa: las condiciones del día mueven una carrera larga entre 20 y 40 min. Calibrar la estrecha.",
  sensitivityLabel: "Con otro ritmo base:",
  courseNamePlaceholder: "Nombre del recorrido",
  courseNameAria: "Nombre del recorrido para la imagen compartida",
  shareImage: "Compartir imagen",
  creatingImage: "Creando…",
  copyLink: "Copiar enlace",
  copied: "Copiado",
  shareText: (title: string) =>
    `Mi plan de carrera ${title}, creado con GradePace`,
  shareFailed: "No se pudo crear la imagen. Inténtalo de nuevo.",
  copyFallback:
    "No se pudo copiar automáticamente. El enlace está en la barra de direcciones.",
  racePlan: "Plan de carrera",
  thGrade: "pendiente",
  thDplus: "D+",
  thHike: "marcha",
  thPace: "ritmo",
  thElapsed: "acumulado",
  showAll: (n: number) => `Mostrar los ${n} tramos`,
  showFewer: "Mostrar menos",
  errInvalid:
    "Este archivo no es un GPX válido: no se pudo leer como XML. Comprueba que exportaste un archivo .gpx.",
  errNoTrack:
    "Este archivo no contiene ni track ni ruta: no hay nada que planificar.",
  errTooFew:
    "Este track tiene muy pocos puntos para construir un plan (hacen falta al menos dos).",
  errNoElevation:
    "Este archivo no tiene datos de altitud, imposible ajustar por pendiente. Re-exporta el GPX con altitud; la mayoría de las herramientas lo permiten.",
  errGeneric: "No se pudo leer este archivo. Prueba con otro GPX.",
  errExample: "No se pudo cargar el recorrido de ejemplo. Inténtalo de nuevo.",
  errNotGpx: "Esto no parece un archivo .gpx. Suelta una exportación GPX.",
  footerBuiltBy: "Creado por",
  footerTraining: "mientras entrena para el Imperial Trail 70k, Fontainebleau.",
  footerOpenSource: "Código abierto en GitHub",
  themeToLight: "Cambiar a modo claro",
  themeToDark: "Cambiar a modo oscuro",
  uploadCourse: "Subir GPX",
  calibAdd: "Añadir salidas",
  aidLabel: "Avituallamientos",
  aidPlaceholder: "ej. 17, 33(8), 47",
  mapStart: "Salida",
  mapFinish: "Meta",
  mapAria: "Mapa del recorrido",
  mapLayersAria: "Estilo de mapa",
  mapLocate: "Mostrar mi posición",
  mapLocateError:
    "Posición no disponible. Permite el acceso a la ubicación y reinténtalo.",
  mapLayerTerrain: "Terreno",
  mapLayerStandard: "Estándar",
  mapLayerSatellite: "Satélite",
  mapLayerHybrid: "Híbrido",
  mapPoiToggle: "Puntos de interés",
  mapPoiHint:
    "Agua, aseos, miradores, cafés y más desde OpenStreetMap. Solo se envía la zona del recorrido (un rectángulo), nunca tu track.",
  mapPoiLoading: "Cargando…",
  mapPoiError:
    "No se pudieron cargar los puntos de interés. Reactiva para reintentar.",
  mapPoiTooBig: "Zona del recorrido demasiado grande para puntos de interés.",
  mapPoiEmpty: "Ningún punto de interés cartografiado cerca de este recorrido.",
  poiWater: "agua potable",
  poiToilets: "aseos",
  poiViewpoint: "mirador",
  poiCafe: "café",
  poiSpring: "manantial",
  poiShelter: "refugio",
  poiParking: "aparcamiento",
  poiPicnic: "zona de pícnic",
  nutritionTitle: "Plan de nutrición",
  nutritionSubtitle: "· carbohidratos, líquidos, sodio por tramo",
  nutritionIntro:
    "Objetivos por hora aplicados a cada tramo del plan (un tramo es la sección entre dos avituallamientos): esto es lo que llevar y consumir en cada uno. Las cantidades siguen el tiempo previsto, no la distancia.",
  nutritionNoStations:
    "Añade tus avituallamientos en el campo bajo el perfil y esta tabla se divide en una fila por tramo entre avituallamientos, cada una con sus cantidades.",
  carbsLabel: "Carbohidratos",
  carbsHint:
    "g por hora. 60–90 g/h es el rango de ultra; por encima de 90 hace falta un estómago entrenado",
  fluidLabel: "Líquidos",
  fluidHint: "ml por hora. Más con calor, menos con frío",
  sodiumLabel: "Sodio",
  sodiumHint:
    "mg de sodio por hora (1 g de sal ≈ 390 mg de sodio). Sudor salado = más necesidad",
  caffeineLabel: "Cafeína",
  caffeineHint:
    "mg por hora, 0 = desactivado. Resérvala para la segunda mitad; total moderado en la prueba (3 a 6 mg por kg)",
  colCaffeine: "cafeína",
  legLabel: "tramo",
  colDuration: "tiempo",
  colCarbs: "carbos",
  colFluid: "líquidos",
  colSodium: "sodio",
  colKcal: "kcal",
  nutritionTotal: "Total",
  gelsHint: (n: number) =>
    `≈ ${n} geles en la carrera (25 g de carbohidratos cada uno). Combínalos con bebidas, barritas y comida sólida a tu gusto.`,
  nutritionDisclaimer:
    "Pautas generales, no consejo médico. Entrena tu nutrición de carrera en tus tiradas largas.",
  exportSheet: "Exportar PDF",
  exportGpx: "GPX reloj",
  popupBlocked:
    "No se pudo abrir la vista de exportación. Permite las ventanas emergentes para este sitio y reinténtalo.",
  sheetSettings: "Ajustes",
  sheetEta: "paso",
  sheetSplitsTitle: "Tabla de ritmo",
  sheetFooter: (host: string) => `Creado con GradePace · ${host}`,
  dwellLabel: "Tiempo de parada",
  dwellHint:
    "Minutos perdidos en cada avituallamiento (rellenar, comer, cola). Se añaden a todos los tiempos posteriores. ¿Una parada distinta? Escribe 33(8) en el campo de avituallamientos: 8 min en esa.",
  startLabel: "Salida",
  startInvalid: "Introduce una hora de salida como 8:00 (24 h).",
  raceDateLabel: "Fecha de carrera",
  raceDateHint:
    "A menos de 16 días de la carrera, se consulta el pronóstico del día para un punto medio redondeado del recorrido. Tu GPX nunca sale del dispositivo.",
  weatherCountdown: (days: number) =>
    days === 1
      ? "El pronóstico del día de carrera se abre mañana."
      : `El pronóstico del día de carrera se abre en ${days} días.`,
  weatherLine: (temps: string, rain: string | null) =>
    rain === null
      ? `Pronóstico del día de carrera: ${temps}.`
      : `Pronóstico del día de carrera: ${temps}, lluvia ${rain}.`,
  weatherHeat: (extra: string, fluid: string) =>
    `El calor puede añadir hasta +${extra}. Considera beber +${fluid}.`,
  weatherError: "Pronóstico no disponible por ahora.",
  finishClock: (clock: string) => `llegada ≈ ${clock}`,
  cutoffLabel: "Cortes",
  cutoffPlaceholder: "ej. 5:30, 8:00",
  cutoffHint:
    "tiempos de corte como tiempo de carrera transcurrido (H:MM), uno por avituallamiento en orden del recorrido",
  cutoffMissLine: (station: string, arr: string, cutoff: string) =>
    `${station}: llegada prevista ${arr}, después del corte de ${cutoff}.`,
  cutoffRiskLine: (station: string, cutoff: string) =>
    `${station}: el extremo lento de tu horquilla supera el corte de ${cutoff}.`,
  chipArrDep: (arr: string, dep: string) => `llegada ${arr}, salida ${dep}`,
  sheetDepart: "salida",
  sheetCutoff: "corte",
  savedBadge: "Guardado",
  savedNote:
    "Tu plan se guarda en este dispositivo y se restaura en tu próxima visita.",
  savedForget: "Olvidar este plan",
  howTitle: "Cómo funciona",
  howSubtitle: "· el modelo detrás del plan",
  howModel:
    "El ritmo sale de la física, no de sensaciones: la curva de coste energético de Minetti (medida en laboratorio) pone precio a cada pendiente, anclada por tu ritmo cómodo en llano. Por encima del umbral de marcha, el plan pasa a marcha rápida a tu velocidad vertical, porque a esa pendiente correr deja de ser la opción eficiente.",
  howCalib:
    "El factor de terreno se mide, no se adivina: sube una salida grabada y GradePace invierte su propio modelo sobre ella, filtrando las paradas. Varias salidas estabilizan la medición.",
  howRange:
    "La llegada es una horquilla a propósito. Las condiciones del día (sueño, calor, alimentación) mueven una carrera larga entre 20 y 40 minutos; una predicción al segundo sería teatro. Calibrar estrecha la horquilla.",
  howMore: "Metodología completa y código en GitHub",
};

const de: Messages = {
  tagline:
    "Die meisten Pace-Planer nehmen an, dass du jeden Anstieg läufst. Tust du nicht. GradePace plant auch die Gehpassagen, direkt aus dem GPX deiner Strecke.",
  dropHint:
    "Oder ziehe eine .gpx-Datei irgendwo hinein. Wird im Browser analysiert, nie hochgeladen.",
  uploadCourseAria: "GPX-Datei der Strecke hochladen",
  exampleBadge: "Beispiel",
  exampleImperial:
    "Imperial Trail, Fontainebleau (70 km). Lade deine eigene Strecke, um dein Rennen zu planen.",
  exampleBosses:
    "25 Bosses, Fontainebleau: 15 km Sandsteinmauern, das Schaufenster des Power-Hikings.",
  loadImperial: "Imperial Trail (70 km)",
  loadBosses: "25 Bosses (steil)",
  yourPace: "Dein Tempo",
  unitsLabel: "Einheiten",
  paceLabel: "Dein lockeres Tempo in der Ebene",
  paceHintMetric: "min/km, ein Tempo, das du stundenlang flach halten kannst",
  paceHintImperial:
    "min/Meile, ein Tempo, das du stundenlang flach halten kannst",
  paceInvalid: (example: string, current: string) =>
    `Gib ein Tempo wie ${example} ein. Bis dahin gilt ${current}.`,
  advanced: "Erweiterte Einstellungen",
  vamLabel: "Steiggeschwindigkeit beim Gehen",
  vamHintMetric:
    "wie schnell du beim Power-Hiken steigst, in Höhenmetern pro Stunde",
  vamHintImperial:
    "wie schnell du beim Power-Hiken steigst, in vertikalen Fuß pro Stunde",
  gateLabel: "Gehen ab einer Steigung von",
  gateHint: "oberhalb dieser Steigung geht der Plan statt zu laufen",
  terrainLabel: "Gelände-Faktor",
  terrainHint:
    "Zeitaufschlag für technisches Gelände (Standard ×1,04, auf echten Trailläufen gemessen). Am besten selbst messen: siehe „Mit einem echten Lauf kalibrieren“.",
  climbsTitle: "Schlüsselanstiege",
  climbsSubtitle: "· wo das Rennen entschieden wird",
  climbsMore: (n: number) => `+ ${n} kleinere Anstiege nicht gelistet`,
  colLength: "Länge",
  colVam: "VAM",
  compareTitle: "Nach dem Rennen",
  compareSubtitle: "· Prognose vs gelaufen",
  compareIntro:
    "Lade nach dem Rennen die aufgezeichnete Aktivität hoch. Du siehst Abschnitt für Abschnitt, wo der Plan hielt und wo die Realität abwich.",
  compareAdd: "Aufgezeichnetes Rennen hochladen",
  compareUploadAria: "GPX des aufgezeichneten Rennens zum Vergleich hochladen",
  compareSummary: (pred: string, act: string, delta: string) =>
    `Prognose ${pred} · gelaufen ${act} · ${delta}`,
  compareStops: (t: string) => `Standzeit ${t}`,
  compareWorst: (lost: string, span: string) =>
    `Größte Lücke: ${lost} verloren zwischen ${span}.`,
  compareBest: (gain: string, span: string) =>
    `Stärkster Abschnitt: ${gain} gewonnen zwischen ${span}.`,
  comparePartial:
    "Die Aufzeichnung ist kürzer als die Strecke. Der Vergleich deckt nur den aufgezeichneten Teil ab.",
  compareMismatch:
    "Die Aufzeichnung ist deutlich länger als die Strecke, Distanzen werden daher absolut verglichen.",
  compareClear: "Vergleich entfernen",
  thActual: "Ist",
  naiveLine: (naive: string, real: string) =>
    `Ein Flachtempo-Rechner würde ${naive} versprechen. Diese Strecke macht daraus ${real}.`,
  fadeLabel: "Ermüdung im Rennverlauf",
  fadeHint:
    "zusätzliche Verlangsamung pro Stunde nach Stunde 4 (Standard 2 %/h, aus Ultra-Pacing-Studien). 0 = konstante Leistung",
  calibWeight: (pct: number) => `Gewicht ${pct}%`,
  replayLabel: "Rennen abspielen",
  replayStop: "Stoppen",
  calibTitle: "Mit einem echten Lauf kalibrieren",
  calibMeasure: "· miss deinen Gelände-Faktor",
  calibApplied: (factor: string) => `· angewendet ×${factor}`,
  calibIntro:
    "Lade einen oder mehrere aufgezeichnete Läufe (mit Zeitstempeln) hoch. Jeder wird mit dem Modell verglichen, Pausen herausgefiltert, um deinen persönlichen Gelände-Faktor zu messen. Ein Lauf = ein Tag; mehrere Läufe stabilisieren die Messung.",
  calibUploadAria: "Aufgezeichnete Läufe (GPX) zur Kalibrierung hochladen",
  calibNoTime: (file: string) =>
    `${file}: keine Zeitstempel, sieht nach einer geplanten Route aus. Exportiere stattdessen die aufgezeichnete Aktivität (Strava, Garmin, COROS…).`,
  calibUnreadable: (file: string) => `${file}: Datei konnte nicht gelesen werden.`,
  moving: "in Bewegung",
  implausible:
    "unplausibel, daher vom Median ausgeschlossen. Route mit geschätzten Zeiten? Referenztempo an dem Tag weit daneben?",
  removeRun: (file: string) => `${file} entfernen`,
  useFactor: (factor: string) => `×${factor} verwenden`,
  medianOfRuns: (n: number) => ` (Median aus ${n} Läufen)`,
  forThisPlan: " für diesen Plan",
  spread: "Spanne",
  threeDTitle: "3D-Flug",
  expandChart: "Vergrößern",
  closeChart: "Schließen",
  legendDescent: "Abstieg",
  legendRunnable: "laufbar",
  legendClimb: "Anstieg",
  legendPowerHike: "Power-Hike",
  elevationWord: "Höhe",
  powerHikeWord: "Power-Hike",
  chartDplusLeft: "HM übrig",
  statDistance: "Distanz",
  statGain: "Höhenmeter",
  statHike: "Power-Hike",
  statFinish: "Zielzeit (Prognose)",
  walkedPct: (pct: string) => `${pct}% der Strecke gehend`,
  expect: "rechne mit",
  calibratedTag: "· kalibriert",
  rangeNote:
    "Eine Spanne, kein Versprechen: die Tagesform verschiebt ein langes Rennen um 20 bis 40 min. Kalibrieren macht sie enger.",
  sensitivityLabel: "Mit einem anderen Grundtempo:",
  courseNamePlaceholder: "Streckenname",
  courseNameAria: "Streckenname für das geteilte Bild",
  shareImage: "Bild teilen",
  creatingImage: "Wird erstellt…",
  copyLink: "Link kopieren",
  copied: "Kopiert",
  shareText: (title: string) =>
    `Mein ${title}-Rennplan, erstellt mit GradePace`,
  shareFailed: "Bild konnte nicht erstellt werden. Bitte erneut versuchen.",
  copyFallback:
    "Automatisches Kopieren fehlgeschlagen. Der Link steht jetzt in der Adressleiste.",
  racePlan: "Rennplan",
  thGrade: "Steigung",
  thDplus: "HM+",
  thHike: "gehen",
  thPace: "Tempo",
  thElapsed: "gesamt",
  showAll: (n: number) => `Alle ${n} Abschnitte anzeigen`,
  showFewer: "Weniger anzeigen",
  errInvalid:
    "Diese Datei ist kein gültiges GPX: sie ließ sich nicht als XML lesen. Prüfe, ob du eine .gpx-Datei exportiert hast.",
  errNoTrack:
    "Diese Datei enthält weder Track noch Route: nichts zu planen.",
  errTooFew:
    "Dieser Track hat zu wenige Punkte für einen Plan (mindestens zwei nötig).",
  errNoElevation:
    "Diese Datei hat keine Höhendaten, eine Anpassung an die Steigung ist unmöglich. Exportiere das GPX mit Höhe; die meisten Tools bieten das an.",
  errGeneric: "Datei konnte nicht gelesen werden. Versuche ein anderes GPX.",
  errExample:
    "Beispielstrecke konnte nicht geladen werden. Bitte erneut versuchen.",
  errNotGpx: "Das sieht nicht nach einer .gpx-Datei aus. Ziehe einen GPX-Export hinein.",
  footerBuiltBy: "Erstellt von",
  footerTraining:
    "während des Trainings für den Imperial Trail 70k, Fontainebleau.",
  footerOpenSource: "Open Source auf GitHub",
  themeToLight: "Zum hellen Modus wechseln",
  themeToDark: "Zum dunklen Modus wechseln",
  uploadCourse: "GPX hochladen",
  calibAdd: "Läufe hinzufügen",
  aidLabel: "Verpflegungspunkte",
  aidPlaceholder: "z. B. 17, 33(8), 47",
  mapStart: "Start",
  mapFinish: "Ziel",
  mapAria: "Streckenkarte",
  mapLayersAria: "Kartenstil",
  mapLocate: "Meine Position anzeigen",
  mapLocateError:
    "Position nicht verfügbar. Standortzugriff erlauben und erneut versuchen.",
  mapLayerTerrain: "Gelände",
  mapLayerStandard: "Standard",
  mapLayerSatellite: "Satellit",
  mapLayerHybrid: "Hybrid",
  mapPoiToggle: "Points of Interest",
  mapPoiHint:
    "Wasser, Toiletten, Aussichtspunkte, Cafés und mehr aus OpenStreetMap. Es wird nur das Streckengebiet (ein Rechteck) gesendet, nie dein Track.",
  mapPoiLoading: "Lädt…",
  mapPoiError:
    "Points of Interest konnten nicht geladen werden. Zum Wiederholen erneut aktivieren.",
  mapPoiTooBig: "Streckengebiet zu groß für Points of Interest.",
  mapPoiEmpty: "Keine Points of Interest nahe dieser Strecke kartiert.",
  poiWater: "Trinkwasser",
  poiToilets: "Toiletten",
  poiViewpoint: "Aussichtspunkt",
  poiCafe: "Café",
  poiSpring: "Quelle",
  poiShelter: "Schutzhütte",
  poiParking: "Parkplatz",
  poiPicnic: "Picknickplatz",
  nutritionTitle: "Ernährungsplan",
  nutritionSubtitle: "· Kohlenhydrate, Flüssigkeit, Natrium pro Abschnitt",
  nutritionIntro:
    "Stundenziele, angewendet auf jeden Abschnitt deines Plans (ein Abschnitt ist die Strecke zwischen zwei Verpflegungspunkten): das nimmst du dort mit und zu dir. Die Mengen folgen der prognostizierten Zeit, nicht der Distanz.",
  nutritionNoStations:
    "Trage deine Verpflegungspunkte im Feld unter dem Höhenprofil ein, dann teilt sich diese Tabelle in eine Zeile pro Abschnitt, jede mit eigenen Mengen.",
  carbsLabel: "Kohlenhydrate",
  carbsHint:
    "g pro Stunde. 60–90 g/h ist der Ultra-Bereich; über 90 braucht einen trainierten Magen",
  fluidLabel: "Flüssigkeit",
  fluidHint: "ml pro Stunde. Bei Hitze mehr, bei Kälte weniger",
  sodiumLabel: "Natrium",
  sodiumHint:
    "mg Natrium pro Stunde (1 g Salz ≈ 390 mg Natrium). Salzige Schwitzer brauchen mehr",
  caffeineLabel: "Koffein",
  caffeineHint:
    "mg pro Stunde, 0 = aus. Heb es für die zweite Hälfte auf; Gesamtmenge moderat halten (3 bis 6 mg pro kg)",
  colCaffeine: "Koffein",
  legLabel: "Abschnitt",
  colDuration: "Zeit",
  colCarbs: "KH",
  colFluid: "Flüssigkeit",
  colSodium: "Natrium",
  colKcal: "kcal",
  nutritionTotal: "Gesamt",
  gelsHint: (n: number) =>
    `≈ ${n} Gels über das Rennen (je 25 g Kohlenhydrate). Nach Geschmack mit Getränken, Riegeln und fester Nahrung mischen.`,
  nutritionDisclaimer:
    "Allgemeine Richtwerte, keine medizinische Beratung. Trainiere deine Rennverpflegung auf langen Läufen.",
  exportSheet: "PDF exportieren",
  exportGpx: "Uhr-GPX",
  popupBlocked:
    "Export-Ansicht konnte nicht geöffnet werden. Erlaube Pop-ups für diese Seite und versuche es erneut.",
  sheetSettings: "Einstellungen",
  sheetEta: "Durchgang",
  sheetSplitsTitle: "Tempotabelle",
  sheetFooter: (host: string) => `Erstellt mit GradePace · ${host}`,
  dwellLabel: "Standzeit",
  dwellHint:
    "Minuten, die an jedem Verpflegungspunkt verloren gehen (Auffüllen, Essen, Schlange). Wird allen späteren Zeiten zugerechnet. Ein Punkt anders? 33(8) im Stationsfeld bedeutet: 8 min an diesem.",
  startLabel: "Start",
  startInvalid: "Gib eine Startzeit wie 8:00 ein (24 h).",
  raceDateLabel: "Renntag",
  raceDateHint:
    "Innerhalb von 16 Tagen vor dem Rennen wird die Vorhersage für einen gerundeten Mittelpunkt der Strecke geladen. Dein GPX verlässt nie das Gerät.",
  weatherCountdown: (days: number) =>
    days === 1
      ? "Die Renntag-Vorhersage öffnet morgen."
      : `Die Renntag-Vorhersage öffnet in ${days} Tagen.`,
  weatherLine: (temps: string, rain: string | null) =>
    rain === null
      ? `Renntag-Vorhersage: ${temps}.`
      : `Renntag-Vorhersage: ${temps}, Regen ${rain}.`,
  weatherHeat: (extra: string, fluid: string) =>
    `Hitze kann bis zu +${extra} kosten. Denk an +${fluid} mehr Flüssigkeit.`,
  weatherError: "Renntag-Vorhersage derzeit nicht verfügbar.",
  finishClock: (clock: string) => `Ziel ≈ ${clock}`,
  cutoffLabel: "Cut-offs",
  cutoffPlaceholder: "z. B. 5:30, 8:00",
  cutoffHint:
    "Karenzzeiten als verstrichene Rennzeit (H:MM), eine pro Verpflegungspunkt in Streckenreihenfolge",
  cutoffMissLine: (station: string, arr: string, cutoff: string) =>
    `${station}: prognostizierte Ankunft ${arr}, nach dem Cut-off von ${cutoff}.`,
  cutoffRiskLine: (station: string, cutoff: string) =>
    `${station}: das langsame Ende deiner Spanne reißt den Cut-off von ${cutoff}.`,
  chipArrDep: (arr: string, dep: string) => `Ankunft ${arr}, Abfahrt ${dep}`,
  sheetDepart: "Abfahrt",
  sheetCutoff: "Cut-off",
  savedBadge: "Gespeichert",
  savedNote:
    "Dein Plan wird auf diesem Gerät gespeichert und beim nächsten Besuch wiederhergestellt.",
  savedForget: "Diesen Plan vergessen",
  howTitle: "So funktioniert es",
  howSubtitle: "· das Modell hinter dem Plan",
  howModel:
    "Das Tempo kommt aus der Physik, nicht aus dem Bauchgefühl: die Minetti-Energiekostenkurve (im Labor gemessen) bepreist jede Steigung, verankert durch dein lockeres Flachtempo. Oberhalb der Geh-Schwelle wechselt der Plan zum Power-Hiken mit deiner Steiggeschwindigkeit, weil Laufen dort nicht mehr die effiziente Option ist.",
  howCalib:
    "Der Gelände-Faktor wird gemessen, nicht geraten: lade einen aufgezeichneten Lauf hoch und GradePace invertiert sein eigenes Modell darauf, Pausen herausgefiltert. Mehrere Läufe stabilisieren die Messung.",
  howRange:
    "Die Zielzeit ist absichtlich eine Spanne. Die Tagesbedingungen (Schlaf, Hitze, Verpflegung) verschieben ein langes Rennen um 20 bis 40 Minuten; eine sekundengenaue Prognose wäre Theater. Kalibrieren macht die Spanne enger.",
  howMore: "Vollständige Methodik und Quellcode auf GitHub",
};

const it: Messages = {
  tagline:
    "La maggior parte dei pianificatori di ritmo presume che tu corra ogni salita. In realtà no. GradePace pianifica anche i tratti di camminata, dal GPX del tuo percorso.",
  dropHint:
    "Oppure trascina un .gpx ovunque. Analizzato nel tuo browser, mai caricato.",
  uploadCourseAria: "Carica un file GPX del percorso",
  exampleBadge: "Esempio",
  exampleImperial:
    "Imperial Trail, Fontainebleau (70 km). Carica il tuo per pianificare la tua gara.",
  exampleBosses:
    "25 Bosses, Fontainebleau: 15 km di muri di arenaria, la vetrina della camminata veloce.",
  loadImperial: "Imperial Trail (70 km)",
  loadBosses: "25 Bosses (ripido)",
  yourPace: "Il tuo ritmo",
  unitsLabel: "Unità",
  paceLabel: "Il tuo ritmo facile in piano",
  paceHintMetric: "min/km, un ritmo sostenibile per ore in piano",
  paceHintImperial: "min/miglio, un ritmo sostenibile per ore in piano",
  paceInvalid: (example: string, current: string) =>
    `Inserisci un ritmo come ${example}. Nel frattempo resta ${current}.`,
  advanced: "Impostazioni avanzate",
  vamLabel: "Velocità di salita camminando",
  vamHintMetric:
    "quanto sali durante la camminata veloce, in metri verticali all'ora",
  vamHintImperial:
    "quanto sali durante la camminata veloce, in piedi verticali all'ora",
  gateLabel: "Cammina oltre una pendenza di",
  gateHint: "oltre questa pendenza, il piano cammina invece di correre",
  terrainLabel: "Fattore terreno",
  terrainHint:
    "tempo extra per terreno tecnico (predefinito ×1,04, misurato su uscite reali). L'ideale: misuralo tu stesso, vedi “Calibra con un'uscita reale”.",
  climbsTitle: "Salite chiave",
  climbsSubtitle: "· dove si decide la gara",
  climbsMore: (n: number) => `+ ${n} salite minori non elencate`,
  colLength: "lunghezza",
  colVam: "VAM",
  compareTitle: "Dopo la gara",
  compareSubtitle: "· previsto vs corso",
  compareIntro:
    "Dopo la gara, carica l'attività registrata. Vedrai dove il piano ha tenuto e dove la realtà è andata altrove, tratto per tratto.",
  compareAdd: "Carica la gara registrata",
  compareUploadAria: "Carica il GPX della gara registrata per il confronto",
  compareSummary: (pred: string, act: string, delta: string) =>
    `Previsto ${pred} · corso ${act} · ${delta}`,
  compareStops: (t: string) => `tempo fermo ${t}`,
  compareWorst: (lost: string, span: string) =>
    `Distacco maggiore: ${lost} persi tra ${span}.`,
  compareBest: (gain: string, span: string) =>
    `Tratto migliore: ${gain} guadagnati tra ${span}.`,
  comparePartial:
    "La registrazione è più corta del percorso. Il confronto copre solo la parte registrata.",
  compareMismatch:
    "La registrazione è molto più lunga del percorso, quindi le distanze sono confrontate in assoluto.",
  compareClear: "Rimuovi il confronto",
  thActual: "reale",
  naiveLine: (naive: string, real: string) =>
    `Una calcolatrice a ritmo piatto prometterebbe ${naive}. Questo percorso lo trasforma in ${real}.`,
  fadeLabel: "Calo di fine gara",
  fadeHint:
    "rallentamento extra all'ora dopo la 4a ora (predefinito 2%/h, dagli studi sul ritmo negli ultra). 0 = sforzo costante",
  calibWeight: (pct: number) => `peso ${pct}%`,
  replayLabel: "Riproduci la gara",
  replayStop: "Ferma",
  calibTitle: "Calibra con un'uscita reale",
  calibMeasure: "· misura il tuo fattore terreno",
  calibApplied: (factor: string) => `· applicato ×${factor}`,
  calibIntro:
    "Carica una o più uscite registrate (con marcatura temporale). Ognuna viene confrontata col modello, soste filtrate, per misurare il tuo fattore terreno personale. Un'uscita = un giorno; più uscite stabilizzano la misura.",
  calibUploadAria: "Carica uscite registrate (GPX) per la calibrazione",
  calibNoTime: (file: string) =>
    `${file}: nessuna marcatura temporale, sembra un percorso pianificato. Esporta invece l'attività registrata (Strava, Garmin, COROS…).`,
  calibUnreadable: (file: string) => `${file}: impossibile leggere il file.`,
  moving: "in movimento",
  implausible:
    "inverosimile, quindi escluso dalla mediana. Percorso con tempi stimati? Ritmo di riferimento molto diverso quel giorno?",
  removeRun: (file: string) => `Rimuovi ${file}`,
  useFactor: (factor: string) => `Usa ×${factor}`,
  medianOfRuns: (n: number) => ` (mediana di ${n} uscite)`,
  forThisPlan: " per questo piano",
  spread: "intervallo",
  threeDTitle: "Sorvolo 3D",
  expandChart: "Ingrandisci",
  closeChart: "Chiudi",
  legendDescent: "discesa",
  legendRunnable: "corribile",
  legendClimb: "salita",
  legendPowerHike: "camminata veloce",
  elevationWord: "quota",
  powerHikeWord: "camminata",
  chartDplusLeft: "D+ rimanente",
  statDistance: "Distanza",
  statGain: "Dislivello positivo",
  statHike: "Camminata veloce",
  statFinish: "Arrivo previsto",
  walkedPct: (pct: string) => `${pct}% del percorso camminando`,
  expect: "conta su",
  calibratedTag: "· calibrato",
  rangeNote:
    "Una forchetta, non una promessa: le condizioni del giorno spostano una gara lunga di 20-40 min. Calibrare la restringe.",
  sensitivityLabel: "Con un altro ritmo base:",
  courseNamePlaceholder: "Nome del percorso",
  courseNameAria: "Nome del percorso per l'immagine condivisa",
  shareImage: "Condividi immagine",
  creatingImage: "Creazione…",
  copyLink: "Copia link",
  copied: "Copiato",
  shareText: (title: string) =>
    `Il mio piano gara ${title}, creato con GradePace`,
  shareFailed: "Impossibile creare l'immagine. Riprova.",
  copyFallback:
    "Copia automatica non riuscita. Il link è nella barra degli indirizzi.",
  racePlan: "Piano gara",
  thGrade: "pendenza",
  thDplus: "D+",
  thHike: "camminata",
  thPace: "ritmo",
  thElapsed: "totale",
  showAll: (n: number) => `Mostra tutti i ${n} tratti`,
  showFewer: "Mostra meno",
  errInvalid:
    "Questo file non è un GPX valido: impossibile leggerlo come XML. Verifica di aver esportato un file .gpx.",
  errNoTrack:
    "Questo file non contiene né traccia né percorso: niente da pianificare.",
  errTooFew:
    "Questa traccia ha troppo pochi punti per costruire un piano (ne servono almeno due).",
  errNoElevation:
    "Questo file non ha dati di quota, impossibile adattare alla pendenza. Riesporta il GPX con la quota; la maggior parte degli strumenti lo consente.",
  errGeneric: "Impossibile leggere questo file. Prova un altro GPX.",
  errExample: "Impossibile caricare il percorso di esempio. Riprova.",
  errNotGpx: "Non sembra un file .gpx. Trascina un'esportazione GPX.",
  footerBuiltBy: "Creato da",
  footerTraining:
    "mentre si allena per l'Imperial Trail 70k, Fontainebleau.",
  footerOpenSource: "Open source su GitHub",
  themeToLight: "Passa alla modalità chiara",
  themeToDark: "Passa alla modalità scura",
  uploadCourse: "Carica GPX",
  calibAdd: "Aggiungi uscite",
  aidLabel: "Ristori",
  aidPlaceholder: "es. 17, 33(8), 47",
  mapStart: "Partenza",
  mapFinish: "Arrivo",
  mapAria: "Mappa del percorso",
  mapLayersAria: "Stile mappa",
  mapLocate: "Mostra la mia posizione",
  mapLocateError:
    "Posizione non disponibile. Consenti l'accesso alla posizione e riprova.",
  mapLayerTerrain: "Terreno",
  mapLayerStandard: "Standard",
  mapLayerSatellite: "Satellite",
  mapLayerHybrid: "Ibrida",
  mapPoiToggle: "Punti di interesse",
  mapPoiHint:
    "Acqua, bagni, punti panoramici, caffè e altro da OpenStreetMap. Viene inviata solo la zona del percorso (un rettangolo), mai la tua traccia.",
  mapPoiLoading: "Caricamento…",
  mapPoiError:
    "Impossibile caricare i punti di interesse. Riattiva per riprovare.",
  mapPoiTooBig: "Zona del percorso troppo estesa per i punti di interesse.",
  mapPoiEmpty: "Nessun punto di interesse mappato vicino a questo percorso.",
  poiWater: "acqua potabile",
  poiToilets: "bagni",
  poiViewpoint: "punto panoramico",
  poiCafe: "caffè",
  poiSpring: "sorgente",
  poiShelter: "rifugio",
  poiParking: "parcheggio",
  poiPicnic: "area picnic",
  nutritionTitle: "Piano nutrizionale",
  nutritionSubtitle: "· carboidrati, liquidi, sodio per tratto",
  nutritionIntro:
    "Obiettivi orari applicati a ogni tratto del piano (un tratto è la sezione tra due ristori): ecco cosa portare e consumare su ciascuno. Le quantità seguono il tempo previsto, non la distanza.",
  nutritionNoStations:
    "Aggiungi i tuoi ristori nel campo sotto il profilo altimetrico e questa tabella si divide in una riga per tratto tra ristori, ognuna con le sue quantità.",
  carbsLabel: "Carboidrati",
  carbsHint:
    "g all'ora. 60–90 g/h è il range ultra; oltre 90 serve uno stomaco allenato",
  fluidLabel: "Liquidi",
  fluidHint: "ml all'ora. Di più col caldo, meno col freddo",
  sodiumLabel: "Sodio",
  sodiumHint:
    "mg di sodio all'ora (1 g di sale ≈ 390 mg di sodio). Chi suda salato ne ha più bisogno",
  caffeineLabel: "Caffeina",
  caffeineHint:
    "mg all'ora, 0 = disattivata. Riservala alla seconda metà; totale moderato in gara (3-6 mg per kg)",
  colCaffeine: "caffeina",
  legLabel: "tratto",
  colDuration: "tempo",
  colCarbs: "carbo",
  colFluid: "liquidi",
  colSodium: "sodio",
  colKcal: "kcal",
  nutritionTotal: "Totale",
  gelsHint: (n: number) =>
    `≈ ${n} gel in gara (25 g di carboidrati ciascuno). Da combinare con bevande, barrette e cibo solido a piacere.`,
  nutritionDisclaimer:
    "Indicazioni generali, non un parere medico. Allena la tua nutrizione di gara nei lunghi.",
  exportSheet: "Esporta PDF",
  exportGpx: "GPX orologio",
  popupBlocked:
    "Impossibile aprire la vista di esportazione. Consenti i pop-up per questo sito e riprova.",
  sheetSettings: "Impostazioni",
  sheetEta: "passaggio",
  sheetSplitsTitle: "Tabella dei ritmi",
  sheetFooter: (host: string) => `Creato con GradePace · ${host}`,
  dwellLabel: "Tempo di sosta",
  dwellHint:
    "Minuti persi a ogni ristoro (rifornimento, cibo, coda). Aggiunti a tutti i tempi successivi. Un ristoro diverso? Scrivi 33(8) nel campo dei ristori: 8 min in quello.",
  startLabel: "Partenza",
  startInvalid: "Inserisci un orario di partenza come 8:00 (24 h).",
  raceDateLabel: "Data della gara",
  raceDateHint:
    "A meno di 16 giorni dalla gara, le previsioni del giorno vengono recuperate per un punto medio arrotondato del percorso. Il tuo GPX non lascia mai il dispositivo.",
  weatherCountdown: (days: number) =>
    days === 1
      ? "Le previsioni del giorno di gara aprono domani."
      : `Le previsioni del giorno di gara aprono tra ${days} giorni.`,
  weatherLine: (temps: string, rain: string | null) =>
    rain === null
      ? `Previsioni del giorno di gara: ${temps}.`
      : `Previsioni del giorno di gara: ${temps}, pioggia ${rain}.`,
  weatherHeat: (extra: string, fluid: string) =>
    `Il caldo può aggiungere fino a +${extra}. Considera di bere +${fluid} in più.`,
  weatherError: "Previsioni al momento non disponibili.",
  finishClock: (clock: string) => `arrivo ≈ ${clock}`,
  cutoffLabel: "Cancelli",
  cutoffPlaceholder: "es. 5:30, 8:00",
  cutoffHint:
    "cancelli orari come tempo di gara trascorso (H:MM), uno per ristoro in ordine di percorso",
  cutoffMissLine: (station: string, arr: string, cutoff: string) =>
    `${station}: arrivo previsto ${arr}, dopo il cancello delle ${cutoff}.`,
  cutoffRiskLine: (station: string, cutoff: string) =>
    `${station}: l'estremo lento della tua forchetta supera il cancello delle ${cutoff}.`,
  chipArrDep: (arr: string, dep: string) => `arrivo ${arr}, ripartenza ${dep}`,
  sheetDepart: "ripartenza",
  sheetCutoff: "cancello",
  savedBadge: "Salvato",
  savedNote:
    "Il tuo piano è salvato su questo dispositivo e ripristinato alla prossima visita.",
  savedForget: "Dimentica questo piano",
  howTitle: "Come funziona",
  howSubtitle: "· il modello dietro il piano",
  howModel:
    "Il ritmo viene dalla fisica, non dalle sensazioni: la curva del costo energetico di Minetti (misurata in laboratorio) dà un prezzo a ogni pendenza, ancorata al tuo ritmo facile in piano. Oltre la soglia di camminata il piano passa alla camminata veloce alla tua velocità verticale, perché a quella pendenza correre smette di essere l'opzione efficiente.",
  howCalib:
    "Il fattore terreno si misura, non si indovina: carica un'uscita registrata e GradePace inverte il proprio modello su di essa, soste filtrate. Più uscite stabilizzano la misura.",
  howRange:
    "L'arrivo è una forchetta di proposito. Le condizioni del giorno (sonno, caldo, alimentazione) spostano una gara lunga di 20-40 minuti; una previsione al secondo sarebbe teatro. Calibrare restringe la forchetta.",
  howMore: "Metodologia completa e codice su GitHub",
};

export const MESSAGES: Record<Lang, Messages> = { en, fr, es, de, it };
