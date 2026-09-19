/**
 * GET /api/webcams/image?src=<published image url>
 *
 * Proxies a live road camera image.
 *
 * ## Why proxy rather than let the browser load it directly
 *
 * An `<img>` tag needs no CORS, so this is not a technical necessity — it is a
 * courtesy and a control. Every viewer hitting Vegagerðin directly would put
 * our traffic on their servers; proxying with a short shared cache means they
 * see at most one request per image per minute no matter how many people have
 * the page open. It also keeps the referrer off their logs and gives us one
 * place to stop if they ask us to.
 *
 * ## Why `src` is allowlisted
 *
 * The URL comes from an upstream response, and a proxy that fetches whatever a
 * parameter names is an open relay — usable to reach internal addresses from
 * our own server. Only `https` URLs on the IRCA image host with an image
 * extension are fetched.
 *
 * ## Caching
 *
 * 60 seconds shared, which matches the upstream `max-age` and the rate the
 * images actually refresh. Deliberately short: a stale road camera during
 * unrest is worse than no road camera.
 *
 * ## `record=1`
 *
 * Files the frame into the reel (`src/server/frame-store.ts`) on its way
 * past, so the pictures a camera published while someone was watching are
 * still there for the next person.
 *
 * Opt-in rather than automatic, because this proxy also serves the thumbnails
 * in the camera list. Recording those would spread a fixed budget across
 * every camera on the page instead of concentrating it on the one being
 * watched, which is the only one whose past anybody wants.
 */

import { NextResponse } from "next/server";
import { allowWebcamSource } from "@/providers/vegagerdin/webcam-provider";
import { recordFrame, viewKeyFor } from "@/server/frame-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse | Response> {
  const src = new URL(request.url).searchParams.get("src");

  if (!src) {
    return NextResponse.json(
      { ok: false, code: "bad_request", message: "Missing image source." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const target = allowWebcamSource(src);
  if (!target) {
    console.warn(`[api/webcams/image] refused a source outside the allowlist: ${src.slice(0, 200)}`);
    return NextResponse.json(
      { ok: false, code: "bad_request", message: "That image source is not permitted." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: "image/jpeg,image/png,image/*",
        "user-agent": "IcelandLive/0.1 (+https://live.gunnthor.is)",
      },
    });
  } catch (error) {
    console.warn(`[api/webcams/image] could not reach ${target.hostname}`, error);
    return NextResponse.json(
      { ok: false, code: "upstream_unavailable", message: "The camera image is unavailable." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { ok: false, code: "upstream_unavailable", message: "The camera image is unavailable." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const lastModified = upstream.headers.get("last-modified");

  const headers: Record<string, string> = {
    "content-type": contentType.startsWith("image/") ? contentType : "image/jpeg",
    "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
    // Passed through so a client can tell how old the picture actually is.
    ...(lastModified ? { "last-modified": lastModified } : {}),
  };

  if (new URL(request.url).searchParams.get("record") !== "1") {
    return new Response(upstream.body, { status: 200, headers });
  }

  /*
   * Buffered rather than streamed, only on this path: the bytes have to exist
   * in one place to be written. Frames run about 30 KB, so this is a cheap
   * exception to make for the one request per view per couple of minutes that
   * asks for it.
   */
  let body: ArrayBuffer;
  try {
    body = await upstream.arrayBuffer();
  } catch (error) {
    console.warn("[api/webcams/image] could not read the image body", error);
    return NextResponse.json(
      { ok: false, code: "upstream_unavailable", message: "The camera image is unavailable." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  const bytes = new Uint8Array(body);

  // Recording must never delay or fail the picture, so its outcome is not
  // awaited and its failures are already swallowed inside the store.
  void recordFrame(viewKeyFor(target.toString()), bytes, {
    takenAt: lastModified ? Date.parse(lastModified) : Date.now(),
    tag: upstream.headers.get("etag"),
  });

  return new Response(bytes, { status: 200, headers });
}
