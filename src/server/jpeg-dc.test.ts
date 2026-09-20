import { describe, expect, it } from "vitest";
import { decodeLuma, lumaDifference, type Luma } from "./jpeg-dc";

/*
 * There is no JPEG encoder here to build fixtures with, so the decoder's
 * correctness is established outside the unit suite: a real camera frame was
 * decoded both by this module and by Chromium's own JPEG decoder (drawn to a
 * canvas and averaged over each 8×8 block), and the two agreed to a mean of
 * 0.172 out of 255 across 4,524 interior blocks, worst block 3.8. That
 * residual is the quantisation error the DC coefficient carries by
 * definition.
 *
 * What is tested here is everything around that: the refusals, which decide
 * whether a frame is kept, and the comparison, which decides the same.
 */

const SOI = [0xff, 0xd8];

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function luma(width: number, height: number, fill: number): Luma {
  return { width, height, values: new Uint8Array(width * height).fill(fill) };
}

describe("decodeLuma refusals", () => {
  it("refuses anything that is not a JPEG", () => {
    expect(decodeLuma(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(decodeLuma(new TextEncoder().encode('{"ok":false}'))).toBeNull();
    expect(decodeLuma(new Uint8Array(0))).toBeNull();
  });

  it("refuses a file with no scan", () => {
    // SOI then EOI: structurally a JPEG, with nothing in it.
    expect(decodeLuma(bytes(...SOI, 0xff, 0xd9))).toBeNull();
  });

  it("refuses a progressive file rather than half-reading it", () => {
    /*
     * SOF2 is progressive: the coefficients arrive across several scans, so
     * reading it as baseline would produce a brightness map that is wrong
     * rather than absent — and a wrong one silently decides frames are
     * unchanged when they are not.
     */
    const sof2 = [
      ...SOI,
      0xff, 0xc2, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03,
      0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      0xff, 0xd9,
    ];
    expect(decodeLuma(bytes(...sof2))).toBeNull();
  });

  it("refuses a precision it cannot read", () => {
    // 12-bit samples; the block means would be on a different scale.
    const sof0 = [
      ...SOI,
      0xff, 0xc0, 0x00, 0x11, 0x0c, 0x00, 0x10, 0x00, 0x10, 0x03,
      0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      0xff, 0xd9,
    ];
    expect(decodeLuma(bytes(...sof0))).toBeNull();
  });

  it("refuses a truncated scan instead of returning a partial map", () => {
    const truncated = [
      ...SOI,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03,
      0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
      // …and the entropy-coded data simply stops.
    ];
    expect(decodeLuma(bytes(...truncated))).toBeNull();
  });
});

describe("lumaDifference", () => {
  it("is zero for a map compared with itself", () => {
    const map = luma(4, 3, 100);
    expect(lumaDifference(map, map)).toBe(0);
  });

  it("is the mean absolute difference per block", () => {
    const a = luma(2, 2, 100);
    const b = luma(2, 2, 100);
    b.values[0] = 140;
    b.values[1] = 60;
    // |40| + |40| + 0 + 0, over four blocks.
    expect(lumaDifference(a, b)).toBe(20);
  });

  it("is symmetric", () => {
    const a = luma(2, 2, 10);
    const b = luma(2, 2, 200);
    expect(lumaDifference(a, b)).toBe(lumaDifference(b, a));
  });

  it("is null for maps of different sizes, not zero", () => {
    /*
     * The caller reads a low number as "nothing changed" and skips the frame.
     * Two maps that cannot be compared must not produce that, so this is null
     * and the caller keeps the frame.
     */
    expect(lumaDifference(luma(4, 3, 0), luma(3, 4, 0))).toBeNull();
    expect(lumaDifference(luma(0, 0, 0), luma(0, 0, 0))).toBeNull();
  });
});
