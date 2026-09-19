/**
 * GET /api/environment
 *
 * Air quality and road conditions in one response.
 *
 * ## Caching
 * Five minutes. The air network publishes hourly averages; the road feeds move
 * every few minutes. Either source may be absent with the other present — the
 * response carries a per-source error rather than failing as a whole.
 */

import { NextResponse } from "next/server";
import type { ApiErrorResponse, EnvironmentResponse } from "@/domain/api";
import { IRCA_ATTRIBUTION } from "@/domain/webcam";
import { notableConditions } from "@/domain/roads";
import { ProviderError } from "@/providers/types";
import { getEnvironment } from "@/server/environment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const snapshot = await getEnvironment();

    const body: EnvironmentResponse = {
      ok: true,
      generatedAt: new Date().toISOString(),
      air: snapshot.air,
      airError: snapshot.airError,
      roadWeather: snapshot.roadWeather,
      // Only the segments that are not plainly clear; the other ~835 are noise.
      roadConditions: notableConditions(snapshot.roadConditions),
      roadConditionsTotal: snapshot.roadConditions.length,
      roadConditionGeometry: snapshot.roadConditionGeometry,
      roadsError: snapshot.roadsError,
      roadAttribution: IRCA_ATTRIBUTION,
      meta: snapshot.meta,
    };

    return NextResponse.json(body, {
      headers: {
        "cache-control":
          snapshot.meta.freshness === "stale"
            ? "no-store"
            : "public, s-maxage=300, stale-while-revalidate=900",
      },
    });
  } catch (error) {
    const isProvider = error instanceof ProviderError;
    if (!isProvider) console.error("[api/environment] unexpected failure", error);

    const body: ApiErrorResponse = {
      ok: false,
      code: isProvider ? "upstream_unavailable" : "internal",
      message: "Air quality and road information are not available right now.",
    };
    return NextResponse.json(body, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
