/**
 * A minimal WFS client for the GeoServer instances Icelandic agencies publish.
 *
 * These are not part of the api.vedur.is gateway — they are separate GeoServer
 * deployments run by IMO (geo.vedur.is), the National Land Survey
 * (gis.lmi.is) and the Icelandic Institute of Natural History (gis.natt.is),
 * discoverable through the gateway's `GET /gis/layers` index.
 *
 * We request `outputFormat=application/json` and `srsName=EPSG:4326`, so
 * GeoServer does the projection and we receive ordinary GeoJSON in WGS84.
 */

import { ProviderError } from "@/providers/types";

/** Hosts we are willing to fetch from. */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "geo.vedur.is",
  "gis.lmi.is",
  "gis.natt.is",
]);

export type WfsRequest = {
  /** GeoServer WFS endpoint, e.g. "https://geo.vedur.is/geoserver/wfs". */
  url: string;
  /** Qualified layer name, e.g. "infrastructure:Svartsengi_Grindavik_lava_Barriers". */
  typeName: string;
  /** Optional CQL filter, passed through unchanged. */
  cqlFilter?: string;
  timeoutMs?: number;
  revalidateSeconds?: number;
};

export async function fetchWfsGeoJson<P extends GeoJSON.GeoJsonProperties = GeoJSON.GeoJsonProperties>(
  request: WfsRequest,
): Promise<GeoJSON.FeatureCollection<GeoJSON.Geometry, P>> {
  const url = new URL(request.url);

  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new ProviderError(
      "config",
      `Refusing to fetch WFS from an unexpected host: ${url.hostname}`,
    );
  }

  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typeNames", request.typeName);
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("srsName", "EPSG:4326");
  if (request.cqlFilter) url.searchParams.set("cql_filter", request.cqlFilter);

  const target = url.toString();
  // These payloads are megabytes before simplification, so the default is long.
  const timeout = AbortSignal.timeout(request.timeoutMs ?? 45_000);

  let response: Response;
  try {
    response = await fetch(target, {
      signal: timeout,
      headers: {
        accept: "application/json",
        "user-agent": "IcelandLive/0.1 (+https://live.gunnthor.is)",
      },
      next:
        request.revalidateSeconds === undefined
          ? undefined
          : { revalidate: request.revalidateSeconds },
    });
  } catch (cause) {
    throw new ProviderError("network", `Could not reach ${url.hostname} for ${request.typeName}.`, {
      cause,
    });
  }

  if (!response.ok) {
    throw new ProviderError(
      "http",
      `${url.hostname} responded ${response.status} for ${request.typeName}.`,
      { status: response.status },
    );
  }

  const text = await response.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    // GeoServer reports errors as an XML ServiceExceptionReport with HTTP 200.
    throw new ProviderError(
      "parse",
      `${url.hostname} returned a non-JSON body for ${request.typeName}: ${text.slice(0, 160)}`,
      { cause },
    );
  }

  const collection = parsed as GeoJSON.FeatureCollection<GeoJSON.Geometry, P>;
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new ProviderError(
      "parse",
      `${url.hostname} returned something other than a FeatureCollection for ${request.typeName}.`,
    );
  }

  return collection;
}
