/**
 * The Reykjanes peninsula layer.
 *
 * Reykjanes gets its own treatment because it has erupted repeatedly since
 * 2021, sits beside the capital region, and is where a reader is most likely
 * to want detail beyond "here are some dots".
 *
 * Everything in this layer is sourced. Where no authoritative dataset exists
 * we add nothing rather than placing an approximate marker — the basemap
 * already labels the settlements, and a hand-typed coordinate presented beside
 * surveyed data would be indistinguishable from it.
 */

/** What a Reykjanes feature depicts. */
export type ReykjanesFeatureKind =
  /** A mapped lava flow from one of the 2021–2025 eruptions. */
  | "lava"
  /** An engineered barrier built to divert lava. */
  | "barrier"
  /** The Grindavík subsidence graben, mapped from InSAR. */
  | "graben"
  /** A located facility, e.g. the Svartsengi power station. */
  | "facility";

export type LavaFlowProperties = {
  kind: "lava";
  /** Working name IMO's source dataset uses, e.g. "Sundhnúksgígar VII". */
  name: string;
  /** Eruption start, ISO date, when recorded. */
  startedAt: string | null;
  /** Eruption end, ISO date, when recorded. */
  endedAt: string | null;
  /** Mapped area in square kilometres. */
  areaKm2: number | null;
  /** Erupted volume in cubic kilometres. */
  volumeKm3: number | null;
  /** Who produced the mapping. */
  mappedBy: string | null;
  /** Date the outline was surveyed. */
  mappedAt: string | null;
  /** 0 for the most recent eruption, increasing with age. Drives shading. */
  recencyIndex: number;
};

export type BarrierProperties = {
  kind: "barrier";
  /** Designation from the source dataset, e.g. "L1b". */
  name: string | null;
};

export type GrabenProperties = {
  kind: "graben";
  /** What the line depicts, in the source's own words. */
  label: string | null;
  /** The observation the mapping came from. */
  source: string | null;
};

export type FacilityProperties = {
  kind: "facility";
  name: string;
  /** Facility type, as the source records it. */
  category: string | null;
  operator: string | null;
};

export type ReykjanesProperties =
  | LavaFlowProperties
  | BarrierProperties
  | GrabenProperties
  | FacilityProperties;

export type ReykjanesFeature = GeoJSON.Feature<GeoJSON.Geometry, ReykjanesProperties>;

export type ReykjanesLayer = {
  lava: GeoJSON.FeatureCollection<GeoJSON.Geometry, LavaFlowProperties>;
  barriers: GeoJSON.FeatureCollection<GeoJSON.Geometry, BarrierProperties>;
  graben: GeoJSON.FeatureCollection<GeoJSON.Geometry, GrabenProperties>;
  facilities: GeoJSON.FeatureCollection<GeoJSON.Point, FacilityProperties>;
  /** One credit line per contributing dataset, shown in the legend. */
  attributions: string[];
};

/** Eruptions, most recent first, for the legend and the timeline of activity. */
export function lavaFlowsByRecency(
  layer: ReykjanesLayer,
): Array<GeoJSON.Feature<GeoJSON.Geometry, LavaFlowProperties>> {
  return [...layer.lava.features].sort(
    (a, b) => (a.properties.recencyIndex ?? 0) - (b.properties.recencyIndex ?? 0),
  );
}
