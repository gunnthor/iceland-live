/**
 * Road conditions with geometry, from Vegagerðin's ArcGIS service.
 *
 *   GET https://vegasja.vegagerdin.is/arcgis/rest/services/data/faerd/FeatureServer/16/query
 *
 * The open-data `faerd2014_1` feed carries condition text but no geometry. This
 * service carries both, keyed by the same `IDBUTUR`, and can return GeoJSON in
 * WGS84 directly — so the conditions become a map layer rather than a list.
 *
 * ## Why only the segments that are not clear
 *
 * 1,565 segments exist and roughly 1,420 of them read "Greiðfært". Fetching all
 * of them would be several megabytes to draw a map that is uniformly green and
 * says nothing. The `where` clause asks the server to filter, so the payload is
 * ~146 features before simplification.
 *
 * The service caps a response at 1,000 features. The filtered set is far below
 * that, but `exceededTransferLimit` is checked rather than assumed — a change
 * upstream that pushed it over would otherwise silently truncate the layer.
 */

import type { RoadConditionSegment, RoadSegmentLine } from "@/domain/roads";
import { simplifyFeatureCollection } from "@/lib/simplify";
import {
  ProviderError,
  type ProviderAttribution,
  type ProviderResult,
} from "@/providers/types";
import { IRCA_PROVIDER_ATTRIBUTION } from "./webcam-provider";

const QUERY_URL =
  "https://vegasja.vegagerdin.is/arcgis/rest/services/data/faerd/FeatureServer/16/query";

/** The status the overwhelming majority of segments carry. */
const CLEAR = "Greiðfært";

export type RoadConditionLayer = GeoJSON.FeatureCollection<
  GeoJSON.Geometry,
  RoadConditionSegment
>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** ArcGIS reports `DB_MODIFY` as epoch milliseconds. */
function toIso(value: unknown): string | null {
  const ms = num(value);
  if (ms === null) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Drops the third ordinate from every position.
 *
 * ArcGIS returns `[lon, lat, elevation]`. Nothing here uses elevation and it is
 * roughly a third of the payload.
 */
function stripElevation(geometry: GeoJSON.Geometry): GeoJSON.Geometry {
  const flatten = (coords: unknown): unknown => {
    if (!Array.isArray(coords)) return coords;
    if (typeof coords[0] === "number") return [coords[0], coords[1]];
    return coords.map(flatten);
  };
  return {
    ...geometry,
    coordinates: flatten((geometry as { coordinates: unknown }).coordinates),
  } as GeoJSON.Geometry;
}

export function normalizeRoadConditionLayer(payload: unknown): RoadConditionLayer {
  const collection = payload as GeoJSON.FeatureCollection | undefined;
  if (!collection || !Array.isArray(collection.features)) {
    return { type: "FeatureCollection", features: [] };
  }

  const features: Array<GeoJSON.Feature<GeoJSON.Geometry, RoadConditionSegment>> = [];

  for (const feature of collection.features) {
    if (!feature.geometry) continue;
    const p = (feature.properties ?? {}) as Record<string, unknown>;

    const status = str(p.AST1_NAFN);
    const id = num(p.IDBUTUR);
    if (!status || id === null) continue;

    features.push({
      type: "Feature",
      geometry: stripElevation(feature.geometry),
      properties: {
        id,
        name: str(p.NAFN_LEIDAR),
        roadNumber: str(p.NRVEGUR),
        status,
        colour: str(p.AST1_LITUR),
        updatedAt: toIso(p.DB_MODIFY),
      },
    });
  }

  // 20 m is well below a pixel at the zooms a road layer is read at.
  return simplifyFeatureCollection(
    { type: "FeatureCollection", features },
    { toleranceM: 20, decimals: 5 },
  );
}

export class VegagerdinRoadGeometryProvider {
  readonly id = "vegagerdin-road-geometry";
  readonly attribution: ProviderAttribution = IRCA_PROVIDER_ATTRIBUTION;

  async fetchNotClear(): Promise<ProviderResult<RoadConditionLayer>> {
    const url = new URL(QUERY_URL);
    url.searchParams.set("where", `AST1_NAFN<>'${CLEAR}'`);
    url.searchParams.set(
      "outFields",
      "IDBUTUR,NAFN_LEIDAR,NRVEGUR,AST1_NAFN,AST1_LITUR,DB_MODIFY",
    );
    url.searchParams.set("returnGeometry", "true");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("geometryPrecision", "5");
    url.searchParams.set("f", "geojson");

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: {
          accept: "application/json",
          "user-agent": "IcelandLive/0.1 (+https://live.gunnthor.is)",
        },
        next: { revalidate: 300 },
      });
    } catch (cause) {
      throw new ProviderError("network", "Could not reach the Vegagerðin road service.", {
        cause,
      });
    }

    if (!response.ok) {
      throw new ProviderError(
        "http",
        `Vegagerðin road service responded ${response.status}.`,
        { status: response.status },
      );
    }

    const payload = (await response.json()) as unknown;

    // ArcGIS reports a 200 with an `error` body for a rejected query.
    const asError = payload as { error?: { message?: string } };
    if (asError?.error) {
      throw new ProviderError(
        "http",
        `Vegagerðin road service rejected the query: ${asError.error.message ?? "unknown"}`,
      );
    }

    if ((payload as { exceededTransferLimit?: boolean })?.exceededTransferLimit) {
      console.warn(
        "[road-geometry] the response hit the service's record limit; the layer is truncated",
      );
    }

    return {
      data: normalizeRoadConditionLayer(payload),
      meta: {
        providerId: this.id,
        freshness: "live",
        fetchedAt: new Date().toISOString(),
        attribution: this.attribution,
      },
    };
  }
}

