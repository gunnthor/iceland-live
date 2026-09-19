"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type {
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MapLibreMap,
  MapGeoJSONFeature,
  MapMouseEvent,
} from "maplibre-gl";
import type { Earthquake } from "@/domain/earthquake";
import type maplibregl from "maplibre-gl";
import type { GnssStation } from "@/domain/deformation";
import type { ReykjanesLayer } from "@/domain/reykjanes";
import type { WebcamSite } from "@/domain/webcam";
import type { VolcanicSystem } from "@/domain/volcano";
import type { BoundingBox } from "@/lib/geo";
import { DEFAULT_FOCUS } from "@/lib/geo";
import { BASE_STYLE_URL, firstSymbolLayerId, tuneBaseStyle } from "./base-style";
import {
  toGnssGeoJson,
  toQuakeGeoJson,
  toVolcanoLineGeoJson,
  toVolcanoPointGeoJson,
  toWebcamGeoJson,
} from "./geojson";
import {
  pulseLayer,
  quakeLayer,
  radiusExpression,
  selectedLayer,
  QUAKE_LAYER_ID,
  QUAKE_PULSE_LAYER_ID,
  QUAKE_SELECTED_LAYER_ID,
  QUAKE_SOURCE_ID,
} from "./quake-layers";

/**
 * Places or removes the interferogram overlay.
 *
 * An `image` source must be created with a URL, so rather than keeping an empty
 * one around it is added when a product is selected and removed when it is
 * cleared. Corner order is the one MapLibre expects: top-left, top-right,
 * bottom-right, bottom-left.
 */
function setInsarOverlay(map: MapLibreMap, insar: InsarOverlay | null, beforeId?: string): void {
  if (!insar) {
    if (map.getLayer(INSAR_LAYER)) map.removeLayer(INSAR_LAYER);
    if (map.getSource(INSAR_SOURCE)) map.removeSource(INSAR_SOURCE);
    return;
  }

  const { west, south, east, north } = insar.bounds;
  const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];

  const existing = map.getSource(INSAR_SOURCE);
  if (existing && "updateImage" in existing) {
    (existing as maplibregl.ImageSource).updateImage({ url: insar.imageUrl, coordinates });
    return;
  }

  map.addSource(INSAR_SOURCE, { type: "image", url: insar.imageUrl, coordinates });
  map.addLayer(
    {
      id: INSAR_LAYER,
      type: "raster",
      source: INSAR_SOURCE,
      /*
       * Deliberately below half. The point of laying an interferogram on the
       * map is to see deformation *with* the seismicity, and at full strength
       * these images are vivid enough to bury every earthquake marker and the
       * lava barriers underneath them.
       */
      paint: { "raster-opacity": 0.55, "raster-fade-duration": 200 },
    },
    beforeId,
  );
}

/** Narrows a style source to a GeoJSON source before writing data to it. */
function geoJsonSource(map: MapLibreMap, id: string): GeoJSONSource | null {
  const source = map.getSource(id);
  return source && source.type === "geojson" ? (source as GeoJSONSource) : null;
}

const VOLCANO_LINE_SOURCE = "volcano-lines";
const VOLCANO_POINT_SOURCE = "volcano-points";
const VOLCANO_LINE_LAYER = "volcano-line";
const VOLCANO_LABEL_LAYER = "volcano-label";
const VOLCANO_STATUS_LAYER = "volcano-status";
const ALERT_AREA_SOURCE = "alert-area";
const ALERT_AREA_FILL_LAYER = "alert-area-fill";
const ALERT_AREA_LINE_LAYER = "alert-area-line";
const LAVA_SOURCE = "reykjanes-lava";
const BARRIER_SOURCE = "reykjanes-barriers";
const GRABEN_SOURCE = "reykjanes-graben";
const FACILITY_SOURCE = "reykjanes-facilities";
const LAVA_FILL_LAYER = "reykjanes-lava-fill";
const LAVA_LINE_LAYER = "reykjanes-lava-line";
const GRABEN_LAYER = "reykjanes-graben-line";
const BARRIER_LAYER = "reykjanes-barrier-line";
const FACILITY_LAYER = "reykjanes-facility";
const FACILITY_LABEL_LAYER = "reykjanes-facility-label";
const INSAR_SOURCE = "insar-image";
const INSAR_LAYER = "insar-raster";
const GNSS_SOURCE = "gnss-stations";
const GNSS_LAYER = "gnss-station";
const GNSS_LABEL_LAYER = "gnss-station-label";
const WEBCAM_SOURCE = "webcams";
const WEBCAM_LAYER = "webcam-site";
const WEBCAM_LABEL_LAYER = "webcam-site-label";

