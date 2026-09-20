import { describe, expect, it } from "vitest";
import { normalizeRoadLines } from "./road-geometry-provider";

function feature(
  properties: Record<string, unknown>,
  geometry: GeoJSON.Geometry | null,
): GeoJSON.Feature {
  return { type: "Feature", properties, geometry: geometry as GeoJSON.Geometry };
}

const PROPS = { IDBUTUR: 42, NAFN_LEIDAR: "Grindavíkurvegur", NRVEGUR: "43" };

describe("normalizeRoadLines", () => {
  it("reads a line segment", () => {
    const [line] = normalizeRoadLines({
      type: "FeatureCollection",
      features: [
        feature(PROPS, {
          type: "LineString",
          coordinates: [
            [-22.43, 63.84],
            [-22.41, 63.87],
          ],
        }),
      ],
    });

    expect(line).toEqual({
      id: 42,
      name: "Grindavíkurvegur",
      roadNumber: "43",
      points: [
        { latitude: 63.84, longitude: -22.43 },
        { latitude: 63.87, longitude: -22.41 },
      ],
    });
  });

  it("flattens a multi-part route into one list of vertices", () => {
    // Nothing that tests a route against a footprint cares which part of it a
    // vertex belongs to.
    const [line] = normalizeRoadLines({
      type: "FeatureCollection",
      features: [
        feature(PROPS, {
          type: "MultiLineString",
          coordinates: [
            [
              [-22.43, 63.84],
              [-22.41, 63.87],
            ],
            [
              [-22.3, 63.9],
            ],
          ],
        }),
      ],
    });
    expect(line?.points).toHaveLength(3);
  });

  it("drops the elevation ArcGIS attaches", () => {
    const [line] = normalizeRoadLines({
      type: "FeatureCollection",
      features: [
        feature(PROPS, { type: "LineString", coordinates: [[-22.43, 63.84, 117]] }),
      ],
    });
    expect(line?.points).toEqual([{ latitude: 63.84, longitude: -22.43 }]);
  });

  it("keeps a segment with no route name, since it still has geometry", () => {
    // Grouping by name drops it later; the line itself is still valid.
    const [line] = normalizeRoadLines({
      type: "FeatureCollection",
      features: [
        feature({ IDBUTUR: 7 }, { type: "LineString", coordinates: [[-22, 64]] }),
      ],
    });
    expect(line?.name).toBeNull();
  });

  it("drops a feature with no id or no geometry", () => {
    expect(
      normalizeRoadLines({
        type: "FeatureCollection",
        features: [
          feature({ NAFN_LEIDAR: "Nameless" }, { type: "LineString", coordinates: [[-22, 64]] }),
          feature(PROPS, null),
          feature(PROPS, { type: "LineString", coordinates: [] }),
        ],
      }),
    ).toEqual([]);
  });

  it("survives a payload that is not a feature collection", () => {
    expect(normalizeRoadLines(null)).toEqual([]);
    expect(normalizeRoadLines({ error: { message: "rejected" } })).toEqual([]);
  });
});
