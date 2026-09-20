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
  type DispersionRun,
} from "@/domain/dispersion";
import type { RoadExposure, RoadSegmentLine } from "@/domain/roads";
import { distanceKm } from "@/lib/geo";
import { decodeAlpha, type AlphaMask } from "./png-alpha";
import { getRoadNetwork } from "./road-network";
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
 * Which routes a run puts something over.
 *
 * ## How the two sources divide the work
 *
 * The raster answers *where*: one bit per pixel, read from the alpha channel,
 * meaning "the model puts something here". The per-location endpoint answers
 * *how much*, with IMO's own numbers, converted the way IMO's own viewer
 * converts them. Neither question is answered by reading colours off the
 * picture, which would be inventing a measurement.
 *
 * Using the raster as an index is what keeps this bounded. The network is
 * about 1,565 segments over some 800 routes; asking the model about each
 * vertex would be thousands of requests, and the mask usually rules out all
 * but a handful of routes before anything is asked.
 *
 * ## Routes, not points on them
 *
 * An earlier version listed road-weather stations, which are points that
 * happen to sit on roads. "Grindavíkurvegur" is what a reader recognises, so
 * segments are matched against the footprint and grouped by route name.
 *
 * The figure, though, is still a point measurement: one sampled vertex per
 * route, the one nearest the source among those the footprint covers. Asking
 * at every vertex would put the request count back where the mask removed it.
 * `sampledKm` says which point was measured, and a long route may be heavier
 * somewhere else along it.
 *
 * ## Orientation
 *
 * Requested in plate carrée (`srid=4326`) so the mapping from coordinate to
 * pixel is linear in both axes, and read with row 0 as the northern edge.
 * That is not an assumption: `orientation-probe.integration.ts` checks the
 * mask against IMO's per-location model at a scatter of coordinates, and the
 * top-down reading agreed at every one of them while bottom-up did not.
 */

/** Routes listed. */
export const MAX_EXPOSED_ROUTES = 8;

/**
 * Distinct model cells asked about.
 *
 * Routes are grouped into the cell their sample falls in before anything is
 * asked, because a cell is about seven kilometres across and the roads around
 * a vent all land in one or two of them. Without that, eight requests bought
 * eight answers about the same place and the list read as four spellings of
 * "next to the volcano" — with Grindavíkurvegur, sixteen kilometres out,
 * truncated off the end. Grouping first spends the same requests on ground
 * that differs.
 */
const MAX_SAMPLED_CELLS = 16;

/**
 * Routes listed from any one cell.
 *
 * Without this the list was eight roads around one vent all reporting the
 * same figure, because they share a model cell and so share its answer. Two
 * per cell makes the list span the footprint, which is the thing it is for.
 */
const MAX_ROUTES_PER_CELL = 2;

const MASK_TTL_MS = 6 * 60 * 60_000;
const EXPOSURE_TTL_MS = 60 * 60_000;

const maskCache = new TtlCache<AlphaMask | null>(MASK_TTL_MS, MASK_TTL_MS, 40);
const exposureCache = new TtlCache<DispersionExposure>(EXPOSURE_TTL_MS, 6 * 60 * 60_000, 40);

