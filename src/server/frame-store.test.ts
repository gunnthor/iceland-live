import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  BASE_FRAMES_PER_VIEW,
  FLOOR_FRAMES_PER_VIEW,
  MAX_FRAMES_PER_VIEW,
  MAX_VIEWS,
  earnedFrameCap,
  frameStoreStats,
  isViewKey,
  readFrame,
  readReel,
  recordFrame,
  resetFrameStoreForTests,
  viewKeyFor,
  type StoredFrame,
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
    it("gives a view that rarely changes no more than the base reel", async () => {
      const key = viewKeyFor(CAMERA);
      const total = BASE_FRAMES_PER_VIEW + 5;
      /*
       * Nine minutes apart. No two-hour stretch of this holds more than
       * fourteen frames, so there is nothing to earn and the base reel stands
       * — a quiet camera keeps exactly what it kept before slots were earned.
       */
      for (let index = 0; index < total; index += 1) {
        await recordFrame(key, frame(), {
          takenAt: NOW - (total - index) * 540_000,
          tag: `"${index}"`,
          now: NOW,
        });
      }

      const reel = await readReel(key, NOW);
      expect(reel).toHaveLength(BASE_FRAMES_PER_VIEW);
      // The oldest five are gone from the index and from the disk.
      expect(reel[0]?.at).toBe(NOW - BASE_FRAMES_PER_VIEW * 540_000);
      expect(await readFrame(key, NOW - total * 540_000)).toBeNull();
    });

    it("buys a busy view the frames that reaching back two hours costs", async () => {
      const key = viewKeyFor(CAMERA);
      // Four hours of a camera changing on every poll, two minutes apart.
      const total = 120;
      for (let index = 0; index < total; index += 1) {
        await recordFrame(key, frame(), {
          takenAt: NOW - (total - index) * 120_000,
          tag: `"${index}"`,
          now: NOW,
        });
      }

      const reel = await readReel(key, NOW);
      // Not thirty, and not the four hours it was given: the reel it keeps
      // reaches back exactly the span the slots were bought for.
      const span = (reel.at(-1)?.at ?? 0) - (reel[0]?.at ?? 0);
      expect(span).toBe(2 * 3_600_000);
      expect(reel.length).toBeGreaterThan(BASE_FRAMES_PER_VIEW);
      expect(reel.length).toBeLessThanOrEqual(MAX_FRAMES_PER_VIEW);
    });

    it("leaves every view a floor when the byte budget cannot be met", async () => {
      /*
       * Small enough that the sweep would empty both views to reach it. The
       * floor wins: "spend the budget where something is happening" must not
       * become "one camera takes it all".
       */
      process.env.ICELAND_LIVE_FRAME_BUDGET_MB = String(2 / 1024); // 2 KB
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

      for (const key of keys) {
        const reel = await readReel(key, NOW);
        expect(reel).toHaveLength(FLOOR_FRAMES_PER_VIEW);
        // What it keeps is the newest, not whatever the sweep reached last.
        expect(reel.at(-1)?.at).toBe(NOW - 120_000);
      }
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

describe("the earned cap", () => {
  const TWO_HOURS = 2 * 3_600_000;

  /** `count` frames ending just before `NOW`, evenly spaced. */
  function spaced(count: number, everyMs: number): StoredFrame[] {
    return Array.from({ length: count }, (_, index) => ({
      at: NOW - (count - index) * everyMs,
      bytes: 1024,
    }));
  }

  it("holds a camera that rarely changes at the base reel", () => {
    // A frame every quarter of an hour: two hours costs nine of them.
    expect(earnedFrameCap(spaced(60, 15 * 60_000), TWO_HOURS)).toBe(BASE_FRAMES_PER_VIEW);
  });

  it("buys a busy camera what two hours costs it", () => {
    // A frame every two minutes: sixty intervals, so sixty-one frames.
    expect(earnedFrameCap(spaced(200, 120_000), TWO_HOURS)).toBe(61);
  });

  it("stops at the ceiling however fast the picture changes", () => {
    expect(earnedFrameCap(spaced(600, 10_000), TWO_HOURS)).toBe(MAX_FRAMES_PER_VIEW);
  });

  it("keeps what a busy stretch earned once the camera goes quiet", () => {
    /*
     * An hour of traffic five hours ago, then almost nothing. The densest
     * window is behind us and it is still the one that decides — otherwise a
     * view would lose the busy stretch precisely when it had become the
     * interesting part of its reel.
     */
    const busy = Array.from({ length: 60 }, (_, index) => ({
      at: NOW - 5 * 3_600_000 + index * 60_000,
      bytes: 1024,
    }));
    const quiet = [NOW - 2 * 3_600_000, NOW - 3_600_000, NOW - 1_800_000].map((at) => ({
      at,
      bytes: 1024,
    }));

    expect(earnedFrameCap([...busy, ...quiet], TWO_HOURS)).toBe(60);
  });

  it("never reads a gap as a reason to drop below the base reel", () => {
    // One frame an hour for two days: nothing dense anywhere in it.
    expect(earnedFrameCap(spaced(48, 3_600_000), TWO_HOURS)).toBe(BASE_FRAMES_PER_VIEW);
  });
});

describe("a new file that is not a new picture", () => {
  /*
   * Two consecutive real frames from a live camera, sixty seconds apart, with
   * a vehicle moving between them. A JPEG cannot be written here without an
   * encoder, and a synthetic one would not exercise the Huffman path these
   * cameras actually produce — so the fixtures are genuine pictures. See
   * `__fixtures__/README.md`.
   */
  const frameA = new Uint8Array(readFileSync(join(__dirname, "__fixtures__/camera-frame-a.jpg")));
  const frameB = new Uint8Array(readFileSync(join(__dirname, "__fixtures__/camera-frame-b.jpg")));

  let directory: string;
  const saved: Record<string, string | undefined> = {};
  const keys = [
    "ICELAND_LIVE_CACHE_DIR",
    "ICELAND_LIVE_FRAME_BUDGET_MB",
    "ICELAND_LIVE_FRAME_CHANGE_THRESHOLD",
  ];

  beforeEach(async () => {
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    directory = await mkdtemp(join(tmpdir(), "iceland-live-change-"));
    process.env.ICELAND_LIVE_CACHE_DIR = directory;
    resetFrameStoreForTests();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("keeps a frame where something moved", async () => {
    const key = viewKeyFor(CAMERA);
    expect(await recordFrame(key, frameA, { takenAt: NOW - 60_000, tag: '"a"', now: NOW })).toBe(
      "stored",
    );
    expect(await recordFrame(key, frameB, { takenAt: NOW, tag: '"b"', now: NOW })).toBe("stored");
    expect(await readReel(key, NOW)).toHaveLength(2);
  });

  it("skips a republication of the same picture", async () => {
    // A new file and a new validator, so neither of the cheaper checks catches
    // it; only the comparison does.
    const key = viewKeyFor(CAMERA);
    await recordFrame(key, frameA, { takenAt: NOW - 60_000, tag: '"a"', now: NOW });
    expect(await recordFrame(key, frameA, { takenAt: NOW, tag: '"different"', now: NOW })).toBe(
      "unchanged",
    );
    expect(await readReel(key, NOW)).toHaveLength(1);
  });

  it("keeps the first frame of a view whatever it looks like", async () => {
    // There is nothing to compare it against, and one picture is the whole
    // difference between a camera that works and one that does not.
    expect(
      await recordFrame(viewKeyFor(OTHER), frameA, { takenAt: NOW, tag: '"a"', now: NOW }),
    ).toBe("stored");
  });

  it("honours a raised threshold", async () => {
    // The same pair, which differs by about 1.75% of blocks: kept at the
    // default of 0.25% and skipped once the bar is above it.
    process.env.ICELAND_LIVE_FRAME_CHANGE_THRESHOLD = "0.05";
    const key = viewKeyFor(CAMERA);
    await recordFrame(key, frameA, { takenAt: NOW - 60_000, tag: '"a"', now: NOW });
    expect(await recordFrame(key, frameB, { takenAt: NOW, tag: '"b"', now: NOW })).toBe(
      "unchanged",
    );
  });

  it("keeps a frame it cannot decode rather than assuming nothing changed", async () => {
    // "We do not know whether anything changed" and "nothing changed" lead to
    // opposite decisions, and only one of them loses a picture.
    const key = viewKeyFor(CAMERA);
    await recordFrame(key, frameA, { takenAt: NOW - 60_000, tag: '"a"', now: NOW });
    expect(
      await recordFrame(key, new Uint8Array(2048).fill(0x41), {
        takenAt: NOW,
        tag: '"not a jpeg"',
        now: NOW,
      }),
    ).toBe("stored");
  });
});
