/**
 * How an earthquake looks on the map.
 *
 * Three encodings, in order of how loudly they speak:
 *
 *   **Size — magnitude.** The one thing a reader should be able to judge at a
 *   glance. Radius grows with magnitude and with zoom.
 *
 *   **Colour — recency.** Warm for the last minutes, cooling to slate over
 *   days. This is what makes the map feel alive without animating anything.
 *
 *   **Edge — depth.** Shallow events get a crisp, brighter rim; deep ones a
 *   softer, dimmer one. It is deliberately quiet — depth is the third thing you
 *   notice, not the first.
 *
 * ## Why no clustering
 *
 * A 30-day window is about 2,800 points. A single GeoJSON source drawn by one
 * WebGL circle layer handles that without effort, and clustering would defeat
 * the purpose: the shape of a swarm *is* the information. Clustering would be
 * worth revisiting only if we started plotting years of catalogue at once.
 */

import type { CircleLayerSpecification, ExpressionSpecification } from "maplibre-gl";

export const QUAKE_SOURCE_ID = "quakes";
export const QUAKE_LAYER_ID = "quake-points";
export const QUAKE_PULSE_LAYER_ID = "quake-pulse";
export const QUAKE_SELECTED_LAYER_ID = "quake-selected";

/** Feature properties we attach to each point. */
export type QuakeFeatureProps = {
  id: string;
  /** Magnitude, or `-9` when unknown — kept numeric so expressions stay simple. */
  mag: number;
  hasMag: boolean;
  depth: number;
  hasDepth: boolean;
  /** Hours since the event, relative to the payload's generation time. */
  ageHours: number;
  region: string;
};

/** Magnitude used for sizing when an event has none reported. */
export const UNKNOWN_MAGNITUDE_SIZE = 0.2;

/**
 * Radius in pixels, interpolated over magnitude and zoom.
 *
 * Icelandic magnitudes run from about -1.5 to 5. The curve is deliberately
 * shallow at the bottom — a swarm of M0 events should read as texture, not as
 * hundreds of competing dots — and opens up above M2 where events start to
 * matter to people.
 *
 * The table is expanded into an expression rather than written out once and
 * scaled arithmetically: MapLibre only accepts `["zoom"]` as the input to a
 * *top-level* `interpolate`, so `["*", RADIUS, 1.8]` is rejected outright and
 * the layer silently falls back to a default radius. Layers that want a bigger
 * or smaller version of this curve get their own expression built from the same
 * numbers.
 */
const MAGNITUDE_STOPS = [-1, 0, 1, 2, 3, 4, 5] as const;

/** Radius per magnitude stop, at each zoom anchor. */
const RADIUS_BY_ZOOM: Array<[zoom: number, radii: readonly number[]]> = [
  [4, [1.6, 2.2, 3.2, 5, 8, 12, 17]],
  [8, [2.4, 3.4, 5, 8, 13, 19, 26]],
  [12, [4, 5.5, 8, 13, 21, 30, 42]],
];

/**
 * Builds a radius expression, optionally scaled and offset.
 *
 * `scale` multiplies the curve (the pulse halo uses this); `offset` adds a flat
 * number of pixels (the selection ring uses this, so the gap it leaves is
 * constant rather than proportional).
 */
export function radiusExpression(scale = 1, offset = 0): ExpressionSpecification {
  const byZoom = RADIUS_BY_ZOOM.flatMap(([zoom, radii]) => [
    zoom,
    [
      "interpolate",
      ["linear"],
      ["get", "mag"],
      ...MAGNITUDE_STOPS.flatMap((mag, i) => [mag, (radii[i] as number) * scale + offset]),
    ],
  ]);
  return ["interpolate", ["linear"], ["zoom"], ...byZoom] as ExpressionSpecification;
}

const RADIUS = radiusExpression();

/**
 * Colour by age in hours.
 *
 * The first hour is the only part of the ramp that is genuinely hot, so a fresh
 * event stands out against a busy field without the whole map turning orange.
 */
const COLOUR: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["get", "ageHours"],
  0, "#ff6b3d",
  1, "#f8843c",
  6, "#e8a33c",
  24, "#9aa0ad",
  72, "#6d7684",
  360, "#4d5663",
];

/** Fresh events sit at full strength; older ones recede. */
const OPACITY: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["get", "ageHours"],
  0, 0.95,
  24, 0.82,
  168, 0.62,
  720, 0.5,
];

/** Shallow events get a brighter rim, deep ones almost none. */
const STROKE_OPACITY: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["get", "depth"],
  0, 0.55,
  5, 0.35,
  12, 0.18,
  25, 0.08,
];

/** A hint of softness with depth, as if the event were further away. */
const BLUR: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["get", "depth"],
  0, 0,
  10, 0.12,
  25, 0.3,
];

export const quakeLayer: Omit<CircleLayerSpecification, "source"> = {
  id: QUAKE_LAYER_ID,
  type: "circle",
  paint: {
    "circle-radius": RADIUS,
    "circle-color": COLOUR,
    "circle-opacity": OPACITY,
    "circle-blur": BLUR,
    "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 10, 1.1],
    "circle-stroke-color": "#ffffff",
    "circle-stroke-opacity": STROKE_OPACITY,
  },
};

/**
 * The ring drawn around the selected event.
 *
 * Rendered as its own layer filtered to one feature, which is cheaper and
 * steadier than restyling the main layer on every selection change.
 */
export const selectedLayer: Omit<CircleLayerSpecification, "source"> = {
  id: QUAKE_SELECTED_LAYER_ID,
  type: "circle",
  filter: ["==", ["get", "id"], ""],
  paint: {
    "circle-radius": radiusExpression(1, 7),
    "circle-color": "transparent",
    "circle-stroke-width": 1.5,
    "circle-stroke-color": "#ffffff",
    "circle-stroke-opacity": 0.9,
  },
};

/**
 * The pulse layer.
 *
 * Only events that are both recent and large enough to matter get one, so the
 * map never turns into a field of blinking dots. Radius and opacity are driven
 * from an animation frame in `MapView`; under `prefers-reduced-motion` the
 * layer is added but never animated, leaving a static halo.
 */
export const PULSE_MAX_AGE_HOURS = 1;
export const PULSE_MIN_MAGNITUDE = 1.2;

export const pulseLayer: Omit<CircleLayerSpecification, "source"> = {
  id: QUAKE_PULSE_LAYER_ID,
  type: "circle",
  filter: [
    "all",
    ["<", ["get", "ageHours"], PULSE_MAX_AGE_HOURS],
    [">=", ["get", "mag"], PULSE_MIN_MAGNITUDE],
  ],
  paint: {
    "circle-radius": radiusExpression(1.8),
    "circle-color": "#ff6b3d",
    "circle-opacity": 0.22,
    "circle-blur": 0.55,
  },
};
