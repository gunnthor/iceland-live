/**
 * Keeps a handful of cameras recording whether or not anyone is watching.
 *
 * ## The gap this closes
 *
 * The frame store fills as a side effect of somebody looking, which is honest
 * but has the timing exactly wrong. Nobody has a camera open for an hour
 * *before* something happens, so the first person to arrive during unrest gets
 * the one frame their own page just fetched — precisely when the preceding
 * hour is the thing worth seeing.
 *
 * This polls a small watch list on a schedule so that hour already exists.
 *
 * ## Which cameras
 *
 * Derived, not listed. A hard-coded set of camera identifiers would be a guess
 * frozen at the moment it was written: Vegagerðin renumbers and retires
 * cameras, and the interesting part of Iceland moves.
 *
 * Where to point is decided by `chooseFocus` — a precedence ladder running
 * from official warnings through aviation colour codes to seismicity — and the
 * watch list is the camera sites nearest whatever it picks. The rung that
 * fired is reported, so "why is it looking there" always has an answer in
 * words.
 *
 * ## Cost
 *
 * Twelve views at roughly 30 KB each is under half a megabyte per run, and
 * frames the cameras have already given us are recognised upstream of the
 * store and discarded. The store's own bounds cap what this can accumulate;
 * nothing here can grow without limit.
 */

import { filterByRange, tallyByRegion } from "@/analytics/stats";
import type { WebcamSite, WebcamView } from "@/domain/webcam";
import { sitesNearest } from "@/domain/webcam";
import { allowWebcamSource } from "@/providers/vegagerdin/webcam-provider";
import { getActiveAlerts } from "./alerts";
import { getEarthquakeSnapshot } from "./earthquakes";
import { recordFrame, viewKeyFor, type RecordResult } from "./frame-store";
import { chooseFocus, type WatchFocus } from "./watch-focus";
import { getVolcanicSystems } from "./volcanoes";
import { getWebcamSites } from "./webcams";

/** Sites to watch. Each carries one to four views. */
export const WATCH_SITES = 4;

/**
 * Hard cap on views, independent of how many the sites happen to have.
 *
 * Ártúnsbrekka alone publishes four. Without a ceiling, four camera-dense
 * sites would put sixteen requests on Vegagerðin every tick.
 */
export const WATCH_VIEWS = 12;

/** Requests in flight at once. Polite rather than necessary. */
const CONCURRENCY = 4;

const FETCH_TIMEOUT_MS = 15_000;

export type RecorderReport = {
  /** Where the watch list was centred, which rung chose it, and what it matched. */
  focus: WatchFocus;
  /** Camera views polled. */
  views: number;
  stored: number;
  /** The camera had not republished since we last asked. */
  duplicate: number;
  /** A new file, but the same picture — see the frame store's threshold. */
  unchanged: number;
  skipped: number;
  /** Views whose image could not be fetched at all. */
  failed: number;
  durationMs: number;
};

/**
 * Gathers what the ladder needs.
 *
 * Each source is optional: a warning broker being unreachable should cost the
 * recorder its first rung, not its run. Every one of these is already cached
 * for the interface, so on a normal tick this is three cache reads.
 */
async function currentFocus(): Promise<WatchFocus> {
  const [alerts, systems, regions] = await Promise.all([
    getActiveAlerts()
      .then((snapshot) => snapshot.alerts)
      .catch((error: unknown) => {
        console.warn("[camera-recorder] warnings unavailable", error);
        return [];
      }),
    getVolcanicSystems()
      .then((snapshot) => snapshot.systems)
      .catch((error: unknown) => {
        console.warn("[camera-recorder] volcano status unavailable", error);
        return [];
      }),
    getEarthquakeSnapshot()
      .then(({ quakes }) => {
        const now = new Date();
        return tallyByRegion(
          filterByRange(quakes, new Date(now.getTime() - 86_400_000), now),
        );
      })
      .catch((error: unknown) => {
        console.warn("[camera-recorder] earthquake snapshot unavailable", error);
        return [];
      }),
  ]);

  return chooseFocus({ alerts, systems, regions });
}

