/**
 * A bounded, disk-backed reel of camera frames.
 *
 * ## Why this exists
 *
 * Vegagerðin's cameras publish stills, not video, and they publish only the
 * current one — there is no archive endpoint and no way to ask for the frame
 * from twenty minutes ago. So a viewer can only assemble a reel out of frames
 * it has fetched itself, and a browser that has just opened the page has
 * fetched exactly one.
 *
 * That is the wrong way round for what these cameras are for. Nobody has the
 * page open for an hour *before* something happens. Recording frames on the
 * server means the first person to look during unrest sees the preceding
 * stretch rather than a single picture, and everyone after them shares it.
 *
 * ## What it is not
 *
 * Not an archive, and never presented as one. It holds what this server
 * happens to have fetched, which depends entirely on whether anyone was
 * watching — so a gap in the reel is a gap in attention, not a gap in the
 * weather, and the interface says so.
 *
 * It is also per-instance. On a platform like Vercel only `os.tmpdir()` is
 * writable, it is not shared between instances, and it does not survive
 * indefinitely. Two readers may therefore see different reels. That is
 * acceptable for something that is explicitly "frames we happen to hold", and
 * it is why every operation here is best-effort and every failure is
 * swallowed: a recorder that can break the live image it is recording is
 * worse than no recorder.
 *
 * ## Bounds
 *
 * Frames are roughly 30–60 KB each. The budget below is a hard ceiling on the
 * total, enforced by evicting the oldest frames across every view, so an
 * unbounded number of cameras being watched cannot fill the disk.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheDirectory } from "./disk-cache";

/** Frames kept per camera view. At ~2 minutes apart, an hour of pictures. */
export const MAX_FRAMES_PER_VIEW = 30;

/** Views recorded at once. Beyond this the least recently written is dropped. */
export const MAX_VIEWS = 40;

/** Total bytes across every view. Roughly 40 views × 30 frames × 40 KB. */
function budgetBytes(): number {
  const configured = Number(process.env.ICELAND_LIVE_FRAME_BUDGET_MB);
  return (Number.isFinite(configured) && configured > 0 ? configured : 64) * 1024 * 1024;
}

/** A single frame is never this large; anything bigger is not a camera still. */
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** Frames older than this are dropped on sight, however much room there is. */
const MAX_FRAME_AGE_MS = 6 * 60 * 60 * 1000;

export type StoredFrame = {
  /** When the picture was taken, from the camera's own `last-modified`. */
  at: number;
  bytes: number;
  /** The upstream validator, used to recognise a frame we already hold. */
  tag: string | null;
};

type ViewIndex = {
  frames: StoredFrame[];
  /** Last time anything was written for this view, for view-level eviction. */
  touchedAt: number;
};

/**
 * The index lives in memory and is mirrored to disk.
 *
 * In memory because every read of it is on the path of serving an image, and
 * on disk so a restarted process finds the frames it already wrote instead of
 * orphaning them.
 */
const views = new Map<string, ViewIndex>();
let loaded = false;

const INDEX_VERSION = 1;

function root(): string {
  return join(cacheDirectory(), "frames");
}

function viewDirectory(key: string): string {
  return join(root(), key);
}

function framePath(key: string, at: number): string {
  return join(viewDirectory(key), `${at}.jpg`);
}

function indexPath(): string {
  return join(root(), "index.json");
}

/** Logged once, so a read-only filesystem does not fill the log. */
const warned = new Set<string>();
function warnOnce(scope: string, error: unknown): void {
  if (warned.has(scope)) return;
  warned.add(scope);
  console.warn(`[frame-store] ${scope}: ${String(error)} (continuing without it)`);
}

/**
 * A stable, filesystem-safe key for a camera view.
 *
 * Derived from the source URL by hash rather than taken from a request, so
 * nothing a caller sends can name a path. Hex only, fixed length: the key is
 * used as a directory name and as a value the browser sends back.
 */
export function viewKeyFor(sourceUrl: string): string {
  return createHash("sha256").update(sourceUrl).digest("hex").slice(0, 16);
}

