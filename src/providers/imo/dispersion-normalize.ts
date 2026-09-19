/**
 * Turns IMO's two dispersion payloads into `DispersionRun`s.
 *
 * Neither payload alone is enough. The EPOS catalogue says what was published
 * and at which volcano but carries no model grid; the dispersion service knows
 * the grid and the output layers but names only a scenario string. They are
 * joined on the run UUID, which the catalogue embeds in its link to IMO's
 * viewer.
 *
 * Every timestamp in both payloads is naive — no zone designator. IMO
 * publishes in UTC, which is also Icelandic local time all year round, so they
 * are read as UTC. Getting this wrong would shift a forecast by an hour and
 * nothing in the data would say so.
 */

import type {
  DispersionBounds,
  DispersionHazard,
  DispersionLayer,
  DispersionModel,
  DispersionPointSeries,
  DispersionRun,
} from "@/domain/dispersion";
import { parseSeriesLayer, unitFor } from "@/domain/dispersion";

/** What the EPOS catalogue tells us about one published run. */
export type CatalogueEntry = {
  runId: string;
  scenario: string;
  volcano: string;
  model: DispersionModel;
  hazard: DispersionHazard;
  createdAt: string;
  viewerUrl: string;
};

/** What the dispersion service tells us about the run itself. */
export type SimulationRecord = {
  runId: string;
  scenario: string;
  model: DispersionModel;
  latitude: number;
  longitude: number;
  columnHeightM: number | null;
  startsAt: string;
  durationHours: number;
  bounds: DispersionBounds;
  layers: DispersionLayer[];
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `2026-09-19T19:22:25.589865` → ISO instant, read as UTC. */
export function toIso(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const withZone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Pulls the run UUID out of the catalogue's viewer link.
 *
 * Matched as a UUID rather than taken as "whatever follows the equals sign":
 * the value goes into an upstream request path, and a catalogue entry is not
 * a place we should be relaying arbitrary strings from.
 */
export function runIdFromReference(reference: unknown): string | null {
  const raw = str(reference);
  if (!raw) return null;
  const match = /run_uuid=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(raw);
  return match?.[1]?.toLowerCase() ?? null;
}

function toModel(value: unknown): DispersionModel | null {
  const raw = str(value)?.toUpperCase();
  return raw === "NAME" || raw === "CALPUFF" ? raw : null;
}

/**
 * IMO's hazard wording, mapped to ours.
 *
 * Anything unrecognised is dropped rather than guessed: showing a plume under
 * the wrong hazard label would put an ash legend on a gas forecast.
 */
function toHazard(value: unknown): DispersionHazard | null {
  const raw = str(value)?.toLowerCase();
  if (raw === "gas") return "gas";
  if (raw === "tephra fallout" || raw === "tephra" || raw === "ash") return "ash";
  return null;
}

export function normalizeCatalogue(payload: unknown): CatalogueEntry[] {
  if (!Array.isArray(payload)) return [];

  const entries: CatalogueEntry[] = [];

  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;

    const runId = runIdFromReference(raw.product_reference);
    const hazardBlock = (raw.hazard ?? {}) as Record<string, unknown>;
    const model = toModel(hazardBlock.model_name);
    const hazard = toHazard(hazardBlock.type);
    const scenario = str(raw.name);
    const dates = (raw.dates ?? {}) as Record<string, unknown>;
    const createdAt = toIso(dates["date_of_creation_(for_static_products)"]);

    if (!runId || !model || !hazard || !scenario || !createdAt) continue;

    const location = (raw.geographical_location ?? {}) as Record<string, unknown>;
    const volcano = str((location.volcano as Record<string, unknown> | undefined)?.name);
    if (!volcano) continue;

    entries.push({
      runId,
      scenario,
      volcano,
      model,
      hazard,
      createdAt,
      viewerUrl: `https://dispersion.vedur.is/map.html?run_uuid=${runId}`,
    });
  }

  return entries;
}

/**
 * Bounds arrive as `[[north, west], [south, east]]` — latitude first, and the
 * northern corner first. Neither is the convention used elsewhere in this
 * codebase, so they are reordered here and nowhere else.
 */
function toBounds(value: unknown): DispersionBounds | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [first, second] = value as [unknown, unknown];
  if (!Array.isArray(first) || !Array.isArray(second)) return null;

  const north = num(first[0]);
  const west = num(first[1]);
  const south = num(second[0]);
  const east = num(second[1]);
  if (north === null || west === null || south === null || east === null) return null;
  if (north <= south || east <= west) return null;

  return { west, south, east, north };
}

function toLayers(value: unknown): DispersionLayer[] {
  if (!Array.isArray(value)) return [];

  const layers: DispersionLayer[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const dispersionType = str(raw.dispersion_type);
    const altitude = num(raw.altitude);
    const unit = str(raw.altitude_unit);
    if (!dispersionType || altitude === null) continue;
    if (unit !== "m" && unit !== "hPa") continue;
    layers.push({ dispersionType, altitude, altitudeUnit: unit });
  }
  return layers;
}