/** The views to poll, nearest the focus first. */
export function watchList(
  sites: readonly WebcamSite[],
  focus: { latitude: number; longitude: number },
): WebcamView[] {
  return sitesNearest(sites, focus, WATCH_SITES)
    .flatMap((site) => site.views)
    .slice(0, WATCH_VIEWS);
}

async function pollView(view: WebcamView): Promise<RecordResult | "failed"> {
  const target = allowWebcamSource(view.sourceUrl);
  if (!target) return "skipped";

  let response: Response;
  try {
    response = await fetch(target, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        accept: "image/jpeg,image/png,image/*",
        "user-agent": "IcelandLive/0.1 (+https://live.gunnthor.is)",
      },
      // Never the Next data cache: the whole point is the current picture.
      cache: "no-store",
    });
  } catch {
    return "failed";
  }

  if (!response.ok) return "failed";

  let body: ArrayBuffer;
  try {
    body = await response.arrayBuffer();
  } catch {
    return "failed";
  }

  const lastModified = response.headers.get("last-modified");
  return recordFrame(viewKeyFor(target.toString()), new Uint8Array(body), {
    takenAt: lastModified ? Date.parse(lastModified) : Date.now(),
    tag: response.headers.get("etag"),
  });
}

/**
 * Polls the watch list once.
 *
 * Never throws. A scheduler that receives an exception tends to either retry
 * hard or stop calling, and neither is the right response to one camera being
 * briefly unreachable.
 */
export async function recordWatchList(): Promise<RecorderReport> {
  const startedAt = Date.now();
  const focus = await currentFocus();

  const report: RecorderReport = {
    focus,
    views: 0,
    stored: 0,
    duplicate: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    durationMs: 0,
  };

  let views: WebcamView[] = [];
  try {
    const { sites } = await getWebcamSites();
    views = watchList(sites, focus);
  } catch (error) {
    console.warn("[camera-recorder] the camera catalogue is unavailable", error);
    report.durationMs = Date.now() - startedAt;
    return report;
  }

  report.views = views.length;

  for (let index = 0; index < views.length; index += CONCURRENCY) {
    const batch = views.slice(index, index + CONCURRENCY);
    const outcomes = await Promise.all(batch.map(pollView));
    for (const outcome of outcomes) {
      if (outcome === "failed") report.failed += 1;
      else report[outcome] += 1;
    }
  }

  report.durationMs = Date.now() - startedAt;
  return report;
}

/**
 * The in-process ticker, for deployments where the process outlives a request.
 *
 * On a VPS, a container or anything else long-running this removes the need
 * for an external scheduler entirely. On serverless it is meaningless — the
 * process is torn down between invocations — so it is opt-in rather than
 * automatic, and the cron route exists for that case.
 */
let ticker: ReturnType<typeof setInterval> | null = null;

export function startCameraRecorder(): { started: boolean; everyMs?: number } {
  if (ticker) return { started: false };
  if (process.env.ICELAND_LIVE_CAMERA_RECORDER !== "1") return { started: false };

  const configured = Number(process.env.ICELAND_LIVE_CAMERA_RECORDER_SECONDS);
  // Never faster than a minute: the cameras do not publish faster than that,
  // and a tighter loop would only ask Vegagerðin for pictures we already hold.
  const everyMs = Math.max(60, Number.isFinite(configured) ? configured : 120) * 1000;

  ticker = setInterval(() => {
    void recordWatchList().then((report) => {
      if (report.stored > 0) {
        console.info(
          `[camera-recorder] stored ${report.stored} of ${report.views} views near ` +
            `${report.focus.label ?? "the default view"} (${report.focus.reason})`,
        );
      }
    });
  }, everyMs);

  // Node keeps the process alive for a pending timer; this one must not be a
  // reason the process cannot exit.
  ticker.unref?.();

  return { started: true, everyMs };
}
