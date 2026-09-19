import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { cacheDirectory, readDiskCache, writeDiskCache } from "./disk-cache";

/** The module resolves its directory per call, so this is all the setup needed. */
function useDirectory(path: string): void {
  process.env.ICELAND_LIVE_CACHE_DIR = path;
}

describe("disk cache", () => {
  let directory: string;
  const original = process.env.ICELAND_LIVE_CACHE_DIR;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "iceland-live-test-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    if (original === undefined) delete process.env.ICELAND_LIVE_CACHE_DIR;
    else process.env.ICELAND_LIVE_CACHE_DIR = original;
  });

  it("round-trips a value", async () => {
    useDirectory(directory);
    expect(cacheDirectory()).toBe(directory);
    await writeDiskCache("thing", 1, { hello: "world" });
    expect(await readDiskCache("thing", 1, 60_000)).toEqual({ hello: "world" });
  });

  it("returns null when nothing has been written", async () => {
    useDirectory(directory);
    expect(await readDiskCache("absent", 1, 60_000)).toBeNull();
  });

  it("ignores a value written under a different version", async () => {
    // A shape change must not be read back as if it were the current shape.
    useDirectory(directory);
    await writeDiskCache("thing", 1, { old: true });
    expect(await readDiskCache("thing", 2, 60_000)).toBeNull();
  });

  it("ignores a value older than the requested age", async () => {
    useDirectory(directory);
    await writeDiskCache("thing", 1, { hello: "world" });
    expect(await readDiskCache("thing", 1, -1)).toBeNull();
  });

  it("survives a corrupt file rather than throwing", async () => {
    useDirectory(directory);
    await writeDiskCache("thing", 1, { hello: "world" });
    await writeFile(join(directory, "thing.json"), "{ not json", "utf8");
    expect(await readDiskCache("thing", 1, 60_000)).toBeNull();
  });

  it("survives an unwritable directory rather than throwing", async () => {
    // A read-only filesystem is the serverless case; it must degrade silently.
    // A regular file standing in for the directory fails immediately with
    // ENOTDIR, which is the same code path as EACCES or EROFS.
    const blocker = join(directory, "not-a-directory");
    await writeFile(blocker, "", "utf8");
    useDirectory(join(blocker, "cache"));

    await expect(writeDiskCache("thing", 1, { hello: "world" })).resolves.toBeUndefined();
    expect(await readDiskCache("thing", 1, 60_000)).toBeNull();
  });

  it("keeps keys separate and sanitises them into filenames", async () => {
    useDirectory(directory);
    await writeDiskCache("a/../b", 1, { which: "first" });
    await writeDiskCache("plain", 1, { which: "second" });
    expect(await readDiskCache("plain", 1, 60_000)).toEqual({ which: "second" });
  });
});
