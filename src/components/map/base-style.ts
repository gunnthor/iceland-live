/**
 * Basemap configuration.
 *
 * We start from CARTO's Dark Matter vector style — it needs no API key and its
 * tile schema is stable — and then retune it for this product. Two changes do
 * most of the work:
 *
 *  1. **Land and water are inverted.** Dark Matter paints water lighter than
 *     land. Reversing that so the ocean is near-black and land is a shade
 *     lighter makes Iceland read as a lit landmass, which is the whole picture.
 *  2. **Clutter is removed.** Points of interest, road names and house numbers
 *     carry nothing at the zooms this map lives at. Settlement names stay,
 *     muted, because knowing where Grindavík or Reykjavík sits relative to an
 *     earthquake is genuinely useful.
 *
 * Adjustments are applied by layer id after the style loads. If CARTO renames a
 * layer the adjustment silently does nothing, which degrades to the stock dark
 * basemap rather than to a broken map.
 */

import type { Map as MapLibreMap } from "maplibre-gl";

export const BASE_STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** Ocean: deep, cool, almost black. */
const WATER = "#04070c";
/** Land: a touch lighter than the ocean, neutral so marker colour stays true. */
const LAND = "#121720";
/** Coastline hairline. Defines Iceland's shape without drawing attention. */
const COAST = "#2b3947";

/** Layers that add nothing at these zooms. */
const HIDDEN_LAYERS = [
  "poi_stadium",
  "poi_park",
  "roadname_minor",
  "roadname_sec",
  "roadname_pri",
  "roadname_major",
  "housenumber",
  "building",
  "building-top",
  "landuse_residential",
  "waterway_label",
  "place_suburbs",
  "place_continent",
  // A large "ICELAND" across the middle of the map is not news here.
  "place_country_1",
  "place_country_2",
  "place_state",
];

/** Settlement labels we keep, with the opacity to render them at. */
const MUTED_LABELS: Array<[layerId: string, colour: string]> = [
  ["place_hamlet", "#5d6875"],
  ["place_villages", "#6b7684"],
  ["place_town", "#8d99a8"],
  ["place_city_r6", "#8d99a8"],
  ["place_city_r5", "#9aa6b5"],
  ["place_city_dot_r7", "#8d99a8"],
  ["place_city_dot_r4", "#a3afbe"],
  ["place_city_dot_r2", "#a3afbe"],
  ["place_city_dot_z7", "#8d99a8"],
  ["place_capital_dot_z7", "#b6c2d1"],
  ["watername_ocean", "#37424f"],
  ["watername_sea", "#37424f"],
  ["watername_lake", "#4a5562"],
  ["watername_lake_line", "#4a5562"],
];

/** Id of the first symbol layer, so data layers can be inserted beneath labels. */
export function firstSymbolLayerId(map: MapLibreMap): string | undefined {
  return map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
}

function setPaint(map: MapLibreMap, layerId: string, property: string, value: unknown): void {
  if (!map.getLayer(layerId)) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.setPaintProperty(layerId, property as any, value as any);
  } catch {
    // A renamed or restructured upstream layer is not worth failing the map for.
  }
}

/** Applies the Iceland Live treatment to a freshly loaded basemap style. */
export function tuneBaseStyle(map: MapLibreMap): void {
  setPaint(map, "background", "background-color", LAND);

  for (const layerId of ["landcover", "landuse", "park_national_park", "park_nature_reserve"]) {
    setPaint(map, layerId, "fill-color", LAND);
  }

  setPaint(map, "water", "fill-color", WATER);
  setPaint(map, "water_shadow", "fill-color", WATER);
  setPaint(map, "waterway", "line-color", "#1b2836");

  for (const layerId of HIDDEN_LAYERS) {
    if (map.getLayer(layerId)) {
      try {
        map.setLayoutProperty(layerId, "visibility", "none");
      } catch {
        /* see setPaint */
      }
    }
  }

  for (const [layerId, colour] of MUTED_LABELS) {
    setPaint(map, layerId, "text-color", colour);
    setPaint(map, layerId, "text-halo-color", "#04070c");
    setPaint(map, layerId, "text-halo-width", 1.2);
  }

  // Country borders are meaningless for an island; the coastline is the edge.
  setPaint(map, "boundary_country_outline", "line-opacity", 0);
  setPaint(map, "boundary_country_inner", "line-opacity", 0);
  setPaint(map, "boundary_state", "line-opacity", 0);
  setPaint(map, "boundary_county", "line-opacity", 0);

  addCoastline(map);
}

/**
 * Draws the water polygons' outline as a hairline.
 *
 * This is what makes the island's shape crisp: without it, land and ocean meet
 * as two flat fills and the coast goes soft.
 */
function addCoastline(map: MapLibreMap): void {
  if (map.getLayer("iceland-coastline")) return;
  if (!map.getSource("carto")) return;

  try {
    map.addLayer(
      {
        id: "iceland-coastline",
        type: "line",
        source: "carto",
        "source-layer": "water",
        paint: {
          "line-color": COAST,
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 7, 0.7, 10, 1.1, 14, 1.6],
          "line-opacity": 0.85,
        },
      },
      firstSymbolLayerId(map),
    );
  } catch {
    /* Optional refinement; a missing coastline is not a failure. */
  }
}
