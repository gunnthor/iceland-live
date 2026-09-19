/**
 * GET /api/dispersion
 *
 * The dispersal simulations IMO currently has running, one per scenario.
 *
 * ## Caching
 * 15 minutes shared. IMO produces these a few times a day.
 *
 * ## What the client must do with this
 * Every run in this payload is a model scenario. The response says nothing
 * about whether an eruption is happening, and neither must anything built on
 * it. See `src/domain/dispersion.ts`.
 */

import { NextResponse } from "next/server";
import type { ApiErrorResponse, DispersionResponse } from "@/domain/api";
import { ProviderError } from "@/providers/types";
import { getDispersionRuns } from "@/server/dispersion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const { runs, meta } = await getDispersionRuns();

    const body: DispersionResponse = {
      ok: true,
      generatedAt: new Date().toISOString(),
      runs,
      meta,
    };

    return NextResponse.json(body, {
      headers: {
        "cache-control":
          meta.freshness === "stale"
            ? "no-store"
            : "public, s-maxage=900, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    const isProvider = error instanceof ProviderError;
    if (!isProvider) console.error("[api/dispersion] unexpected failure", error);

    const body: ApiErrorResponse = {
      ok: false,
      code: isProvider ? "upstream_unavailable" : "internal",
      message: "Dispersal simulations are not available right now.",
    };
    return NextResponse.json(body, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