/** Whether a string could be a key this module produced. */
export function isViewKey(value: string): boolean {
  return /^[0-9a-f]{16}$/.test(value);
}

async function loadIndex(): Promise<void> {
  if (loaded) return;
  loaded = true;

  try {
    const raw = await readFile(indexPath(), "utf8");
    const parsed = JSON.parse(raw) as {
      version?: number;
      views?: Record<string, ViewIndex>;
    };
    if (parsed.version !== INDEX_VERSION || !parsed.views) return;

    for (const [key, entry] of Object.entries(parsed.views)) {
      if (!isViewKey(key) || !Array.isArray(entry.frames)) continue;
      views.set(key, {
        touchedAt: typeof entry.touchedAt === "number" ? entry.touchedAt : 0,
        frames: entry.frames.filter(
          (frame) => typeof frame?.at === "number" && typeof frame?.bytes === "number",
        ),
      });
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") warnOnce("index read", error);
  }
}

async function saveIndex(): Promise<void> {
  const payload = {
    version: INDEX_VERSION,
    views: Object.fromEntries(views),
  };
  const target = indexPath();
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await mkdir(root(), { recursive: true });
    await writeFile(temporary, JSON.stringify(payload), "utf8");
    await rename(temporary, target);
  } catch (error) {
    warnOnce("index write", error);
  }
}

async function removeFrame(key: string, at: number): Promise<void> {
  try {
    await rm(framePath(key, at), { force: true });
  } catch (error) {
    warnOnce("frame delete", error);
  }
}

/** Total bytes currently indexed. */
function totalBytes(): number {
  let total = 0;
  for (const entry of views.values()) {
    for (const frame of entry.frames) total += frame.bytes;
  }
  return total;
}

/**
 * Brings the store back inside its bounds.
 *
 * Age first, then the per-view cap, then whole views, then the byte budget —
 * so the cheap structural limits do the work and the global sweep only runs
 * when they were not enough.
 */
