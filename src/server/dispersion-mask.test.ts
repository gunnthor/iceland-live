import { describe, expect, it } from "vitest";
import { maskCell, maskCovers } from "./dispersion";
import type { AlphaMask } from "./png-alpha";

/** The grid IMO actually serves: 40° of longitude by ~13° of latitude. */
const BOUNDS = { west: -40, south: 60, east: -0.03, north: 72.95 };

/** A 4x2 mask with one opaque cell, so every corner can be checked. */
function mask(opaque: Array<[x: number, y: number]>, width = 4, height = 2): AlphaMask {
  const alpha = new Uint8Array(width * height);
  for (const [x, y] of opaque) alpha[y * width + x] = 255;
  return { width, height, alpha };
}

describe("maskCovers", () => {
  it("reads row 0 as the northern edge", () => {
    /*
     * Not an assumption: `orientation-probe.integration.ts` checks this
     * against IMO's own per-location model at a scatter of coordinates, where
     * the top-down reading agreed at all of them and bottom-up did not.
     */
    const northern = mask([[0, 0]]);
    expect(maskCovers(northern, BOUNDS, { latitude: 72, longitude: -39 })).toBe(true);
    expect(maskCovers(northern, BOUNDS, { latitude: 61, longitude: -39 })).toBe(false);
  });

  it("maps longitude west to east across the columns", () => {
    const eastern = mask([[3, 0]]);
    expect(maskCovers(eastern, BOUNDS, { latitude: 72, longitude: -1 })).toBe(true);
    expect(maskCovers(eastern, BOUNDS, { latitude: 72, longitude: -39 })).toBe(false);
  });

  it("is false outside the grid rather than wrapping to an edge cell", () => {
    // A point off the grid is "not modelled", which must not read as "covered".
    const full = mask([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(maskCovers(full, BOUNDS, { latitude: 80, longitude: -20 })).toBe(false);
    expect(maskCovers(full, BOUNDS, { latitude: 50, longitude: -20 })).toBe(false);
    expect(maskCovers(full, BOUNDS, { latitude: 65, longitude: -50 })).toBe(false);
    expect(maskCovers(full, BOUNDS, { latitude: 65, longitude: 10 })).toBe(false);
  });

  it("treats any non-zero alpha as covered", () => {
    // The question the alpha channel answers is "is anything here", not
    // "how much" — the amount comes from the per-location endpoint.
    const faint: AlphaMask = { width: 1, height: 1, alpha: new Uint8Array([1]) };
    expect(maskCovers(faint, BOUNDS, { latitude: 65, longitude: -20 })).toBe(true);

    const empty: AlphaMask = { width: 1, height: 1, alpha: new Uint8Array([0]) };
    expect(maskCovers(empty, BOUNDS, { latitude: 65, longitude: -20 })).toBe(false);
  });

  it("places a real Icelandic coordinate in the cell it belongs to", () => {
    // Grindavík, on a grid whose cells are 10° wide and 6.475° tall.
    const grid = mask([[1, 1]], 4, 2);
    expect(maskCovers(grid, BOUNDS, { latitude: 63.84, longitude: -22.43 })).toBe(true);
    // One cell north is empty, so the same longitude further north is not.
    expect(maskCovers(grid, BOUNDS, { latitude: 70, longitude: -22.43 })).toBe(false);
  });
});

describe("maskCell", () => {
  const grid = mask([], 4, 2);

  it("indexes row-major from the north-west corner", () => {
    expect(maskCell(grid, BOUNDS, { latitude: 72, longitude: -39 })).toBe(0);
    expect(maskCell(grid, BOUNDS, { latitude: 72, longitude: -1 })).toBe(3);
    expect(maskCell(grid, BOUNDS, { latitude: 61, longitude: -39 })).toBe(4);
    expect(maskCell(grid, BOUNDS, { latitude: 61, longitude: -1 })).toBe(7);
  });

  it("gives two nearby coordinates the same cell", () => {
    /*
     * This is what the route list relies on: roads a few kilometres apart
     * share a model cell, so one lookup answers for all of them and the
     * request budget reaches further out.
     */
    const grindavik = maskCell(grid, BOUNDS, { latitude: 63.84, longitude: -22.43 });
    const selhals = maskCell(grid, BOUNDS, { latitude: 63.86, longitude: -22.42 });
    expect(grindavik).toBe(selhals);
  });

  it("is null off the grid rather than clamping to an edge cell", () => {
    expect(maskCell(grid, BOUNDS, { latitude: 80, longitude: -20 })).toBeNull();
    expect(maskCell(grid, BOUNDS, { latitude: 65, longitude: 10 })).toBeNull();
  });
});
