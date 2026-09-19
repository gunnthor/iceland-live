/**
 * Air quality from the Environment and Energy Agency (Umhverfis- og orkustofnun).
 *
 *   GET https://api.ust.is/aq/a/getStations  — station metadata with coordinates
 *   GET https://api.ust.is/aq/a/getLatest    — last 24 hours, hourly, per station
 *
 * The two have to be joined: `getLatest` carries measurements but no position,
 * `getStations` carries position but no measurements. `local_id` is the key.
 *
 * ## Shape notes
 *
 * `getLatest` is an object keyed by station id, and each parameter block mixes
 * metadata keys (`unit`, `resolution`) with numeric string keys `"0"`, `"1"`, …
 * holding the hourly series, newest first. Every value is a string. Timestamps
 * are `YYYY-MM-DD HH:MM:SS` with no zone; the agency publishes in UTC, which is
 * also Icelandic local time year-round, so they are read as UTC.
 */

import type {
  AirQualityStation,
  Pollutant,
  Reading,
  VerificationState,
} from "@/domain/air-quality";
import { HEADLINE_POLLUTANTS } from "@/domain/air-quality";
import {
  ProviderError,
  type ProviderAttribution,
  type ProviderResult,
} from "@/providers/types";

const BASE = "https://api.ust.is/aq/a";

export const UST_ATTRIBUTION: ProviderAttribution = {
  name: "Environment and Energy Agency of Iceland (Umhverfis- og orkustofnun)",
  url: "https://ust.is/",
  note: "Air quality measurements from the national monitoring network.",
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `2026-09-19 17:00:00` → ISO instant, read as UTC. */
function toIso(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const date = new Date(`${raw.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The agency documents 1 as verified and 3 as not verified. */
function toVerification(value: unknown): VerificationState {
  const parsed = num(value);
  if (parsed === 1) return "verified";
  if (parsed === 3) return "unverified";
  return "unknown";
}

type RawParameter = Record<string, unknown> & {
  unit?: unknown;
  resolution?: unknown;
};

type RawStationMeta = {
  local_id?: unknown;
  name?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  municipality?: unknown;
  network_name?: unknown;
  station_classification?: unknown;
  altitude?: unknown;
  activity_end?: unknown;
};

/**
 * Picks the newest reading from a parameter block, with its preceding series.
 *
 * Index `"0"` is normally the newest, but samples are ordered by timestamp
 * rather than trusting that: an ordering assumption that silently breaks would
 * show an hours-old value as current.
 *
 * The series is kept only for the pollutants the interface charts, because
 * carrying 24 points for all ten pollutants at every station would multiply the
 * payload for charts nobody looks at.
 */
function newestReading(pollutant: Pollutant, block: RawParameter): Reading | null {
  const unit = str(block.unit) ?? "";
  const resolution = str(block.resolution);
  const keepSeries = HEADLINE_POLLUTANTS.includes(pollutant);

  let best: Reading | null = null;
  const series: Array<{ at: string; value: number }> = [];

  for (const [key, entry] of Object.entries(block)) {
    if (!/^\d+$/.test(key)) continue;
    if (!entry || typeof entry !== "object") continue;

    const sample = entry as { endtime?: unknown; value?: unknown; verification?: unknown };
    const value = num(sample.value);
    const observedAt = toIso(sample.endtime);
    if (value === null || !observedAt) continue;

    /*
     * Negative concentrations are dropped.
     *
     * A mass concentration below zero is physically impossible; in unverified
     * real-time data it is instrument baseline drift near the detection limit,
     * and about 3% of readings carry one. Displaying "-6.8 µg/m³" presents
     * noise as a measurement, and clamping it to zero invents a reading that
     * was never taken — so the sample is treated as absent, which is what it
     * is. Verified data from the agency does not have this problem.
     */
    if (value < 0) continue;

    if (keepSeries) series.push({ at: observedAt, value });

    if (!best || observedAt > best.observedAt) {
      best = {
        pollutant,
        value,
        unit,
        observedAt,
        resolution,
        verification: toVerification(sample.verification),
      };
    }
  }

  if (best && keepSeries && series.length > 1) {
    series.sort((a, b) => a.at.localeCompare(b.at));
    best.series = series;
  }

  return best;
}

export function normalizeAirQuality(
  latest: unknown,
  stations: unknown,
): AirQualityStation[] {
  if (!latest || typeof latest !== "object") return [];

  // Index the metadata by local_id so measurements can be given a position.
  const meta = new Map<string, RawStationMeta>();
  if (Array.isArray(stations)) {
    for (const entry of stations) {
      if (!entry || typeof entry !== "object") continue;
      const id = str((entry as RawStationMeta).local_id);
      if (id) meta.set(id, entry as RawStationMeta);
    }
  }

  const result: AirQualityStation[] = [];

  for (const [id, raw] of Object.entries(latest as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const station = raw as { name?: unknown; parameters?: unknown };

    const info = meta.get(id);
    const latitude = num(info?.latitude);
    const longitude = num(info?.longitude);

    // Without a position it cannot go on the map, and an air reading with no
    // location is not something we can present usefully.
    if (latitude === null || longitude === null) continue;

    const readings: Reading[] = [];
    if (station.parameters && typeof station.parameters === "object") {
      for (const [pollutant, block] of Object.entries(
        station.parameters as Record<string, RawParameter>,
      )) {
        if (!block || typeof block !== "object") continue;
        const reading = newestReading(pollutant, block);
        if (reading) readings.push(reading);
      }
    }

    if (readings.length === 0) continue;

    readings.sort((a, b) => a.pollutant.localeCompare(b.pollutant));

    result.push({
      id,
      name: str(station.name) ?? str(info?.name) ?? id,
      latitude,
      longitude,
      municipality: str(info?.municipality),
      network: str(info?.network_name),
      classification: str(info?.station_classification),
      altitudeM: num(info?.altitude),
      latest: readings,
    });
  }

  result.sort((a, b) => a.name.localeCompare(b.name, "is"));
  return result;
}

export class UstAirQualityProvider {
  readonly id = "ust-air-quality";
  readonly attribution = UST_ATTRIBUTION;

  async fetchStations(): Promise<ProviderResult<AirQualityStation[]>> {
    const [latest, stations] = await Promise.all([
      this.get("/getLatest", 300),
      // Station metadata changes on the order of years.
      this.get("/getStations", 24 * 60 * 60),
    ]);

    return {
      data: normalizeAirQuality(latest, stations),
      meta: {
        providerId: this.id,
        freshness: "live",
        fetchedAt: new Date().toISOString(),
        attribution: this.attribution,
      },
    };
  }

  private async get(path: string, revalidateSeconds: number): Promise<unknown> {
    const url = `${BASE}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: {
          /*
           * `*\/*`, not `application/json`.
           *
           * api.ust.is answers 406 Not Acceptable to an explicit
           * `Accept: application/json` — despite serving exactly that — while
           * accepting `*\/*` or no Accept header at all. Its content
           * negotiation evidently does not advertise the type it returns.
           */
          accept: "*/*",
          "user-agent": "IcelandLive/0.1 (+https://live.gunnthor.is)",
        },
        next: { revalidate: revalidateSeconds },
      });
    } catch (cause) {
      throw new ProviderError("network", `Could not reach the air quality API at ${url}.`, {
        cause,
      });
    }

    if (!response.ok) {
      throw new ProviderError("http", `Air quality API responded ${response.status} for ${path}.`, {
        status: response.status,
      });
    }

    return (await response.json()) as unknown;
  }
}