async function enforceBounds(now: number): Promise<void> {
  for (const [key, entry] of views) {
    const keep: StoredFrame[] = [];
    for (const frame of entry.frames) {
      if (now - frame.at > MAX_FRAME_AGE_MS) {
        await removeFrame(key, frame.at);
        continue;
      }
      keep.push(frame);
    }
    keep.sort((a, b) => a.at - b.at);

    while (keep.length > MAX_FRAMES_PER_VIEW) {
      const oldest = keep.shift();
      if (oldest) await removeFrame(key, oldest.at);
    }

    if (keep.length === 0) {
      views.delete(key);
      try {
        await rm(viewDirectory(key), { recursive: true, force: true });
      } catch (error) {
        warnOnce("view delete", error);
      }
      continue;
    }
    entry.frames = keep;
  }

  // Least recently written view goes first: it is the one nobody is watching.
  while (views.size > MAX_VIEWS) {
    let oldestKey: string | null = null;
    let oldestTouch = Infinity;
    for (const [key, entry] of views) {
      if (entry.touchedAt < oldestTouch) {
        oldestTouch = entry.touchedAt;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    views.delete(oldestKey);
    try {
      await rm(viewDirectory(oldestKey), { recursive: true, force: true });
    } catch (error) {
      warnOnce("view delete", error);
    }
  }

  const budget = budgetBytes();
  if (totalBytes() <= budget) return;

  /*
   * Over budget: drop the oldest frames wherever they are, rather than
   * emptying one view. A reel thinned from its far end everywhere still shows
   * the recent past for every camera someone is watching; sacrificing one
   * camera entirely would leave a viewer staring at a single frame while
   * another camera nobody has open keeps a full hour.
   */
  const everything = [...views.entries()]
    .flatMap(([key, entry]) => entry.frames.map((frame) => ({ key, frame })))
    .sort((a, b) => a.frame.at - b.frame.at);

  let over = totalBytes() - budget;
  for (const { key, frame } of everything) {
    if (over <= 0) break;
    const entry = views.get(key);
    // Never leave a view with nothing: a reel of one is still a live picture.
    if (!entry || entry.frames.length <= 1) continue;
    entry.frames = entry.frames.filter((item) => item.at !== frame.at);
    await removeFrame(key, frame.at);
    over -= frame.bytes;
  }
}

export type RecordResult = "stored" | "duplicate" | "skipped";

/**
 * Files a frame away, if it is one we do not already hold.
 *
 * `takenAt` comes from the camera's own `last-modified` header rather than
 * from our clock: two viewers polling on different schedules would otherwise
 * store the same picture twice under different times, and the reel would
 * claim a frame rate the camera does not have.
 */
export async function recordFrame(
  key: string,
  body: Uint8Array,
  options: { takenAt: number; tag: string | null; now?: number },
): Promise<RecordResult> {
  if (!isViewKey(key)) return "skipped";
  if (body.byteLength === 0 || body.byteLength > MAX_FRAME_BYTES) return "skipped";

  const now = options.now ?? Date.now();
  // A camera clock ahead of ours, or a missing header, must not file a frame
  // into the future where it would pin the reel's live edge forever.
  const takenAt =
    Number.isFinite(options.takenAt) && options.takenAt > 0 && options.takenAt <= now
      ? options.takenAt
      : now;

  await loadIndex();

  const entry = views.get(key) ?? { frames: [], touchedAt: 0 };

  const known = entry.frames.some(
    (frame) =>
      frame.at === takenAt || (options.tag !== null && frame.tag === options.tag),
  );
  if (known) {
    entry.touchedAt = now;
    views.set(key, entry);
    return "duplicate";
  }

  try {
    await mkdir(viewDirectory(key), { recursive: true });
    const target = framePath(key, takenAt);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, body);
    await rename(temporary, target);
  } catch (error) {
    warnOnce("frame write", error);
    return "skipped";
  }

  entry.frames = [...entry.frames, { at: takenAt, bytes: body.byteLength, tag: options.tag }]
    .sort((a, b) => a.at - b.at);
  entry.touchedAt = now;
  views.set(key, entry);

  await enforceBounds(now);
  await saveIndex();
  return "stored";
}

/** The frames held for a view, oldest first. Empty when we hold none. */
export async function readReel(key: string, now = Date.now()): Promise<StoredFrame[]> {
  if (!isViewKey(key)) return [];
  await loadIndex();
  const entry = views.get(key);
  if (!entry) return [];
  return entry.frames
    .filter((frame) => now - frame.at <= MAX_FRAME_AGE_MS)
    .sort((a, b) => a.at - b.at);
}

/** One stored frame's bytes, or `null` when we do not hold it. */
export async function readFrame(key: string, at: number): Promise<Buffer | null> {
  if (!isViewKey(key) || !Number.isInteger(at)) return null;
  await loadIndex();

  const entry = views.get(key);
  if (!entry?.frames.some((frame) => frame.at === at)) return null;

  try {
    return await readFile(framePath(key, at));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") warnOnce("frame read", error);
    return null;
  }
}

/** Test seam: forgets everything in memory so a fresh directory can be used. */
export function resetFrameStoreForTests(): void {
  views.clear();
  loaded = false;
  warned.clear();
}

/** Diagnostics: what the store is currently holding. */
export async function frameStoreStats(): Promise<{
  views: number;
  frames: number;
  bytes: number;
  onDisk: number | null;
}> {
  await loadIndex();
  let frames = 0;
  for (const entry of views.values()) frames += entry.frames.length;

  let onDisk: number | null = null;
  try {
    const directories = await readdir(root(), { withFileTypes: true });
    let total = 0;
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      const files = await readdir(join(root(), directory.name));
      for (const file of files) {
        total += (await stat(join(root(), directory.name, file))).size;
      }
    }
    onDisk = total;
  } catch {
    onDisk = null;
  }

  return { views: views.size, frames, bytes: totalBytes(), onDisk };
}
