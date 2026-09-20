/** Turns normalized earthquakes into the GeoJSON the map source consumes. */

import type { Earthquake } from "@/domain/earthquake";
import { aviationRank, isAboveBackground, type VolcanicSystem } from "@/domain/volcano";
import { isActive, type GnssStation } from "@/domain/deformation";
import type { WebcamSite } from "@/domain/webcam";
import { readingFor, type AirQualityStation } from "@/domain/air-quality";
import type { RoadWeatherStation } from "@/domain/roads";
import { UNKNOWN_MAGNITUDE_SIZE, type QuakeFeatureProps } from "./quake-layers";

export type QuakeFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point, QuakeFeatureProps>;

/**
 * `referenceMs` is the instant ages are measured from — the payload's
 * `generatedAt`, so every point on the map is aged against the same clock.
 */
export function toQuakeGeoJson(
  quakes: readonly Earthquake[],
  referenceMs: number,
): QuakeFeatureCollection {
  return {
    type: "FeatureCollection",
    features: quakes.map((quake) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [quake.longitude, quake.latitude] },
      properties: {
        id: quake.id,
        mag: quake.magnitude ?? UNKNOWN_MAGNITUDE_SIZE,
        hasMag: quake.magnitude !== null,
        depth: quake.depthKm ?? 0,
        hasDepth: quake.depthKm !== null,
        ageHours: Math.max(0, (referenceMs - Date.parse(quake.occurredAt)) / 3_600_000),
        region: quake.region ?? "",
      },
    })),
  };
}

export type VolcanoFeatureProps = {
  code: string;
  name: string;
  featureType: string;
  attribution: string;
};

/**
 * Line work for the volcanic systems layer.
 *
 * The Catalogue of Icelandic Volcanoes publishes central volcano outlines,
 * caldera rims and fissure swarms as lines, so that is how we draw them. We do
 * not close them into filled polygons: a filled shape reads as a zone with an
 * inside and an outside, which is a claim this dataset does not make.
 */
export function toVolcanoLineGeoJson(
  systems: readonly VolcanicSystem[],
): GeoJSON.FeatureCollection<GeoJSON.Geometry, VolcanoFeatureProps> {
  const features: GeoJSON.Feature<GeoJSON.Geometry, VolcanoFeatureProps>[] = [];

  for (const system of systems) {
    for (const feature of system.features) {
      features.push({
        type: "Feature",
        geometry: feature.geometry,
        properties: {
          code: system.code,
          name: system.name,
          featureType: feature.featureType,
          attribution: feature.attribution ?? "",
        },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

export type VolcanoLabelProps = {
  code: string;
  name: string;
  /** Official IMO aviation colour, or empty when no VONA has been issued. */
  aviation: string;
  alertLevel: number;
  /** GREEN=0 … RED=3, or -1 when IMO has issued no VONA. Drives map styling. */
  aviationRank: number;
  /** 1 when IMO has this system above its normal state, 0 otherwise. */
  elevated: number;
};

/** Point labels for each system, drawn at the summit location IMO publishes. */
export function toVolcanoPointGeoJson(
  systems: readonly VolcanicSystem[],
): GeoJSON.FeatureCollection<GeoJSON.Point, VolcanoLabelProps> {
  return {
    type: "FeatureCollection",
    features: systems
      .filter((system) => system.latitude !== null && system.longitude !== null)
      .map((system) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [system.longitude as number, system.latitude as number],
        },
        properties: {
          code: system.code,
          name: system.name,
          aviation: system.aviation?.colour ?? "",
          alertLevel: system.alertLevel?.level ?? 0,
          aviationRank: aviationRank(system.aviation?.colour),
          elevated: isAboveBackground(system) ? 1 : 0,
        },
      })),
  };
}

export type GnssFeatureProps = {
  marker: string;
  name: string;
  /** Whether the station is still recording. Drives the marker colour. */
  active: boolean;
};

/** Station markers for the monitoring-network layer. */
export function toGnssGeoJson(
  stations: readonly GnssStation[],
): GeoJSON.FeatureCollection<GeoJSON.Point, GnssFeatureProps> {
  return {
    type: "FeatureCollection",
    features: stations.map((station) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [station.longitude, station.latitude] },
      properties: {
        marker: station.marker,
        name: station.name,
        active: isActive(station),
      },
    })),
  };
}

