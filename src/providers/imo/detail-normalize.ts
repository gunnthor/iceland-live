/**
 * Normalization of `GET /quakes/events/{id}`.
 *
 * The response mirrors SeisComP's origin/magnitude structure and **reports
 * every number as a string**, so each one is parsed rather than trusted.
 *
 * Units, established by inspecting live data across the quality range rather
 * than from documentation (the endpoint has no response schema in the OpenAPI
 * spec):
 *
 *  - `origin.time.uncertainty` — seconds. Values run 0.04–0.25.
 *  - `origin.depth.uncertainty` — kilometres, matching the depth value itself.
 *  - `origin.latitude|longitude.uncertainty` — kilometres, *not* degrees.
 *    Observed values run 0.2–3.8. Read as degrees those would be horizontal
 *    errors of 22–420 km, which is not a solution IMO would publish as
 *    reviewed; read as kilometres they are exactly what a dense local network
 *    produces.
 *  - `confidenceLevel` — percent, reported as 89.99999761581421 for 90%.
 */

import type {
  DepthType,
  EarthquakeDetail,
  Measured,
} from "@/domain/earthquake-detail";
import type { EvaluationMode } from "@/domain/earthquake";
import { ProviderError } from "@/providers/types";

/** Parses a value that upstream sends as a string. */
function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Rounds 89.99999761581421 to 90 without flattening a genuine 89.5. */
function confidence(value: unknown): number | null {
  const parsed = num(value);
  if (parsed === null) return null;
  return Math.round(parsed * 100) / 100;
}

type RawQuantity = { value?: unknown; uncertainty?: unknown; confidenceLevel?: unknown };

function measured(raw: unknown): Measured | null {
  if (!raw || typeof raw !== "object") return null;
  const quantity = raw as RawQuantity;
  const value = num(quantity.value);
  if (value === null) return null;
  return {
    value,
    uncertainty: num(quantity.uncertainty),
    confidenceLevel: confidence(quantity.confidenceLevel),
  };
}

function evaluationMode(raw: unknown): EvaluationMode | null {
  const value = str(raw)?.toLowerCase();
  return value === "manual" || value === "automatic" ? value : null;
}

export function normalizeEarthquakeDetail(id: string, payload: unknown): EarthquakeDetail {
  if (!payload || typeof payload !== "object") {
    throw new ProviderError("parse", `IMO returned no usable detail for event ${id}.`);
  }

  const raw = payload as {
    description?: { text?: unknown } | null;
    magnitude?: { mag?: unknown; type?: unknown } | null;
    origin?: {
      time?: RawQuantity | null;
      latitude?: unknown;
      longitude?: unknown;
      depth?: unknown;
      depthType?: unknown;
      evaluationMode?: unknown;
    } | null;
    type?: unknown;
  };

  const origin = raw.origin ?? {};
  const timeIso = str(origin.time?.value);

  return {
    id,
    regionText: str(raw.description?.text),
    magnitude: measured(raw.magnitude?.mag),
    magnitudeType: str(raw.magnitude?.type),
    originTime: timeIso
      ? {
          iso: new Date(timeIso).toISOString(),
          uncertaintySeconds: num(origin.time?.uncertainty),
          confidenceLevel: confidence(origin.time?.confidenceLevel),
        }
      : null,
    latitude: measured(origin.latitude),
    longitude: measured(origin.longitude),
    depthKm: measured(origin.depth),
    depthType: (str(origin.depthType) as DepthType | null) ?? null,
    evaluationMode: evaluationMode(origin.evaluationMode),
    eventType: str(raw.type),
  };
}
