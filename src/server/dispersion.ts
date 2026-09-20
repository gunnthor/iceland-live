/**
 * Current dispersal simulations.
 *
 * Cached for 15 minutes. IMO produces these a few times a day, and the join
 * behind them costs one catalogue request plus one per scenario, so refetching
 * per visitor would spend a dozen upstream requests to learn nothing new.
 *
 * A stale snapshot is served rather than an error when IMO is unreachable, and
 * labelled as such — the runs themselves are still exactly what IMO produced,
 * they are just no longer being refreshed.
 */

import type { DispersionPointSeries, DispersionLayer } from "@/domain/dispersion";
import {
  groundLayer,
  layerKey,
  peakOf,
  toRasterTime,
  frameTimes,
  withinBounds,
  type DepositExposure,
  type DispersionRun,
} from "@/domain/dispersion";
import { distanceKm } from "@/lib/geo";
import { decodeAlpha, type AlphaMask } from "./png-alpha";
import { getEnvironment } from "./environment";
import { IMO_API_VERSIONS, IMO_BASE_URL } from "@/providers/imo/client";
import { ImoDispersionProvider } from "@/providers/imo/dispersion-provider";
import { ProviderError, type ProviderMeta } from "@/providers/types";
import { TtlCache } from "./cache";

export const DISPERSION_TTL_MS = 15 * 60_000;
const DISPERSION_MAX_STALE_MS = 6 * 60 * 60_000;
const KEY = "dispersion:runs";

export type DispersionSnapshot = { runs: DispersionRun[]; meta: ProviderMeta };

const cache = new TtlCache<DispersionSnapshot>(DISPERSION_TTL_MS, DISPERSION_MAX_STALE_MS);
const provider = new ImoDispersionProvider();
let inFlight: Promise<DispersionSnapshot> | null = null;

export async function getDispersionRuns(): Promise<DispersionSnapshot> {
  const fresh = cache.getFresh(KEY);
  if (fresh) return { runs: fresh.value.runs, meta: { ...fresh.value.meta, freshness: "cached" } };

  inFlight ??= (async () => {
    const result = await provider.fetchRuns();
    const snapshot: DispersionSnapshot = { runs: result.data, meta: result.meta };
    cache.set(KEY, snapshot);
    return snapshot;
  })().finally(() => {
    inFlight = null;
  });

  try {
    return await inFlight;
  } catch (error) {
    const usable = cache.getUsable(KEY);
    if (!usable) throw error;
    const reason =
      error instanceof ProviderError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown upstream failure";

    /*
     * A spent run is dropped even from the stale copy. Everything else here
     * degrades by getting older; a forecast window that has elapsed stops
     * being a forecast, and showing one under a heading about the next two
     * days would be the one misreading this feature cannot afford.
     */
    const now = Date.now();
    const stillCurrent = usable.value.runs.filter(
      (run) => Date.parse(run.startsAt) + run.durationHours * 3_600_000 >= now,
    );

    return {
      runs: stillCurrent,
      meta: { ...usable.value.meta, freshness: "stale", degradedReason: reason },
    };
  }
}

/**
 * Modelled series at one place, cached.
 *
 * Keyed by run and rounded coordinates. Three decimals is about 100 m, well
 * inside the model's own grid spacing, so rounding costs no resolution and
 * turns a stream of near-identical probes into one upstream request.
 *
 * Size-capped as well as time-capped: the key includes a coordinate, so it is
 * unbounded in a way the other caches here are not.
 */
const POINT_TTL_MS = 60 * 60_000;
const POINT_MAX_STALE_MS = 6 * 60 * 60_000;
const POINT_MAX_ENTRIES = 400;

const pointCache = new TtlCache<DispersionPointSeries[]>(
  POINT_TTL_MS,
  POINT_MAX_STALE_MS,
  POINT_MAX_ENTRIES,
);

export type PointLookup =
  | { ok: true; run: DispersionRun; series: DispersionPointSeries[] }
  | { ok: false; reason: "unknown-run" | "outside-grid" | "unavailable" };

