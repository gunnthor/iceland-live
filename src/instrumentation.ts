/**
 * Runs once when a server instance starts.
 *
 * The only thing registered here is the optional in-process camera recorder.
 * It is off unless `ICELAND_LIVE_CAMERA_RECORDER=1`, because a background
 * timer is meaningful only where the process outlives a request — on
 * serverless it would either never fire or fire unpredictably, and
 * `/api/cron/cameras` is the answer there.
 */

export async function register(): Promise<void> {
  // This module is also evaluated in the edge runtime, which has no timers
  // worth starting and no filesystem to record to.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startCameraRecorder } = await import("@/server/camera-recorder");
  const result = startCameraRecorder();
  if (result.started) {
    console.info(
      `[instrumentation] camera recorder running every ${Math.round((result.everyMs ?? 0) / 1000)}s`,
    );
  }
}
