/**
 * GET /api/webcams/reel?src=<published image url>
 *
 * The frames this server holds for one camera view, oldest first.
 *
 * ## What this is
 *
 * Not an archive. Vegagerðin publishes only the current picture, so this is
 * what our own proxy happened to fetch while somebody had the camera open —
 * see `src/server/frame-store.ts`. An empty list is the ordinary answer for a
 * camera nobody has looked at, and the interface says as much rather than
 * implying the camera was down.
 *
 * `src` is put through the same allowlist as the image proxy before it is
 * hashed, so a caller cannot ask about a key we would never have written.
 *
 * ## Caching
 * Never. The whole point is what arrived in the last two minutes, and the
 * reel is per-instance anyway, so a shared cache would answer for the wrong
 * server.
 */

import { NextResponse } from "next/server";
import { allowWebcamSource } from "@/providers/vegagerdin/webcam-provider";
import { readReel, viewKeyFor } from "@/server/frame-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const src = new URL(request.url).searchParams.get("src");
  const target = src ? allowWebcamSource(src) : null;

  if (!target) {
    return NextResponse.json(
      { ok: false, code: "bad_request", message: "That camera is not one we serve." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const view = viewKeyFor(target.toString());
  const frames = await readReel(view);

  return NextResponse.json(
    {
      ok: true,
      view,
      frames: frames.map((frame) => ({
        at: new Date(frame.at).toISOString(),
        url: `/api/webcams/frame?view=${view}&at=${frame.at}`,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