export async function getDispersionPoint(
  runId: string,
  latitude: number,
  longitude: number,
): Promise<PointLookup> {
  let run: DispersionRun | undefined;
  try {
    run = (await getDispersionRuns()).runs.find((item) => item.id === runId);
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  // Only runs we are currently serving. Relaying an arbitrary UUID would make
  // this a general-purpose proxy for someone else's service.
  if (!run) return { ok: false, reason: "unknown-run" };

  /*
   * Outside the grid the service answers 200 with zeros, which would read as
   * "the model says nothing will reach here" when the truth is "this place was
   * never modelled". Refused rather than passed on.
   */
  if (!withinBounds(run.bounds, { latitude, longitude })) {
    return { ok: false, reason: "outside-grid" };
  }

  const lat = Math.round(latitude * 1000) / 1000;
  const lon = Math.round(longitude * 1000) / 1000;
  const key = `${runId}:${lat}:${lon}`;

  const fresh = pointCache.getFresh(key);
  if (fresh) return { ok: true, run, series: fresh.value };

  try {
    const result = await provider.fetchPointSeries(runId, lat, lon);
    pointCache.set(key, result.data);
    return { ok: true, run, series: result.data };
  } catch (error) {
    const usable = pointCache.getUsable(key);
    if (usable) return { ok: true, run, series: usable.value };
    console.warn(`[dispersion] point lookup failed for ${runId}`, error);
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * Which roads a run puts something over.
 *
 * ## How the two sources divide the work
 *
 * The raster answers *where*: one bit per pixel, read from the alpha channel,
 * meaning "the model puts something here". The per-location endpoint answers
 * *how much*, with IMO's own numbers. Neither question is answered by reading
 * colours off the picture, which would be inventing a measurement.
 *
 * Using the raster as an index is what keeps this bounded. Iceland has 183
 * road-weather stations and asking the model about each would be 183 upstream
 * requests; the mask usually rules out all but a handful before anything is
 * asked.
 *
 * ## Orientation
 *
 * Requested in plate carrée (`srid=4326`) so the mapping from coordinate to
 * pixel is linear in both axes, and read with row 0 as the northern edge.
 * That is not an assumption: `orientation-probe.integration.ts` checks the
 * mask against IMO's per-location model at a scatter of coordinates, and the
 * top-down reading agreed at every one of them while bottom-up did not.
 */

/** Stations asked about. The mask normally leaves far fewer than this. */
export const MAX_EXPOSED_STATIONS = 8;

const MASK_TTL_MS = 6 * 60 * 60_000;
const EXPOSURE_TTL_MS = 60 * 60_000;

const maskCache = new TtlCache<AlphaMask | null>(MASK_TTL_MS, MASK_TTL_MS, 40);
const exposureCache = new TtlCache<DispersionExposure>(EXPOSURE_TTL_MS, 6 * 60 * 60_000, 40);

export type DispersionExposure = {
  runId: string;
  /** The layer the ordering is based on. */
  layer: DispersionLayer;
  /** Stations the run reaches, heaviest first. */
  stations: DepositExposure[];
  /** How many stations the footprint was tested against, as a denominator. */
  checked: number;
  /** True when the footprint could not be read; `stations` is then empty. */
  unavailable: boolean;
};

/** Fetches and decodes the run's final ground-level frame. */
async function groundMask(
  run: DispersionRun,
  layer: DispersionLayer,
): Promise<AlphaMask | null> {
  const key = `${run.id}:${layerKey(layer)}`;
  const cached = maskCache.getFresh(key);
  if (cached) return cached.value;

  const frames = frameTimes(run);
  const last = frames[frames.length - 1];
  if (last === undefined) return null;

  const url = new URL("/dispersion/raster", IMO_BASE_URL);
  url.searchParams.set("uuid", run.id);
  url.searchParams.set("model_type", run.model);
  url.searchParams.set("dispersion_type", layer.dispersionType);
  url.searchParams.set("altitude", String(layer.altitude));
  url.searchParams.set("altitude_unit", layer.altitudeUnit);
  url.searchParams.set("time", toRasterTime(last));
  // Plate carrée: linear in both axes, which is what makes the pixel lookup
  // arithmetic rather than a projection.
  url.searchParams.set("srid", "4326");
  url.searchParams.set("filetype", "png");

  let mask: AlphaMask | null = null;
  try {
    const response = await fetch(url, {
      headers: {
        "x-vi-api-version": IMO_API_VERSIONS.dispersion,
        accept: "image/png",
        "user-agent": "IcelandLive/0.1 (+https://live.gunnthor.is)",
      },
      signal: AbortSignal.timeout(25_000),
      next: { revalidate: 6 * 60 * 60 },
    });
    if (response.ok) mask = decodeAlpha(new Uint8Array(await response.arrayBuffer()));
  } catch (error) {
    console.warn(`[dispersion] footprint unavailable for ${run.id}`, error);
  }

  maskCache.set(key, mask);
  return mask;
}

/** Whether the model puts anything at this coordinate. Row 0 is the north edge. */
export function maskCovers(
  mask: AlphaMask,
  bounds: DispersionRun["bounds"],
  point: { latitude: number; longitude: number },
): boolean {
  const { west, east, south, north } = bounds;
  const x = Math.floor(((point.longitude - west) / (east - west)) * mask.width);
  const y = Math.floor(((north - point.latitude) / (north - south)) * mask.height);
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return (mask.alpha[y * mask.width + x] ?? 0) > 0;
}

export async function getDispersionExposure(runId: string): Promise<DispersionExposure | null> {
  const cached = exposureCache.getFresh(runId);
  if (cached) return cached.value;

  const run = (await getDispersionRuns()).runs.find((item) => item.id === runId);
  if (!run) return null;

  const layer = groundLayer(run);
  if (!layer) return null;

  const empty: DispersionExposure = {
    runId,
    layer,
    stations: [],
    checked: 0,
    unavailable: true,
  };

  let stations;
  try {
    stations = (await getEnvironment()).roadWeather;
  } catch {
    return empty;
  }

  const mask = await groundMask(run, layer);
  if (!mask) return { ...empty, checked: stations.length };

  const candidates = stations
    .filter((station) => withinBounds(run.bounds, station))
    .filter((station) => maskCovers(mask, run.bounds, station))
    .map((station) => ({ station, distanceKm: distanceKm(run, station) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, MAX_EXPOSED_STATIONS);

  const measured = await Promise.all(
    candidates.map(async ({ station, distanceKm: distance }) => {
      const base = {
        stationId: station.id,
        stationName: station.name,
        latitude: station.latitude,
        longitude: station.longitude,
        distanceKm: distance,
      };

      const lookup = await getDispersionPoint(runId, station.latitude, station.longitude);
      if (!lookup.ok) return { base, peak: null };

      const series = lookup.series.find(
        (item) =>
          item.layer.dispersionType === layer.dispersionType &&
          item.layer.altitude === layer.altitude &&
          item.layer.altitudeUnit === layer.altitudeUnit,
      );
      return { base, peak: series ? peakOf(series) : null };
    }),
  );

  /*
   * Expressed as a share of the largest rather than as a figure.
   *
   * IMO's per-location values and their own raster legend disagree by about a
   * factor of a thousand — see `DepositExposure` — so the magnitudes cannot be
   * quoted. A ratio survives any constant factor, which is why the ordering
   * can be published when the numbers behind it cannot.
   */
  const largest = Math.max(0, ...measured.map((item) => item.peak?.value ?? 0));

  const exposed: DepositExposure[] = measured
    .map(({ base, peak }) => ({
      ...base,
      share: peak && largest > 0 ? peak.value / largest : null,
      peakAt: peak?.at ?? null,
    }))
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1));

  const result: DispersionExposure = {
    runId,
    layer,
    stations: exposed,
    checked: stations.length,
    unavailable: false,
  };

  exposureCache.set(runId, result);
  return result;
}
