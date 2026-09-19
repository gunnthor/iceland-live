/**
 * GET /api/webcams/frame?view=<key>&at=<epoch ms>
 *
 * One frame out of the reel this server recorded.
 *
 * Both parameters are ours: `view` is a hash we produced and `at` is a time we
 * wrote, and the store checks a frame is indexed before touching the disk. No
 * value from the caller reaches a path, so there is nothing to traverse.
 *
 * ## Caching
 * A stored frame is immutable — it is one picture taken at one instant — so
 * it is cached hard. Missing frames are not: a frame evicted for budget could
 * legitimately be written again by a later poll.
 */

import { NextResponse } from "next/server";
import { readFrame } from "@/server/frame-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse | Response> {
  const params = new URL(request.url).searchParams;
  const view = params.get("view") ?? "";
  const at = Number(params.get("at"));

  const bytes = Number.isInteger(at) ? await readFrame(view, at) : null;

  if (!bytes) {
    return NextResponse.json(
      { ok: false, code: "not_found", message: "That frame is no longer held." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=3600, immutable",
    },
  });
}
