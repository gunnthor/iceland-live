/**
 * Provider contracts.
 *
 * Every external data source is reached through one of these interfaces. The
 * rule is: API-specific response shapes exist only inside a provider
 * implementation, and everything the provider returns is already normalized
 * into `src/domain`. Adding a new source (air quality, road conditions, GNSS)
 * means adding a provider, not touching the UI.
 */

import type { Earthquake } from "@/domain/earthquake";
import type { VolcanicSystem } from "@/domain/volcano";

/** Where a payload came from, and how much we trust its freshness. */
export type Freshness =
  /** Fetched from upstream during this request. */
  | "live"
  /** Served from our cache while still inside its TTL. */
  | "cached"
  /** Upstream failed; we are serving the last good payload we hold. */
  | "stale"
  /** Deliberately synthetic data, only ever used in development. */
  | "fixture";

export type ProviderAttribution = {
  /** Human-readable source name, e.g. "Icelandic Meteorological Office". */
  name: string;
  /** Canonical link users can follow to the source. */
  url: string;
  /** Short licence/usage note, when the source states one. */
  note?: string;
};

export type ProviderMeta = {
  providerId: string;
  freshness: Freshness;
  /** When the underlying payload was retrieved from upstream. */
  fetchedAt: string;
  /** Present when `freshness === "stale"`: why the live fetch failed. */
  degradedReason?: string;
  attribution: ProviderAttribution;
};

export type ProviderResult<T> = {
  data: T;
  meta: ProviderMeta;
};

/** An upstream failure that carries enough context for a useful UI state. */
export class ProviderError extends Error {
  readonly kind: "network" | "http" | "parse" | "config";
  readonly status?: number;

  constructor(
    kind: ProviderError["kind"],
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.kind = kind;
    this.status = options.status;
  }
}

export type EarthquakeQuery = {
  /** Inclusive lower bound on origin time. */
  from: Date;
  /** Exclusive upper bound on origin time. */
  to: Date;
};

export interface EarthquakeProvider {
  readonly id: string;
  readonly attribution: ProviderAttribution;
  fetchEarthquakes(query: EarthquakeQuery): Promise<ProviderResult<Earthquake[]>>;
}

export interface VolcanoProvider {
  readonly id: string;
  readonly attribution: ProviderAttribution;
  fetchVolcanicSystems(): Promise<ProviderResult<VolcanicSystem[]>>;
}