/** Every layer belonging to the Reykjanes detail set, toggled together. */
const REYKJANES_LAYERS = [
  LAVA_FILL_LAYER,
  LAVA_LINE_LAYER,
  GRABEN_LAYER,
  BARRIER_LAYER,
  FACILITY_LAYER,
  FACILITY_LABEL_LAYER,
];

/** Attribution shown in the map corner. Every source we draw is credited. */
const ATTRIBUTION = [
  'Earthquakes: <a href="https://en.vedur.is/" target="_blank" rel="noopener">Icelandic Met Office</a>',
  'Volcanic systems: <a href="https://icelandicvolcanoes.is/" target="_blank" rel="noopener">Catalogue of Icelandic Volcanoes</a>',
  '<a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
].join(" · ");

export type MapPadding = { top: number; right: number; bottom: number; left: number };

/** The interferogram currently laid over the map, if any. */
export type InsarOverlay = {
  imageUrl: string;
  bounds: { west: number; south: number; east: number; north: number };
};

export type MapViewHandle = {
  /** Frames a bounding box, respecting the current panel padding. */
  fitBounds: (bounds: BoundingBox, options?: { maxZoom?: number }) => void;
  /** Centres on a single event. */
  flyToPoint: (longitude: number, latitude: number, zoom?: number) => void;
  resize: () => void;
};

/** Everything the map renders, in one shape, so it can be applied atomically. */
type MapData = {
  quakes: readonly Earthquake[];
  referenceMs: number;
  selectedId: string | null;
  volcanoes: readonly VolcanicSystem[] | null;
  showVolcanoes: boolean;
  alertArea: GeoJSON.FeatureCollection | null;
  reykjanes: ReykjanesLayer | null;
  showReykjanes: boolean;
  stations: readonly GnssStation[];
  showStations: boolean;
  insar: InsarOverlay | null;
  webcams: readonly WebcamSite[];
  showWebcams: boolean;
};

/**
 * Writes a full snapshot of the data to a loaded style.
 *
 * Used once when the style finishes loading, and by the individual effects
 * thereafter.
 */
function applyAll(map: MapLibreMap, data: MapData): void {
  geoJsonSource(map, QUAKE_SOURCE_ID)?.setData(toQuakeGeoJson(data.quakes, data.referenceMs));

  if (map.getLayer(QUAKE_SELECTED_LAYER_ID)) {
    map.setFilter(QUAKE_SELECTED_LAYER_ID, ["==", ["get", "id"], data.selectedId ?? ""]);
  }

  if (data.volcanoes) {
    geoJsonSource(map, VOLCANO_LINE_SOURCE)?.setData(toVolcanoLineGeoJson(data.volcanoes));
    geoJsonSource(map, VOLCANO_POINT_SOURCE)?.setData(toVolcanoPointGeoJson(data.volcanoes));
  }

  const visibility = data.showVolcanoes ? "visible" : "none";
  for (const layerId of [VOLCANO_LINE_LAYER, VOLCANO_STATUS_LAYER, VOLCANO_LABEL_LAYER]) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
  }

  geoJsonSource(map, ALERT_AREA_SOURCE)?.setData(
    data.alertArea ?? { type: "FeatureCollection", features: [] },
  );

  if (data.reykjanes) {
    geoJsonSource(map, LAVA_SOURCE)?.setData(data.reykjanes.lava);
    geoJsonSource(map, BARRIER_SOURCE)?.setData(data.reykjanes.barriers);
    geoJsonSource(map, GRABEN_SOURCE)?.setData(data.reykjanes.graben);
    geoJsonSource(map, FACILITY_SOURCE)?.setData(data.reykjanes.facilities);
  }

  const reykjanesVisibility = data.showReykjanes ? "visible" : "none";
  for (const layerId of REYKJANES_LAYERS) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", reykjanesVisibility);
  }

  geoJsonSource(map, GNSS_SOURCE)?.setData(toGnssGeoJson(data.stations));
  const gnssVisibility = data.showStations ? "visible" : "none";
  for (const layerId of [GNSS_LAYER, GNSS_LABEL_LAYER]) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", gnssVisibility);
  }

  setInsarOverlay(map, data.insar, firstSymbolLayerId(map));

  geoJsonSource(map, WEBCAM_SOURCE)?.setData(toWebcamGeoJson(data.webcams));
  const webcamVisibility = data.showWebcams ? "visible" : "none";
  for (const layerId of [WEBCAM_LAYER, WEBCAM_LABEL_LAYER]) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", webcamVisibility);
  }
}

