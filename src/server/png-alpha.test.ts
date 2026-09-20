import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { decodeAlpha } from "./png-alpha";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A minimal PNG writer, so the decoder can be tested against images whose
 * contents are known exactly — including each scanline filter, which is where
 * a decoder actually goes wrong.
 */
function makePng(
  width: number,
  height: number,
  pixels: (x: number, y: number) => [number, number, number, number],
  options: { filter?: number; bitDepth?: number; colourType?: number; interlace?: number } = {},
): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = options.bitDepth ?? 8;
  header[9] = options.colourType ?? 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = options.interlace ?? 0;

  const stride = width * 4;
  const filter = options.filter ?? 0;
  const raw = Buffer.alloc((stride + 1) * height);

  const previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const line = Buffer.alloc(stride);
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixels(x, y);
      line[x * 4] = r;
      line[x * 4 + 1] = g;
      line[x * 4 + 2] = b;
      line[x * 4 + 3] = a;
    }

    const encoded = Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 4 ? line[i - 4]! : 0;
      const up = previous[i]!;
      const upLeft = i >= 4 ? previous[i - 4]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      encoded[i] = (line[i]! - predictor) & 0xff;
    }

    raw[y * (stride + 1)] = filter;
    encoded.copy(raw, y * (stride + 1) + 1);
    line.copy(previous);
  }

  return new Uint8Array(
    Buffer.concat([
      SIGNATURE,
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/** A plume-ish shape: opaque on the diagonal, transparent elsewhere. */
const plume = (x: number, y: number): [number, number, number, number] =>
  x === y ? [200, 30, 30, 255] : [0, 0, 0, 0];

describe("decodeAlpha", () => {
  it("reads the alpha channel", () => {
    const mask = decodeAlpha(makePng(4, 4, plume));
    expect(mask).not.toBeNull();
    expect(mask?.width).toBe(4);
    expect(mask?.height).toBe(4);
    expect([...(mask?.alpha ?? [])]).toEqual([
      255, 0, 0, 0,
      0, 255, 0, 0,
      0, 0, 255, 0,
      0, 0, 0, 255,
    ]);
  });

  it("handles every scanline filter", () => {
    // Filters are where a decoder is actually wrong, and an encoder is free to
    // pick a different one per image.
    for (const filter of [0, 1, 2, 3, 4]) {
      const mask = decodeAlpha(makePng(4, 4, plume, { filter }));
      expect(mask, `filter ${filter}`).not.toBeNull();
      expect([...(mask?.alpha ?? [])], `filter ${filter}`).toEqual([
        255, 0, 0, 0,
        0, 255, 0, 0,
        0, 0, 255, 0,
        0, 0, 0, 255,
      ]);
    }
  });

  it("keeps rows in order, top row first", () => {
    // An upside-down mask would put a plume over the wrong towns.
    const mask = decodeAlpha(
      makePng(2, 3, (_x, y) => (y === 0 ? [1, 1, 1, 255] : [0, 0, 0, 0])),
    );
    expect([...(mask?.alpha ?? [])]).toEqual([255, 255, 0, 0, 0, 0]);
  });

  it("reads a non-square image without shearing it", () => {
    const mask = decodeAlpha(makePng(5, 2, (x, y) => (x === 4 && y === 1 ? [1, 1, 1, 9] : [0, 0, 0, 0])));
    expect(mask?.width).toBe(5);
    expect(mask?.alpha[1 * 5 + 4]).toBe(9);
  });

  it("refuses anything that is not a PNG", () => {
    expect(decodeAlpha(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(decodeAlpha(new TextEncoder().encode('{"detail":"Internal server error"}'))).toBeNull();
    expect(decodeAlpha(new Uint8Array(0))).toBeNull();
  });

  it("refuses a format it is not prepared to read rather than guessing", () => {
    // A mis-decoded mask is worse than no mask: it is confidently wrong.
    expect(decodeAlpha(makePng(2, 2, plume, { colourType: 2 }))).toBeNull();
    expect(decodeAlpha(makePng(2, 2, plume, { bitDepth: 16 }))).toBeNull();
    expect(decodeAlpha(makePng(2, 2, plume, { interlace: 1 }))).toBeNull();
  });

  it("refuses a truncated image", () => {
    const png = makePng(4, 4, plume);
    expect(decodeAlpha(png.slice(0, png.length - 30))).toBeNull();
  });
});
