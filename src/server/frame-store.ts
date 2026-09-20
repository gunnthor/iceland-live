/**
 * A bounded reel of camera frames.
 *
 * ## Why this exists
 *
 * Vegagerðin's cameras publish stills, not video, and they publish only the
 * current one — there is no archive endpoint and no way to ask for the frame
 * from twenty minutes ago. So a viewer can only assemble a reel out of frames
 * somebody has already fetched, and a browser that has just opened the page
 * has fetched exactly one.
 *
 * That is the wrong way round for what these cameras are for. Nobody has the
 * page open for an hour *before* something happens. Keeping frames on the
 * server means the first person to look during unrest sees the preceding
 * stretch rather than a single picture, and everyone after them shares it.
 *
 * ## The one thing here that is not a cache
 *
 * Everything else this codebase stores can be fetched again. A camera frame
 * cannot: once the camera publishes its next picture the previous one is gone
 * upstream forever. That is why the frames go through a backend interface
 * (`frame-backend.ts`) with a durable implementation, rather than living only
 * in a temporary directory.
 *
 * ## State comes from the listing
 *
 * There is no index file. The capture time is in the key, so listing the
 * store *is* the index — which matters the moment two instances share a
 * bucket, where a read-modify-write index silently loses whichever instance
 * wrote first. Listings are memoised briefly, because a reel is read far more
 * often than it changes.
 *
 * ## Where the budget goes
 *
 * Slots are earned rather than handed out equally. A frame is only kept when
 * the picture changed, so a still camera's reel already reaches back hours
 * while a busy one burns the same slots in under one — the camera showing the
 * most would get the shortest record. Each view is instead given as many
 * slots as it takes to reach back a couple of hours, between a floor everyone
 * gets and a ceiling nobody passes. See `earnedFrameCap`.
 *
 * ## What it is not
 *
 * Not an archive, and never presented as one. It holds what this deployment
 * happens to have fetched, which depends on whether anyone was watching or
 * the recorder was pointed here — so a gap in the reel is a gap in attention,
 * not a gap in the weather, and the interface says so.
 */

import { createHash } from "node:crypto";
import { changedFraction, decodeLuma, type Luma } from "./jpeg-dc";
import { localFrameBackend } from "./frame-backend-local";
import { createS3FrameBackend, s3ConfigFromEnv } from "./frame-backend-s3";
import {
  resetBackendWarnings,
  warnOnce,
  type BackendFrame,
  type FrameBackend,
} from "./frame-backend";

/**
 * The reel every view gets, whatever it is showing.
 *
 * A view that rarely changes never needs more: since the previous frame is
 * compared before a slot is spent, thirty kept frames already stretch across
 * the whole retention window. This is the floor of the earned cap, so a quiet
 * camera keeps exactly what it keeps today.
 */
export const BASE_FRAMES_PER_VIEW = 30;

/**
 * The most any one view can earn.
 *
 * At the fastest these cameras publish — about once a minute for a busy urban
 * view — this is two hours of record, so nothing on the road network should
 * reach it. It is a ceiling rather than a target: whatever a camera or a
 * crowd of viewers turns out to do, one view cannot quietly become the store.
 */
export const MAX_FRAMES_PER_VIEW = 120;

/**
 * What the global byte sweep must leave a view.
 *
 * Earned caps make the byte budget bind far more often than a flat thirty
 * did, and the sweep drops the oldest frames wherever they are — which is
 * mostly the quiet cameras, by construction. Without a floor, "spend the
 * budget where something is happening" would end as "one camera takes it
 * all", and somebody watching anything else would be left on a single
 * picture. Bounded by `MAX_VIEWS`, so the floor's own footprint is small.
 */
export const FLOOR_FRAMES_PER_VIEW = 3;

/** Views kept at once. Beyond this the one with the oldest newest frame goes. */
export const MAX_VIEWS = 40;

/** A single frame is never this large; anything bigger is not a camera still. */
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** How long a listing is trusted before it is fetched again. */
const LISTING_TTL_MS = 20_000;

