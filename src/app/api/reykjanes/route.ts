/**
 * GET /api/reykjanes
 *
 * Lava flows, lava barriers, the Grindavík graben and located facilities on
 * the Reykjanes peninsula, assembled from four Icelandic geospatial datasets
 * and simplified for the browser.
 *
 * ## Caching
 * A day at the CDN. Every dataset here is a completed survey; the most recent
 * lava outline is from the July 2025 eruption and will not change.
 */

import { NextResponse } from "next/server";
import type { ApiErrorResponse, ReykjanesResponse } from "@/domain/api";
import { ProviderError } from "@/providers/types";
import { getReykjanesLayer } from "@/server/reykjanes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const { layer, meta } = await getReykjanesLayer();

    const body: ReykjanesResponse = {
      ok: true,
      generatedAt: new Date().toISOString(),
      layer,
      meta,
    };

    return NextResponse.json(body, {
      headers: {
        "cache-control":
          meta.freshness === "stale"
            ? "no-store"
            : "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    const isProvider = error instanceof ProviderError;
    if (!isProvider) console.error("[api/reykjanes] unexpected failure", error);

    const body: ApiErrorResponse = {
      ok: false,
      code: isProvider ? "upstream_unavailable" : "internal",
      message: "Reykjanes map layers are not available right now.",
    };
    return NextResponse.json(body, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
