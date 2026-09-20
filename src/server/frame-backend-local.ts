/**
 * Frames on the local filesystem.
 *
 * The default, and the right answer wherever the process has a real volume.
 * On serverless it still helps — repeated cold starts on a warm instance read
 * locally instead of re-fetching — but it is not durable there, which is what
 * the object-store backend is for.
 *
 * Layout is `<dir>/frames/<view>/<capture ms>.jpg`. The capture time is the
 * filename, so a directory listing is the index; see `frame-backend.ts` for
 * why there is no index file.
 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheDirectory } from "./disk-cache";
import { warnOnce, type BackendFrame, type FrameBackend } from "./frame-backend";

function root(): string {
  return join(cacheDirectory(), "frames");
}

function viewDirectory(view: string): string {
  return join(root(), view);
}

function framePath(view: string, at: number): string {
  return join(viewDirectory(view), `${at}.jpg`);
}

/** `1789857966000.jpg` -> 1789857966000, or null for anything else. */
function timeFromName(name: string): number | null {
  const match = /^(\d+)\.jpg$/.exec(name);
  if (!match?.[1]) return null;
  const at = Number(match[1]);
  return Number.isSafeInteger(at) ? at : null;
}

async function listDirectory(view: string): Promise<BackendFrame[]> {
  let names: string[];
  try {
    names = await readdir(viewDirectory(view));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    // A view nobody has recorded is the ordinary case, not a problem.
    if (code !== "ENOENT" && code !== "ENOTDIR") warnOnce(`list ${view}`, error);
    return [];
  }

  const frames: BackendFrame[] = [];
  for (const name of names) {
    const at = timeFromName(name);
    if (at === null) continue;
    try {
      frames.push({ at, bytes: (await stat(join(viewDirectory(view), name))).size });
    } catch {
      // Removed between the listing and the stat; simply not there.
    }
  }
  return frames;
}

export const localFrameBackend: FrameBackend = {
  name: "local",

  async put(view, at, body) {
    await mkdir(viewDirectory(view), { recursive: true });
    const target = framePath(view, at);
    // Written aside and renamed, so a concurrent reader sees the whole file
    // or no file, never a half-written one.
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, body);
    await rename(temporary, target);
  },

  async get(view, at) {
    try {
      return await readFile(framePath(view, at));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") warnOnce(`read ${view}`, error);
      return null;
    }
  },

  async remove(view, at) {
    try {
      await rm(framePath(view, at), { force: true });
    } catch (error) {
      warnOnce("delete", error);
    }
  },

  list: listDirectory,

  async listAll() {
    const all = new Map<string, BackendFrame[]>();

    let entries;
    try {
      entries = await readdir(root(), { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") warnOnce("list all", error);
      return all;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const frames = await listDirectory(entry.name);
      if (frames.length > 0) all.set(entry.name, frames);
    }
    return all;
  },
};