/**
 * The whole road network as line work, without condition.
 *
 * ## Why the whole of it
 *
 * `fetchNotClear` is right for the map layer — a uniformly green country says
 * nothing — but wrong for asking which routes a modelled plume reaches. A
 * road that is perfectly clear is exactly the one worth telling someone about
 * if ash is going to land on it, and filtering by condition would make it
 * invisible.
 *
 * ## Pagination and generalisation
 *
 * The service caps a response at 1,000 records and there are about 1,565
 * segments, so this pages with `resultOffset`. `maxAllowableOffset` asks the
 * server to generalise to roughly two kilometres, which keeps the payload near
 * 330 KB and is well inside the seven-kilometre cells the lines are tested
 * against. It is fetched server-side, cached for a day, and never sent to a
 * browser — the line work changes on the order of roadworks, unlike the
 * conditions laid over it.
 */
const PAGE_SIZE = 1000;
const MAX_PAGES = 6;
/** Degrees, since the output is WGS84. About two kilometres. */
const GENERALISE_DEGREES = 0.02;

export function normalizeRoadLines(payload: unknown): RoadSegmentLine[] {
  const collection = payload as GeoJSON.FeatureCollection | undefined;
  if (!collection || !Array.isArray(collection.features)) return [];

  const lines: RoadSegmentLine[] = [];

  for (const feature of collection.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;

    const p = (feature.properties ?? {}) as Record<string, unknown>;
    const id = num(p.IDBUTUR);
    if (id === null) continue;

    // LineString and MultiLineString both reduce to a flat list of positions;
    // nothing here cares which part of a route a vertex belongs to.
    const positions: Array<{ latitude: number; longitude: number }> = [];
    const collect = (coords: unknown): void => {
      if (!Array.isArray(coords)) return;
      if (typeof coords[0] === "number") {
        const longitude = coords[0] as number;
        const latitude = num(coords[1]);
        if (latitude !== null && Number.isFinite(longitude)) {
          positions.push({ latitude, longitude });
        }
        return;
      }
      for (const inner of coords) collect(inner);
    };
    collect((geometry as { coordinates?: unknown }).coordinates);

    if (positions.length === 0) continue;

    lines.push({
      id,
      name: str(p.NAFN_LEIDAR),
      roadNumber: str(p.NRVEGUR),
      points: positions,
    });
  }

  return lines;
}

export class VegagerdinRoadNetworkProvider {
  readonly id = "vegagerdin-road-network";
  readonly attribution: ProviderAttribution = IRCA_PROVIDER_ATTRIBUTION;

  async fetchAllSegments(): Promise<ProviderResult<RoadSegmentLine[]>> {
    const segments: RoadSegmentLine[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(QUERY_URL);
      url.searchParams.set("where", "1=1");
      url.searchParams.set("outFields", "IDBUTUR,NAFN_LEIDAR,NRVEGUR");
      url.searchParams.set("returnGeometry", "true");
      url.searchParams.set("outSR", "4326");
      url.searchParams.set("geometryPrecision", "4");
      url.searchParams.set("maxAllowableOffset", String(GENERALISE_DEGREES));
      url.searchParams.set("resultOffset", String(page * PAGE_SIZE));
      url.searchParams.set("f", "geojson");

      let response: Response;
      try {
        response = await fetch(url, {
          signal: AbortSignal.timeout(40_000),
          headers: {
            accept: "application/json",
            "user-agent": "IcelandLive/0.1 (+https://live.gunnthor.is)",
          },
          // The line work changes on the order of roadworks.
          next: { revalidate: 24 * 60 * 60 },
        });
      } catch (cause) {
        throw new ProviderError("network", "Could not reach the Vegagerðin road service.", {
          cause,
        });
      }

      if (!response.ok) {
        throw new ProviderError(
          "http",
          `Vegagerðin road service responded ${response.status} for the network.`,
          { status: response.status },
        );
      }

      const payload = (await response.json()) as unknown;
      const asError = payload as { error?: { message?: string } };
      if (asError?.error) {
        throw new ProviderError(
          "http",
          `Vegagerðin road service rejected the network query: ${asError.error.message ?? "unknown"}`,
        );
      }

      const page_ = normalizeRoadLines(payload);
      segments.push(...page_);

      // The last page is the one the service did not have to truncate.
      if (!(payload as { exceededTransferLimit?: boolean })?.exceededTransferLimit) break;
    }

    return {
      data: segments,
      meta: {
        providerId: this.id,
        freshness: "live",
        fetchedAt: new Date().toISOString(),
        attribution: this.attribution,
      },
    };
  }
}
