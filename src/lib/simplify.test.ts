import { describe, expect, it } from "vitest";
import { simplifyFeatureCollection, simplifyGeometry } from "./simplify";

/** A dense straight line: every intermediate vertex is redundant. */
function densifiedLine(count: number): GeoJSON.Position[] {
  return Array.from({ length: count }, (_, i) => [-22 + i * 0.00001, 63.9]);
}

describe("simplifyGeometry", () => {
  it("removes redundant vertices from a straight line", () => {
    const geometry = simplifyGeometry(
      { type: "LineString", coordinates: densifiedLine(500) },
      { toleranceM: 20 },
    ) as GeoJSON.LineString;

    expect(geometry.coordinates).toHaveLength(2);
  });

  it("keeps vertices that carry shape", () => {
    // A right angle: the corner must survive.
    const geometry = simplifyGeometry(
      {
        type: "LineString",
        coordinates: [
          [-22, 63.9],
          [-21.99, 63.9],
          [-21.99, 63.91],
        ],
      },
      { toleranceM: 20 },
    ) as GeoJSON.LineString;

    expect(geometry.coordinates).toHaveLength(3);
  });

  it("leaves a closed ring closed", () => {
    const ring: GeoJSON.Position[] = [
      [-22, 63.9],
      [-21.98, 63.9],
      [-21.98, 63.92],
      [-22, 63.92],
      [-22, 63.9],
    ];
    const geometry = simplifyGeometry(
      { type: "Polygon", coordinates: [ring] },
      { toleranceM: 20 },
    ) as GeoJSON.Polygon;

    const out = geometry.coordinates[0] as GeoJSON.Position[];
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out[0]).toEqual(out[out.length - 1]);
  });

  it("drops a sliver that collapses below a valid ring", () => {
    // Four near-identical points: nothing survives a 20 m tolerance.
    const sliver: GeoJSON.Position[] = [
      [-22, 63.9],
      [-22.000001, 63.9],
      [-22.000001, 63.900001],
      [-22, 63.9],
    ];
    expect(simplifyGeometry({ type: "Polygon", coordinates: [sliver] }, { toleranceM: 20 })).toBeNull();
  });

  it("handles MultiPolygon and MultiLineString", () => {
    const multi = simplifyGeometry(
      {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [-22, 63.9],
              [-21.98, 63.9],
              [-21.98, 63.92],
              [-22, 63.9],
            ],
          ],
        ],
      },
      { toleranceM: 5 },
    ) as GeoJSON.MultiPolygon;
    expect(multi.type).toBe("MultiPolygon");
    expect(multi.coordinates).toHaveLength(1);

    const lines = simplifyGeometry(
      { type: "MultiLineString", coordinates: [densifiedLine(200)] },
      { toleranceM: 20 },
    ) as GeoJSON.MultiLineString;
    expect(lines.coordinates[0]).toHaveLength(2);
  });

  it("leaves points untouched", () => {
    const point: GeoJSON.Point = { type: "Point", coordinates: [-22, 63.9] };
    expect(simplifyGeometry(point)).toEqual(point);
  });

  it("does not blow the stack on a very large ring", () => {
    // One published lava outline has ~227,000 vertices; a recursive
    // implementation overflows on it.
    const huge: GeoJSON.Position[] = Array.from({ length: 250_000 }, (_, i) => [
      -22 + Math.sin(i / 1000) * 0.01,
      63.9 + Math.cos(i / 1000) * 0.01,
    ]);
    huge.push(huge[0] as GeoJSON.Position);

    const geometry = simplifyGeometry(
      { type: "Polygon", coordinates: [huge] },
      { toleranceM: 20 },
    ) as GeoJSON.Polygon;

    expect(geometry).not.toBeNull();
    expect((geometry.coordinates[0] as GeoJSON.Position[]).length).toBeLessThan(huge.length / 10);
  });

  it("rounds coordinates to the requested precision", () => {
    const geometry = simplifyGeometry(
      {
        type: "LineString",
        coordinates: [
          [-22.123456789, 63.987654321],
          [-21.987654321, 63.123456789],
        ],
      },
      { toleranceM: 1, decimals: 4 },
    ) as GeoJSON.LineString;

    expect(geometry.coordinates[0]).toEqual([-22.1235, 63.9877]);
  });
});

describe("simplifyFeatureCollection", () => {
  it("keeps properties and drops collapsed features", () => {
    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "keeps shape" },
          geometry: { type: "LineString", coordinates: densifiedLine(100) },
        },
        {
          type: "Feature",
          properties: { name: "collapses" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-22, 63.9],
                [-22.000001, 63.9],
                [-22.000001, 63.900001],
                [-22, 63.9],
              ],
            ],
          },
        },
      ],
    };

    const out = simplifyFeatureCollection(collection, { toleranceM: 20 });
    expect(out.features).toHaveLength(1);
    expect(out.features[0]?.properties).toEqual({ name: "keeps shape" });
  });
});
