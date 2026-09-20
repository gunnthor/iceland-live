/**
 * Gathers what the written brief is composed from.
 *
 * ## Every source is optional, and says so
 *
 * Five services feed this page and any of them can be down. The composition
 * in `src/analytics/brief.ts` draws the distinction that matters — "there are
 * none" against "we could not ask" — but it can only draw it if this layer
 * tells it which happened, so nothing here swallows a failure into an empty
 * list. A brief assembled while the CAP broker was unreachable is still worth
 * sending; one that quietly implies there are no warnings in force is not.
 *
 * The earthquake catalogue is the exception. It is the spine of the document
 * — the summary, the observations and the regional rates are all derived from
 * it — so a brief without it would be a page of caveats. When it cannot be
 * had, this returns `null` and the route says so in one sentence instead.
 *
 * ## Everything here is already cached
 *
 * Each of these loaders is the same one the interface uses, with its own TTL
 * and its own stale fallback. On a normal request the brief costs five cache
 * reads, which is what makes it safe to leave as a link anyone can open.
 */

import { detectObservations } from "@/analytics/clusters";
import { computeStats, filterByRange, tallyByRegion } from "@/analytics/stats";
import { withBaselines } from "@/analytics/baseline";
import { buildSummary } from "@/analytics/summary";
import { buildBrief, type Brief, type Fetched } from "@/analytics/brief";
import { resolveWindow, type TimeRangeId } from "@/domain/time-range";
import { getActiveAlerts } from "./alerts";
import { getDispersionRuns } from "./dispersion";
import { getEarthquakeSnapshot } from "./earthquakes";
import { getRegionHistory } from "./region-history";
import { getVolcanicSystems } from "./volcanoes";

/**
 * Runs a loader, turning a failure into a reason rather than an exception.
 *
 * The reason itself is logged and not carried into the document: an upstream
 * error message is written for whoever runs the server, and a reader of the
 * brief needs to know only that the section could not be filled.
 */
async function optional<T>(
  name: string,
  load: () => Promise<readonly T[]>,
): Promise<Fetched<T>> {
  try {
    return { items: await load(), unavailable: null };
  } catch (error) {
    console.warn(`[brief] ${name} unavailable`, error);
    return { items: [], unavailable: name };
  }
}

/**
 * The brief for one window, or `null` when the catalogue could not be read.
 */
export async function getBrief(range: TimeRangeId, now = new Date()): Promise<Brief | null> {
  const [snapshot, history, alerts, systems, runs] = await Promise.all([
    getEarthquakeSnapshot().catch((error: unknown) => {
      console.warn("[brief] the earthquake catalogue is unavailable", error);
      return null;
    }),
    getRegionHistory().catch(() => null),
    optional("warnings", async () => (await getActiveAlerts()).alerts),
    optional("volcano status", async () => (await getVolcanicSystems()).systems),
    optional("dispersal simulations", async () => (await getDispersionRuns()).runs),
  ]);

  if (!snapshot) return null;

  const { from, to } = resolveWindow(range, now);
  const quakes = filterByRange(snapshot.quakes, from, to);
  const stats = computeStats(quakes, { from, to });

  const observations = detectObservations({
    quakes,
    from,
    to,
    // The window cannot be its own baseline, so the comparison is against the
    // whole catalogue we hold, and against a year of daily counts where there
    // is one.
    catalogue: snapshot.quakes,
    history: history?.history ?? null,
  });

  return buildBrief({
    generatedAt: now,
    range,
    window: { from, to },
    summary: buildSummary(quakes, stats, range),
    observations: observations.observations,
    regions: withBaselines(tallyByRegion(quakes), { from, to }, history?.history ?? null),
    alerts,
    systems,
    runs,
  });
}
