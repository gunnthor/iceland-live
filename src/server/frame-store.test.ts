import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  MAX_FRAMES_PER_VIEW,
  MAX_VIEWS,
  frameStoreStats,
  isViewKey,
  readFrame,
  readReel,
  recordFrame,
  resetFrameStoreForTests,
  viewKeyFor,
} from "./frame-store";

const CAMERA = "https://www.vegagerdin.is/vgdata/vefmyndavelar/gighaed_1.jpg";
const OTHER = "https://www.vegagerdin.is/vgdata/vefmyndavelar/gighaed_2.jpg";

/** A stand-in for a JPEG. Only its length matters to the store. */
function frame(size = 1024, fill = 0x41): Uint8Array {
  return new Uint8Array(size).fill(fill);
}

const NOW = Date.parse("2026-09-19T22:00:00Z");

describe("frame store", () => {
  let directory: string;
  const original = process.env.ICELAND_LIVE_CACHE_DIR;
  const originalBudget = process.env.ICELAND_LIVE_FRAME_BUDGET_MB;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "iceland-live-frames-"));
    process.env.ICELAND_LIVE_CACHE_DIR = directory;
    resetFrameStoreForTests();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    if (original === undefined) delete process.env.ICELAND_LIVE_CACHE_DIR;
    else process.env.ICELAND_LIVE_CACHE_DIR = original;
    if (originalBudget === undefined) delete process.env.ICELAND_LIVE_FRAME_BUDGET_MB;
    else process.env.ICELAND_LIVE_FRAME_BUDGET_MB = originalBudget;
  });

  describe("keys", () => {
    it("derives a fixed-length hex key from the source URL", () => {
      const key = viewKeyFor(CAMERA);
      expect(isViewKey(key)).toBe(true);
      expect(viewKeyFor(CAMERA)).toBe(key);
      expect(viewKeyFor(OTHER)).not.toBe(key);
    });

    it("rejects anything that is not a key it would have produced", () => {
      // The key names a directory, so nothing outside this shape gets near one.
      expect(isViewKey("../../etc")).toBe(false);
      expect(isViewKey("")).toBe(false);
      expect(isViewKey("ABCDEF0123456789")).toBe(false);
      expect(isViewKey("0123456789abcde")).toBe(false);
    });

    it("refuses to record or read under a key of the wrong shape", async () => {
      expect(await recordFrame("../evil", frame(), { takenAt: NOW, tag: null })).toBe("skipped");
      expect(await readReel("../evil")).toEqual([]);
      expect(await readFrame("../evil", NOW)).toBeNull();
    });
  });

  describe("recording", () => {
    it("stores a frame and reads it back", async () => {
      const key = viewKeyFor(CAMERA);
      expect(await recordFrame(key, frame(2048), { takenAt: NOW, tag: '"abc"', now: NOW })).toBe(
        "stored",
      );

      const reel = await readReel(key, NOW);
      expect(reel).toHaveLength(1);
      expect(reel[0]).toMatchObject({ at: NOW, bytes: 2048 });
      expect((await readFrame(key, NOW))?.byteLength).toBe(2048);
    });

    it("recognises the same picture arriving again", async () => {
      // Two viewers polling on different schedules fetch the same still; it
      // must not appear twice in the reel under two different times.
      const key = viewKeyFor(CAMERA);
      await recordFrame(key, frame(), { takenAt: NOW, tag: '"abc"', now: NOW });
      expect(
        await recordFrame(key, frame(), { takenAt: NOW + 30_000, tag: '"abc"', now: NOW + 30_000 }),
      ).toBe("duplicate");
      expect(await readReel(key, NOW + 30_000)).toHaveLength(1);
    });

    it("recognises a repeat by capture time when there is no validator", async () => {
      const key = viewKeyFor(CAMERA);
      await recordFrame(key, frame(), { takenAt: NOW, tag: null, now: NOW });
      expect(
        await recordFrame(key, frame(), { takenAt: NOW, tag: null, now: NOW + 60_000 }),
      ).toBe("duplicate");
    });

    it("times a frame by the camera's clock, not ours", async () => {
      // Otherwise the reel claims a frame rate the camera does not have.
      const key = viewKeyFor(CAMERA);
      const taken = NOW - 90_000;
      await recordFrame(key, frame(), { takenAt: taken, tag: '"a"', now: NOW });
      expect((await readReel(key, NOW))[0]?.at).toBe(taken);
    });

    it("falls back to our clock when the camera's is unusable", async () => {
      // A missing or future `last-modified` would otherwise pin the live edge.
      const key = viewKeyFor(CAMERA);
      await recordFrame(key, frame(), { takenAt: NaN, tag: '"a"', now: NOW });
      await recordFrame(key, frame(), { takenAt: NOW + 86_400_000, tag: '"b"', now: NOW });
      const reel = await readReel(key, NOW);
      expect(reel.every((item) => item.at <= NOW)).toBe(true);
    });

    it("skips an empty body or one too large to be a still", async () => {
      const key = viewKeyFor(CAMERA);
      expect(await recordFrame(key, new Uint8Array(0), { takenAt: NOW, tag: null })).toBe("skipped");
      expect(
        await recordFrame(key, frame(3 * 1024 * 1024), { takenAt: NOW, tag: null }),
      ).toBe("skipped");
      expect(await readReel(key, NOW)).toEqual([]);
    });

    it("keeps frames in order however they arrive", async () => {
      const key = viewKeyFor(CAMERA);
      for (const offset of [0, -240_000, -120_000]) {
        await recordFrame(key, frame(), {
          takenAt: NOW + offset,
          tag: `"${offset}"`,
          now: NOW,
        });
      }
      expect((await readReel(key, NOW)).map((item) => item.at)).toEqual([
        NOW - 240_000,
        NOW - 120_000,
        NOW,
      ]);
    });
  });

  describe("bounds", () => {
    it("keeps only the most recent frames for a view", async () => {
      const key = viewKeyFor(CAMERA);
      const total = MAX_FRAMES_PER_VIEW + 5;
      for (let index = 0; index < total; index += 1) {
        await recordFrame(key, frame(), {
          takenAt: NOW - (total - index) * 120_000,
          tag: `"${index}"`,
          now: NOW,
        });
      }

      const reel = await readReel(key, NOW);
      expect(reel).toHaveLength(MAX_FRAMES_PER_VIEW);
      // The oldest five are gone from the index and from the disk.
      expect(reel[0]?.at).toBe(NOW - MAX_FRAMES_PER_VIEW * 120_000);
      expect(await readFrame(key, NOW - total * 120_000)).toBeNull();
    });

    it("drops the view whose newest frame is oldest once too many are recorded", async () => {
      // Each view's single frame is a minute newer than the last, so the
      // ordering under test is unambiguous rather than incidental.
      const total = MAX_VIEWS + 3;
      for (let index = 0; index < total; index += 1) {
        await recordFrame(viewKeyFor(`${CAMERA}?${index}`), frame(), {
          takenAt: NOW - (total - index) * 60_000,
          tag: `"${index}"`,
          now: NOW,
        });
      }

      const stats = await frameStoreStats(NOW);
      expect(stats.views).toBe(MAX_VIEWS);
      // The three with the oldest pictures are gone: nobody is watching them
      // and the recorder is not pointed at them.
      expect(await readReel(viewKeyFor(`${CAMERA}?0`), NOW)).toEqual([]);
      expect(await readReel(viewKeyFor(`${CAMERA}?2`), NOW)).toEqual([]);
      expect(await readReel(viewKeyFor(`${CAMERA}?${total - 1}`), NOW)).toHaveLength(1);
    });

    it("forgets frames older than the retention window", async () => {
      const key = viewKeyFor(CAMERA);
      await recordFrame(key, frame(), { takenAt: NOW - 20 * 3_600_000, tag: '"old"', now: NOW });
      await recordFrame(key, frame(), { takenAt: NOW, tag: '"new"', now: NOW });
      expect((await readReel(key, NOW)).map((item) => item.at)).toEqual([NOW]);
    });

    it("thins every reel rather than emptying one when over budget", async () => {
      /*
       * A budget small enough that a handful of frames exceeds it. Sacrificing
       * one camera entirely would leave someone watching it stuck on a single
       * picture while a camera nobody has open keeps a full reel.
       */
      process.env.ICELAND_LIVE_FRAME_BUDGET_MB = String(8 / 1024); // 8 KB
      const keys = [viewKeyFor(CAMERA), viewKeyFor(OTHER)];

      for (let index = 0; index < 6; index += 1) {
        for (const key of keys) {
          await recordFrame(key, frame(1024), {
            takenAt: NOW - (6 - index) * 120_000,
            tag: `"${key}-${index}"`,
            now: NOW,
          });
        }
      }

      const stats = await frameStoreStats(NOW);
      expect(stats.bytes).toBeLessThanOrEqual(8 * 1024);
      // Both views survive, each still holding its newest frame.
      for (const key of keys) {
        const reel = await readReel(key, NOW);
        expect(reel.length).toBeGreaterThan(0);
        expect(reel.at(-1)?.at).toBe(NOW - 120_000);
      }
    });
  });

  describe("survives a restart", () => {
    it("finds the frames it already wrote", async () => {
      const key = viewKeyFor(CAMERA);
      await recordFrame(key, frame(512), { takenAt: NOW, tag: '"abc"', now: NOW });

      // A new process, same directory.
      resetFrameStoreForTests();

      const reel = await readReel(key, NOW);
      expect(reel).toHaveLength(1);
      expect((await readFrame(key, NOW))?.byteLength).toBe(512);
    });
  });

  describe("an unwritable filesystem", () => {
    it("degrades to holding nothing rather than failing the image", async () => {
      // A file where the directory should be: every write below it gets
      // ENOTDIR immediately, with no waiting on a permission check.
      process.env.ICELAND_LIVE_CACHE_DIR = join(directory, "not-a-directory");
      await rm(join(directory, "not-a-directory"), { force: true });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(directory, "not-a-directory"), "blocked");
      resetFrameStoreForTests();

      const key = viewKeyFor(CAMERA);
      expect(await recordFrame(key, frame(), { takenAt: NOW, tag: null, now: NOW })).toBe(
        "skipped",
      );
      expect(await readReel(key, NOW)).toEqual([]);
    });
  });
});