export type DispersionExposure = {
  runId: string;
  /** The layer the figures are for. */
  layer: DispersionLayer;
  /** Routes the run reaches, heaviest first. Capped; see `covered`. */
  routes: RoadExposure[];
  /** How many routes the footprint covers in total, listed or not. */
  covered: number;
  /** How many routes the footprint was tested against, as a denominator. */
  checked: number;
  /** True when the footprint could not be read; `routes` is then empty. */
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

/**
 * The index of the cell a coordinate falls in, or null when it is off the
 * grid. Row 0 is the northern edge.
 */
export function maskCell(
  mask: AlphaMask,
  bounds: DispersionRun["bounds"],
  point: { latitude: number; longitude: number },
): number | null {
  const { west, east, south, north } = bounds;
  const x = Math.floor(((point.longitude - west) / (east - west)) * mask.width);
  const y = Math.floor(((north - point.latitude) / (north - south)) * mask.height);
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return null;
  return y * mask.width + x;
}

/** Whether the model puts anything at this coordinate. */
export function maskCovers(
  mask: AlphaMask,
  bounds: DispersionRun["bounds"],
  point: { latitude: number; longitude: number },
): boolean {
  const cell = maskCell(mask, bounds, point);
  return cell !== null && (mask.alpha[cell] ?? 0) > 0;
}

/** Groups segments by the route name a reader would recognise. */
function byRoute(segments: readonly RoadSegmentLine[]): Map<string, RoadSegmentLine[]> {
  const routes = new Map<string, RoadSegmentLine[]>();
  for (const segment of segments) {
    // A segment with no route name cannot be reported as one.
    if (!segment.name) continue;
    const existing = routes.get(segment.name);
    if (existing) existing.push(segment);
    else routes.set(segment.name, [segment]);
  }
  return routes;
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
    routes: [],
    covered: 0,
    checked: 0,
    unavailable: true,
  };

  const network = await getRoadNetwork();
  if (network.length === 0) return empty;

  const routes = byRoute(network);

  const mask = await groundMask(run, layer);
  if (!mask) return { ...empty, checked: routes.size };

  /*
   * A route is reached when any vertex of any of its segments falls in a
   * covered cell. Vertices are about two kilometres apart after the service's
   * generalisation and the cells are about seven, so a segment cannot cross a
   * covered cell without putting a vertex in it.
   */
  type Candidate = {
    route: string;
    roadNumber: string | null;
    segments: number;
    cell: number;
    sample: { latitude: number; longitude: number };
    sampledKm: number;
  };

  const candidates: Candidate[] = [];

  for (const [route, segments] of routes) {
    let covered = 0;
    let nearest: { latitude: number; longitude: number } | null = null;
    let nearestCell: number | null = null;
    let nearestKm = Infinity;

    for (const segment of segments) {
      let segmentCovered = false;
      for (const point of segment.points) {
        const cell = maskCell(mask, run.bounds, point);
        if (cell === null || (mask.alpha[cell] ?? 0) === 0) continue;
        segmentCovered = true;
        const distance = distanceKm(run, point);
        if (distance < nearestKm) {
          nearestKm = distance;
          nearest = point;
          nearestCell = cell;
        }
      }
      if (segmentCovered) covered += 1;
    }

    if (covered > 0 && nearest && nearestCell !== null) {
      candidates.push({
        route,
        roadNumber: segments[0]?.roadNumber ?? null,
        segments: covered,
        cell: nearestCell,
        sample: nearest,
        sampledKm: nearestKm,
      });
    }
  }

  /*
   * One lookup per distinct cell, shared by every route whose sample lands in
   * it. Cells are taken nearest-first: for a deposit that decays along the
   * plume axis those are the heaviest, and asking about all of them is the
   * request count the mask exists to avoid.
   */
  const cells = new Map<number, Candidate[]>();
  for (const candidate of candidates.sort((a, b) => a.sampledKm - b.sampledKm)) {
    const existing = cells.get(candidate.cell);
    if (existing) existing.push(candidate);
    else cells.set(candidate.cell, [candidate]);
  }

  const sampled = [...cells.entries()].slice(0, MAX_SAMPLED_CELLS);

  const values = new Map<number, { value: number; at: string } | null>(
    await Promise.all(
      sampled.map(async ([cell, members]): Promise<[number, { value: number; at: string } | null]> => {
        const representative = members[0] as Candidate;
        const lookup = await getDispersionPoint(
          runId,
          representative.sample.latitude,
          representative.sample.longitude,
        );
        if (!lookup.ok) return [cell, null];

        const series = lookup.series.find(
          (item) =>
            item.layer.dispersionType === layer.dispersionType &&
            item.layer.altitude === layer.altitude &&
            item.layer.altitudeUnit === layer.altitudeUnit,
        );
        return [cell, series ? peakOf(series) : null];
      }),
    ),
  );

  // A share alongside the figure: eight rows are compared by bar length far
  // faster than by reading eight numbers.
  const largest = Math.max(0, ...[...values.values()].map((peak) => peak?.value ?? 0));

  const exposed: RoadExposure[] = sampled
    .flatMap(([cell, members]) => {
      const peak = values.get(cell) ?? null;
      // Nearest first within a cell, so the two kept are the ones closest to
      // the source rather than whichever the network listed first.
      return members.slice(0, MAX_ROUTES_PER_CELL).map((candidate) => ({
        route: candidate.route,
        roadNumber: candidate.roadNumber,
        segments: candidate.segments,
        sampledKm: candidate.sampledKm,
        peak: peak?.value ?? null,
        share: peak && largest > 0 ? peak.value / largest : null,
        peakAt: peak?.at ?? null,
      }));
    })
    /*
     * The footprint said this cell holds something and the model, asked at a
     * point inside it, says nothing. The point is the only evidence there is
     * about that route, so it is believed over the cell.
     */
    .filter((route) => route.peak === null || route.peak > 0)
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1))
    .slice(0, MAX_EXPOSED_ROUTES);

  const result: DispersionExposure = {
    runId,
    layer,
    routes: exposed,
    covered: candidates.length,
    checked: routes.size,
    unavailable: false,
  };

  exposureCache.set(runId, result);
  return result;
}