/**
 * How much of a frame must differ from the last one kept, as a fraction of
 * its 8×8 blocks, for the new one to be worth a slot.
 *
 * A camera watching an empty road publishes a new file every minute or so
 * whether or not anything happened. Storing thirty of those spends a reel on
 * nothing and leaves less budget for cameras that are showing something.
 *
 * Measured on live cameras rather than guessed:
 *
 * | scene                                   | blocks changed |
 * |-----------------------------------------|----------------|
 * | rural road, nothing moving, 6 min apart | 0.02%          |
 * | one vehicle crossing the view           | 1.75% – 2.60%  |
 * | busy urban traffic                      | 24% – 36%      |
 * | an entirely different camera            | 77%            |
 *
 * A quarter of one percent sits an order of magnitude above the still scene
 * and an order of magnitude below the smallest real change, which is about as
 * much daylight as a threshold gets.
 *
 * A frame that cannot be compared is always kept: "we do not know whether
 * anything changed" must never be read as "nothing changed".
 */
function changeThreshold(): number {
  const configured = Number(process.env.ICELAND_LIVE_FRAME_CHANGE_THRESHOLD);
  return Number.isFinite(configured) && configured >= 0 ? configured : 0.0025;
}

/**
 * How long frames are kept.
 *
 * Six hours suits a temporary directory, where nothing survives anyway. With
 * a durable backend a longer window is the point of having one, so it is
 * configurable rather than a constant someone has to come here and edit.
 */
function retentionMs(): number {
  const configured = Number(process.env.ICELAND_LIVE_FRAME_RETENTION_HOURS);
  const hours = Number.isFinite(configured) && configured > 0 ? configured : 6;
  return hours * 3_600_000;
}

/**
 * How far back a reel should reach, which is what a view's slots are spent
 * buying. Two hours covers the approach to an event rather than its last
 * minutes, and sits inside the default retention window so the two bounds do
 * not argue.
 */
function targetReelMs(): number {
  const configured = Number(process.env.ICELAND_LIVE_FRAME_TARGET_HOURS);
  const hours = Number.isFinite(configured) && configured > 0 ? configured : 2;
  return hours * 3_600_000;
}

/** Total bytes across every view. Roughly 40 views × 30 frames × 40 KB. */
function budgetBytes(): number {
  const configured = Number(process.env.ICELAND_LIVE_FRAME_BUDGET_MB);
  return (Number.isFinite(configured) && configured > 0 ? configured : 64) * 1024 * 1024;
}

export type StoredFrame = { at: number; bytes: number };

let backend: FrameBackend | null = null;

/**
 * The backend in use.
 *
 * Resolved on first use rather than at import, so the environment can be set
 * after this module loads — which is also what makes it testable.
 */
export function frameBackend(): FrameBackend {
  if (backend) return backend;
  const s3 = s3ConfigFromEnv();
  backend = s3 ? createS3FrameBackend(s3) : localFrameBackend;
  if (s3) console.info(`[frame-store] using the ${backend.name} backend`);
  return backend;
}

/** Memoised listings. Small, and dropped wholesale rather than expired one by one. */
const listings = new Map<string, { frames: StoredFrame[]; fetchedAt: number }>();
let allListing: { views: Map<string, StoredFrame[]>; fetchedAt: number } | null = null;

/**
 * Capture times we have already stored, per view.
 *
 * A pure optimisation on top of the listing: it lets a repeat poll be
 * recognised without a round trip. Correctness does not depend on it, because
 * the capture time is the key — the same picture always writes the same
 * object, whichever instance handles it.
 */
const seen = new Map<string, Set<number>>();

/**
 * Upstream validators we have already seen, per view.
 *
 * The capture time does the real work, but a camera that publishes no
 * `Last-Modified` falls back to our clock, and every poll of one would then
 * look like a new picture and fill its quota with copies. `ETag` catches
 * that. Per instance and advisory only — the worst a cold process does is
 * store one extra frame before the times start matching again.
 */
const tags = new Map<string, Map<string, number>>();

/**
 * The brightness map of the last frame stored for each view.
 *
 * Per instance and not persisted: a restarted process simply keeps the first
 * frame it sees, which is the right outcome anyway.
 */
const lastLuma = new Map<string, Luma>();

