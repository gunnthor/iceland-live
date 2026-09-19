/**
 * Reykjanes peninsula detail, assembled from four published datasets.
 *
 * | Layer      | Source                                  | Endpoint            |
 * | ---------- | --------------------------------------- | ------------------- |
 * | Lava flows | Náttúrufræðistofnun / Landmælingar      | gis.natt.is WFS     |
 * | Barriers   | Icelandic Meteorological Office         | geo.vedur.is WFS    |
 * | Graben     | Landmælingar Íslands (InSAR, Nov 2023)  | gis.lmi.is WFS      |
 * | Facilities | Orkustofnun power station register      | gis.lmi.is WFS      |
 *
 * Layer names were taken from the gateway's own index (`GET /gis/layers`), not
 * guessed.
 *
 * The four fetches run concurrently and each is allowed to fail on its own: a
 * GeoServer being down should cost us that one layer, not the whole Reykjanes
 * view. `attributions` lists only the datasets that actually arrived, so the
 * legend never credits a source that is not on screen.
 */

import type {
  BarrierProperties,
  FacilityProperties,
  GrabenProperties,
  LavaFlowProperties,
  ReykjanesLayer,
} from "@/domain/reykjanes";
import { simplifyFeatureCollection } from "@/lib/simplify";
import type { ProviderAttribution, ProviderResult } from "@/providers/types";
import { fetchWfsGeoJson } from "./wfs-client";

const VEDUR_WFS = "https://geo.vedur.is/geoserver/wfs";
const LMI_WFS = "https://gis.lmi.is/geoserver/wfs";
const NATT_WFS = "https://gis.natt.is/geoserver/wfs";

/**
 * Cached hard for a day: these are historical survey products. The most recent
 * outline dates from the July 2025 eruption, and none of them will change.
 */
const REVALIDATE_SECONDS = 24 * 60 * 60;

export const REYKJANES_ATTRIBUTION: ProviderAttribution = {
  name: "Icelandic geospatial agencies",
  url: "https://api.vedur.is/gis/layers",
  note: "Lava outlines, lava barriers, graben mapping and facility locations, each credited individually.",
};

const CREDIT = {
  lava: "Lava outlines: Náttúrufræðistofnun Íslands and Landmælingar Íslands",
  barriers: "Lava barriers: Icelandic Meteorological Office",
  graben: "Grindavík graben: Landmælingar Íslands (InSAR, November 2023)",
  facilities: "Power stations: Orkustofnun",
} as const;

