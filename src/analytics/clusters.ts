/**
 * Activity observations: deterministic, purely statistical summaries of the
 * earthquake catalogue.
 *
 * ## Scientific integrity
 *
 * Nothing in this module is a forecast, a hazard assessment or a geological
 * interpretation. Each observation is arithmetic over the events in the
 * selected window, and every headline states the numbers it is derived from.
 * We deliberately never use words such as "precursor", "swarm", "imminent" or
 * "warning" — official hazard status comes from IMO and the Department of Civil
 * Protection, and is surfaced separately as their data, never ours.
 *
 * ## How each observation is calculated
 *
 * **0. Observation window**
 *    Observations answer "what is notable right now", so they are computed over
 *    the selected window capped at `OBSERVATION_MAX_WINDOW_HOURS` (48). Over 7-
 *    and 30-day ranges the chart and statistics still cover the full period, but
 *    calling a month of ordinary ridge seismicity "elevated" would be
 *    meaningless. `detectObservations` returns the window it actually used so
 *    the interface can state it.
 *
 * **1. Dense cluster** (`dense-cluster`)
 *    Events in the window are clustered with DBSCAN using
 *    `eps = CLUSTER_EPS_KM` (5 km, great-circle) and
 *    `minPts = CLUSTER_MIN_POINTS` (6, counting the point itself).
 *    A cluster is reported only when it holds at least
 *    `DENSE_CLUSTER_MIN_EVENTS` (12) events *and* its radius is at most
 *    `CLUSTER_MAX_RADIUS_KM` (20 km). The radius cap matters: DBSCAN links
 *    density-connected points, so over a long window continuous seismicity
 *    along the Reykjanes peninsula chains into one group tens of kilometres
 *    across. That is regional background, not a cluster, so we decline to
 *    report it. Radius is the greatest great-circle distance from the cluster
 *    centroid to any member.
 *    The reported place name is the IMO region most common among its members —
 *    we never invent a name.
 *
 * **2. Repeated moderate events** (`repeated-moderate`)
 *    Within a reported cluster, the number of events with magnitude at least
 *    `MODERATE_MAGNITUDE` (2.0). Reported when that count reaches
 *    `MODERATE_MIN_EVENTS` (3).
 *
 * **3. Rate change** (`rate-increase`)
 *    The window is split into a recent part (the most recent third) and a
 *    baseline part (the earlier two thirds). Both are converted to events per
 *    hour. Reported when the recent rate is at least `RATE_RATIO` (2.0) times
 *    the baseline rate, the recent part holds at least
 *    `RATE_MIN_RECENT_EVENTS` (10) events, and the baseline part holds at least
 *    `RATE_MIN_BASELINE_EVENTS` (5) events — the last condition keeps us from
 *    announcing a "doubling" that is really one quiet hour followed by two
 *    ordinary ones.
 *
 * Thresholds live in `OBSERVATION_THRESHOLDS` so they can be shown in the UI.
 */

import type { Earthquake } from "@/domain/earthquake";
import { centroid, distanceKm, LAT_DEGREES_PER_KM, lonDegreesPerKm, type LatLon } from "@/lib/geo";
import { baselineMethod, computeRegionBaseline, describeBaseline } from "./baseline";

export const CLUSTER_EPS_KM = 5;
/** Groups wider than this are regional background rather than a cluster. */
export const CLUSTER_MAX_RADIUS_KM = 20;
/** Observations never look further back than this, whatever range is selected. */
export const OBSERVATION_MAX_WINDOW_HOURS = 48;
export const CLUSTER_MIN_POINTS = 6;
export const DENSE_CLUSTER_MIN_EVENTS = 12;
export const MODERATE_MAGNITUDE = 2;
export const MODERATE_MIN_EVENTS = 3;
export const RATE_RATIO = 2;
export const RATE_MIN_RECENT_EVENTS = 10;
export const RATE_MIN_BASELINE_EVENTS = 5;