/**
 * A stable, filesystem- and key-safe name for a camera view.
 *
 * Derived from the source URL by hash rather than taken from a request, so
 * nothing a caller sends can name a path or an object. Hex only, fixed
 * length: the value is used as a directory name, as part of an object key,
 * and as something the browser sends back.
 */
export function viewKeyFor(sourceUrl: string): string {
  return createHash("sha256").update(sourceUrl).digest("hex").slice(0, 16);
}

/** Whether a string could be a key this module produced. */
export function isViewKey(value: string): boolean {
  return /^[0-9a-f]{16}$/.test(value);
}

function sortFrames(frames: BackendFrame[]): StoredFrame[] {
  return [...frames].sort((a, b) => a.at - b.at);
}

async function listView(view: string, now: number): Promise<StoredFrame[]> {
  const cached = listings.get(view);
  if (cached && now - cached.fetchedAt < LISTING_TTL_MS) return cached.frames;

  let frames: StoredFrame[];
  try {
    frames = sortFrames(await frameBackend().list(view));
  } catch (error) {
    warnOnce(`list ${view}`, error);
    frames = cached?.frames ?? [];
  }

  listings.set(view, { frames, fetchedAt: now });
  seen.set(view, new Set(frames.map((frame) => frame.at)));
  return frames;
}

async function listEverything(now: number): Promise<Map<string, StoredFrame[]>> {
  if (allListing && now - allListing.fetchedAt < LISTING_TTL_MS) return allListing.views;

  let views = new Map<string, StoredFrame[]>();
  try {
    const raw = await frameBackend().listAll();
    for (const [view, frames] of raw) views.set(view, sortFrames(frames));
  } catch (error) {
    warnOnce("list all", error);
    views = allListing?.views ?? new Map();
  }

  allListing = { views, fetchedAt: now };
  return views;
}

function forget(view: string): void {
  listings.delete(view);
  allListing = null;
  seen.delete(view);
  tags.delete(view);
}

async function removeFrame(view: string, at: number): Promise<void> {
  try {
    await frameBackend().remove(view, at);
  } catch (error) {
    warnOnce("delete", error);
  }
}

/**
 * How many slots a view has earned.
 *
 * ## The thing being bought
 *
 * Not "how busy is this camera" scored out of ten, but a length of record.
 * Every view is trying to reach back `targetReelMs`; what differs is how many
 * frames that costs. A junction under traffic changes on nearly every poll
 * and needs sixty of them to cover two hours; a mountain road changes a
 * handful of times all morning and covers the same two hours with four. The
 * cap is simply the price of the same reel, which is why this returns a
 * count rather than a weight.
 *
 * Frame density only became a measure of the scene once frames were compared
 * before being kept. While every poll was stored it measured how often *we
 * asked*; now that a slot is spent only when the picture changed, it measures
 * how often the picture changed — the camera's behaviour rather than ours.
 *
 * It is a lower bound on activity, not a measurement of it: a camera nobody
 * polls cannot show that it changed. That is the right failure. A view nobody
 * is watching and the recorder is not pointed at has no reel worth extending.
 *
 * ## Why the busiest window and not the most recent one
 *
 * Taken over the last two hours, a view would lose its earned slots as soon
 * as things went quiet — trimming the busy stretch precisely when it had
 * become the interesting part of the reel. Taking the densest window the view
 * still holds lets it keep what it earned until those frames age out of the
 * retention window on their own.
 *
 * ## Bounds
 *
 * Never below `BASE_FRAMES_PER_VIEW`, so no view loses anything it holds
 * today, and never above `MAX_FRAMES_PER_VIEW`. Frames must be sorted oldest
 * first, as everything in this module keeps them.
 */
export function earnedFrameCap(
  frames: readonly StoredFrame[],
  targetMs: number = targetReelMs(),
): number {
  // Below the floor the answer cannot change, and this runs on every write.
  if (frames.length <= BASE_FRAMES_PER_VIEW) return BASE_FRAMES_PER_VIEW;

  let widest = 0;
  let start = 0;
  for (let end = 0; end < frames.length; end += 1) {
    const last = frames[end] as StoredFrame;
    while (last.at - (frames[start] as StoredFrame).at > targetMs) start += 1;
    widest = Math.max(widest, end - start + 1);
  }

  return Math.min(Math.max(widest, BASE_FRAMES_PER_VIEW), MAX_FRAMES_PER_VIEW);
}