export type MapViewProps = {
  quakes: readonly Earthquake[];
  /** Instant marker ages are measured from. */
  referenceMs: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  volcanoes: readonly VolcanicSystem[] | null;
  showVolcanoes: boolean;
  /** Area of the official warning being shown, or null. */
  alertArea: GeoJSON.FeatureCollection | null;
  /** Reykjanes detail layers, once loaded. */
  reykjanes: ReykjanesLayer | null;
  showReykjanes: boolean;
  /** GNSS station network. Locations only; no displacements are published. */
  stations: readonly GnssStation[];
  showStations: boolean;
  /** Interferogram overlay, or null when none is selected. */
  insar: InsarOverlay | null;
  /** Road camera sites. */
  webcams: readonly WebcamSite[];
  showWebcams: boolean;
  /** Space reserved for the surrounding panels, so framing stays visible. */
  padding: MapPadding;
  onReady?: () => void;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function toLngLatBounds(box: BoundingBox): LngLatBoundsLike {
  return [
    [box.west, box.south],
    [box.east, box.north],
  ];
}

export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  {
    quakes,
    referenceMs,
    selectedId,
    onSelect,
    volcanoes,
    showVolcanoes,
    alertArea,
    reykjanes,
    showReykjanes,
    stations,
    showStations,
    insar,
    webcams,
    showWebcams,
    padding,
    onReady,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  const paddingRef = useRef(padding);
  paddingRef.current = padding;

  /** Latest props the map's event handlers need, without re-binding them. */
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  /*
   * The map is created asynchronously, so by the time its `load` event fires
   * the data effects below have already run and bailed out (the style was not
   * ready). This ref carries the current props into the load handler so the
   * first paint has data, rather than waiting for the next poll.
   */
  const latestRef = useRef({
    quakes,
    referenceMs,
    selectedId,
    volcanoes,
    showVolcanoes,
    alertArea,
    reykjanes,
    showReykjanes,
    stations,
    showStations,
    insar,
    webcams,
    showWebcams,
  });
  latestRef.current = {
    quakes,
    referenceMs,
    selectedId,
    volcanoes,
    showVolcanoes,
    alertArea,
    reykjanes,
    showReykjanes,
    stations,
    showStations,
    insar,
    webcams,
    showWebcams,
  };

  useImperativeHandle(
    ref,
    (): MapViewHandle => ({
      fitBounds: (bounds, options) => {
        const map = mapRef.current;
        if (!map) return;
        map.fitBounds(toLngLatBounds(bounds), {
          padding: paddingRef.current,
          maxZoom: options?.maxZoom ?? 11,
          duration: prefersReducedMotion() ? 0 : 1100,
          essential: true,
        });
      },
      flyToPoint: (longitude, latitude, zoom = 10) => {
        const map = mapRef.current;
        if (!map) return;
        map.flyTo({
          center: [longitude, latitude],
          zoom: Math.max(map.getZoom(), zoom),
          padding: paddingRef.current,
          duration: prefersReducedMotion() ? 0 : 1100,
          essential: true,
        });
      },
      resize: () => mapRef.current?.resize(),
    }),
    [],
  );

  // --- Map creation. Runs once; everything after is an update. ----------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let cancelled = false;
    let map: MapLibreMap | null = null;

    // maplibre-gl is ~800 KB; keeping it out of the initial bundle lets the
    // shell and the first statistics paint before the map arrives.
    // maplibre-gl is ~800 KB; keeping it out of the initial bundle lets the
    // shell and the first statistics paint before the map arrives. v6 is pure
    // ESM with named exports — there is no default export to destructure.
    /*
     * maplibre-gl is ~1 MB; loading it on demand lets the shell and the first
     * statistics paint before the map arrives.
     *
     * The interop dance below is deliberate. maplibre-gl 5 ships as a single
     * UMD bundle with its web worker inlined as a blob, which is what makes it
     * work under a bundler at all — version 6 splits the worker into a sibling
     * chunk it locates with `new URL('./maplibre-gl-worker.mjs', import.meta.url)`,
     * a dynamic form no bundler can rewrite. Under Next that URL 404s, the
     * worker dies on creation, and the style never finishes loading: a map that
     * reports no error and renders nothing. Being a CJS bundle, how the named
     * exports arrive depends on the bundler's interop, so we resolve the
     * namespace before reading from it.
     */
    void import("maplibre-gl").then((mod) => {
      if (cancelled || !containerRef.current) return;

      const maplibregl = mod.Map ? mod : (mod.default as unknown as typeof mod);
      const { Map: MapLibreGL, AttributionControl, NavigationControl } = maplibregl;

      const instance = new MapLibreGL({
        container: containerRef.current,
        style: BASE_STYLE_URL,
        bounds: toLngLatBounds(DEFAULT_FOCUS.bounds),
        fitBoundsOptions: { padding: paddingRef.current },
        minZoom: 3.2,
        maxZoom: 14,
        attributionControl: false,
        // Capping at 2 keeps text crisp without the memory cost of 3x tiles.
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });

      instance.touchZoomRotate.disableRotation();

      instance.addControl(
        new AttributionControl({ compact: true, customAttribution: ATTRIBUTION }),
        "bottom-right",
      );
      instance.addControl(
        new NavigationControl({ showCompass: false, visualizePitch: false }),
        "bottom-right",
      );

      map = instance;
      mapRef.current = instance;

      instance.on("load", () => {
        if (cancelled) return;
        tuneBaseStyle(instance);
        installDataLayers(instance);
        loadedRef.current = true;
        applyAll(instance, latestRef.current);
        onReady?.();
      });

      instance.on("error", (event) => {
        // Tile fetch failures are routine on a flaky connection and MapLibre
        // recovers on its own; surfacing them as console errors is just noise.
        const message = (event as { error?: { message?: string } }).error?.message ?? "";
        if (/Failed to fetch|NetworkError|AbortError/i.test(message)) return;
        console.warn("[map]", message || event);
      });
    });

    return () => {
      cancelled = true;
      loadedRef.current = false;
      map?.remove();
      mapRef.current = null;
    };
    // Intentionally empty: the map is created once and updated imperatively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Adds sources, layers and interaction handlers to a loaded style. */
  const installDataLayers = useCallback((map: MapLibreMap) => {
    const beforeId = firstSymbolLayerId(map);

    map.addSource(QUAKE_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addSource(VOLCANO_LINE_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addSource(VOLCANO_POINT_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addSource(ALERT_AREA_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    for (const id of [
      LAVA_SOURCE,
      BARRIER_SOURCE,
      GRABEN_SOURCE,
      FACILITY_SOURCE,
      GNSS_SOURCE,
      WEBCAM_SOURCE,
    ]) {
      map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }

    // Volcanic line work sits beneath the events: it is context, not content.
    map.addLayer(
      {
        id: VOLCANO_LINE_LAYER,
        type: "line",
        source: VOLCANO_LINE_SOURCE,
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#b8674a",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.7, 8, 1.2, 12, 2],
          "line-opacity": 0.5,
          "line-dasharray": [3, 2],
        },
      },
      beforeId,
    );

    /*
     * The area of the official warning the reader has asked to see.
     *
     * Only ever one at a time, and only on request: IMO's forecast regions are
     * large enough that showing several would blanket the map and bury the
     * earthquakes. Drawn in the warning's own published colour, beneath the
     * events.
     */
    map.addLayer(
      {
        id: ALERT_AREA_FILL_LAYER,
        type: "fill",
        source: ALERT_AREA_SOURCE,
        paint: { "fill-color": ["get", "colour"], "fill-opacity": 0.1 },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: ALERT_AREA_LINE_LAYER,
        type: "line",
        source: ALERT_AREA_SOURCE,
        paint: {
          "line-color": ["get", "colour"],
          "line-width": 1.2,
          "line-opacity": 0.75,
          "line-dasharray": [4, 2],
        },
      },
      beforeId,
    );

    /*
     * Reykjanes detail, drawn beneath the events.
     *
     * Lava is ground, not data: it is shaded by how recently it erupted, dark
     * enough to read as terrain rather than as something to click. The
     * barriers are the exception — they are engineered structures built to
     * protect Grindavík and Svartsengi, so they get the one bright line in
     * the set.
     */
    map.addLayer(
      {
        id: LAVA_FILL_LAYER,
        type: "fill",
        source: LAVA_SOURCE,
        layout: { visibility: "none" },
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["get", "recencyIndex"],
            0, "#4a2418",
            3, "#3a2018",
            7, "#2c1c18",
            11, "#231b1a",
          ],
          "fill-opacity": 0.85,
        },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: LAVA_LINE_LAYER,
        type: "line",
        source: LAVA_SOURCE,
        layout: { visibility: "none" },
        paint: {
          "line-color": [
            "interpolate",
            ["linear"],
            ["get", "recencyIndex"],
            0, "#8a4a30",
            5, "#5c3628",
            11, "#3d2c26",
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.4, 12, 1],
          "line-opacity": 0.9,
        },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: GRABEN_LAYER,
        type: "line",
        source: GRABEN_SOURCE,
        layout: { visibility: "none" },
        paint: {
          "line-color": "#6f8296",
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.8, 13, 1.8],
          "line-opacity": 0.75,
          "line-dasharray": [2, 2],
        },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: BARRIER_LAYER,
        type: "line",
        source: BARRIER_SOURCE,
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#d8dee8",
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 12, 2.6, 14, 4],
          "line-opacity": 0.95,
        },
      },
      beforeId,
    );

    map.addLayer({ ...pulseLayer, source: QUAKE_SOURCE_ID }, beforeId);
    map.addLayer({ ...quakeLayer, source: QUAKE_SOURCE_ID }, beforeId);
    map.addLayer({ ...selectedLayer, source: QUAKE_SOURCE_ID }, beforeId);

    /*
     * Official status, shown as IMO publishes it.
     *
     * The colour is the ICAO aviation colour code from that volcano's most
     * recent VONA notice — IMO's own assessment, not ours. We render it in the
     * published colours precisely so it cannot be confused with our statistical
     * observations, which are monochrome-on-amber elsewhere in the interface.
     */
    map.addLayer({
      id: VOLCANO_STATUS_LAYER,
      type: "circle",
      source: VOLCANO_POINT_SOURCE,
      layout: { visibility: "none" },
      filter: [">=", ["get", "aviationRank"], 0],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3, 9, 5],
        "circle-color": [
          "match",
          ["get", "aviation"],
          "RED", "#e2564a",
          "ORANGE", "#e8913c",
          "YELLOW", "#e8c34a",
          "#3fb27f",
        ],
        "circle-opacity": ["case", [">", ["get", "aviationRank"], 0], 0.95, 0.5],
        "circle-stroke-width": 1,
        "circle-stroke-color": "#04070c",
      },
    });

    /*
     * GNSS stations: instrument locations, not measurements.
     *
     * Drawn as small hollow squares so they never read as events. IMO does not
     * publish processed displacements through this API, so there is nothing
     * here to size or colour by — the layer answers "what is watching this
     * area", and links out to IMO's own data.
     */
    map.addLayer({
      id: GNSS_LAYER,
      type: "circle",
      source: GNSS_SOURCE,
      layout: { visibility: "none" },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.2, 10, 4],
        "circle-color": "transparent",
        "circle-stroke-width": 1.4,
        "circle-stroke-color": ["case", ["get", "active"], "#7fd4c1", "#5a6672"],
        "circle-stroke-opacity": 0.9,
      },
    });

    map.addLayer({
      id: GNSS_LABEL_LAYER,
      type: "symbol",
      source: GNSS_SOURCE,
      minzoom: 8,
      layout: {
        visibility: "none",
        "text-field": ["get", "marker"],
        "text-font": ["Open Sans Regular"],
        "text-size": 10,
        "text-offset": [0, 1],
        "text-anchor": "top",
        "text-padding": 4,
      },
      paint: {
        "text-color": "#7fd4c1",
        "text-halo-color": "#04070c",
        "text-halo-width": 1.4,
        "text-opacity": 0.85,
      },
    });

    map.addLayer({
      id: FACILITY_LAYER,
      type: "circle",
      source: FACILITY_SOURCE,
      layout: { visibility: "none" },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 12, 4.5],
        "circle-color": "#8fa3bd",
        "circle-stroke-width": 1.2,
        "circle-stroke-color": "#04070c",
      },
    });

    map.addLayer({
      id: FACILITY_LABEL_LAYER,
      type: "symbol",
      source: FACILITY_SOURCE,
      layout: {
        visibility: "none",
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 12, 12],
        "text-offset": [0, 1],
        "text-anchor": "top",
        "text-padding": 6,
      },
      paint: {
        "text-color": "#a9b8cc",
        "text-halo-color": "#04070c",
        "text-halo-width": 1.4,
      },
    });

    /*
     * Road cameras. Drawn above the events, because they are things you click
     * rather than data you read, and a marker hidden under a swarm is useless.
     */
    map.addLayer({
      id: WEBCAM_LAYER,
      type: "circle",
      source: WEBCAM_SOURCE,
      layout: { visibility: "none" },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.4, 10, 5],
        "circle-color": "#0b0e13",
        "circle-stroke-width": 1.6,
        "circle-stroke-color": "#c3b3f0",
        "circle-stroke-opacity": 0.9,
      },
    });

    map.addLayer({
      id: WEBCAM_LABEL_LAYER,
      type: "symbol",
      source: WEBCAM_SOURCE,
      minzoom: 9,
      layout: {
        visibility: "none",
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Regular"],
        "text-size": 10,
        "text-offset": [0, 1],
        "text-anchor": "top",
        "text-padding": 4,
      },
      paint: {
        "text-color": "#c3b3f0",
        "text-halo-color": "#04070c",
        "text-halo-width": 1.4,
        "text-opacity": 0.9,
      },
    });

    map.addLayer({
      id: VOLCANO_LABEL_LAYER,
      type: "symbol",
      source: VOLCANO_POINT_SOURCE,
      layout: {
        visibility: "none",
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Semibold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 5, 9, 9, 12],
        "text-offset": [0, 0.9],
        "text-anchor": "top",
        "text-allow-overlap": false,
        "text-padding": 6,
      },
      paint: {
        // Systems IMO has raised above background read brighter.
        "text-color": ["case", [">", ["get", "elevated"], 0], "#e8b39c", "#b0806e"],
        "text-halo-color": "#04070c",
        "text-halo-width": 1.4,
        "text-opacity": ["case", [">", ["get", "elevated"], 0], 1, 0.82],
      },
    });

    const pick = (event: MapMouseEvent): MapGeoJSONFeature | undefined => {
      // A small query box makes the smallest markers tappable on a phone.
      const box: [[number, number], [number, number]] = [
        [event.point.x - 8, event.point.y - 8],
        [event.point.x + 8, event.point.y + 8],
      ];
      const hits = map.queryRenderedFeatures(box, { layers: [QUAKE_LAYER_ID] });
      if (hits.length <= 1) return hits[0];
      // Overlapping markers: prefer the largest, then the most recent.
      return [...hits].sort((a, b) => {
        const magA = Number(a.properties?.mag ?? -9);
        const magB = Number(b.properties?.mag ?? -9);
        if (magB !== magA) return magB - magA;
        return Number(a.properties?.ageHours ?? 0) - Number(b.properties?.ageHours ?? 0);
      })[0];
    };

    map.on("click", (event) => {
      const feature = pick(event);
      onSelectRef.current(feature ? String(feature.properties?.id ?? "") || null : null);
    });

    map.on("mousemove", (event) => {
      map.getCanvas().style.cursor = pick(event) ? "pointer" : "";
    });
  }, []);

  // --- Earthquake data --------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    geoJsonSource(map, QUAKE_SOURCE_ID)?.setData(toQuakeGeoJson(quakes, referenceMs));
  }, [quakes, referenceMs]);

  // --- Selection --------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !map.getLayer(QUAKE_SELECTED_LAYER_ID)) return;
    map.setFilter(QUAKE_SELECTED_LAYER_ID, ["==", ["get", "id"], selectedId ?? ""]);
  }, [selectedId]);

  // --- Volcanic systems -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !volcanoes) return;

    geoJsonSource(map, VOLCANO_LINE_SOURCE)?.setData(toVolcanoLineGeoJson(volcanoes));
    geoJsonSource(map, VOLCANO_POINT_SOURCE)?.setData(toVolcanoPointGeoJson(volcanoes));
  }, [volcanoes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const visibility = showVolcanoes ? "visible" : "none";
    for (const layerId of [VOLCANO_LINE_LAYER, VOLCANO_STATUS_LAYER, VOLCANO_LABEL_LAYER]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }, [showVolcanoes, volcanoes]);

  // --- Official warning area ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    geoJsonSource(map, ALERT_AREA_SOURCE)?.setData(
      alertArea ?? { type: "FeatureCollection", features: [] },
    );
  }, [alertArea]);

  // --- Reykjanes detail ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !reykjanes) return;
    geoJsonSource(map, LAVA_SOURCE)?.setData(reykjanes.lava);
    geoJsonSource(map, BARRIER_SOURCE)?.setData(reykjanes.barriers);
    geoJsonSource(map, GRABEN_SOURCE)?.setData(reykjanes.graben);
    geoJsonSource(map, FACILITY_SOURCE)?.setData(reykjanes.facilities);
  }, [reykjanes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const visibility = showReykjanes ? "visible" : "none";
    for (const layerId of REYKJANES_LAYERS) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }, [showReykjanes, reykjanes]);

  // --- GNSS network ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    geoJsonSource(map, GNSS_SOURCE)?.setData(toGnssGeoJson(stations));
  }, [stations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const visibility = showStations ? "visible" : "none";
    for (const layerId of [GNSS_LAYER, GNSS_LABEL_LAYER]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }, [showStations, stations]);

  // --- Road cameras ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    geoJsonSource(map, WEBCAM_SOURCE)?.setData(toWebcamGeoJson(webcams));
  }, [webcams]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const visibility = showWebcams ? "visible" : "none";
    for (const layerId of [WEBCAM_LAYER, WEBCAM_LABEL_LAYER]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }, [showWebcams, webcams]);

  // --- Interferogram overlay ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    setInsarOverlay(map, insar, firstSymbolLayerId(map));
  }, [insar]);

  // --- Pulse animation --------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || prefersReducedMotion()) return;

    let frame = 0;
    let lastPaint = 0;
    const PERIOD_MS = 2600;
    // ~20fps is plenty for a slow pulse and a fraction of the paint cost of 60.
    const FRAME_MS = 50;

    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (time - lastPaint < FRAME_MS) return;
      lastPaint = time;

      if (!map.getLayer(QUAKE_PULSE_LAYER_ID)) return;
      const phase = (time % PERIOD_MS) / PERIOD_MS;
      const eased = 1 - (1 - phase) * (1 - phase);

      try {
        map.setPaintProperty(QUAKE_PULSE_LAYER_ID, "circle-opacity", 0.3 * (1 - eased));
        // Rebuilt rather than multiplied: a zoom interpolation may only appear
        // at the top level of an expression (see `radiusExpression`).
        map.setPaintProperty(
          QUAKE_PULSE_LAYER_ID,
          "circle-radius",
          radiusExpression(0.7 + eased * 1.5),
        );
      } catch {
        /* The style can be mid-reload; skip this frame. */
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // --- Viewport ---------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const observer = new ResizeObserver(() => map.resize());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    // The outer element owns the positioning; the inner one is handed to
    // MapLibre and only ever has to fill its parent. Keeping those jobs apart
    // means MapLibre's own stylesheet cannot fight our layout.
    <div
      className="absolute inset-0"
      // The activity list carries the same information in text, which is what
      // a screen reader user navigates; the canvas itself has nothing to read.
      role="presentation"
      aria-hidden="true"
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
});
