/**
 * Normalization of IMO EPOS monitoring products.
 *
 * Both endpoints return GeoJSON FeatureCollections whose properties carry a
 * number of EPOS-internal keys (`@epos_label_key`, `@epos_data_keys`, …). Those
 * describe how EPOS's own viewer should render the record and mean nothing to
 * us, so they are dropped here rather than carried through the app.
 */

import type { GnssStation, Interferogram, OrbitDirection } from "@/domain/deformation";

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** EPOS dates are plain `YYYY-MM-DD`; timestamps carry a zone. */
function isoDate(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const date = new Date(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * A stable id for an interferogram.
 *
 * EPOS gives no identifier, so the product filename is used — it encodes the
 * sensor, both acquisition dates and the track, and is unique across the
 * catalogue.
 */
function productId(pngUrl: string | null, fallback: string): string {
  if (!pngUrl) return fallback;
  const file = pngUrl.split("/").pop() ?? fallback;
  return file.replace(/\.png$/i, "");
}

export function normalizeInterferograms(
  payload: unknown,
  /** Rewrites the published image URL to our proxy. */
  toProxyUrl: (url: string) => string,
): Interferogram[] {
  const collection = payload as GeoJSON.FeatureCollection | undefined;
  if (!collection || !Array.isArray(collection.features)) return [];

  const items: Interferogram[] = [];

  collection.features.forEach((feature, index) => {
    const p = (feature.properties ?? {}) as Record<string, unknown>;

    const startDate = isoDate(p.period_starts);
    const endDate = isoDate(p.period_ends);
    const png = str(p.png);
    const west = num(p.lon_min);
    const south = num(p.lat_min);
    const east = num(p.lon_max);
    const north = num(p.lat_max);

    // Without dates, an image and an extent there is nothing to place or label.
    if (!startDate || !endDate || !png) return;
    if (west === null || south === null || east === null || north === null) return;
    if (west >= east || south >= north) return;

    items.push({
      id: productId(png, `insar-${index}`),
      focusArea: str(p.focus_area) ?? "Iceland",
      startDate,
      endDate,
      orbitDirection: (str(p.orbit_dir) as OrbitDirection) ?? "unknown",
      satellite: str(p.satellite) ?? "unknown",
      bounds: { west, south, east, north },
      imageUrl: toProxyUrl(png),
      productUrl: str(p.url),
    });
  });

  return items;
}

export function normalizeGnssStations(payload: unknown): GnssStation[] {
  const collection = payload as GeoJSON.FeatureCollection | undefined;
  if (!collection || !Array.isArray(collection.features)) return [];

  const stations: GnssStation[] = [];

  for (const feature of collection.features) {
    const p = (feature.properties ?? {}) as Record<string, unknown>;

    const marker = str(p.marker);
    const latitude = num(p.location_coordinates_lat);
    const longitude = num(p.location_coordinates_lon);
    if (!marker || latitude === null || longitude === null) continue;

    stations.push({
      marker,
      name: str(p.name) ?? marker,
      latitude,
      longitude,
      altitudeM: num(p.location_coordinates_altitude),
      agency: str(p.agency_name),
      since: isoDate(p.date_from),
      until: isoDate(p.date_to),
      siteLogUrl: str(p.information_url),
      dataUrl: str(p.rinex_url),
    });
  }

  stations.sort((a, b) => a.marker.localeCompare(b.marker));
  return stations;
}
