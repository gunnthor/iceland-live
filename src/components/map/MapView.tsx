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
import type { AirQualityStation } from "@/domain/air-quality";
import { conditionSeverity, type RoadWeatherStation } from "@/domain/roads";
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
  toAirGeoJson,
  toWindGeoJson,
  toPlumeOriginGeoJson,
  toPointGeoJson,
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
 * Places, updates or removes a georeferenced image overlay.
 *
 * An `image` source must be created with a URL, so rather than keeping an
 * empty one around it is added when a product is selected and removed when it
 * is cleared. Corner order is the one MapLibre expects: top-left, top-right,
 * bottom-right, bottom-left.
 *
 * Shared by the interferograms and the dispersal rasters. They differ only in
 * where the pixels come from and how strongly they are drawn, and having two
 * copies of the add/update/remove dance is how one of them ends up leaking a
 * source.
 */
function setImageOverlay(
  map: MapLibreMap,
  ids: { source: string; layer: string },
  overlay: ImageOverlay | null,
  opacity: number,
  beforeId?: string,
): void {
  if (!overlay) {
    if (map.getLayer(ids.layer)) map.removeLayer(ids.layer);
    if (map.getSource(ids.source)) map.removeSource(ids.source);
    return;
  }

  const { west, south, east, north } = overlay.bounds;
  const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];

  const existing = map.getSource(ids.source);
  if (existing && "updateImage" in existing) {
    (existing as maplibregl.ImageSource).updateImage({ url: overlay.imageUrl, coordinates });
    return;
  }

  map.addSource(ids.source, { type: "image", url: overlay.imageUrl, coordinates });
  map.addLayer(
    {
      id: ids.layer,
      type: "raster",
      source: ids.source,
      paint: { "raster-opacity": opacity, "raster-fade-duration": 200 },
    },
    beforeId,
  );
}

/*
 * Deliberately below half for interferograms. The point of laying one on the
 * map is to see deformation *with* the seismicity, and at full strength these
 * images are vivid enough to bury every earthquake marker and the lava
 * barriers underneath them.
 */
const INSAR_OPACITY = 0.55;

/*
 * A dispersal raster carries IMO's own alpha, so it is already translucent
 * where the plume is thin. Held a little under three quarters: high enough
 * that the faint outer edge survives — the part most likely to be over
 * somewhere populated — and low enough that the earthquakes underneath a
 * saturated core are still findable.
 */
const PLUME_OPACITY = 0.72;

/**
 * Registers the arrow used by the wind layer.
 *
 * Drawn into a canvas at load rather than shipped as a file: it is a dozen
 * lines of path, and an icon fetched over the network is one more thing that
 * can fail between the map and a reader looking for wind direction.
 *
 * Points up (north) at 0°, so MapLibre's `icon-rotate` maps directly onto a
 * compass bearing.
 */
