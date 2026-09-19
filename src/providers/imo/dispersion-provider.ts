/**
 * Dispersal simulations from IMO.
 *
 *   GET /epos/volcano/hazard/maps/probabilistic-modelling-based/dispersion-ash-gas
 *   GET /dispersion/simulations/{uuid}
 *   GET /dispersion/raster?...                 (proxied, see the route)
 *
 * The catalogue is the published product list and is the authority on what
 * exists; the dispersion service supplies the model grid each run was
 * computed on. Both are documented, each with its own OpenAPI description and
 * its own independently pinned version.
 *
 * ## Why only some of the catalogue
 *
 * IMO reruns the same handful of scenarios several times a day, so most of
 * the catalogue is older copies of the current list — 276 entries reduce to
 * about half a dozen distinct scenarios. Runs whose forecast window has
 * already elapsed are dropped: they were never wrong, they are simply spent,
 * and leaving a year-old run at the top of a list labelled "latest" would
 * read as current when it is not.
 */

import {
  sortRuns,
  type DispersionPointSeries,
  type DispersionRun,
} from "@/domain/dispersion";
import type { ProviderAttribution, ProviderResult } from "@/providers/types";
import { imoFetchJson } from "./client";
import {
  latestPerScenario,
  mergeRun,
  normalizeCatalogue,
  normalizePointSeries,
  normalizeSimulation,
} from "./dispersion-normalize";

export const DISPERSION_ATTRIBUTION: ProviderAttribution = {
  name: "Icelandic Meteorological Office — dispersal forecasting",
  url: "https://dispersion.vedur.is/",
  note: "CALPUFF and NAME dispersal simulations driven by ECMWF meteorology.",
};

const CATALOGUE_PATH =
  "/volcano/hazard/maps/probabilistic-modelling-based/dispersion-ash-gas";

/**
 * How stale a catalogue entry may be before we stop asking about it.
 *
 * Every current scenario is rerun well inside this window, so anything older
 * is a product IMO has stopped producing rather than one that is merely due.
 * Checked before the per-run requests, so a source that goes quiet costs one
 * request rather than a fan-out over its whole back catalogue.
 */
const MAX_CATALOGUE_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * A ceiling on the per-run requests, independent of what the catalogue says.
 *
 * Six scenarios are current today. If IMO adds a dozen more overnight this
 * keeps one page load from turning into thirty upstream requests.
 */
const MAX_RUNS = 12;

const CATALOGUE_REVALIDATE_SECONDS = 15 * 60;
/** A run's grid and layer list are fixed once it has been produced. */
const RUN_REVALIDATE_SECONDS = 24 * 60 * 60;

export class ImoDispersionProvider {
  readonly id = "imo-dispersion";
  readonly attribution = DISPERSION_ATTRIBUTION;

  /**
   * Evaluates a run at one place.
   *
   * The service answers 200 with zeros for a point outside the model grid
   * rather than refusing, so callers must check the run's bounds first —
   * "the model puts nothing here" and "this place is not in the model" are
   * different answers and only one of them is true outside the grid.
   */
  async fetchPointSeries(
    runId: string,
    latitude: number,
    longitude: number,
  ): Promise<ProviderResult<DispersionPointSeries[]>> {
    const payload = await imoFetchJson<unknown>({
      service: "dispersion",
      path:
        `/graphs/location/uuid/${encodeURIComponent(runId)}` +
        `/lat/${latitude}/lng/${longitude}/srid/4326`,
      // A finished run's output never changes, so this is worth holding on to.
      revalidateSeconds: RUN_REVALIDATE_SECONDS,
      timeoutMs: 25_000,
    });

    return {
      data: normalizePointSeries(payload),
      meta: {
        providerId: this.id,
        freshness: "live",
        fetchedAt: new Date().toISOString(),
        attribution: this.attribution,
      },
    };
  }

  async fetchRuns(now = Date.now()): Promise<ProviderResult<DispersionRun[]>> {
    const catalogue = await imoFetchJson<unknown>({
      service: "epos",
      path: CATALOGUE_PATH,
      revalidateSeconds: CATALOGUE_REVALIDATE_SECONDS,
      timeoutMs: 30_000,
    });

    const candidates = latestPerScenario(normalizeCatalogue(catalogue))
      .filter((entry) => now - Date.parse(entry.createdAt) <= MAX_CATALOGUE_AGE_MS)
      .slice(0, MAX_RUNS);

    /*
     * One failing run must not cost the rest. A scenario whose detail request
     * fails is simply absent from the list, which is the same outcome as IMO
     * not having published it — and better than an error page over a product
     * that is contingency planning rather than an active warning.
     */
    const settled = await Promise.all(
      candidates.map(async (entry) => {
        try {
          const record = normalizeSimulation(
            await imoFetchJson<unknown>({
              service: "dispersion",
              path: `/simulations/${entry.runId}`,
              revalidateSeconds: RUN_REVALIDATE_SECONDS,
              timeoutMs: 20_000,
            }),
          );
          return record ? mergeRun(entry, record) : null;
        } catch (error) {
          console.warn(`[dispersion] run ${entry.runId} could not be read`, error);
          return null;
        }
      }),
    );

    const runs = settled.filter((run): run is DispersionRun => {
      if (!run) return false;
      const endsAt = Date.parse(run.startsAt) + run.durationHours * 3_600_000;
      return endsAt >= now;
    });

    return {
      data: sortRuns(runs),
      meta: {
        providerId: this.id,
        freshness: "live",
        fetchedAt: new Date().toISOString(),
        attribution: this.attribution,
      },
    };
  }
}
