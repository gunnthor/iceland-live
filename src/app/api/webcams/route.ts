/**
 * GET /api/webcams
 *
 * Live road camera sites from Vegagerðin.
 *
 * ## Caching
 * Six hours for the catalogue — where the cameras are changes rarely. The
 * images are not cached here; they go through `/api/webcams/image` per request,
 * which is what keeps them live.
 */

import { NextResponse } from "next/server";
import type { ApiErrorResponse, WebcamsResponse } from "@/domain/api";
import { IRCA_ATTRIBUTION } from "@/domain/webcam";
import { ProviderError } from "@/providers/types";
import { getWebcamSites } from "@/server/webcams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const { sites, meta } = await getWebcamSites();

    const body: WebcamsResponse = {
      ok: true,
      generatedAt: new Date().toISOString(),
      sites,
      attribution: IRCA_ATTRIBUTION,
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
    if (!isProvider) console.error("[api/webcams] unexpected failure", error);

    const body: ApiErrorResponse = {
      ok: false,
      code: isProvider ? "upstream_unavailable" : "internal",
      message: "Road camera information is not available right now.",
    };
    return NextResponse.json(body, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
