/**
 * GET /api/cron/cameras
 *
 * Polls the camera watch list once and files the frames away.
 *
 * ## Why an endpoint rather than a timer
 *
 * On serverless there is no process between requests to run a timer in, so
 * the schedule has to come from outside. This works with any scheduler that
 * can make an authenticated GET — Vercel Cron, a GitHub Actions workflow, a
 * systemd timer, `curl` in a crontab. Deployments where the process *does*
 * outlive a request can skip all of that and set
 * `ICELAND_LIVE_CAMERA_RECORDER=1` instead; both drive the same function.
 *
 * ## Authentication
 *
 * A bearer token in `CRON_SECRET`, which is the convention Vercel Cron sends.
 * Without the secret set this refuses in production and allows in development,
 * mirroring how `ALLOW_FIXTURES_IN_PRODUCTION` is handled: a misconfigured
 * deployment should fail closed rather than expose a trigger that costs
 * someone else's bandwidth.
 *
 * It is not a dangerous endpoint — worst case it fetches a dozen public JPEGs
 * — but it is an endpoint that does outbound work, and those should not be
 * anonymous.
 */

import { NextResponse } from "next/server";
import { recordWatchList } from "@/server/camera-recorder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Comfortably longer than twelve sequential-ish image fetches. */
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  if (!secret) return process.env.NODE_ENV !== "production";

  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, code: "unauthorized", message: "Not permitted." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  // `recordWatchList` does not throw; a scheduler handed an exception tends to
  // either retry hard or give up, and neither suits one unreachable camera.
  const report = await recordWatchList();

  return NextResponse.json(
    { ok: true, ranAt: new Date().toISOString(), ...report },
    { headers: { "cache-control": "no-store" } },
  );
}