export const OBSERVATION_THRESHOLDS = {
  clusterEpsKm: CLUSTER_EPS_KM,
  clusterMaxRadiusKm: CLUSTER_MAX_RADIUS_KM,
  observationMaxWindowHours: OBSERVATION_MAX_WINDOW_HOURS,
  clusterMinPoints: CLUSTER_MIN_POINTS,
  denseClusterMinEvents: DENSE_CLUSTER_MIN_EVENTS,
  moderateMagnitude: MODERATE_MAGNITUDE,
  moderateMinEvents: MODERATE_MIN_EVENTS,
  rateRatio: RATE_RATIO,
  rateMinRecentEvents: RATE_MIN_RECENT_EVENTS,
  rateMinBaselineEvents: RATE_MIN_BASELINE_EVENTS,
} as const;

export type QuakeCluster = {
  id: string;
  events: Earthquake[];
  centre: LatLon;
  /** Greatest distance from the centroid to a member, in km. */
  radiusKm: number;
  /** IMO region name most common among members. */
  region: string | null;
  earliestAt: string;
  latestAt: string;
  largestMagnitude: number | null;
  countM2Plus: number;
};

/**
 * DBSCAN over great-circle distance, with a uniform grid index so neighbour
 * lookups stay near-linear for the few thousand events a 30-day window holds.
 */
export function clusterQuakes(
  quakes: readonly Earthquake[],
  epsKm: number = CLUSTER_EPS_KM,
  minPoints: number = CLUSTER_MIN_POINTS,
): QuakeCluster[] {
  if (quakes.length === 0) return [];

  // Grid cells are one eps across, so every neighbour within eps lies in the
  // 3x3 block of cells around a point.
  const midLat =
    quakes.reduce((sum, quake) => sum + quake.latitude, 0) / quakes.length;
  const cellLat = epsKm * LAT_DEGREES_PER_KM;
  const cellLon = epsKm * lonDegreesPerKm(midLat);

  const grid = new Map<string, number[]>();
  const key = (row: number, col: number) => `${row}:${col}`;
  const cellOf = (quake: Earthquake) => ({
    row: Math.floor(quake.latitude / cellLat),
    col: Math.floor(quake.longitude / cellLon),
  });

  quakes.forEach((quake, i) => {
    const { row, col } = cellOf(quake);
    const bucket = grid.get(key(row, col));
    if (bucket) bucket.push(i);
    else grid.set(key(row, col), [i]);
  });

  const neighboursOf = (i: number): number[] => {
    const origin = quakes[i] as Earthquake;
    const { row, col } = cellOf(origin);
    const found: number[] = [];
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const bucket = grid.get(key(row + dr, col + dc));
        if (!bucket) continue;
        for (const j of bucket) {
          if (distanceKm(origin, quakes[j] as Earthquake) <= epsKm) found.push(j);
        }
      }
    }
    return found;
  };

  const UNVISITED = -1;
  const NOISE = -2;
  const labels = new Array<number>(quakes.length).fill(UNVISITED);
  let clusterId = 0;

  for (let i = 0; i < quakes.length; i += 1) {
    if (labels[i] !== UNVISITED) continue;

    const neighbours = neighboursOf(i);
    if (neighbours.length < minPoints) {
      labels[i] = NOISE;
      continue;
    }

    labels[i] = clusterId;
    // Breadth-first expansion over density-reachable points.
    const queue = neighbours.filter((j) => j !== i);
    for (let q = 0; q < queue.length; q += 1) {
      const j = queue[q] as number;
      if (labels[j] === NOISE) labels[j] = clusterId;
      if (labels[j] !== UNVISITED) continue;
      labels[j] = clusterId;
      const inner = neighboursOf(j);
      if (inner.length >= minPoints) {
        for (const k of inner) if (labels[k] === UNVISITED) queue.push(k);
      }
    }
    clusterId += 1;
  }

  const buckets = new Map<number, Earthquake[]>();
  labels.forEach((label, i) => {
    if (label < 0) return;
    const bucket = buckets.get(label);
    if (bucket) bucket.push(quakes[i] as Earthquake);
    else buckets.set(label, [quakes[i] as Earthquake]);
  });

  const clusters: QuakeCluster[] = [];
  for (const [label, events] of buckets) {
    const centre = centroid(events);
    if (!centre) continue;

    const times = events.map((event) => event.occurredAt).sort();
    const magnitudes = events
      .map((event) => event.magnitude)
      .filter((magnitude): magnitude is number => magnitude !== null);

    clusters.push({
      id: `cluster-${label}`,
      events,
      centre,
      radiusKm: events.reduce((max, event) => Math.max(max, distanceKm(centre, event)), 0),
      region: dominantRegion(events),
      earliestAt: times[0] as string,
      latestAt: times[times.length - 1] as string,
      largestMagnitude: magnitudes.length > 0 ? Math.max(...magnitudes) : null,
      countM2Plus: events.filter((e) => (e.magnitude ?? -Infinity) >= MODERATE_MAGNITUDE).length,
    });
  }

  return clusters.sort((a, b) => b.events.length - a.events.length);
}

