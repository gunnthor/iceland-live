/**
 * Baselines: how an area's current rate compares with its own recent history.
 *
 * ## The question this answers
 *
 * An observation can already say "46 earthquakes within 6 km of Norðurland over
 * 26 hours". What it cannot say is whether that is a lot *for Norðurland*.
 * Forty events a day is routine on the Reykjanes Ridge and remarkable under
 * Öræfajökull, and a reader without that context cannot tell the difference.
 *
 * ## How it is calculated
 *
 * For a named IMO region:
 *
 *  1. The **observation window** is the period the observation covers.
 *  2. The **baseline window** is the rest of the catalogue we hold — the full
 *     30 days *minus* the observation window. Excluding it matters: leaving the
 *     current burst inside its own baseline drags the average up and hides the
 *     very thing we are trying to measure.
 *  3. Both are reduced to events per day, and the ratio is reported.
 *
 * ## What it is not
 *
 * A ratio against thirty days of one region's own record. It is not a
 * probability, not a forecast, and not a statement that anything is wrong. If
 * the whole thirty days was itself unusual, the baseline is unusual too — which
 * is why the comparison always states its period, and why we decline to report
 * one at all when there is too little history to compare against.
 */

import type { Earthquake } from "@/domain/earthquake";

/** Below this many baseline events the comparison is noise, so we say nothing. */
export const MIN_BASELINE_EVENTS = 8;

/** Below this many events in the window there is nothing worth comparing. */
export const MIN_RECENT_EVENTS = 5;

/** A baseline window shorter than this cannot characterise "normal". */
export const MIN_BASELINE_DAYS = 3;

/** Ratios within this band of 1 are reported as "typical" rather than as a number. */
export const TYPICAL_BAND = { low: 0.6, high: 1.6 } as const;

export type RegionBaseline = {
  region: string;
  /** Events per day in the observation window. */
  recentPerDay: number;
  /** Events per day across the baseline window. */
  baselinePerDay: number;
  /** `recentPerDay / baselinePerDay`. */
  ratio: number;
  /** Length of the baseline window, in days. */
  baselineDays: number;
  /** Event counts behind each rate, so the reader can check the arithmetic. */
  recentCount: number;
  baselineCount: number;
};

export type BaselineInput = {
  /** The full catalogue we hold — typically 30 days. */
  catalogue: readonly Earthquake[];
  /** Start of the period being described. */
  from: Date;
  /** End of the period being described. */
  to: Date;
};

function countInRegion(
  quakes: readonly Earthquake[],
  region: string,
  fromMs: number,
  toMs: number,
): number {
  let count = 0;
  for (const quake of quakes) {
    if (quake.region !== region) continue;
    const at = Date.parse(quake.occurredAt);
    if (Number.isFinite(at) && at >= fromMs && at < toMs) count += 1;
  }
  return count;
}

/**
 * Compares a region's rate in the window against its rate over the rest of the
 * catalogue. Returns `null` when there is not enough history to say anything.
 */
export function computeRegionBaseline(
  region: string,
  { catalogue, from, to }: BaselineInput,
): RegionBaseline | null {
  if (catalogue.length === 0) return null;

  const fromMs = from.getTime();
  const toMs = to.getTime();
  const windowDays = (toMs - fromMs) / 86_400_000;
  if (windowDays <= 0) return null;

  // The catalogue's own extent, so the baseline is measured over real coverage
  // rather than an assumed 30 days.
  let earliestMs = Infinity;
  for (const quake of catalogue) {
    const at = Date.parse(quake.occurredAt);
    if (Number.isFinite(at) && at < earliestMs) earliestMs = at;
  }
  if (!Number.isFinite(earliestMs)) return null;

  const baselineDays = (fromMs - earliestMs) / 86_400_000;
  if (baselineDays < MIN_BASELINE_DAYS) return null;

  const recentCount = countInRegion(catalogue, region, fromMs, toMs);
  if (recentCount < MIN_RECENT_EVENTS) return null;

  const baselineCount = countInRegion(catalogue, region, earliestMs, fromMs);
  if (baselineCount < MIN_BASELINE_EVENTS) return null;

  const recentPerDay = recentCount / windowDays;
  const baselinePerDay = baselineCount / baselineDays;
  if (baselinePerDay <= 0) return null;

  return {
    region,
    recentPerDay,
    baselinePerDay,
    ratio: recentPerDay / baselinePerDay,
    baselineDays,
    recentCount,
    baselineCount,
  };
}

/**
 * A plain-language rendering of a ratio.
 *
 * Deliberately flat: "about 3× the usual rate" states a measurement, where
 * "dramatically elevated" would be a judgement we have no standing to make.
 */
export function describeBaseline(baseline: RegionBaseline): string {
  const { ratio, baselineDays, region } = baseline;
  const days = Math.round(baselineDays);
  const period = `the preceding ${days} ${days === 1 ? "day" : "days"}`;

  if (ratio >= TYPICAL_BAND.low && ratio <= TYPICAL_BAND.high) {
    return `That is close to the usual rate for ${region} over ${period}.`;
  }

  if (ratio < TYPICAL_BAND.low) {
    const factor = 1 / ratio;
    return `That is about ${formatFactor(factor)} lower than the usual rate for ${region} over ${period}.`;
  }

  return `That is about ${formatFactor(ratio)} the usual rate for ${region} over ${period}.`;
}

/** `2×`, `3.5×`, or `over 20×` where the precise figure stops being meaningful. */
function formatFactor(factor: number): string {
  if (factor >= 20) return "over 20×";
  if (factor >= 10) return `${Math.round(factor)}×`;
  const rounded = Math.round(factor * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}×`;
}

/**
 * The method note shown alongside an observation carrying a baseline.
 *
 * States explicitly that the comparison is region-wide. The observation above
 * it counts a *cluster* — a spatial subset picked out by this window — and a
 * cluster has no history to be compared with, because it did not exist before
 * the window defined it. The region does. Without saying so, the two counts
 * sitting next to each other simply look inconsistent.
 */
export function baselineMethod(baseline: RegionBaseline): string {
  const days = Math.round(baseline.baselineDays);
  return (
    `Compared across the whole of ${baseline.region}, not just the cluster: ` +
    `${baseline.recentCount} events during this window (${baseline.recentPerDay.toFixed(1)} per day) ` +
    `against ${baseline.baselineCount} over the preceding ${days} ` +
    `${days === 1 ? "day" : "days"} (${baseline.baselinePerDay.toFixed(1)} per day). ` +
    `The window itself is excluded from the baseline. This is a ratio against one ` +
    `region's own recent record, not a probability or a forecast.`
  );
}