export function normalizeSimulation(payload: unknown): SimulationRecord | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;

  // A failed run may still be listed; it has no rasters to show.
  if (raw.failed === true) return null;

  const runId = str(raw.run_uuid);
  const model = toModel(raw.model_type);
  const startsAt = toIso(raw.start_time);
  const duration = num(raw.duration);
  const bounds = toBounds(raw.bounds);
  const layers = toLayers(raw.results);

  if (!runId || !model || !startsAt || duration === null || !bounds) return null;
  if (duration <= 0 || duration > 240) return null;
  if (layers.length === 0) return null;

  // Hours is the only unit this service has ever used; anything else would
  // make `duration` mean something different and silently mis-time every frame.
  const unit = str(raw.durationUnit);
  if (unit !== null && unit !== "h") return null;

  const latitude = num(raw.latitude);
  const longitude = num(raw.longitude);
  if (latitude === null || longitude === null) return null;

  /*
   * Placeholder coordinates.
   *
   * Older gas runs carry `latitude: 1.0, longitude: 1.0` — the real source is
   * buried in a projected grid reference inside `extra_info`. A source marker
   * at 1°N 1°E in the Gulf of Guinea is worse than no marker, so these are
   * treated as absent by the caller.
   */
  const columnHeightM = num(raw.column_height);

  return {
    runId,
    scenario: str(raw.run) ?? runId,
    model,
    latitude,
    longitude,
    columnHeightM: columnHeightM !== null && columnHeightM > 1 ? columnHeightM : null,
    startsAt,
    durationHours: Math.round(duration),
    bounds,
    layers,
  };
}

/** Whether a simulation's source position is a real one. */
export function hasRealSource(record: SimulationRecord): boolean {
  const { latitude, longitude } = record;
  if (latitude === 1 && longitude === 1) return false;
  if (latitude === 0 && longitude === 0) return false;
  return latitude >= 62 && latitude <= 68 && longitude >= -26 && longitude <= -12;
}

/** Joins a catalogue entry to its simulation record. */
export function mergeRun(
  entry: CatalogueEntry,
  record: SimulationRecord,
): DispersionRun | null {
  if (entry.runId !== record.runId) return null;

  return {
    id: entry.runId,
    scenario: entry.scenario,
    volcano: entry.volcano,
    model: entry.model,
    hazard: entry.hazard,
    latitude: record.latitude,
    longitude: record.longitude,
    columnHeightM: record.columnHeightM,
    startsAt: record.startsAt,
    durationHours: record.durationHours,
    createdAt: entry.createdAt,
    bounds: record.bounds,
    layers: record.layers,
    viewerUrl: entry.viewerUrl,
  };
}

/**
 * The newest catalogue entry for each distinct scenario.
 *
 * IMO reruns the same handful of scenarios several times a day, so the raw
 * catalogue is mostly yesterday's copies of today's list. Keeping one per
 * scenario is what makes the panel a list of *scenarios* rather than a log,
 * and it caps how many detail requests the join costs.
 */
export function latestPerScenario(entries: readonly CatalogueEntry[]): CatalogueEntry[] {
  const newest = new Map<string, CatalogueEntry>();

  for (const entry of entries) {
    const key = `${entry.volcano}::${entry.scenario}`;
    const current = newest.get(key);
    if (!current || entry.createdAt > current.createdAt) newest.set(key, entry);
  }

  return [...newest.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Reads the per-location graph payload: `[{ name, x: [...], y: [...] }]`.
 *
 * The two arrays are parallel and are zipped here rather than passed along,
 * because a payload where they disagree in length is a payload whose values
 * are attached to the wrong hours — better to drop the trailing mismatch than
 * to plot it.
 *
 * Nulls in `y` are holes, not zeros, and are dropped. Zeros are kept: inside
 * the model grid, "nothing here at this hour" is a result.
 *
 * Note the x-axis convention differs between products — a 24-hour tephra run
 * starts an hour after its `start_time` while a 72-hour gas run starts at it —
 * so the returned times are used as given and never reconstructed.
 */
export function normalizePointSeries(payload: unknown): DispersionPointSeries[] {
  if (!Array.isArray(payload)) return [];

  const series: DispersionPointSeries[] = [];

  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { name?: unknown; x?: unknown; y?: unknown };

    const name = str(raw.name);
    if (!name || !Array.isArray(raw.x) || !Array.isArray(raw.y)) continue;

    const layer = parseSeriesLayer(name);
    if (!layer) continue;

    const points: DispersionPointSeries["points"] = [];
    const length = Math.min(raw.x.length, raw.y.length);
    for (let index = 0; index < length; index += 1) {
      const at = toIso(raw.x[index]);
      const value = num(raw.y[index]);
      if (!at || value === null || value < 0) continue;
      points.push({ at, value });
    }
    if (points.length === 0) continue;

    points.sort((a, b) => a.at.localeCompare(b.at));
    series.push({ name, layer, unit: unitFor(layer.dispersionType), points });
  }

  return series;
}