function dominantRegion(events: readonly Earthquake[]): string | null {
  const tally = new Map<string, number>();
  for (const event of events) {
    if (!event.region) continue;
    tally.set(event.region, (tally.get(event.region) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [region, count] of tally) {
    if (count > bestCount || (count === bestCount && best !== null && region < best)) {
      best = region;
      bestCount = count;
    }
  }
  return best;
}

export type ObservationKind = "dense-cluster" | "repeated-moderate" | "rate-increase";

export type ActivityObservation = {
  id: string;
  kind: ObservationKind;
  /** Neutral headline, e.g. "Elevated earthquake activity". */
  headline: string;
  /** One sentence stating exactly the numbers behind the headline. */
  detail: string;
  /** Plain-language description of the calculation, shown on request. */
  method: string;
  /**
   * How this compares with the area's own recent rate, when there is enough
   * history to say. Absent rather than guessed at when there is not.
   */
  context?: string;
  /** Where to fly the map, when the observation has a location. */
  focus?: { centre: LatLon; radiusKm: number };
  /** Ids of the events the observation is derived from. */
  eventIds: string[];
};

export type ObservationInput = {
  quakes: readonly Earthquake[];
  from: Date;
  to: Date;
  /**
   * The full catalogue we hold, used to work out what is normal for a region.
   * Defaults to `quakes`, which yields no comparison — the window cannot be its
   * own baseline.
   */
  catalogue?: readonly Earthquake[];
};

export type ObservationResult = {
  observations: ActivityObservation[];
  /**
   * The window the observations were actually computed over. Equal to the
   * requested window unless it exceeded `OBSERVATION_MAX_WINDOW_HOURS`.
   */
  window: { from: string; to: string };
  /** True when the requested window was capped. */
  windowCapped: boolean;
};

/**
 * Produces the observations that hold for the given window.
 *
 * Returns an empty list when nothing meets the thresholds — a quiet period
 * should read as quiet, not be padded with weak findings.
 */
export function detectObservations({
  quakes,
  from,
  to,
  catalogue,
}: ObservationInput): ObservationResult {
  const maxWindowMs = OBSERVATION_MAX_WINDOW_HOURS * 3_600_000;
  const requestedMs = to.getTime() - from.getTime();
  const windowCapped = requestedMs > maxWindowMs;
  const effectiveFrom = windowCapped ? new Date(to.getTime() - maxWindowMs) : from;

  const result: ObservationResult = {
    observations: [],
    window: { from: effectiveFrom.toISOString(), to: to.toISOString() },
    windowCapped,
  };

  const fromMs = effectiveFrom.getTime();
  const toMs = to.getTime();
  const scoped = quakes.filter((quake) => {
    const at = Date.parse(quake.occurredAt);
    return Number.isFinite(at) && at >= fromMs && at < toMs;
  });

  if (scoped.length === 0) return result;

  const windowHours = (toMs - fromMs) / 3_600_000;

  const clusters = clusterQuakes(scoped).filter(
    (cluster) =>
      cluster.events.length >= DENSE_CLUSTER_MIN_EVENTS &&
      cluster.radiusKm <= CLUSTER_MAX_RADIUS_KM,
  );

  for (const cluster of clusters.slice(0, 3)) {
    const place = cluster.region ?? "this area";
    const spanHours = Math.max(
      0,
      (Date.parse(cluster.latestAt) - Date.parse(cluster.earliestAt)) / 3_600_000,
    );

    /*
     * Context, where the catalogue supports it.
     *
     * "46 earthquakes over 26 hours" is a fact a reader cannot judge without
     * knowing what that area normally does. The comparison is against the
     * region's own preceding record, and is omitted entirely when there is too
     * little of it to mean anything.
     */
    const baseline =
      catalogue && cluster.region
        ? computeRegionBaseline(cluster.region, { catalogue, from: effectiveFrom, to })
        : null;

    result.observations.push({
      id: `dense-${cluster.id}`,
      kind: "dense-cluster",
      headline: "Elevated earthquake activity",
      detail: `${cluster.events.length} earthquakes were recorded within ${formatKm(cluster.radiusKm)} of ${place} over ${formatHours(spanHours)}.`,
      method:
        `DBSCAN clustering with a ${CLUSTER_EPS_KM} km radius and a minimum of ${CLUSTER_MIN_POINTS} neighbouring events. ` +
        `Reported at ${DENSE_CLUSTER_MIN_EVENTS} events or more, and only when the group spans no more than ${CLUSTER_MAX_RADIUS_KM} km.` +
        (baseline ? ` ${baselineMethod(baseline)}` : ""),
      ...(baseline ? { context: describeBaseline(baseline) } : {}),
      focus: { centre: cluster.centre, radiusKm: cluster.radiusKm },
      eventIds: cluster.events.map((event) => event.id),
    });

    if (cluster.countM2Plus >= MODERATE_MIN_EVENTS) {
      const moderate = cluster.events.filter(
        (event) => (event.magnitude ?? -Infinity) >= MODERATE_MAGNITUDE,
      );
      result.observations.push({
        id: `moderate-${cluster.id}`,
        kind: "repeated-moderate",
        headline: `Repeated M${MODERATE_MAGNITUDE.toFixed(1)}+ events`,
        detail: `${moderate.length} earthquakes of magnitude ${MODERATE_MAGNITUDE.toFixed(1)} or greater occurred within ${formatKm(cluster.radiusKm)} of ${place} over ${formatHours(windowHours)}.`,
        method: `Count of events at or above magnitude ${MODERATE_MAGNITUDE.toFixed(1)} inside a detected cluster; reported at ${MODERATE_MIN_EVENTS} events or more.`,
        focus: { centre: cluster.centre, radiusKm: cluster.radiusKm },
        eventIds: moderate.map((event) => event.id),
      });
    }
  }

  const rate = detectRateChange(scoped, effectiveFrom, to, windowHours);
  if (rate) result.observations.push(rate);

  return result;
}

function detectRateChange(
  quakes: readonly Earthquake[],
  from: Date,
  to: Date,
  windowHours: number,
): ActivityObservation | null {
  if (windowHours <= 0) return null;

  const splitMs = from.getTime() + (to.getTime() - from.getTime()) * (2 / 3);
  const recentHours = windowHours / 3;
  const baselineHours = (windowHours * 2) / 3;

  let recent = 0;
  let baseline = 0;
  for (const quake of quakes) {
    const at = Date.parse(quake.occurredAt);
    if (!Number.isFinite(at)) continue;
    if (at >= splitMs) recent += 1;
    else if (at >= from.getTime()) baseline += 1;
  }

  if (recent < RATE_MIN_RECENT_EVENTS || baseline < RATE_MIN_BASELINE_EVENTS) return null;

  const recentRate = recent / recentHours;
  const baselineRate = baseline / baselineHours;
  if (baselineRate <= 0 || recentRate < baselineRate * RATE_RATIO) return null;

  const factor = recentRate / baselineRate;

  return {
    id: "rate-increase",
    kind: "rate-increase",
    headline: "Increased earthquake frequency",
    detail: `${recent} earthquakes were recorded in the most recent ${formatHours(recentHours)}, about ${factor.toFixed(1)}× the rate of the preceding ${formatHours(baselineHours)}.`,
    method: `Events per hour in the most recent third of the window compared with the earlier two thirds; reported at ${RATE_RATIO}× or more, with at least ${RATE_MIN_RECENT_EVENTS} recent and ${RATE_MIN_BASELINE_EVENTS} baseline events.`,
    eventIds: [],
  };
}

function formatKm(km: number): string {
  if (km < 1) return "1 km";
  return `${Math.round(km)} km`;
}

function formatHours(hours: number): string {
  if (hours < 1.5) return "the past hour";
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}
