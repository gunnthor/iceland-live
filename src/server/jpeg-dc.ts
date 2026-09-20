/**
 * The luminance of a baseline JPEG, at one value per 8×8 block.
 *
 * ## Why not decode the picture
 *
 * The question is only "did anything change since the last frame", and that
 * does not need pixels. Every 8×8 block of a JPEG carries a DC coefficient
 * which *is* the block's mean brightness — the rest of the block is detail
 * layered on top. Reading only those gives a 1/8-scale greyscale thumbnail
 * (a 640×480 camera becomes 80×60) for a fraction of the work: Huffman
 * decoding, and no inverse DCT, no chroma upsampling, no colour conversion.
 *
 * That is also why this is a page of code rather than a dependency. A full
 * JPEG decoder is a large thing to take on for a comparison.
 *
 * ## What it accepts
 *
 * Baseline sequential (`SOF0`), 8-bit, which is what Vegagerðin's cameras
 * publish — verified by reading the markers of a live frame: 640×480, 4:2:0,
 * standard tables, no restart interval. Progressive files are refused rather
 * than half-read, and the caller treats a refusal as "cannot compare", never
 * as "nothing changed".
 *
 * Restart markers are handled even though these files carry none: they are
 * ten lines, and a stream that grew them would otherwise decode into noise
 * rather than fail.
 */

/** A block-resolution brightness map, one byte per 8×8 block. */
export type Luma = {
  /** Blocks across and down, which is the image size divided by eight. */
  width: number;
  height: number;
  /** Mean brightness of each block, 0–255, row-major. */
  values: Uint8Array;
};

type Huffman = {
  /** `lookup[length][code]` → value. */
  codes: Map<number, number>[];
};

function buildHuffman(bits: Uint8Array, values: Uint8Array): Huffman {
  const codes: Map<number, number>[] = Array.from({ length: 17 }, () => new Map());
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length += 1) {
    for (let i = 0; i < (bits[length - 1] ?? 0); i += 1) {
      codes[length]?.set(code, values[k] ?? 0);
      code += 1;
      k += 1;
    }
    code <<= 1;
  }
  return { codes };
}

/** Reads bits MSB-first, unstuffing the `FF 00` the format inserts. */
class BitReader {
  private position: number;
  private bit = 0;
  private current = 0;

  constructor(
    private readonly data: Uint8Array,
    start: number,
  ) {
    this.position = start;
  }

  /** Byte offset, for skipping to a marker. */
  get offset(): number {
    return this.position;
  }

  align(): void {
    this.bit = 0;
  }

  seek(offset: number): void {
    this.position = offset;
    this.bit = 0;
  }

  readBit(): number {
    if (this.bit === 0) {
      if (this.position >= this.data.length) throw new Error("jpeg: scan ended early");
      this.current = this.data[this.position] as number;
      this.position += 1;
      if (this.current === 0xff) {
        const next = this.data[this.position];
        // A stuffed zero is data; anything else is a marker and ends the scan.
        if (next === 0x00) this.position += 1;
        else throw new Error("jpeg: marker inside scan");
      }
      this.bit = 8;
    }
    this.bit -= 1;
    return (this.current >> this.bit) & 1;
  }

  receive(length: number): number {
    let value = 0;
    for (let i = 0; i < length; i += 1) value = (value << 1) | this.readBit();
    return value;
  }

  decode(table: Huffman): number {
    let code = 0;
    for (let length = 1; length <= 16; length += 1) {
      code = (code << 1) | this.readBit();
      const value = table.codes[length]?.get(code);
      if (value !== undefined) return value;
    }
    throw new Error("jpeg: no Huffman code matched");
  }
}

/** Sign-extends a `receive`d value, per the format's EXTEND procedure. */
function extend(value: number, length: number): number {
  if (length === 0) return 0;
  return value < 1 << (length - 1) ? value - (1 << length) + 1 : value;
}

type Component = {
  id: number;
  h: number;
  v: number;
  quantTable: number;
  dcTable: number;
  acTable: number;
  predictor: number;
};

