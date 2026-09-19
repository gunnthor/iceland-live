/**
 * GET /api/insar
 *
 * IMO's published interferograms and the GNSS station network.
 *
 * ## Caching
 * Six hours. A new interferogram appears only after an acquisition pair has
 * been processed, and the station network changes on the order of years.
 */

import { NextResponse } from "next/server";
import type { ApiErrorResponse, DeformationResponse } from "@/domain/api";
import { ProviderError } from "@/providers/types";
import { getDeformation } from "@/server/deformation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const { interferograms, stations, meta } = await getDeformation();

    const body: DeformationResponse = {
      ok: true,
      generatedAt: new Date().toISOString(),
      interferograms,
      stations,
      meta,
    };

    return NextResponse.json(body, {
      headers: {
        "cache-control":
          meta.freshness === "stale"
            ? "no-store"
            : "public, s-maxage=21600, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    const isProvider = error instanceof ProviderError;
    if (!isProvider) console.error("[api/insar] unexpected failure", error);

    const body: ApiErrorResponse = {
      ok: false,
      code: isProvider ? "upstream_unavailable" : "internal",
      message: "Deformation products are not available right now.",
    };
    return NextResponse.json(body, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
