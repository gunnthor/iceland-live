/**
 * GET /api/dispersion/raster?run=&model=&type=&alt=&unit=&at=
 *
 * One frame of a dispersal simulation, as a Web Mercator PNG.
 *
 * ## Why proxy
 *
 * Two reasons, both hard requirements. IMO's raster endpoint sends no
 * `Access-Control-Allow-Origin`, and MapLibre uploads a raster image source to
 * a WebGL texture — a cross-origin read the browser refuses. And the frames
 * are small and numerous: stepping through a 48-hour run is 48 requests, which
 * belong behind our cache rather than on IMO's server once per viewer.
 *
 * ## Why parameters rather than a URL
 *
 * Unlike the image proxies for interferograms and road cameras, nothing here
 * relays a URL. Every parameter is validated against the values IMO's own
 * OpenAPI description declares, and the upstream URL is built here from
 * nothing but those. There is no input that could name a different host.
 *
 * `srid` is fixed at 3857 and never taken from the caller. MapLibre maps an
 * image onto four corners by interpolating in Web Mercator, so a plate carrée
 * raster would be stretched in latitude — visibly, and wrongly, at Iceland's
 * latitudes. Asking IMO for Mercator makes the interpolation exact.
 *
 * ## Caching
 * A run is immutable once produced: its UUID identifies one set of model
 * output, and the bytes behind a given frame never change. Cached for a year.
 */

import { NextResponse } from "next/server";
import { IMO_API_VERSIONS, IMO_BASE_URL } from "@/providers/imo/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 25_000;

/** Exactly the values IMO's OpenAPI declares for these parameters. */
const MODELS = new Set(["NAME", "CALPUFF"]);
const DISPERSION_TYPES = new Set(["Ash kg/m2", "Ash g/m3", "SO2", "SO4"]);
const ALTITUDE_UNITS = new Set(["m", "hPa"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pressure levels go to 1025 hPa and metre altitudes stay near the ground. */
const MAX_ALTITUDE = 2000;

function badRequest(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, code: "bad_request", message },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request): Promise<NextResponse | Response> {
  const params = new URL(request.url).searchParams;

  const run = params.get("run");
  const model = params.get("model");
  const dispersionType = params.get("type");
  const unit = params.get("unit");
  const altitude = Number(params.get("alt"));
  const at = params.get("at");

  if (!run || !UUID.test(run)) return badRequest("Missing or malformed run identifier.");
  if (!model || !MODELS.has(model)) return badRequest("Unknown model.");
  if (!dispersionType || !DISPERSION_TYPES.has(dispersionType)) {
    return badRequest("Unknown dispersion type.");
  }
  if (!unit || !ALTITUDE_UNITS.has(unit)) return badRequest("Unknown altitude unit.");
  if (!Number.isInteger(altitude) || altitude < 0 || altitude > MAX_ALTITUDE) {
    return badRequest("Altitude out of range.");
  }

  const atMs = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(atMs)) return badRequest("Missing or malformed frame time.");
  // Naive, no zone designator: IMO answers 500 to a trailing `Z`.
  const upstreamTime = new Date(atMs).toISOString().replace(/\.\d+Z$/, "");

  const target = new URL("/dispersion/raster", IMO_BASE_URL);
  target.searchParams.set("uuid", run);
  target.searchParams.set("model_type", model);
  target.searchParams.set("dispersion_type", dispersionType);
  target.searchParams.set("altitude", String(altitude));
  target.searchParams.set("altitude_unit", unit);
  target.searchParams.set("time", upstreamTime);
  target.searchParams.set("srid", "3857");
  target.searchParams.set("filetype", "png");

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "x-vi-api-version": IMO_API_VERSIONS.dispersion,
        accept: "image/png",
        "user-agent": "IcelandLive/0.1 (+https://live.gunnthor.is)",
      },
    });
  } catch (error) {
    console.warn("[api/dispersion/raster] could not reach the dispersion service", error);
    return NextResponse.json(
      { ok: false, code: "upstream_unavailable", message: "That frame could not be retrieved." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  /*
   * 404 is ordinary here, not a fault: a run has no raster at its own start
   * instant, and none past the end of its window. Passed through as 404 so a
   * caller can tell "this frame does not exist" from "IMO is down".
   */
  if (upstream.status === 404) {
    return NextResponse.json(
      { ok: false, code: "not_found", message: "No frame at that time." },
      { status: 404, headers: { "cache-control": "public, max-age=300" } },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { ok: false, code: "upstream_unavailable", message: "That frame could not be retrieved." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, s-maxage=31536000, immutable",
    },
  });
}
