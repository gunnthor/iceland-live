/**
 * Road weather and conditions from Vegagerðin.
 *
 *   GET https://gagnaveita.vegagerdin.is/api/vedur2014_1  — ~203 weather stations
 *   GET https://gagnaveita.vegagerdin.is/api/faerd2014_1  — ~970 road segments
 *
 * Same open-data service and same terms as the webcams, so the same
 * acknowledgement applies.
 *
 * Field names are Icelandic. The ones that matter: `Breidd` latitude,
 * `Lengd` longitude, `Hiti` air temperature, `Veghiti` road temperature,
 * `Vindhradi` wind speed, `Vindhvida` gust, `Vindatt` wind direction,
 * `FulltAstand` full condition text, `Linulitur` their own status colour.
 */

import type { RoadCondition, RoadWeatherStation } from "@/domain/roads";
import {
  ProviderError,
  type ProviderAttribution,
  type ProviderResult,
} from "@/providers/types";
import { IRCA_PROVIDER_ATTRIBUTION } from "./webcam-provider";

const WEATHER_ENDPOINT = "https://gagnaveita.vegagerdin.is/api/vedur2014_1";
const CONDITIONS_ENDPOINT = "https://gagnaveita.vegagerdin.is/api/faerd2014_1";

export const IRCA_ROADS_ATTRIBUTION: ProviderAttribution = IRCA_PROVIDER_ATTRIBUTION;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parses `19.9.2026 17:40:00` — day-first, no zone.
 *
 * Read as UTC, which is also Icelandic local time all year. `Date.parse` cannot
 * be trusted with this format (it would read `19.9` as a month), so it is
 * decomposed explicitly.
 */
function toIso(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;

  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!match) return null;

  const [, day, month, year, hour, minute, second] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? "0"),
    ),
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeRoadWeather(payload: unknown): RoadWeatherStation[] {
  if (!Array.isArray(payload)) return [];

  const stations: RoadWeatherStation[] = [];

  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;

    const id = num(raw.Nr);
    const name = str(raw.Nafn);
    const latitude = num(raw.Breidd);
    const longitude = num(raw.Lengd);
    if (id === null || !name || latitude === null || longitude === null) continue;
    if (latitude < 62 || latitude > 68 || longitude < -26 || longitude > -12) continue;

    stations.push({
      id,
      name,
      latitude,
      longitude,
      altitudeM: num(raw.Haed),
      observedAt: toIso(raw.Dags),
      windDirectionDeg: num(raw.Vindatt),
      windDirectionLabel: str(raw.VindattAscEng) ?? str(raw.VindattAsc),
      windSpeedMs: num(raw.Vindhradi),
      windGustMs: num(raw.Vindhvida),
      airTempC: num(raw.Hiti),
      roadTempC: num(raw.Veghiti),
      relativeHumidity: num(raw.Raki),
    });
  }

  stations.sort((a, b) => a.name.localeCompare(b.name, "is"));
  return stations;
}

export function normalizeRoadConditions(payload: unknown): RoadCondition[] {
  if (!Array.isArray(payload)) return [];

  const conditions: RoadCondition[] = [];
  const seen = new Set<string>();

  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;

    const id = num(raw.IdButur);
    const name = str(raw.LangtNafn);
    const status = str(raw.FulltAstand);
    if (id === null || !name || !status) continue;

    // The feed repeats some segments; one row per name and status is enough.
    const key = `${name}|${status}`;
    if (seen.has(key)) continue;
    seen.add(key);

    conditions.push({
      id,
      name,
      status,
      shortStatus: str(raw.StuttAstand),
      colour: str(raw.Linulitur),
      updatedAt: toIso(raw.DagsKeyrtUt),
      highland: num(raw.ErHalendi) === 1,
    });
  }

  conditions.sort((a, b) => a.name.localeCompare(b.name, "is"));
  return conditions;
}

export class VegagerdinRoadsProvider {
  readonly id = "vegagerdin-roads";
  readonly attribution = IRCA_ROADS_ATTRIBUTION;

  async fetchRoads(): Promise<
    ProviderResult<{ weather: RoadWeatherStation[]; conditions: RoadCondition[] }>
  > {
    const [weather, conditions] = await Promise.all([
      this.get(WEATHER_ENDPOINT, 300),
      this.get(CONDITIONS_ENDPOINT, 300),
    ]);

    return {
      data: {
        weather: normalizeRoadWeather(weather),
        conditions: normalizeRoadConditions(conditions),
      },
      meta: {
        providerId: this.id,
        freshness: "live",
        fetchedAt: new Date().toISOString(),
        attribution: this.attribution,
      },
    };
  }

  private async get(url: string, revalidateSeconds: number): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: {
          accept: "application/json",
          "user-agent": "IcelandLive/0.1 (+https://live.gunnthor.is)",
        },
        next: { revalidate: revalidateSeconds },
      });
    } catch (cause) {
      throw new ProviderError("network", `Could not reach the Vegagerðin service at ${url}.`, {
        cause,
      });
    }

    if (!response.ok) {
      throw new ProviderError("http", `Vegagerðin responded ${response.status} for ${url}.`, {
        status: response.status,
      });
    }

    return (await response.json()) as unknown;
  }
}
