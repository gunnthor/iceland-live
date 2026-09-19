/**
 * GET /api/insar/image?src=<published png url>
 *
 * Proxies a published interferogram image.
 *
 * ## Why a proxy is required
 *
 * `data.epos-iceland.is` serves the PNGs without any `Access-Control-Allow-Origin`
 * header. MapLibre draws a raster image source onto a WebGL texture, which is a
 * cross-origin read, so the browser refuses it. Serving the bytes from our own
 * origin is the only way to put these on the map.
 *
 * ## Why `src` is allowlisted
 *
 * The URL originates in an upstream response, and a proxy that fetches whatever
 * a parameter names is an open relay — usable to reach internal addresses from
 * our server. Only `https` URLs on the EPOS data host are fetched, and the path
 * must be a `.png`.
 *
 * ## Caching
 * These files are immutable: a product's filename encodes its sensor and both
 * acquisition dates, so the bytes behind a given URL never change. Cached for a
 * year, and the response is streamed rather than buffered — they run to ~3 MB.
 */

import { NextResponse } from "next/server";
import { EPOS_DATA_HOST } from "@/providers/imo/epos-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 30_000;

function isAllowed(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname !== EPOS_DATA_HOST) return null;
  if (!url.pathname.toLowerCase().endsWith(".png")) return null;
  return url;
}

export async function GET(request: Request): Promise<NextResponse | Response> {
  const src = new URL(request.url).searchParams.get("src");

  if (!src) {
    return NextResponse.json(
      { ok: false, code: "bad_request", message: "Missing image source." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const target = isAllowed(src);
  if (!target) {
    console.warn(`[api/insar/image] refused a source outside the allowlist: ${src.slice(0, 200)}`);
    return NextResponse.json(
      { ok: false, code: "bad_request", message: "That image source is not permitted." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "image/png", "user-agent": "IcelandLive/0.1 (+https://live.gunnthor.is)" },
    });
  } catch (error) {
    console.warn(`[api/insar/image] could not reach ${target.hostname}`, error);
    return NextResponse.json(
      { ok: false, code: "upstream_unavailable", message: "The image could not be retrieved." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { ok: false, code: "upstream_unavailable", message: "The image could not be retrieved." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  // Trust our own allowlist over the upstream content-type header.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": upstream.headers.get("content-length") ?? "",
    },
  });
}
