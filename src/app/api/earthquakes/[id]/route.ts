/**
 * GET /api/earthquakes/{id}
 *
 * The full solution for one event, including the uncertainties the bulk
 * catalogue omits. Fetched on demand when a user opens an event, so the common
 * case — panning the map — never pays for it.
 *
 * ## Caching
 * Five minutes at the CDN, matching the in-process TTL. A solution is revised a
 * few times shortly after the event and then stops changing.
 */

import { NextResponse } from "next/server";
import type { ApiErrorResponse, EarthquakeDetailResponse } from "@/domain/api";
import { ProviderError } from "@/providers/types";
import { getEarthquakeDetail } from "@/server/earthquake-detail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;

  if (!id || id.length > 64) {
    const body: ApiErrorResponse = {
      ok: false,
      code: "bad_request",
      message: "That is not a valid event identifier.",
    };
    return NextResponse.json(body, { status: 400, headers: { "cache-control": "no-store" } });
  }

  try {
    const result = await getEarthquakeDetail(id);

    if (!result) {
      const body: ApiErrorResponse = {
        ok: false,
        code: "unsupported",
        message: "The current data source does not provide per-event detail.",
      };
      return NextResponse.json(body, { status: 501, headers: { "cache-control": "no-store" } });
    }

    const body: EarthquakeDetailResponse = {
      ok: true,
      detail: result.detail,
      meta: result.meta,
    };

    return NextResponse.json(body, {
      headers: {
        "cache-control":
          result.meta.freshness === "stale"
            ? "no-store"
            : "public, s-maxage=300, stale-while-revalidate=1800",
      },
    });
  } catch (error) {
    if (error instanceof ProviderError && error.status === 404) {
      const body: ApiErrorResponse = {
        ok: false,
        code: "not_found",
        message: "The Icelandic Meteorological Office has no record of that event.",
      };
      return NextResponse.json(body, { status: 404, headers: { "cache-control": "no-store" } });
    }

    const isProvider = error instanceof ProviderError;
    if (!isProvider) console.error("[api/earthquakes/:id] unexpected failure", error);

    const body: ApiErrorResponse = {
      ok: false,
      code: isProvider ? "upstream_unavailable" : "internal",
      message: "Detailed information for this event is not available right now.",
    };
    return NextResponse.json(body, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
