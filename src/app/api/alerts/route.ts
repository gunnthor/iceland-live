/**
 * GET /api/alerts
 *
 * Official warnings currently in force, from IMO's CAP broker. Relayed
 * unaltered — this route normalizes shape, never substance.
 *
 * ## Caching
 * Three minutes, matching the in-process TTL. A degraded response is `no-store`
 * so a CDN cannot hold a stale warning in place after it is cancelled.
 */

import { NextResponse } from "next/server";
import type { AlertsResponse, ApiErrorResponse } from "@/domain/api";
import { ProviderError } from "@/providers/types";
import { getActiveAlerts } from "@/server/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const { alerts, meta } = await getActiveAlerts();

    const body: AlertsResponse = {
      ok: true,
      generatedAt: new Date().toISOString(),
      alerts,
      meta,
    };

    return NextResponse.json(body, {
      headers: {
        "cache-control":
          meta.freshness === "stale"
            ? "no-store"
            : "public, s-maxage=180, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    const isProvider = error instanceof ProviderError;
    if (!isProvider) console.error("[api/alerts] unexpected failure", error);

    const body: ApiErrorResponse = {
      ok: false,
      code: isProvider ? "upstream_unavailable" : "internal",
      message: "Official warnings from the Icelandic Meteorological Office are not reachable.",
    };
    return NextResponse.json(body, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
