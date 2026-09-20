/**
 * A best-effort disk cache for expensive derived data.
 *
 * ## What this is for
 *
 * The year of region history costs one 5 MB upstream fetch and a parse of
 * ~35,000 rows. In memory that is paid once a day. On a cold start it is paid
 * again, and until it completes every observation loses its comparison
 * sentence. Writing the reduced result to disk makes a cold start read ~86 KB
 * of local JSON instead.
 *
 * ## What it is not
 *
 * It is not a source of truth and never the only copy. Every caller must work
 * when it is empty, unreadable, or when the filesystem is read-only. Failures
 * are logged once and swallowed — a cache that can take down the thing it is
 * accelerating is worse than no cache.
 *
 * ## On serverless
 *
 * Only `os.tmpdir()` is writable on platforms like Vercel, and it is per
 * instance and not guaranteed to survive. That is still useful — it turns
 * repeated cold starts on a warm instance into local reads — but it is why
 * this is an accelerator rather than storage. Set `ICELAND_LIVE_CACHE_DIR` to
 * a persistent volume when one exists.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { envOr } from "@/lib/env";

/**
 * Resolved per call rather than at import, so the environment can be set after
 * this module is loaded — which is also what makes it testable.
 */
function directory(): string {
  // Blank counts as unset: an empty value here would root the cache at the
  // process's working directory rather than anywhere anyone intended.
  return envOr(process.env.ICELAND_LIVE_CACHE_DIR, join(tmpdir(), "iceland-live-cache"));
}

/** Logged once per key so a read-only filesystem does not spam the log. */
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[disk-cache] ${message}`);
}

type Envelope<T> = {
  /** Bumped when the stored shape changes, so old files are ignored. */
  version: number;
  storedAt: number;
  value: T;
};

function pathFor(key: string): string {
  // Keys are internal constants, but keep the filename derivation total anyway:
  // anything outside this character set becomes an underscore, so a key can
  // never escape the cache directory.
  return join(directory(), `${key.replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

/**
 * Reads a cached value, or `null` when absent, stale, corrupt or unreadable.
 *
 * `maxAgeMs` is applied here rather than by the caller so a stale file can
 * never be mistaken for a fresh one.
 */
export async function readDiskCache<T>(
  key: string,
  version: number,
  maxAgeMs: number,
): Promise<T | null> {
  try {
    const raw = await readFile(pathFor(key), "utf8");
    const envelope = JSON.parse(raw) as Envelope<T>;

    if (envelope.version !== version) return null;
    if (typeof envelope.storedAt !== "number") return null;
    if (Date.now() - envelope.storedAt > maxAgeMs) return null;

    return envelope.value;
  } catch (error) {
    // A missing file is the normal cold-start case, not a problem.
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      warnOnce(`read:${key}`, `could not read ${key}: ${String(error)}`);
    }
    return null;
  }
}

/**
 * Writes a value, via a temporary file and a rename.
 *
 * The rename is what makes a concurrent reader safe: it either sees the old
 * complete file or the new complete file, never a half-written one.
 */
export async function writeDiskCache<T>(
  key: string,
  version: number,
  value: T,
): Promise<void> {
  const envelope: Envelope<T> = { version, storedAt: Date.now(), value };
  const target = pathFor(key);
  const temporary = `${target}.${process.pid}.tmp`;

  try {
    await mkdir(directory(), { recursive: true });
    await writeFile(temporary, JSON.stringify(envelope), "utf8");
    await rename(temporary, target);
  } catch (error) {
    warnOnce(`write:${key}`, `could not write ${key} (continuing without it): ${String(error)}`);
  }
}

/** Exposed for diagnostics and tests. */
export function cacheDirectory(): string {
  return directory();
}
