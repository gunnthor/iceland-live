import { describe, expect, it } from "vitest";
import { conditionSeverity } from "@/domain/roads";
import { normalizeRoadConditionLayer } from "./road-geometry-provider";

/** A trimmed but otherwise verbatim ArcGIS GeoJSON response. */
const PAYLOAD = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        IDBUTUR: 913670036,
        NAFN_LEIDAR: "Norðurljósavegur sunnan Bláalóns",
        NRVEGUR: "426",
        AST1_NAFN: "Ekki í þjónustu",
        AST1_LITUR: "#8C8A88",
        DB_MODIFY: 1789786501000,
      },
      geometry: {
        type: "LineString",
        // ArcGIS returns [lon, lat, elevation].
        coordinates: [
          [-22.43, 63.87, 120.5],
          [-22.4, 63.875, 118.2],
          [-22.37, 63.88, 115.9],
        ],
      },
    },
    {
      type: "Feature",
      properties: { IDBUTUR: 1, AST1_NAFN: "Ófært", AST1_LITUR: "#FF0000" },
      geometry: {
        type: "LineString",
        coordinates: [
          [-19.0, 65.0, 300],
          [-18.9, 65.05, 305],
        ],
      },
    },
  ],
};

describe("normalizeRoadConditionLayer", () => {
  it("keeps the condition, colour and join key", () => {
    const layer = normalizeRoadConditionLayer(PAYLOAD);
    expect(layer.features[0]?.properties).toMatchObject({
      id: 913670036,
      name: "Norðurljósavegur sunnan Bláalóns",
      roadNumber: "426",
      status: "Ekki í þjónustu",
      colour: "#8C8A88",
    });
  });

  it("strips the elevation ordinate", () => {
    // Roughly a third of the payload, and nothing here uses it.
    const coords = (
      normalizeRoadConditionLayer(PAYLOAD).features[0]?.geometry as GeoJSON.LineString
    ).coordinates;
    for (const position of coords) expect(position).toHaveLength(2);
  });

  it("converts the epoch-millisecond timestamp", () => {
    expect(normalizeRoadConditionLayer(PAYLOAD).features[0]?.properties.updatedAt).toBe(
      new Date(1789786501000).toISOString(),
    );
  });

  it("drops features with no status or no join key", () => {
    const partial = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { IDBUTUR: 5 }, geometry: PAYLOAD.features[1]!.geometry },
        { type: "Feature", properties: { AST1_NAFN: "Ófært" }, geometry: PAYLOAD.features[1]!.geometry },
      ],
    };
    expect(normalizeRoadConditionLayer(partial).features).toHaveLength(0);
  });

  it("returns an empty collection for junk", () => {
    expect(normalizeRoadConditionLayer(null).features).toEqual([]);
    expect(normalizeRoadConditionLayer({ error: { message: "bad" } }).features).toEqual([]);
  });
});

describe("conditionSeverity", () => {
  it("ranks impassable above out-of-service above 4x4-only", () => {
    // Vegagerðin gives a 4x4-only track the same green as a clear road, which
    // is right for a driver and useless on a map read at a glance.
    expect(conditionSeverity("Ófært - Vegna aurbleytu")).toBeGreaterThan(
      conditionSeverity("Ekki í þjónustu"),
    );
    expect(conditionSeverity("Ekki í þjónustu")).toBeGreaterThan(
      conditionSeverity("Fært fjallabílum (og stærri bílum)"),
    );
    expect(conditionSeverity("Fært fjallabílum")).toBeGreaterThan(conditionSeverity("Steinkast"));
  });

  it("treats an unknown status as unremarkable rather than severe", () => {
    expect(conditionSeverity("Eitthvað alveg nýtt")).toBe(0);
  });
});
