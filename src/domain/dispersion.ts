/**
 * Atmospheric dispersal simulations published by the Icelandic Meteorological
 * Office.
 *
 * ## What these are — and the one thing a reader must not conclude
 *
 * IMO runs dispersal models several times a day for eruptions at a handful of
 * selected volcanoes, each with a preset plume height. **The overwhelming
 * majority of these runs are for eruptions that are not happening.** They are
 * contingency products: "if this volcano erupted with today's weather, here is
 * where the plume would go". IMO's own description of the service says so —
 * the simulations are "for hypothetical eruptions at key selected Icelandic
 * volcanoes", and "in case of real eruption, the service will provide access
 * to the simulations produced for the ongoing event".
 *
 * Nothing in the published record distinguishes the two. A run for a real
 * eruption and a run for a hypothetical one carry the same fields, the same
 * model, and the same `product_type: Forecast`. Some scenario names contain
 * the word "hypothetical" and others do not, and that is a naming habit rather
 * than a flag.
 *
 * So this codebase never asserts which kind a run is, and the interface never
 * implies an eruption is under way or expected. Whether anything is actually
 * happening is answered by IMO's aviation colour codes and official warnings,
 * both of which this product already shows, and by IMO directly.
 *
 * ## What the numbers mean
 *
 * The shading is IMO's, reproduced from their own published legend rather than
 * a scale invented here. `NAME` models tephra (ash), `CALPUFF` models volcanic
 * SO₂. Meteorology is ECMWF.
 *
 * ## Sources
 *
 *   GET /epos/volcano/hazard/maps/probabilistic-modelling-based/dispersion-ash-gas
 *     — the published catalogue: which runs exist, at which volcano, of which
 *       hazard, valid for how long. Carries the volcano's name.
 *   GET /dispersion/simulations/{uuid}
 *     — the run itself: the geographic bounds of the model grid and which
 *       output layers it produced. Needed to put anything on a map.
 *
 * The two are joined on the run UUID, which the catalogue publishes inside its
 * `product_reference` link to IMO's own viewer.
 */

/** The two models IMO runs. Each answers a different question. */
export type DispersionModel = "NAME" | "CALPUFF";

/** What is being dispersed. */
export type DispersionHazard = "ash" | "gas";

/**
 * One output layer of a run.
 *
 * A single simulation produces many: ground deposit, near-surface
 * concentration, and concentration at a series of flight levels. `altitude`
 * is metres above ground when `altitudeUnit` is `m`, and a pressure level when
 * it is `hPa` — 300 hPa being roughly 9 km, which is why aviation cares.
 */
export type DispersionLayer = {
  /** As published: "Ash kg/m2", "Ash g/m3", "SO2" or "SO4". */
  dispersionType: string;
  altitude: number;
  altitudeUnit: "m" | "hPa";
};

/** The model grid's extent, in degrees. */
export type DispersionBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type DispersionRun = {
  /** The run UUID, which is also the key for fetching its rasters. */
  id: string;
  /** IMO's own name for the scenario, e.g. "Grindavik10000", "askjascenario". */
  scenario: string;
  /** The volcano the source sits on, from the EPOS catalogue. */
  volcano: string;
  model: DispersionModel;
  hazard: DispersionHazard;
  /** Source position, as the model was configured. */
  latitude: number;
  longitude: number;
  /**
   * Plume height above the vent in metres, as the scenario presets it.
   *
   * This is an input to the model, not an observation. A "10000 m" run is a
   * question ("what if the column reached 10 km"), never a measurement.
   */
  columnHeightM: number | null;
  /** Model start, ISO instant. Frames run from one hour after this. */
  startsAt: string;
  /** Hours simulated from `startsAt`. */
  durationHours: number;
  /** When IMO produced the run, ISO instant. */
  createdAt: string;
  bounds: DispersionBounds;
  layers: DispersionLayer[];
  /** IMO's own viewer for this run, which carries the quantitative legend. */
  viewerUrl: string;
};

/**
 * The instants this run has rasters for.
 *
 * Verified against the service rather than assumed: frames are hourly, the
 * first is one hour *after* `startsAt` (at t=0 nothing has dispersed yet and
 * the endpoint answers 404), and the last is exactly `startsAt + duration`.
 */
export function frameTimes(run: DispersionRun): number[] {
  const start = Date.parse(run.startsAt);
  if (!Number.isFinite(start)) return [];
  const frames: number[] = [];
  for (let hour = 1; hour <= run.durationHours; hour += 1) {
    frames.push(start + hour * 3_600_000);
  }
  return frames;
}

/**
 * The raster endpoint's time format: `2026-09-19T18:00:00`, naive.
 *
 * Appending a `Z` makes it answer 500, so the trailing zone designator is
 * stripped. IMO publishes in UTC, which is also Icelandic local time all year,
 * so the naive string and the instant agree.
 */
export function toRasterTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d+Z$/, "");
}

/**
 * Our proxy URL for one frame.
 *
 * Nothing upstream appears in it: the route rebuilds the IMO request from
 * these validated parts, so this is a description of a frame rather than a
 * URL to fetch on someone's behalf.
 */
