/**
 * Normalized volcanic-system model.
 *
 * Geometry and attributes come from IMO's Volcanoes API, which republishes the
 * Catalogue of Icelandic Volcanoes. We keep the per-feature `source` string so
 * the UI can credit the originating institution exactly as IMO reports it.
 */

/** ICAO aviation colour code, as issued by IMO in a VONA notice. */
export type AviationColour = "GREEN" | "YELLOW" | "ORANGE" | "RED";

/** IMO Volcanic Alert Level System (VALS) level. */
export type VolcanicAlertLevel = {
  level: number;
  /** English label, e.g. "Orange". */
  code: string;
  /** English description, e.g. "Heightened volcanic unrest". */
  description: string | null;
  publishedAt: string | null;
};

export type AviationStatus = {
  colour: AviationColour;
  description: string | null;
  publishedAt: string | null;
};

/**
 * Geometry class as published in the Catalogue of Icelandic Volcanoes.
 * All published geometries are line work (rims, outlines, swarm axes) rather
 * than filled hazard polygons — we render them as lines and never imply that
 * they delimit a hazard zone.
 */
export type VolcanoFeatureType =
  | "Central volcano"
  | "Caldera rim"
  | "Fissure swarm"
  | "Volcanic zones - offshore"
  | (string & {});

export type VolcanoGeometryFeature = {
  id: string;
  featureType: VolcanoFeatureType;
  /** Attribution string exactly as published by IMO. */
  attribution: string | null;
  geometry: GeoJSON.Geometry;
};

export type VolcanicSystem = {
  /** IMO short code, e.g. "REY". */
  code: string;
  name: string;
  /** Alternative/local name, e.g. "Mýrdalsjökull" for Katla. */
  altName: string | null;
  /** Smithsonian Global Volcanism Program number, when IMO supplies one. */
  smithsonianId: string | null;
  /** Volcanic zone marker, e.g. "NRR" (Reykjanes Rift), "EVZ". */
  zoneCode: string | null;
  zoneName: string | null;
  summitElevationM: number | null;
  latitude: number | null;
  longitude: number | null;
  /** Official IMO aviation colour code, when a VONA has been issued. */
  aviation: AviationStatus | null;
  /** Official IMO volcanic alert level, when one has been issued. */
  alertLevel: VolcanicAlertLevel | null;
  features: VolcanoGeometryFeature[];
};

const AVIATION_RANK: Record<AviationColour, number> = {
  GREEN: 0,
  YELLOW: 1,
  ORANGE: 2,
  RED: 3,
};

export function aviationRank(colour: AviationColour | null | undefined): number {
  return colour ? AVIATION_RANK[colour] : -1;
}

/** True when IMO has raised this system above its normal, non-eruptive state. */
export function isAboveBackground(system: VolcanicSystem): boolean {
  return aviationRank(system.aviation?.colour) > 0 || (system.alertLevel?.level ?? 0) > 0;
}