/**
 * Brings the store back inside its bounds.
 *
 * Age first, then the per-view cap, then whole views, then the byte budget —
 * so the cheap structural limits do the work and the global sweep only runs
 * when they were not enough.
 */
async function enforceBounds(now: number): Promise<void> {
  const views = new Map(await listEverything(now));
  const retention = retentionMs();
  let changed = false;

  for (const [view, frames] of views) {
    const keep: StoredFrame[] = [];
    for (const frame of frames) {
      if (now - frame.at > retention) {
        await removeFrame(view, frame.at);
        changed = true;
        continue;
      }
      keep.push(frame);
    }

    /*
     * Measured after the age trim, so frames already past retention cannot
     * inflate the cap that decides what survives.
     */
    const cap = earnedFrameCap(keep);
    while (keep.length > cap) {
      const oldest = keep.shift();
      if (oldest) {
        await removeFrame(view, oldest.at);
        changed = true;
      }
    }

    if (keep.length === 0) views.delete(view);
    else views.set(view, keep);
  }

  /*
   * Too many views: the one whose newest frame is oldest goes first — it is
   * the camera nobody is watching and the recorder is not pointed at.
   */
  while (views.size > MAX_VIEWS) {
    let stalest: string | null = null;
    let stalestAt = Infinity;
    for (const [view, frames] of views) {
      const newest = frames[frames.length - 1]?.at ?? 0;
      if (newest < stalestAt) {
        stalestAt = newest;
        stalest = view;
      }
    }
    if (!stalest) break;
    for (const frame of views.get(stalest) ?? []) await removeFrame(stalest, frame.at);
    views.delete(stalest);
    changed = true;
  }

  const budget = budgetBytes();
  const total = () => {
    let sum = 0;
    for (const frames of views.values()) for (const frame of frames) sum += frame.bytes;
    return sum;
  };

  /*
   * Over budget: drop the oldest frames wherever they are, rather than
   * emptying one view. A reel thinned from its far end everywhere still shows
   * the recent past for every camera someone is watching; sacrificing one
   * camera entirely would leave a viewer staring at a single frame while
   * another camera nobody has open keeps a full hour.
   *
   * Every view keeps `FLOOR_FRAMES_PER_VIEW` whatever the budget says. Oldest
   * first is the right order, but it is not a neutral one once slots are
   * earned: a quiet view's frames are the old ones by definition, so an
   * unguarded sweep would fund the busy cameras by emptying every other. The
   * floor can therefore hold the store above a budget set smaller than a few
   * frames for every view at once, which `MAX_VIEWS` keeps small.
   */
  let over = total() - budget;
  if (over > 0) {
    const everything = [...views.entries()]
      .flatMap(([view, frames]) => frames.map((frame) => ({ view, frame })))
      .sort((a, b) => a.frame.at - b.frame.at);

    for (const { view, frame } of everything) {
      if (over <= 0) break;
      const frames = views.get(view);
      if (!frames || frames.length <= FLOOR_FRAMES_PER_VIEW) continue;
      views.set(
        view,
        frames.filter((item) => item.at !== frame.at),
      );
      await removeFrame(view, frame.at);
      over -= frame.bytes;
      changed = true;
    }
  }

  if (changed) {
    listings.clear();
    allListing = { views, fetchedAt: now };
    seen.clear();
    // A frame we just trimmed must be storable again, so its validator has to
    // stop counting as one we already hold.
    tags.clear();
  }
}

export type RecordResult = "stored" | "duplicate" | "unchanged" | "skipped";

/**
 * Files a frame away, if it is one we do not already hold.
 *
 * `takenAt` comes from the camera's own `last-modified` header rather than
 * from our clock: two viewers polling on different schedules would otherwise
 * store the same picture twice under different times, and the reel would
 * claim a frame rate the camera does not have. It is also what makes writing
 * idempotent across instances — the same picture is always the same key.
 *
 * `tag` is the upstream `ETag`, used only to recognise a repeat from a camera
 * that publishes no `Last-Modified`.
 *
 * A frame that is a genuinely new publication but looks the same as the last
 * one stored is reported as `unchanged` and not kept. That is a different
 * answer from `duplicate`, which means the camera republished nothing at all.
 */
