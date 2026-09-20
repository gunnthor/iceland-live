/**
 * Reads the alpha channel out of a PNG.
 *
 * ## What this is for, and the line it does not cross
 *
 * IMO renders their dispersal model as a coloured raster. Translating those
 * colours back into concentrations would be inventing a measurement: the scale
 * is stepped, the image is resampled, and the result would be a number with
 * no provenance.
 *
 * This reads one bit of information per pixel — **is there anything here at
 * all** — which is a question the alpha channel answers directly and without
 * interpretation. It is used to decide *where to ask*, and the asking is done
 * against IMO's own per-location endpoint, which returns numbers. The picture
 * indexes; the model quantifies.
 *
 * ## Why not a library
 *
 * `node:zlib` already does the hard part. What remains is the chunk walk and
 * the scanline filters, which are a page of code and are specified precisely
 * enough that "a page of code" is the whole of it.
 *
 * Only what IMO actually serves is supported — 8-bit RGBA, non-interlaced —
 * and anything else is refused rather than guessed at. A mis-decoded mask
 * would put a plume over the wrong towns.
 */

import { inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG colour type 6: truecolour with alpha. */
const RGBA = 6;
const CHANNELS = 4;

export type AlphaMask = {
  width: number;
  height: number;
  /** One byte per pixel, row-major from the top-left. */
  alpha: Uint8Array;
};

/**
 * Undoes one scanline's filter, in place.
 *
 * `previous` is the already-reconstructed line above, which the Up, Average
 * and Paeth filters refer to. The first line is filtered against a row of
 * zeros, which is what an all-zero `previous` provides.
 */
function unfilter(
  filter: number,
  line: Uint8Array,
  previous: Uint8Array,
  bpp: number,
): void {
  switch (filter) {
    case 0:
      return;
    case 1:
      for (let i = bpp; i < line.length; i += 1) {
        line[i] = (line[i]! + line[i - bpp]!) & 0xff;
      }
      return;
    case 2:
      for (let i = 0; i < line.length; i += 1) {
        line[i] = (line[i]! + previous[i]!) & 0xff;
      }
      return;
    case 3:
      for (let i = 0; i < line.length; i += 1) {
        const left = i >= bpp ? line[i - bpp]! : 0;
        line[i] = (line[i]! + ((left + previous[i]!) >> 1)) & 0xff;
      }
      return;
    case 4:
      for (let i = 0; i < line.length; i += 1) {
        const a = i >= bpp ? line[i - bpp]! : 0;
        const b = previous[i]!;
        const c = i >= bpp ? previous[i - bpp]! : 0;
        // Paeth predictor: whichever of left, above and above-left is nearest
        // to their linear combination.
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[i] = (line[i]! + predicted) & 0xff;
      }
      return;
    default:
      throw new Error(`unknown PNG filter ${filter}`);
  }
}

/**
 * Decodes a PNG's alpha channel, or returns `null` when it is not a shape we
 * are prepared to read.
 *
 * Null rather than a throw: a caller handed an error page instead of an image
 * should lose the mask, not the request.
 */
export function decodeAlpha(bytes: Uint8Array): AlphaMask | null {
  try {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) return null;

    let width = 0;
    let height = 0;
    const idat: Buffer[] = [];

    let offset = 8;
    while (offset + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString("ascii", offset + 4, offset + 8);
      const start = offset + 8;
      const end = start + length;
      if (end + 4 > buffer.length) return null;

      if (type === "IHDR") {
        width = buffer.readUInt32BE(start);
        height = buffer.readUInt32BE(start + 4);
        const bitDepth = buffer[start + 8];
        const colourType = buffer[start + 9];
        const interlace = buffer[start + 12];
        // Only what IMO serves. A guess here would put a plume over the wrong
        // towns rather than fail.
        if (bitDepth !== 8 || colourType !== RGBA || interlace !== 0) return null;
      } else if (type === "IDAT") {
        idat.push(buffer.subarray(start, end));
      } else if (type === "IEND") {
        break;
      }

      offset = end + 4;
    }

    if (width <= 0 || height <= 0 || idat.length === 0) return null;
    // A guard against a decompression bomb: IMO's rasters are ~500×400.
    if (width * height > 16_000_000) return null;

    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * CHANNELS;
    if (raw.length < (stride + 1) * height) return null;

    const alpha = new Uint8Array(width * height);
    let previous = new Uint8Array(stride);
    let cursor = 0;

    for (let row = 0; row < height; row += 1) {
      const filter = raw[cursor]!;
      cursor += 1;
      const line = new Uint8Array(raw.subarray(cursor, cursor + stride));
      cursor += stride;

      unfilter(filter, line, previous, CHANNELS);

      for (let column = 0; column < width; column += 1) {
        alpha[row * width + column] = line[column * CHANNELS + 3]!;
      }
      previous = line;
    }

    return { width, height, alpha };
  } catch {
    return null;
  }
}