export type WebcamFeatureProps = {
  id: number;
  name: string;
  views: number;
};

/** Camera sites for the road-camera layer. */
export function toWebcamGeoJson(
  sites: readonly WebcamSite[],
): GeoJSON.FeatureCollection<GeoJSON.Point, WebcamFeatureProps> {
  return {
    type: "FeatureCollection",
    features: sites.map((site) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [site.longitude, site.latitude] },
      properties: { id: site.id, name: site.name, views: site.views.length },
    })),
  };
}

export type AirFeatureProps = {
  id: string;
  name: string;
  /** SO2 in µg/m3, or -1 when the station does not report it. */
  so2: number;
  /** H2S in µg/m3, or -1 when the station does not report it. */
  h2s: number;
  /** The higher of the two, for sizing. -1 when neither is reported. */
  gas: number;
};

/**
 * Air quality stations for the map.
 *
 * Markers are sized by the volcanic gases and never coloured by a health band —
 * see `EnvironmentPanel` for why. `-1` marks "not reported", which is distinct
 * from a measured zero.
 */
export function toAirGeoJson(
  stations: readonly AirQualityStation[],
): GeoJSON.FeatureCollection<GeoJSON.Point, AirFeatureProps> {
  return {
    type: "FeatureCollection",
    features: stations.map((station) => {
      const so2 = readingFor(station, "SO2")?.value ?? -1;
      const h2s = readingFor(station, "H2S")?.value ?? -1;
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [station.longitude, station.latitude] },
        properties: { id: station.id, name: station.name, so2, h2s, gas: Math.max(so2, h2s) },
      };
    }),
  };
}

export type WindFeatureProps = {
  id: number;
  name: string;
  /**
   * Compass bearing the wind is blowing **towards**, in degrees.
   *
   * The source reports the direction wind comes *from*, which is the
   * meteorological convention. The arrow points downwind because the question
   * this layer answers is where gas is being carried, so 180° is added once,
   * here, rather than in the style where it would be easy to lose.
   */
  towards: number;
  speed: number;
  gust: number;
};

/** Wind readings for the vector layer. Stations with no wind are skipped. */
export function toWindGeoJson(
  stations: readonly RoadWeatherStation[],
): GeoJSON.FeatureCollection<GeoJSON.Point, WindFeatureProps> {
  return {
    type: "FeatureCollection",
    features: stations
      .filter(
        (station) => station.windDirectionDeg !== null && station.windSpeedMs !== null,
      )
      .map((station) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [station.longitude, station.latitude],
        },
        properties: {
          id: station.id,
          name: station.name,
          towards: ((station.windDirectionDeg as number) + 180) % 360,
          speed: station.windSpeedMs as number,
          gust: station.windGustMs ?? (station.windSpeedMs as number),
        },
      })),
  };
}

/**
 * The modelled source of the dispersal run on the map, as a one-point layer.
 *
 * `label` is the volcano's name and nothing more. It deliberately carries no
 * status, colour code or plume height: a caption beside a plume is read as a
 * claim about that volcano, and the only claim supportable here is "this is
 * where the model put the source".
 */
export function toPlumeOriginGeoJson(
  source: { latitude: number; longitude: number; label: string } | null,
): GeoJSON.FeatureCollection {
  if (!source) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [source.longitude, source.latitude] },
        properties: { label: source.label },
      },
    ],
  };
}

/**
 * A single coordinate as a one-point layer, or nothing.
 *
 * Used for the place the dispersal panel is asking about. Carries no
 * properties: it is a position, and anything else written beside it would be
 * a label on a spot the reader chose rather than on a thing that exists.
 */
export function toPointGeoJson(
  point: { latitude: number; longitude: number } | null,
): GeoJSON.FeatureCollection {
  if (!point) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
        properties: {},
      },
    ],
  };
}
