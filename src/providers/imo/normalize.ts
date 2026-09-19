/**
 * Normalization of IMO Quakes API responses into our `Earthquake` model.
 *
 * ## Why CSV rather than GeoJSON
 *
 * `GET /quakes/events` can return either `format=json` (a GeoJSON
 * FeatureCollection) or `format=csv`. They are not equivalent: the CSV carries
 * two fields the GeoJSON omits — `status` (IMO's review state) and
 * `magnitude_type` (the magnitude scale). Both are things we want to surface,
 * so CSV is our wire format and this module is the only place that knows it.
 *
 * Observed CSV header (2026-08-06):
 *   event_id,time,latitude,longitude,depth,magnitude,magnitude_type,status,
 *   evaluation_mode,type,region,update_time
 *
 * Columns are resolved by header name, never by position, so an upstream
 * reordering cannot silently shift values between fields.
 */

import type {
  Earthquake,
  EvaluationMode,
  ReviewStatus,
} from "@/domain/earthquake";
import { ProviderError } from "@/providers/types";

/** Header names we require before trusting a payload. */
const REQUIRED_COLUMNS = ["event_id", "time", "latitude", "longitude"] as const;

export type NormalizationOutcome = {
  quakes: Earthquake[];
  /** Rows dropped because they lacked a usable id, time or position. */
  skipped: number;
};

/**
 * RFC 4180-style CSV reader.
 *
 * Live IMO data currently contains no quoted fields, but region names are free
 * text, so we handle quoting and embedded commas/newlines rather than assuming
 * they will never appear.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let touched = false;

  const endField = () => {
    row.push(field);
    field = "";
    touched = true;
  };
  const endRow = () => {
    if (touched || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    row = [];
    field = "";
    touched = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
      touched = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\n") {
      endRow();
    } else if (char === "\r") {
      // Swallow CR; the following LF terminates the row.
    } else {
      field += char;
      touched = true;
    }
  }

  if (touched || row.length > 0) endRow();
  return rows;
}

function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTrimmedOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * IMO reports `reviewed` for solutions a seismologist has checked and
 * `confirmed` for automatic detections the system is confident about. We map
 * `confirmed` to `automatic` because, from a reader's point of view, the
 * meaningful distinction is "a human has looked at this" versus "it is still
 * a machine solution".
 */
function toReviewStatus(raw: string | null, mode: EvaluationMode | null): ReviewStatus {
  switch (raw?.toLowerCase()) {
    case "reviewed":
      return "reviewed";
    case "confirmed":
      return "automatic";
    default:
      break;
  }
  if (mode === "manual") return "reviewed";
  if (mode === "automatic") return "automatic";
  return "unknown";
}

function toEvaluationMode(raw: string | null): EvaluationMode | null {
  const value = raw?.toLowerCase();
  return value === "manual" || value === "automatic" ? value : null;
}

/**
 * Normalizes IMO's timestamps to an ISO 8601 UTC instant.
 *
 * Upstream values look like `2026-09-19T12:32:30.314487Z` — microsecond
 * precision, already UTC. `Date` truncates to milliseconds, which is ample.
 * A value without a zone designator is treated as UTC, which is what the Quakes
 * API documents ("timezone info is optional", times are UTC).
 */
export function toIsoInstant(raw: string | null): string | null {
  if (!raw) return null;
  const value = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Converts a raw Quakes CSV payload into normalized earthquakes.
 *
 * Rows missing an id, a parseable time or finite coordinates are skipped rather
 * than guessed at — an event we cannot place on a map is not something we can
 * honestly display. The count of skipped rows is returned so callers can log it.
 */
export function normalizeQuakesCsv(csv: string): NormalizationOutcome {
  const rows = parseCsv(csv);
  const header = rows[0];

  if (!header) {
    throw new ProviderError("parse", "IMO Quakes CSV was empty (no header row).");
  }

  const index = new Map<string, number>();
  header.forEach((name, position) => index.set(name.trim().toLowerCase(), position));

  const missing = REQUIRED_COLUMNS.filter((column) => !index.has(column));
  if (missing.length > 0) {
    throw new ProviderError(
      "parse",
      `IMO Quakes CSV is missing expected column(s): ${missing.join(", ")}. Received: ${header.join(", ")}`,
    );
  }

  const cell = (row: string[], column: string): string | undefined => {
    const position = index.get(column);
    return position === undefined ? undefined : row[position];
  };

  const quakes: Earthquake[] = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    // A trailing newline yields a single empty field; that is not a data row.
    if (row.length === 1 && (row[0] ?? "").trim() === "") continue;

    const id = toTrimmedOrNull(cell(row, "event_id"));
    const occurredAt = toIsoInstant(toTrimmedOrNull(cell(row, "time")));
    const latitude = toNumberOrNull(cell(row, "latitude"));
    const longitude = toNumberOrNull(cell(row, "longitude"));

    if (!id || !occurredAt || latitude === null || longitude === null) {
      skipped += 1;
      continue;
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      skipped += 1;
      continue;
    }

    const evaluationMode = toEvaluationMode(toTrimmedOrNull(cell(row, "evaluation_mode")));

    quakes.push({
      id,
      occurredAt,
      updatedAt: toIsoInstant(toTrimmedOrNull(cell(row, "update_time"))),
      latitude,
      longitude,
      depthKm: toNumberOrNull(cell(row, "depth")),
      magnitude: toNumberOrNull(cell(row, "magnitude")),
      magnitudeType: toTrimmedOrNull(cell(row, "magnitude_type")),
      region: toTrimmedOrNull(cell(row, "region")),
      eventType: toTrimmedOrNull(cell(row, "type")),
      reviewStatus: toReviewStatus(toTrimmedOrNull(cell(row, "status")), evaluationMode),
      evaluationMode,
      source: "IMO",
    });
  }

  // Newest first: every consumer (feed, stats, map draw order) wants this.
  quakes.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));

  return { quakes, skipped };
}
