/**
 * GET /api/earthquakes?range=24h
 *
 * Returns the earthquakes in the requested window together with the statistics,
 * summary, observations and histogram derived from them.
 *
 * ## Caching
 *
 * The route itself is dynamic, but the data behind it is not fetched per
 * request — see `src/server/earthquakes.ts`. The response carries
 *   Cache-Control: public, s-maxage=60, stale-while-revalidate=300
 * so a CDN in front of the app can serve a cached copy for a minute and keep
 * serving it for five more while it refreshes in the background.
 *
 * Degraded responses (stale upstream) are sent with `no-store` so a CDN never
 * pins an outage state in place after IMO recovers.
 */

import { NextResponse } from "next/server";
import { detectObservations } from "@/analytics/clusters";
import { buildHistogram } from "@/analytics/histogram";
import { computeStats, filterByRange } from "@/analytics/stats";
import { buildSummary } from "@/analytics/summary";
import type { ApiErrorResponse, EarthquakesResponse } from "@/domain/api";
import { parseTimeRange, resolveWindow } from "@/domain/time-range";
import { ProviderError } from "@/providers/types";
import { getEarthquakeSnapshot } from "@/server/earthquakes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const range = parseTimeRange(url.searchParams.get("range"));

  try {
    const snapshot = await getEarthquakeSnapshot();
    const now = new Date();
    const { from, to } = resolveWindow(range, now);

    const quakes = filterByRange(snapshot.quakes, from, to);
    const stats = computeStats(quakes, { from, to });
    const observations = detectObservations({ quakes, from, to, catalogue: snapshot.quakes });

    const body: EarthquakesResponse = {
      ok: true,
      range,
      window: { from: from.toISOString(), to: to.toISOString() },
      generatedAt: now.toISOString(),
      quakes,
      stats,
      summary: buildSummary(quakes, stats, range),
      observations: observations.observations,
      observationWindow: {
        from: observations.window.from,
        to: observations.window.to,
        capped: observations.windowCapped,
      },
      histogram: buildHistogram(quakes, range, to),
      meta: snapshot.meta,
    };

    const degraded = snapshot.meta.freshness === "stale";

    return NextResponse.json(body, {
      headers: {
        "cache-control": degraded
          ? "no-store"
          : "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    return NextResponse.json(toErrorBody(error), {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}

function toErrorBody(error: unknown): ApiErrorResponse {
  if (error instanceof ProviderError) {
    if (error.kind === "parse") {
      console.error("[api/earthquakes] upstream payload was not usable", error);
      return {
        ok: false,
        code: "upstream_invalid",
        message: "The Icelandic Meteorological Office returned data in an unexpected format.",
      };
    }
    console.warn(`[api/earthquakes] upstream unavailable: ${error.message}`);
    return {
      ok: false,
      code: "upstream_unavailable",
      message: "Earthquake data from the Icelandic Meteorological Office is not reachable right now.",
    };
  }

  console.error("[api/earthquakes] unexpected failure", error);
  return {
    ok: false,
    code: "internal",
    message: "Something went wrong while preparing earthquake data.",
  };
}
