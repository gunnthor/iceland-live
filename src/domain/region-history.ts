/**
 * A year of per-region daily earthquake counts.
 *
 * This exists so the app can answer "is that a lot?" with something better than
 * a month of its own working data. Thirty days tells you what the last thirty
 * days looked like; a year tells you where today sits in a region's ordinary
 * range.
 *
 * ## Why a year, and not further
 *
 * The Quakes API accepts dates back to 1991, but the **SeisComP catalogue only
 * begins around 2015 and is patchy before 2020** — the earlier record lives in
 * the legacy SIL system, which has different detection characteristics and a
 * different completeness threshold. Comparing across the two would manufacture
 * rate changes that are really catalogue changes, so the history stays inside
 * SeisComP, where coverage is continuous.
 *
 * Only daily counts are kept, not events: 35,000 events reduce to about 86 KB
 * of counts, and counts are all a baseline needs.
 */

export type RegionHistory = {
  region: string;
  /** Events per day, keyed `YYYY-MM-DD`. Days with no events are absent. */
  dailyCounts: Record<string, number>;
  /** Total events across the window. */
  total: number;
  /** Days on which this region recorded at least one event. */
  activeDays: number;
};

export type RegionHistorySnapshot = {
  /** Start of the covered window, ISO date. */
  from: string;
  /** End of the covered window, ISO date. */
  to: string;
  /** Length of the window in days. */
  days: number;
  regions: Record<string, RegionHistory>;
};

/**
 * The distribution of a region's daily counts, as a sorted array.
 *
 * Days with no recorded events are included as zeros — leaving them out would
 * compare today only against days the region was already active, which is
 * exactly the bias that makes quiet regions look permanently busy.
 */
export function dailySeries(history: RegionHistory, totalDays: number): number[] {
  const counts = Object.values(history.dailyCounts);
  const zeros = Math.max(0, totalDays - counts.length);
  const series = counts.concat(new Array<number>(zeros).fill(0));
  series.sort((a, b) => a - b);
  return series;
}

/**
 * The share of days in the window that saw fewer events than `rate`.
 *
 * Returns a value in [0, 1]. Ties count as "not fewer", so a day equal to the
 * busiest on record reports below 1 rather than claiming a record outright.
 */
export function percentileOf(series: readonly number[], rate: number): number {
  if (series.length === 0) return 0;
  let below = 0;
  for (const value of series) {
    if (value < rate) below += 1;
    else break; // series is sorted ascending
  }
  return below / series.length;
}