function addWindArrow(map: MapLibreMap): void {
  if (map.hasImage(WIND_ARROW_ICON)) return;

  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return;

  /*
   * Chunkier than looks right at 48 px, because it is never drawn at 48 px.
   * A thin arrow disappears entirely once scaled down to map size — the shaft
   * lands below one pixel and all that survives is a faint smudge.
   */
  context.translate(size / 2, size / 2);
  context.beginPath();
  context.moveTo(0, -20);        // tip
  context.lineTo(11, -2);        // right barb
  context.lineTo(4, -4);
  context.lineTo(4, 19);         // tail
  context.lineTo(-4, 19);
  context.lineTo(-4, -4);
  context.lineTo(-11, -2);       // left barb
  context.closePath();

  context.fillStyle = "#8fd6ff";
  context.fill();
  context.strokeStyle = "#04070c";
  context.lineWidth = 1.2;
  context.stroke();

  const image = context.getImageData(0, 0, size, size);
  map.addImage(WIND_ARROW_ICON, image, { pixelRatio: 2 });
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
const PLUME_SOURCE = "dispersion-image";
const PLUME_LAYER = "dispersion-raster";
const PROBE_SOURCE = "dispersion-probe";
const PROBE_LAYER = "dispersion-probe-point";
const PLUME_ORIGIN_SOURCE = "dispersion-origin";
const PLUME_ORIGIN_LAYER = "dispersion-origin-point";
const PLUME_ORIGIN_LABEL_LAYER = "dispersion-origin-label";
const GNSS_SOURCE = "gnss-stations";
const GNSS_LAYER = "gnss-station";
const GNSS_LABEL_LAYER = "gnss-station-label";
const WEBCAM_SOURCE = "webcams";
const WEBCAM_LAYER = "webcam-site";
const WEBCAM_LABEL_LAYER = "webcam-site-label";
const WEBCAM_SELECTED_LAYER = "webcam-site-selected";
const AIR_SOURCE = "air-quality";
const AIR_LAYER = "air-station";
const AIR_LABEL_LAYER = "air-station-label";
const WIND_SOURCE = "road-wind";
const WIND_LAYER = "road-wind-arrow";
const ROAD_CONDITION_SOURCE = "road-conditions";
const ROAD_CONDITION_LAYER = "road-condition-line";
const WIND_ARROW_ICON = "wind-arrow";

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

/** A georeferenced image laid over the map: an interferogram or a plume frame. */
export type ImageOverlay = {
  imageUrl: string;
  bounds: { west: number; south: number; east: number; north: number };
};

/** Kept as a name callers already use; the shape is the shared one. */
export type InsarOverlay = ImageOverlay;

/**
 * Where the plume on the map was modelled as starting.
 *
 * Without it the raster is a cloud with no origin, and a reader cannot tell
 * which of seven scenarios they are looking at — or that the shape has a
 * source at all.
 */
export type PlumeSource = { latitude: number; longitude: number; label: string };

/** A coordinate the reader asked about, drawn as a small cross. */
export type ProbePoint = { latitude: number; longitude: number };

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
  plume: ImageOverlay | null;
  plumeSource: PlumeSource | null;
  probePoint: ProbePoint | null;
  webcams: readonly WebcamSite[];
  showWebcams: boolean;
  airStations: readonly AirQualityStation[];
  showAir: boolean;
  windStations: readonly RoadWeatherStation[];
  roadConditions: GeoJSON.FeatureCollection | null;
  showRoads: boolean;
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

  const aboveLabels = firstSymbolLayerId(map);
  setImageOverlay(map, { source: INSAR_SOURCE, layer: INSAR_LAYER }, data.insar, INSAR_OPACITY, aboveLabels);
  setImageOverlay(map, { source: PLUME_SOURCE, layer: PLUME_LAYER }, data.plume, PLUME_OPACITY, aboveLabels);
  geoJsonSource(map, PLUME_ORIGIN_SOURCE)?.setData(toPlumeOriginGeoJson(data.plumeSource));
  geoJsonSource(map, PROBE_SOURCE)?.setData(toPointGeoJson(data.probePoint));

  geoJsonSource(map, WEBCAM_SOURCE)?.setData(toWebcamGeoJson(data.webcams));
  const webcamVisibility = data.showWebcams ? "visible" : "none";
  for (const layerId of [WEBCAM_LAYER, WEBCAM_SELECTED_LAYER, WEBCAM_LABEL_LAYER]) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", webcamVisibility);
  }

  geoJsonSource(map, AIR_SOURCE)?.setData(toAirGeoJson(data.airStations));
  const airVisibility = data.showAir ? "visible" : "none";
  for (const layerId of [AIR_LAYER, AIR_LABEL_LAYER]) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", airVisibility);
  }

  geoJsonSource(map, WIND_SOURCE)?.setData(toWindGeoJson(data.windStations));
  geoJsonSource(map, ROAD_CONDITION_SOURCE)?.setData(
    withSeverity(data.roadConditions),
  );
  const roadVisibility = data.showRoads ? "visible" : "none";
  for (const layerId of [WIND_LAYER, ROAD_CONDITION_LAYER]) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", roadVisibility);
  }
}

/**
 * Adds our severity ranking to each segment's properties.
 *
 * Done here rather than server-side so the ordering stays next to the layer
 * that uses it — the API returns exactly what Vegagerðin published.
 */