function emptyCollection<P>(): GeoJSON.FeatureCollection<GeoJSON.Geometry, P> {
  return { type: "FeatureCollection", features: [] };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Source dates look like `2024-06-24Z`. */
function isoDate(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const date = new Date(raw.endsWith("Z") ? raw : `${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Runs a fetch, logging and swallowing its failure. */
async function optional<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.warn(
      `[reykjanes] ${label} layer unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

async function fetchLava(): Promise<GeoJSON.FeatureCollection<GeoJSON.Geometry, LavaFlowProperties>> {
  const raw = await fetchWfsGeoJson({
    url: NATT_WFS,
    typeName: "LMI_vektor:goslok_reykjaneselda",
    revalidateSeconds: REVALIDATE_SECONDS,
    timeoutMs: 60_000,
  });

  // 5.5 MB of survey-precision outlines; 20 m is sub-pixel at these zooms.
  const simplified = simplifyFeatureCollection(raw, { toleranceM: 20, decimals: 5 });

  const withDates = simplified.features.map((feature) => {
    const p = (feature.properties ?? {}) as Record<string, unknown>;
    return {
      feature,
      startedAt: isoDate(p.dags_upphaf_goss),
      endedAt: isoDate(p.dags_goslok),
      properties: p,
    };
  });

  // Most recent eruption first, so recencyIndex 0 is the freshest lava.
  withDates.sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));

  return {
    type: "FeatureCollection",
    features: withDates.map(({ feature, startedAt, endedAt, properties }, index) => ({
      type: "Feature" as const,
      geometry: feature.geometry,
      properties: {
        kind: "lava" as const,
        name: str(properties.vinnuheiti) ?? "Unnamed flow",
        startedAt,
        endedAt,
        areaKm2: num(properties.km2),
        volumeKm3: num(properties.km3),
        mappedBy: str(properties.source),
        mappedAt: isoDate(properties.dags_heimildar),
        recencyIndex: index,
      },
    })),
  };
}

async function fetchBarriers(): Promise<
  GeoJSON.FeatureCollection<GeoJSON.Geometry, BarrierProperties>
> {
  const raw = await fetchWfsGeoJson({
    url: VEDUR_WFS,
    typeName: "infrastructure:Svartsengi_Grindavik_lava_Barriers",
    revalidateSeconds: REVALIDATE_SECONDS,
  });

  const simplified = simplifyFeatureCollection(raw, { toleranceM: 5, decimals: 5 });

  return {
    type: "FeatureCollection",
    features: simplified.features.map((feature) => ({
      type: "Feature" as const,
      geometry: feature.geometry,
      properties: {
        kind: "barrier" as const,
        name: str((feature.properties as Record<string, unknown>)?.name),
      },
    })),
  };
}

async function fetchGraben(): Promise<
  GeoJSON.FeatureCollection<GeoJSON.Geometry, GrabenProperties>
> {
  const raw = await fetchWfsGeoJson({
    url: LMI_WFS,
    typeName: "LMI_vektor:gos_Reykjanes_graben_formation_graben_outline",
    revalidateSeconds: REVALIDATE_SECONDS,
  });

  return {
    type: "FeatureCollection",
    features: raw.features.map((feature) => {
      const p = (feature.properties ?? {}) as Record<string, unknown>;
      return {
        type: "Feature" as const,
        geometry: feature.geometry,
        properties: {
          kind: "graben" as const,
          label: str(p.sigdalur),
          source: str(p.source),
        },
      };
    }),
  };
}

/**
 * Located facilities on the peninsula.
 *
 * Filtered from Orkustofnun's national power station register by bounding box
 * rather than by name, so the set is whatever the register actually places
 * there — Svartsengi and Reykjanesvirkjun today.
 */
async function fetchFacilities(): Promise<
  GeoJSON.FeatureCollection<GeoJSON.Point, FacilityProperties>
> {
  const raw = await fetchWfsGeoJson({
    url: LMI_WFS,
    typeName: "orkustofnun:gisvirkjun",
    revalidateSeconds: REVALIDATE_SECONDS,
  });

  const features: Array<GeoJSON.Feature<GeoJSON.Point, FacilityProperties>> = [];

  for (const feature of raw.features) {
    if (feature.geometry?.type !== "Point") continue;
    const [lon, lat] = feature.geometry.coordinates as [number, number];
    // The Reykjanes peninsula, generously bounded.
    if (lat < 63.75 || lat > 64.05 || lon < -22.9 || lon > -21.9) continue;

    const p = (feature.properties ?? {}) as Record<string, unknown>;
    const name = str(p.nafnvirkjunar);
    if (!name) continue;

    // Only geothermal plants; the register also lists standby diesel sets.
    const category = str(p.tegundvirkjunar);
    if (category !== "Jarðvarmavirkjun") continue;

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        kind: "facility",
        name,
        category,
        operator: str(p.eigandi),
      },
    });
  }

  return { type: "FeatureCollection", features };
}

export class ReykjanesGisProvider {
  readonly id = "gis-reykjanes";
  readonly attribution = REYKJANES_ATTRIBUTION;

  async fetchLayer(): Promise<ProviderResult<ReykjanesLayer>> {
    const [lava, barriers, graben, facilities] = await Promise.all([
      optional("lava", fetchLava),
      optional("barrier", fetchBarriers),
      optional("graben", fetchGraben),
      optional("facility", fetchFacilities),
    ]);

    const attributions: string[] = [];
    if (lava) attributions.push(CREDIT.lava);
    if (barriers) attributions.push(CREDIT.barriers);
    if (graben) attributions.push(CREDIT.graben);
    if (facilities) attributions.push(CREDIT.facilities);

    return {
      data: {
        lava: lava ?? emptyCollection<LavaFlowProperties>(),
        barriers: barriers ?? emptyCollection<BarrierProperties>(),
        graben: graben ?? emptyCollection<GrabenProperties>(),
        facilities:
          facilities ??
          ({ type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection<
            GeoJSON.Point,
            FacilityProperties
          >),
        attributions,
      },
      meta: {
        providerId: this.id,
        freshness: "live",
        fetchedAt: new Date().toISOString(),
        attribution: this.attribution,
      },
    };
  }
}
