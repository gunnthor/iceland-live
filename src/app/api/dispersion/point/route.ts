/**
 * GET /api/dispersion/point?run=<uuid>&lat=&lon=
 *
 * What a dispersal run puts in the air at one place, hour by hour.
 *
 * ## Why this rather than reading the picture
 *
 * The raster is already on the map, and it would be possible to sample its
 * pixels and translate colours back into concentrations. That would be a
 * guess about a scale dressed up as a measurement. This asks IMO's own
 * service to evaluate the model at a coordinate and returns the numbers it
 * gives back.
 *
 * ## Validation
 *
 * The run must be one currently served — relaying an arbitrary UUID would
 * make this a general-purpose proxy for IMO's service — and the point must
 * fall inside that run's model grid, because outside it the service answers
 * 200 with zeros and "not modelled" would arrive looking like "nothing will
 * reach here".
 *
 * ## Caching
 * A finished run's output never changes, so an hour shared, and the answer is
 * memoised server-side against rounded coordinates.
 */

import { NextResponse } from "next/server";
import type { ApiErrorResponse, DispersionPointResponse } from "@/domain/api";
import { getDispersionPoint } from "@/server/dispersion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message: string): NextResponse {
  const body: ApiErrorResponse = { ok: false, code: "bad_request", message };
  return NextResponse.json(body, { status: 400, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const run = params.get("run");
  const latitude = Number(params.get("lat"));
  const longitude = Number(params.get("lon"));

  if (!run || !UUID.test(run)) return bad("Missing or malformed run identifier.");
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return bad("Latitude out of range.");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return bad("Longitude out of range.");
  }

  const lookup = await getDispersionPoint(run, latitude, longitude);

  if (!lookup.ok) {
    const body: ApiErrorResponse =
      lookup.reason === "unknown-run"
        ? { ok: false, code: "not_found", message: "That simulation is not one we currently serve." }
        : lookup.reason === "outside-grid"
          ? { ok: false, code: "bad_request", message: "That place is outside the model grid." }
          : {
              ok: false,
              code: "upstream_unavailable",
              message: "The simulation could not be evaluated there.",
            };
    const status = lookup.reason === "unavailable" ? 502 : lookup.reason === "unknown-run" ? 404 : 400;
    return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
  }

  const body: DispersionPointResponse = {
    ok: true,
    generatedAt: new Date().toISOString(),
    runId: lookup.run.id,
    series: lookup.series,
  };

  return NextResponse.json(body, {
    headers: { "cache-control": "public, s-maxage=3600, stale-while-revalidate=21600" },
  });
}