function withSeverity(
  collection: GeoJSON.FeatureCollection | null,
): GeoJSON.FeatureCollection {
  if (!collection) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        severity: conditionSeverity(String(feature.properties?.status ?? "")),
      },
    })),
  };
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
  /**
   * One frame of a dispersal simulation, or null when none is selected.
   *
   * A model scenario, not an observation — see `src/domain/dispersion.ts`.
   */
  plume: ImageOverlay | null;
  /** The modelled vent behind `plume`, when the run records a real one. */
  plumeSource: PlumeSource | null;
  /**
   * The place the dispersal panel is currently asking about, if any, drawn so
   * the figures in the panel have somewhere to point.
   */
  probePoint: { latitude: number; longitude: number } | null;
  /**
   * True while the reader is choosing a place. The next click reports a
   * coordinate instead of selecting whatever is under it.
   */
  picking: boolean;
  onPickPoint: (point: { latitude: number; longitude: number }) => void;
  /** Road camera sites. */
  webcams: readonly WebcamSite[];
  showWebcams: boolean;
  /** Air quality stations. */
  airStations: readonly AirQualityStation[];
  showAir: boolean;
  /** Road weather stations, drawn as downwind arrows. */
  windStations: readonly RoadWeatherStation[];
  /** Road segments that are not clear, with geometry. */
  roadConditions: GeoJSON.FeatureCollection | null;
  showRoads: boolean;
  /** Camera site selected on the map, or null. */
  selectedWebcamId: number | null;
  onSelectWebcam: (id: number | null) => void;
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
    plume,
    plumeSource,
    probePoint,
    webcams,
    showWebcams,
    airStations,
    showAir,
    windStations,
    roadConditions,
    showRoads,
    selectedWebcamId,
    onSelectWebcam,
    picking,
    onPickPoint,
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
  const onSelectWebcamRef = useRef(onSelectWebcam);
  onSelectWebcamRef.current = onSelectWebcam;
  const onPickPointRef = useRef(onPickPoint);
  onPickPointRef.current = onPickPoint;
  // Read inside a handler bound once at load, so it has to be a ref.
  const pickingRef = useRef(picking);
  pickingRef.current = picking;

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
    plume,
    plumeSource,
    probePoint,
    webcams,
    showWebcams,
    airStations,
    showAir,
    windStations,
    roadConditions,
    showRoads,
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
    plume,
    plumeSource,
    probePoint,
    webcams,
    showWebcams,
    airStations,
    showAir,
    windStations,
    roadConditions,
    showRoads,
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
      AIR_SOURCE,
      WIND_SOURCE,
      ROAD_CONDITION_SOURCE,
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

    map.addSource(PLUME_ORIGIN_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    /*
     * The modelled vent. Drawn as an open ring rather than a filled dot so it
     * reads as a marked position rather than as one more observation: nothing
     * is erupting there, and a solid symbol among solid earthquake markers
     * would suggest otherwise.
     */
    map.addLayer({
      id: PLUME_ORIGIN_LAYER,
      type: "circle",
      source: PLUME_ORIGIN_SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 10, 7],
        "circle-color": "transparent",
        "circle-stroke-width": 1.6,
        "circle-stroke-color": "#e8b98a",
        "circle-stroke-opacity": 0.95,
      },
    });

    map.addLayer({
      id: PLUME_ORIGIN_LABEL_LAYER,
      type: "symbol",
      source: PLUME_ORIGIN_SOURCE,
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Open Sans Regular"],
        "text-size": 11,
        "text-offset": [0, 1.2],
        "text-anchor": "top",
        "text-padding": 6,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#e8b98a",
        "text-halo-color": "#04070c",
        "text-halo-width": 1.6,
      },
    });

    map.addSource(PROBE_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    /*
     * The place being asked about. A ring would read as another observation
     * among the earthquake markers, so this is a crosshair: unmistakably a
     * position someone chose rather than something that happened.
     */
    map.addLayer({
      id: PROBE_LAYER,
      type: "circle",
      source: PROBE_SOURCE,
      paint: {
        "circle-radius": 6,
        /*
         * A dark disc behind the ring. This sits on top of a dispersal raster
         * in IMO's saturated scale, where a thin light ring on its own
         * disappears into yellow and a thin dark one into the basemap.
         */
        "circle-color": "rgb(0 0 0 / 0.45)",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-opacity": 0.95,
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
    /*
     * Road conditions, drawn beneath the events.
     *
     * Only segments that are not clear are fetched at all. Vegagerðin's own
     * colour is used for the line, but width comes from our own severity
     * ordering: they give a 4x4-only track the same green as a clear road,
     * which is right for a driver and unhelpful on a map read at a glance.
     */
    map.addLayer(
      {
        id: ROAD_CONDITION_LAYER,
        type: "line",
        source: ROAD_CONDITION_SOURCE,
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["coalesce", ["get", "colour"], "#8C8A88"],
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5, ["case", [">=", ["get", "severity"], 2], 2, 1],
            10, ["case", [">=", ["get", "severity"], 2], 4, 2],
          ],
          "line-opacity": ["case", [">=", ["get", "severity"], 2], 0.95, 0.6],
        },
      },
      beforeId,
    );

    /*
     * Air quality stations, sized by measured volcanic gas.
     *
     * Size only, never a colour band: grading a concentration as safe or unsafe
     * is a health judgement, and the agency publishes that scale themselves.
     */
    map.addLayer({
      id: AIR_LAYER,
      type: "circle",
      source: AIR_SOURCE,
      layout: { visibility: "none" },
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["max", ["get", "gas"], 0],
          0, 3,
          10, 6,
          50, 11,
          200, 18,
        ],
        "circle-color": "#5ec8b8",
        "circle-opacity": 0.22,
        "circle-stroke-width": 1.3,
        "circle-stroke-color": "#5ec8b8",
        "circle-stroke-opacity": 0.85,
      },
    });

    map.addLayer({
      id: AIR_LABEL_LAYER,
      type: "symbol",
      source: AIR_SOURCE,
      minzoom: 8,
      layout: {
        visibility: "none",
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Regular"],
        "text-size": 10,
        "text-offset": [0, 1.1],
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

    /*
     * Wind, as arrows pointing downwind.
     *
     * The source reports the direction wind comes from; the arrow shows where
     * air is going, because the question during a gas episode is where it is
     * being carried. Size grows with speed so a glance separates a breeze from
     * something that will move a plume.
     */
    addWindArrow(map);
    map.addLayer({
      id: WIND_LAYER,
      type: "symbol",
      source: WIND_SOURCE,
      layout: {
        visibility: "none",
        "icon-image": WIND_ARROW_ICON,
        "icon-rotate": ["get", "towards"],
        "icon-rotation-alignment": "map",
        /*
         * Collision culling left on. There are 183 stations; at Iceland zoom
         * drawing all of them is a thicket, and letting MapLibre thin them to
         * a representative scatter reads far better. Zooming in brings the
         * rest back.
         */
        "icon-allow-overlap": false,
        "icon-padding": 2,
        /*
         * The image is registered at pixelRatio 2, so a 48 px bitmap is 24 CSS
         * px at size 1. These values are chosen against that: roughly 13 px for
         * a light wind at Iceland zoom up to about 40 px for a gale close in.
         */
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5, ["interpolate", ["linear"], ["get", "speed"], 0, 0.55, 10, 0.8, 25, 1.05],
          10, ["interpolate", ["linear"], ["get", "speed"], 0, 0.9, 10, 1.3, 25, 1.7],
        ],
      },
      paint: { "icon-opacity": 0.85 },
    });

    map.addLayer({
      id: WEBCAM_LAYER,
      type: "circle",
      source: WEBCAM_SOURCE,
      layout: { visibility: "none" },
      paint: {
        /*
         * A plain top-level zoom interpolation. Wrapping it in a `case` to
         * grow the selected marker is rejected by MapLibre — `["zoom"]` may
         * only feed a top-level interpolate — and the layer silently falls
         * back to a default radius. The selection highlight is its own layer
         * (`WEBCAM_SELECTED_LAYER`) for exactly that reason.
         */
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.4, 10, 5],
        "circle-color": "#0b0e13",
        "circle-stroke-width": 1.6,
        "circle-stroke-color": "#c3b3f0",
        "circle-stroke-opacity": 0.9,
      },
    });

    map.addLayer({
      id: WEBCAM_SELECTED_LAYER,
      type: "circle",
      source: WEBCAM_SOURCE,
      layout: { visibility: "none" },
      filter: ["==", ["get", "id"], -1],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 6, 10, 10],
        "circle-color": "#c3b3f0",
        "circle-opacity": 0.28,
        "circle-stroke-width": 1.8,
        "circle-stroke-color": "#e0d6ff",
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

    /** Camera sites under the pointer, within the same forgiving box. */
    const pickWebcam = (event: MapMouseEvent): MapGeoJSONFeature | undefined => {
      if (!map.getLayer(WEBCAM_LAYER)) return undefined;
      if (map.getLayoutProperty(WEBCAM_LAYER, "visibility") !== "visible") return undefined;
      const box: [[number, number], [number, number]] = [
        [event.point.x - 10, event.point.y - 10],
        [event.point.x + 10, event.point.y + 10],
      ];
      return map.queryRenderedFeatures(box, { layers: [WEBCAM_LAYER] })[0];
    };

    map.on("click", (event) => {
      /*
       * Picking wins over everything. The reader has said they want a
       * coordinate, so a marker that happens to be under the cursor is not
       * what they are asking for — and an armed mode that sometimes does
       * something else is worse than no mode.
       */
      if (pickingRef.current) {
        onPickPointRef.current({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
        return;
      }

      // Cameras win over earthquakes: a camera marker is something a reader
      // aimed at, whereas quakes are the ambient layer underneath.
      const camera = pickWebcam(event);
      if (camera) {
        const id = Number(camera.properties?.id);
        onSelectWebcamRef.current(Number.isFinite(id) ? id : null);
        return;
      }

      const feature = pick(event);
      onSelectRef.current(feature ? String(feature.properties?.id ?? "") || null : null);
    });

    map.on("mousemove", (event) => {
      // Picking owns the cursor while it is armed.
      if (pickingRef.current) return;
      map.getCanvas().style.cursor = pickWebcam(event) || pick(event) ? "pointer" : "";
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
    for (const layerId of [WEBCAM_LAYER, WEBCAM_SELECTED_LAYER, WEBCAM_LABEL_LAYER]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }, [showWebcams, webcams]);

  // --- Air quality ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    geoJsonSource(map, AIR_SOURCE)?.setData(toAirGeoJson(airStations));
  }, [airStations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const visibility = showAir ? "visible" : "none";
    for (const layerId of [AIR_LAYER, AIR_LABEL_LAYER]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }, [showAir, airStations]);

  // --- Selected camera ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !map.getLayer(WEBCAM_SELECTED_LAYER)) return;
    map.setFilter(WEBCAM_SELECTED_LAYER, ["==", ["get", "id"], selectedWebcamId ?? -1]);
  }, [selectedWebcamId]);

  // --- Wind and road conditions ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    geoJsonSource(map, WIND_SOURCE)?.setData(toWindGeoJson(windStations));
  }, [windStations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    geoJsonSource(map, ROAD_CONDITION_SOURCE)?.setData(withSeverity(roadConditions));
  }, [roadConditions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const visibility = showRoads ? "visible" : "none";
    for (const layerId of [WIND_LAYER, ROAD_CONDITION_LAYER]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }, [showRoads, windStations, roadConditions]);

  // --- Interferogram overlay ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    setImageOverlay(
      map,
      { source: INSAR_SOURCE, layer: INSAR_LAYER },
      insar,
      INSAR_OPACITY,
      firstSymbolLayerId(map),
    );
  }, [insar]);

  /*
   * --- Dispersal raster ---
   *
   * Stepping through a run changes only the URL, and `updateImage` swaps the
   * texture in place rather than tearing the source down and rebuilding it,
   * which is what makes playback smooth rather than a flicker per hour.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    setImageOverlay(
      map,
      { source: PLUME_SOURCE, layer: PLUME_LAYER },
      plume,
      PLUME_OPACITY,
      firstSymbolLayerId(map),
    );
  }, [plume]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    geoJsonSource(map, PLUME_ORIGIN_SOURCE)?.setData(toPlumeOriginGeoJson(plumeSource));
  }, [plumeSource]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    geoJsonSource(map, PROBE_SOURCE)?.setData(toPointGeoJson(probePoint));
  }, [probePoint]);

  /*
   * Picking mode, applied to the canvas rather than to a React element: the
   * map fills its container and the cursor has to change over all of it.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = picking ? "crosshair" : "";
  }, [picking]);

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
