/**
 * Normalization of IMO Volcanoes API responses.
 *
 * Endpoint: GET https://api.vedur.is/volcanoes/volcanoes?include_geometry=true
 *
 * IMO republishes the Catalogue of Icelandic Volcanoes here, including the
 * official aviation colour code (from VONA notices) and the Volcanic Alert
 * Level System (VALS) level for each system. Geometry arrives as a per-volcano
 * GeoJSON FeatureCollection whose features carry their own `source` attribution
 * string, which we preserve verbatim.
 */

import type {
  AviationColour,
  AviationStatus,
  VolcanicAlertLevel,
  VolcanicSystem,
  VolcanoGeometryFeature,
} from "@/domain/volcano";

const AVIATION_COLOURS: ReadonlySet<string> = new Set(["GREEN", "YELLOW", "ORANGE", "RED"]);

/** Shape of the upstream payload, kept deliberately loose and local. */
type RawVolcano = {
  code?: unknown;
  name?: unknown;
  alt_name?: unknown;
  si_code?: unknown;
  height?: unknown;
  zone?: { marker?: unknown; name_en?: unknown; name_is?: unknown } | null;
  geom_point?: { type?: unknown; coordinates?: unknown } | null;
  vona?: { current?: RawVona | null } | null;
  vals?: { current?: RawVals | null } | null;
  features?: { features?: unknown } | null;
};

type RawVona = {
  published_at?: unknown;
  aviation_color?: { code?: unknown; description_en?: unknown } | null;
};

type RawVals = {
  published_at?: unknown;
  alert_level_info?: { level?: unknown; code_en?: unknown; description_en?: unknown } | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function toAviation(raw: RawVona | null | undefined): AviationStatus | null {
  const code = str(raw?.aviation_color?.code)?.toUpperCase();
  if (!code || !AVIATION_COLOURS.has(code)) return null;
  return {
    colour: code as AviationColour,
    description: str(raw?.aviation_color?.description_en),
    publishedAt: str(raw?.published_at),
  };
}

function toAlertLevel(raw: RawVals | null | undefined): VolcanicAlertLevel | null {
  const info = raw?.alert_level_info;
  const level = num(info?.level);
  const code = str(info?.code_en);
  if (level === null || !code) return null;
  return {
    level,
    code,
    description: str(info?.description_en),
    publishedAt: str(raw?.published_at),
  };
}

function toFeatures(code: string, raw: unknown): VolcanoGeometryFeature[] {
  if (!Array.isArray(raw)) return [];
  const out: VolcanoGeometryFeature[] = [];

  raw.forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const feature = item as { id?: unknown; geometry?: unknown; properties?: unknown };
    const geometry = feature.geometry as GeoJSON.Geometry | undefined;
    if (!geometry || typeof geometry !== "object" || !("type" in geometry) || !("coordinates" in geometry)) {
      return;
    }
    const properties = (feature.properties ?? {}) as { feature_type?: unknown; source?: unknown };
    out.push({
      id: `${code}-${str(feature.id) ?? num(feature.id) ?? i}`,
      featureType: str(properties.feature_type) ?? "Unclassified",
      attribution: str(properties.source),
      geometry,
    });
  });

  return out;
}

function toPoint(raw: RawVolcano["geom_point"]): { latitude: number | null; longitude: number | null } {
  const coords = raw?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return { latitude: null, longitude: null };
  // GeoJSON order is [longitude, latitude].
  return { longitude: num(coords[0]), latitude: num(coords[1]) };
}

export function normalizeVolcanoes(payload: unknown): VolcanicSystem[] {
  if (!Array.isArray(payload)) return [];

  const systems: VolcanicSystem[] = [];

  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const raw = item as RawVolcano;

    const code = str(raw.code);
    const name = str(raw.name);
    if (!code || !name) continue;

    const { latitude, longitude } = toPoint(raw.geom_point);

    systems.push({
      code,
      name,
      altName: str(raw.alt_name),
      smithsonianId: str(raw.si_code),
      zoneCode: str(raw.zone?.marker),
      zoneName: str(raw.zone?.name_en) ?? str(raw.zone?.name_is),
      summitElevationM: num(raw.height),
      latitude,
      longitude,
      aviation: toAviation(raw.vona?.current),
      alertLevel: toAlertLevel(raw.vals?.current),
      features: toFeatures(code, raw.features?.features),
    });
  }

  systems.sort((a, b) => a.name.localeCompare(b.name, "is"));
  return systems;
}