/**
 * Decodes the brightness map, or `null` when the file is not a shape this can
 * read.
 *
 * Null rather than a throw: a caller handed an error page instead of an image
 * should lose the comparison, not the frame.
 */
export function decodeLuma(bytes: Uint8Array): Luma | null {
  try {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

    const quant: Array<Uint16Array | undefined> = [];
    const dcTables: Array<Huffman | undefined> = [];
    const acTables: Array<Huffman | undefined> = [];
    let components: Component[] = [];
    let width = 0;
    let height = 0;
    let restartInterval = 0;
    let scanStart = -1;

    let i = 2;
    while (i + 3 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1] as number;

      if (marker === 0xd9) break;
      const length = ((bytes[i + 2] as number) << 8) | (bytes[i + 3] as number);
      const segment = i + 4;

      if (marker === 0xdb) {
        // One segment may hold several tables.
        let p = segment;
        while (p < i + 2 + length) {
          const precision = (bytes[p] as number) >> 4;
          const id = (bytes[p] as number) & 15;
          p += 1;
          const table = new Uint16Array(64);
          for (let k = 0; k < 64; k += 1) {
            if (precision === 0) {
              table[k] = bytes[p] as number;
              p += 1;
            } else {
              table[k] = ((bytes[p] as number) << 8) | (bytes[p + 1] as number);
              p += 2;
            }
          }
          quant[id] = table;
        }
      } else if (marker === 0xc0) {
        if ((bytes[segment] as number) !== 8) return null;
        height = ((bytes[segment + 1] as number) << 8) | (bytes[segment + 2] as number);
        width = ((bytes[segment + 3] as number) << 8) | (bytes[segment + 4] as number);
        const count = bytes[segment + 5] as number;
        components = [];
        for (let c = 0; c < count; c += 1) {
          const at = segment + 6 + c * 3;
          components.push({
            id: bytes[at] as number,
            h: (bytes[at + 1] as number) >> 4,
            v: (bytes[at + 1] as number) & 15,
            quantTable: bytes[at + 2] as number,
            dcTable: 0,
            acTable: 0,
            predictor: 0,
          });
        }
      } else if (marker === 0xc1 || (marker >= 0xc2 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)) {
        // Progressive, arithmetic, lossless and hierarchical. Refused rather
        // than half-read: a wrong brightness map is worse than none.
        return null;
      } else if (marker === 0xc4) {
        let p = segment;
        while (p < i + 2 + length) {
          const klass = (bytes[p] as number) >> 4;
          const id = (bytes[p] as number) & 15;
          p += 1;
          const bits = bytes.subarray(p, p + 16);
          p += 16;
          let total = 0;
          for (const count of bits) total += count;
          const values = bytes.subarray(p, p + total);
          p += total;
          const table = buildHuffman(bits, values);
          if (klass === 0) dcTables[id] = table;
          else acTables[id] = table;
        }
      } else if (marker === 0xdd) {
        restartInterval = ((bytes[segment] as number) << 8) | (bytes[segment + 1] as number);
      } else if (marker === 0xda) {
        const count = bytes[segment] as number;
        for (let c = 0; c < count; c += 1) {
          const id = bytes[segment + 1 + c * 2] as number;
          const tables = bytes[segment + 2 + c * 2] as number;
          const component = components.find((item) => item.id === id);
          if (component) {
            component.dcTable = tables >> 4;
            component.acTable = tables & 15;
          }
        }
        scanStart = i + 2 + length;
        break;
      }

      i += 2 + length;
    }

    const luminance = components[0];
    if (!luminance || scanStart < 0 || width <= 0 || height <= 0) return null;
    // A camera frame, not a poster.
    if (width * height > 50_000_000) return null;

    const hMax = Math.max(...components.map((component) => component.h));
    const vMax = Math.max(...components.map((component) => component.v));
    if (hMax <= 0 || vMax <= 0) return null;

    const mcusX = Math.ceil(width / (8 * hMax));
    const mcusY = Math.ceil(height / (8 * vMax));

    const blocksX = mcusX * luminance.h;
    const blocksY = mcusY * luminance.v;
    const values = new Uint8Array(blocksX * blocksY);

    const reader = new BitReader(bytes, scanStart);
    const dcQuant = quant[luminance.quantTable]?.[0] ?? 1;

    let sinceRestart = 0;

    for (let my = 0; my < mcusY; my += 1) {
      for (let mx = 0; mx < mcusX; mx += 1) {
        if (restartInterval > 0 && sinceRestart === restartInterval) {
          // Skip the RSTn marker and start the predictors again.
          reader.align();
          let at = reader.offset;
          while (at + 1 < bytes.length && !(bytes[at] === 0xff && (bytes[at + 1] as number) >= 0xd0 && (bytes[at + 1] as number) <= 0xd7)) {
            at += 1;
          }
          reader.seek(at + 2);
          for (const component of components) component.predictor = 0;
          sinceRestart = 0;
        }

        for (const component of components) {
          const dcTable = dcTables[component.dcTable];
          const acTable = acTables[component.acTable];
          if (!dcTable || !acTable) return null;

          for (let by = 0; by < component.v; by += 1) {
            for (let bx = 0; bx < component.h; bx += 1) {
              const size = reader.decode(dcTable);
              const diff = size === 0 ? 0 : extend(reader.receive(size), size);
              component.predictor += diff;

              if (component === luminance) {
                /*
                 * The DC coefficient is eight times the block's mean, before
                 * the level shift the format applies on encoding. So the mean
                 * brightness is dc/8 + 128.
                 */
                const mean = (component.predictor * dcQuant) / 8 + 128;
                const x = mx * component.h + bx;
                const y = my * component.v + by;
                values[y * blocksX + x] = mean < 0 ? 0 : mean > 255 ? 255 : Math.round(mean);
              }

              // The 63 AC coefficients are decoded only to advance past them.
              for (let k = 1; k < 64; ) {
                const rs = reader.decode(acTable);
                const run = rs >> 4;
                const size_ = rs & 15;
                if (size_ === 0) {
                  if (run !== 15) break; // EOB
                  k += 16;
                  continue;
                }
                k += run + 1;
                reader.receive(size_);
              }
            }
          }
        }

        sinceRestart += 1;
      }
    }

    return { width: blocksX, height: blocksY, values };
  } catch {
    return null;
  }
}

