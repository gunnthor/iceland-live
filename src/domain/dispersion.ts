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

/**
 * One modelled series at one place, hour by hour.
 *
 * IMO's dispersion service will evaluate a run at an arbitrary latitude and
 * longitude, which is how "what would this scenario put in the air *here*"
 * gets answered with IMO's own numbers rather than by sampling pixels out of
 * their picture. A colour read off a raster is a guess about a scale; this is
 * the model's value.
 *
 * Still a scenario. The eruption behind these numbers is, on almost every
 * day, not happening.
 */
export type DispersionPointSeries = {
  /** As published, e.g. "5m Ash g/m3" or "0m SO2". */
  name: string;
  /** The run layer this series belongs to, parsed from `name`. */
  layer: DispersionLayer;
  /** Unit for `points[].value`. */
  unit: string;
  /** Oldest first. */
  points: Array<{ at: string; value: number }>;
};

/**
 * How a per-location series has to be scaled, and what it is then in.
 *
 * ## Where this comes from
 *
 * IMO's dispersion API returns per-location values that are **not** in the
 * units their series names claim. This is not an inference: their own viewer
 * applies these exact conversions before plotting the same payload —
 *
 * ```js
 * if ("name" === u && "kg/m2" === r[c].name.slice(-5))
 *     r[c].y[f] = r[c].y[f] / 1e3;        // deposit
 * else if ("calpuff" === u) {
 *     r[c].y[f] = 1e6 * r[c].y[f];        // gas
 *     r[c].name += " μg/m3"
 * }
 * ```
 *
 * — so a deposit series named `kg/m2` arrives in grams per square metre, and
 * a gas series arrives in grams per cubic metre while being displayed as
 * micrograms. Airborne ash, which their viewer leaves alone, arrives in the
 * unit it names.
 *
 * ## Why it was worth chasing
 *
 * Before this was found, the raw deposit figure read as 55,000 kg/m² — fifty
 * metres of ash — and the only defensible thing to do was rank by it and
 * refuse to print it. Two independent checks then agreed: comparing values
 * against the colour IMO's own raster paints at the same coordinate put every
 * sample, across four decades, back in its band after dividing by a thousand
 * (`src/server/units-probe.integration.ts`), and their viewer source says to
 * divide by exactly that. With both, the numbers can be shown.
 */
export function scaleFor(dispersionType: string): { factor: number; unit: string } {
  // Their viewer branches on model; these three names are what each produces,
  // so branching on the name is the same rule written the other way round.
  if (/kg\/m2$/i.test(dispersionType)) return { factor: 1 / 1000, unit: "kg/m\u00b2" };
  if (/\bg\/m3$/i.test(dispersionType)) return { factor: 1, unit: "g/m\u00b3" };
  return { factor: 1e6, unit: "\u00b5g/m\u00b3" };
}

/** The unit a series is in once `scaleFor` has been applied. */
export function unitFor(dispersionType: string): string {
  return scaleFor(dispersionType).unit;
}

/**
 * Parses a graph series name into the layer it belongs to.
 *
 * `"300hPa Ash g/m3"` and `"0m SO2"` are the two shapes. Parsed rather than
 * reconstructed and compared, so a change in IMO's spacing or ordering fails
 * to match one series instead of silently mislabelling all of them.
 */
export function parseSeriesLayer(name: string): DispersionLayer | null {
  const match = /^(\d+)(m|hPa)\s+(.+)$/.exec(name.trim());
  if (!match) return null;
  const [, altitude, unit, dispersionType] = match;
  if (altitude === undefined || dispersionType === undefined) return null;
  return {
    dispersionType,
    altitude: Number(altitude),
    altitudeUnit: unit === "hPa" ? "hPa" : "m",
  };
}

/** Whether a point falls inside a run's model grid. */
export function withinBounds(
  bounds: DispersionBounds,
  point: { latitude: number; longitude: number },
): boolean {
  return (
    point.latitude >= bounds.south &&
    point.latitude <= bounds.north &&
    point.longitude >= bounds.west &&
    point.longitude <= bounds.east
  );
}

/**
 * The highest value in a series, and when it occurs.
 *
 * `null` when the model puts nothing here at any hour, which inside the grid
 * is a real answer rather than missing data.
 */
export function peakOf(
  series: DispersionPointSeries,
): { at: string; value: number } | null {
  let best: { at: string; value: number } | null = null;
  for (const point of series.points) {
    if (point.value <= 0) continue;
    if (!best || point.value > best.value) best = point;
  }
  return best;
}

/**
 * One road-weather station a run reaches.
 *
 * Both a figure and a share: the figure because it means something once
 * `scaleFor` has been applied, and the share because a bar is how a list of
 * eight is read at a glance.
 */
export type DepositExposure = {
  stationId: number;
  stationName: string;
  latitude: number;
  longitude: number;
  /** Great-circle distance from the modelled source, km. */
  distanceKm: number;
  /**
   * Highest modelled amount at this station across the run's hours, in the
   * layer's unit. Null when the per-location lookup failed — the station is
   * still listed, because the footprint already says the run reaches it.
   */
  peak: number | null;
  /** This station's amount as a fraction of the largest listed, in (0, 1]. */
  share: number | null;
  /** When the model's amount here peaks, ISO instant. */
  peakAt: string | null;
};

/**
 * The layer used to ask "what does this run put on the ground here".
 *
 * Tephra deposit where the run produces it, since accumulated fallout is the
 * thing with consequences for a road. Gas runs have no deposit, so the
 * near-surface concentration stands in — the same question asked of a
 * substance that does not settle.
 */
export function groundLayer(run: DispersionRun): DispersionLayer | null {
  const deposit = run.layers.find((layer) => layer.dispersionType.endsWith("kg/m2"));
  if (deposit) return deposit;
  return (
    run.layers
      .filter((layer) => layer.altitudeUnit === "m")
      .sort((a, b) => a.altitude - b.altitude)[0] ?? null
  );
}

/**
 * IMO's own depth equivalence for tephra deposit.
 *
 * Their published legend labels each band twice — "1000 kg/m2 [~ 1 m]",
 * "100 kg/m2 [~ 10 cm]", "1 kg/m2 [~ 1mm]" — which is a bulk density of a
 * tonne per cubic metre, stated by them and not chosen here. Reproducing it
 * turns a figure most readers cannot picture into one they can.
 *
 * Only for deposit. A concentration in the air has no depth, and the "~" is
 * theirs: real tephra varies with grain size and compaction, so this is an
 * order-of-magnitude equivalence and is written as one.
 */
const KG_PER_M2_TO_MM = 1;

export function depthEquivalent(kgPerM2: number): string | null {
  if (!Number.isFinite(kgPerM2) || kgPerM2 <= 0) return null;

  const mm = kgPerM2 * KG_PER_M2_TO_MM;
  if (mm >= 1000) return `~${Math.round(mm / 100) / 10} m`;
  if (mm >= 10) return `~${Math.round(mm / 10)} cm`;
  if (mm >= 1) return `~${Math.round(mm)} mm`;
  // Below a millimetre, a rounded figure would read as nothing at all.
  if (mm >= 0.1) return "under 1 mm";
  return "a trace";
}

/** Whether a depth equivalence applies to this layer at all. */
export function hasDepthEquivalent(layer: DispersionLayer): boolean {
  return layer.dispersionType.endsWith("kg/m2");
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