export async function recordFrame(
  view: string,
  body: Uint8Array,
  options: { takenAt: number; tag?: string | null; now?: number },
): Promise<RecordResult> {
  if (!isViewKey(view)) return "skipped";
  if (body.byteLength === 0 || body.byteLength > MAX_FRAME_BYTES) return "skipped";

  const now = options.now ?? Date.now();
  // A camera clock ahead of ours, or a missing header, must not file a frame
  // into the future where it would pin the reel's live edge forever.
  const takenAt =
    Number.isFinite(options.takenAt) && options.takenAt > 0 && options.takenAt <= now
      ? Math.round(options.takenAt)
      : now;

  const tag = options.tag ?? null;
  if (tag !== null && tags.get(view)?.has(tag)) return "duplicate";
  if (seen.get(view)?.has(takenAt)) return "duplicate";

  const frames = await listView(view, now);
  if (frames.some((frame) => frame.at === takenAt)) return "duplicate";

  /*
   * A new file, but is it a new picture? Compared before writing, so an
   * unchanged frame costs a decode rather than a write and a slot.
   *
   * Only when we already hold something: the first frame of a view is always
   * worth keeping, and so is one we cannot decode.
   */
  const luma = decodeLuma(body);
  const previous = lastLuma.get(view);
  if (luma && previous && frames.length > 0) {
    const difference = changedFraction(previous, luma);
    if (difference !== null && difference < changeThreshold()) {
      // Remembered as the new baseline even though it was not kept, so a
      // scene that drifts slowly is not held against a frame from an hour ago.
      lastLuma.set(view, luma);
      return "unchanged";
    }
  }

  try {
    await frameBackend().put(view, takenAt, body);
  } catch (error) {
    warnOnce("write", error);
    return "skipped";
  }

  // Patched rather than invalidated: the frame just written is known, and a
  // reader a moment later should see it without waiting for a fresh listing.
  const updated = sortFrames([...frames, { at: takenAt, bytes: body.byteLength }]);
  listings.set(view, { frames: updated, fetchedAt: now });
  if (allListing) allListing.views.set(view, updated);

  if (luma) lastLuma.set(view, luma);

  let times = seen.get(view);
  if (!times) seen.set(view, (times = new Set()));
  times.add(takenAt);

  if (tag !== null) {
    let known = tags.get(view);
    if (!known) tags.set(view, (known = new Map()));
    known.set(tag, takenAt);
  }

  await enforceBounds(now);
  return "stored";
}

/** The frames held for a view, oldest first. Empty when we hold none. */
export async function readReel(view: string, now = Date.now()): Promise<StoredFrame[]> {
  if (!isViewKey(view)) return [];
  const retention = retentionMs();
  return (await listView(view, now)).filter((frame) => now - frame.at <= retention);
}

/** One stored frame's bytes, or `null` when we do not hold it. */
export async function readFrame(view: string, at: number): Promise<Buffer | null> {
  if (!isViewKey(view) || !Number.isInteger(at)) return null;
  return frameBackend().get(view, at);
}

/** Test seam: forgets the memoised listings and the chosen backend. */
export function resetFrameStoreForTests(): void {
  listings.clear();
  allListing = null;
  seen.clear();
  tags.clear();
  lastLuma.clear();
  backend = null;
  // Warnings are logged once per scope for the life of the process; a test
  // asserting degraded behaviour should not be silenced by an earlier one.
  resetBackendWarnings();
}

/** Diagnostics: what the store is currently holding. */
export async function frameStoreStats(now = Date.now()): Promise<{
  backend: string;
  views: number;
  frames: number;
  bytes: number;
}> {
  const views = await listEverything(now);
  let frames = 0;
  let bytes = 0;
  for (const list of views.values()) {
    frames += list.length;
    for (const frame of list) bytes += frame.bytes;
  }
  return { backend: frameBackend().name, views: views.size, frames, bytes };
}

// `forget` is retained for callers that need to drop a view's memoised
// listing; nothing does yet, but the listing cache is the one piece of state
// here that can go stale in a way a caller might need to correct.
export { forget as forgetCachedListing };