/**
 * Mean absolute difference between two brightness maps, 0–255.
 *
 * `null` when they cannot be compared, which a caller must not read as zero:
 * "we do not know whether anything changed" and "nothing changed" lead to
 * opposite decisions about whether to keep a frame.
 */
export function lumaDifference(a: Luma, b: Luma): number | null {
  if (a.width !== b.width || a.height !== b.height) return null;
  if (a.values.length === 0) return null;

  let total = 0;
  for (let i = 0; i < a.values.length; i += 1) {
    total += Math.abs((a.values[i] as number) - (b.values[i] as number));
  }
  return total / a.values.length;
}

/**
 * How much of the frame changed, as a fraction of its blocks in (0, 1].
 *
 * ## Why not the mean difference
 *
 * A mean over the whole frame confuses two very different things. One car
 * crossing a road camera covers perhaps twenty of 4,800 blocks; even if those
 * blocks change completely, the mean moves by about 0.4 — indistinguishable
 * from sensor noise spread thinly over everything. A threshold that ignored
 * the noise would ignore the car.
 *
 * Counting blocks separates them. Noise nudges every block a little and
 * crosses the floor nowhere; a vehicle moves a few blocks a great deal and
 * crosses it there. What a camera is for is the second kind of change.
 *
 * `floor` is how far one block must move to count as having changed at all.
 */
export function changedFraction(a: Luma, b: Luma, floor = 12): number | null {
  if (a.width !== b.width || a.height !== b.height) return null;
  if (a.values.length === 0) return null;

  let changed = 0;
  for (let i = 0; i < a.values.length; i += 1) {
    if (Math.abs((a.values[i] as number) - (b.values[i] as number)) > floor) changed += 1;
  }
  return changed / a.values.length;
}
