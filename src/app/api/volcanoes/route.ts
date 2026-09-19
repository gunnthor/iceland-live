/**
 * GET /api/volcanoes
 *
 * Volcanic systems from the Catalogue of Icelandic Volcanoes, with IMO's
 * official aviation colour code and volcanic alert level where issued.
 *
 * ## Caching
 * Cached for an hour in-process (see `src/server/volcanoes.ts`) and advertised
 * to any CDN with `s-maxage=3600, stale-while-revalidate=86400`. The geometry
 * is static and the alert levels change on the order of weeks.
 */

import { NextResponse } from "next/server";
import type { ApiErrorResponse, VolcanoesResponse } from "@/domain/api";
import { ProviderError } from "@/providers/types";
import { getVolcanicSystems } from "@/server/volcanoes";

export const runtime = "nodejs";
/**
 * Dynamic on purpose. With `revalidate` this route prerenders at build time,
 * which would bake a build-time upstream failure into a cached 503 for an hour.
 * Freshness is handled by the in-process cache and the Cache-Control header
 * below, both of which react to the actual state of the upstream.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const { systems, meta } = await getVolcanicSystems();

    const body: VolcanoesResponse = {
      ok: true,
      generatedAt: new Date().toISOString(),
      systems,
      meta,
    };

    return NextResponse.json(body, {
      headers: {
        "cache-control":
          meta.freshness === "stale"
            ? "no-store"
            : "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    const isProvider = error instanceof ProviderError;
    if (!isProvider) console.error("[api/volcanoes] unexpected failure", error);

    const body: ApiErrorResponse = {
      ok: false,
      code: isProvider ? "upstream_unavailable" : "internal",
      message: "Volcanic system information is not available right now.",
    };

    return NextResponse.json(body, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