export function rasterUrl(
  run: DispersionRun,
  layer: DispersionLayer,
  atMs: number,
): string {
  const params = new URLSearchParams({
    run: run.id,
    model: run.model,
    type: layer.dispersionType,
    alt: String(layer.altitude),
    unit: layer.altitudeUnit,
    at: toRasterTime(atMs),
  });
  return `/api/dispersion/raster?${params.toString()}`;
}

/**
 * The layer to show first.
 *
 * Near-surface concentration, because that is the one a person on the ground
 * is in: ground deposit accumulates over the whole run and says little about
 * any given hour, and the flight levels are an aviation question.
 */
export function defaultLayer(run: DispersionRun): DispersionLayer | null {
  const surface = run.layers.find(
    (layer) => layer.altitudeUnit === "m" && layer.dispersionType.endsWith("g/m3"),
  );
  if (surface) return surface;
  return run.layers.find((layer) => layer.altitudeUnit === "m") ?? run.layers[0] ?? null;
}

/**
 * Whether the run records where its source actually was.
 *
 * Older gas runs carry `1.0, 1.0` as a placeholder, with the real source
 * buried in a projected grid reference. A marker in the Gulf of Guinea is
 * worse than no marker, so callers check before drawing one.
 */
export function hasKnownSource(run: DispersionRun): boolean {
  const { latitude, longitude } = run;
  if (latitude === 1 && longitude === 1) return false;
  if (latitude === 0 && longitude === 0) return false;
  return latitude >= 62 && latitude <= 68 && longitude >= -26 && longitude <= -12;
}

/** Stable key for a layer within a run, used in the URL and as a React key. */
export function layerKey(layer: DispersionLayer): string {
  return `${layer.dispersionType}|${layer.altitude}|${layer.altitudeUnit}`;
}

/** "Near-surface (5 m)", "Flight level 300 hPa", "Ground deposit". */
export function describeLayer(layer: DispersionLayer): string {
  if (layer.dispersionType.endsWith("kg/m2")) return "Ground deposit, total";
  if (layer.altitudeUnit === "hPa") return `Airborne at ${layer.altitude} hPa`;
  if (layer.altitude <= 10) return `Near the ground (${layer.altitude} m)`;
  return `Airborne at ${layer.altitude} m`;
}

/**
 * IMO's published colour scale, transcribed from their own dispersion viewer.
 *
 * Reproduced rather than invented: a colour-to-concentration mapping made up
 * here would turn a picture into a number we have no basis for. Labels are
 * IMO's wording, including their approximate depth equivalents for deposit.
 */
export const NAME_DEPOSIT_LEGEND: ReadonlyArray<{ label: string; colour: string }> = [
  { label: "1000 kg/m² (~1 m)", colour: "rgb(24 23 23)" },
  { label: "100 kg/m² (~10 cm)", colour: "rgb(59 56 56)" },
  { label: "10 kg/m² (~1 cm)", colour: "rgb(89 89 89)" },
  { label: "1 kg/m² (~1 mm)", colour: "rgb(127 127 127)" },
  { label: "0.1 kg/m² (~0.1 mm)", colour: "rgb(166 166 166)" },
  { label: "0.01 kg/m²", colour: "rgb(217 217 217)" },
];

export const NAME_AIR_LEGEND: ReadonlyArray<{ label: string; colour: string }> = [
  { label: "1 g/m³", colour: "rgb(255 0 0)" },
  { label: "0.1 g/m³", colour: "rgb(96 71 251)" },
  { label: "0.01 g/m³", colour: "rgb(255 192 0)" },
  { label: "0.004 g/m³", colour: "rgb(255 255 0)" },
  { label: "0.002 g/m³", colour: "rgb(112 173 71)" },
  { label: "0.0002 g/m³", colour: "rgb(41 201 223)" },
];

export const CALPUFF_LEGEND: ReadonlyArray<{ label: string; colour: string }> = [
  { label: "14000 µg/m³", colour: "rgb(104 26 26)" },
  { label: "9000 µg/m³", colour: "rgb(92 53 120)" },
  { label: "2600 µg/m³", colour: "rgb(165 30 37)" },
  { label: "600 µg/m³", colour: "rgb(164 93 31)" },
  { label: "350 µg/m³", colour: "rgb(205 205 49)" },
  { label: "100 µg/m³", colour: "rgb(23 131 73)" },
];

/** The scale that applies to a given layer. */
export function legendFor(
  run: DispersionRun,
  layer: DispersionLayer,
): ReadonlyArray<{ label: string; colour: string }> {
  if (run.model === "CALPUFF") return CALPUFF_LEGEND;
  return layer.dispersionType.endsWith("kg/m2") ? NAME_DEPOSIT_LEGEND : NAME_AIR_LEGEND;
}

/**
 * Newest first, then by volcano so the order is stable between refreshes.
 *
 * Runs are grouped by scenario upstream of this, so "newest" here means the
 * most recently produced run of each distinct scenario.
 */
export function sortRuns(runs: readonly DispersionRun[]): DispersionRun[] {
  return [...runs].sort((a, b) => {
    const byTime = b.createdAt.localeCompare(a.createdAt);
    return byTime !== 0 ? byTime : a.volcano.localeCompare(b.volcano);
  });
}
