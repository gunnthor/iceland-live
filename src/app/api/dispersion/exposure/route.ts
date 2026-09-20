/**
 * GET /api/dispersion/exposure?run=<uuid>
 *
 * Which road-weather stations a dispersal run reaches, and how much the model
 * puts there.
 *
 * The footprint comes from the alpha channel of IMO's own raster — one bit per
 * pixel, "is there anything here" — and the figures come from their
 * per-location endpoint. Nothing reads a concentration off a colour.
 *
 * ## Caching
 * An hour shared. A run is finished output, so the answer only changes when
 * the road-station list does.
 */

import { NextResponse } from "next/server";
import type { ApiErrorResponse, DispersionExposureResponse } from "@/domain/api";
import { getDispersionExposure } from "@/server/dispersion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<NextResponse> {
  const run = new URL(request.url).searchParams.get("run");

  if (!run || !UUID.test(run)) {
    const body: ApiErrorResponse = {
      ok: false,
      code: "bad_request",
      message: "Missing or malformed run identifier.",
    };
    return NextResponse.json(body, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const exposure = await getDispersionExposure(run);

  if (!exposure) {
    const body: ApiErrorResponse = {
      ok: false,
      code: "not_found",
      message: "That simulation is not one we currently serve.",
    };
    return NextResponse.json(body, { status: 404, headers: { "cache-control": "no-store" } });
  }

  const body: DispersionExposureResponse = {
    ok: true,
    generatedAt: new Date().toISOString(),
    ...exposure,
  };

  return NextResponse.json(body, {
    headers: {
      "cache-control": exposure.unavailable
        ? "no-store"
        : "public, s-maxage=3600, stale-while-revalidate=21600",
    },
  });
}
