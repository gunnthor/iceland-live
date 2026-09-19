/**
 * Normalization of OASIS CAP 1.2 messages from IMO's CAP broker.
 *
 * ## Shape hazards this module absorbs
 *
 * The payload is XML converted to JSON, and that conversion collapses
 * single-element sequences into bare objects. So `alert.info` is an array when
 * IMO publishes both languages (the normal case) and an object when it
 * publishes one; the same applies to `area`, `parameter`, `geocode`,
 * `eventCode` and `responseType`. Every repeatable element is therefore read
 * through `asArray`.
 *
 * ## Coordinate order
 *
 * CAP polygons are whitespace-separated `latitude,longitude` pairs — the
 * opposite of GeoJSON's `[longitude, latitude]`. Getting this backwards puts
 * Icelandic warnings in the Indian Ocean, so the swap is explicit and tested.
 *
 * ## What we refuse to show
 *
 * Only `status: "Actual"` messages become alerts. CAP also carries `Test`,
 * `Exercise`, `Draft` and `System` statuses, and presenting a drill as a live
 * warning would be the single worst thing this product could do.
 */

import type {
  AlertArea,
  AlertCategory,
  AlertCertainty,
  AlertColour,
  AlertSeverity,
  AlertUrgency,
  LocalizedText,
  OfficialAlert,
} from "@/domain/alert";

const SEVERITIES: ReadonlySet<string> = new Set([
  "Unknown",
  "Minor",
  "Moderate",
  "Severe",
  "Extreme",
]);
const URGENCIES: ReadonlySet<string> = new Set([
  "Unknown",
  "Past",
  "Future",
  "Expected",
  "Immediate",
]);
const CERTAINTIES: ReadonlySet<string> = new Set([
  "Unknown",
  "Unlikely",
  "Possible",
  "Likely",
  "Observed",
]);
const COLOURS: ReadonlySet<string> = new Set(["Yellow", "Orange", "Red"]);

/** CAP status values that represent a real, live warning. */
const LIVE_STATUS = "actual";

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** CAP timestamps look like `2026-09-06T09:46:38-00:00`. */
function iso(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

type RawInfo = {
  language?: unknown;
  category?: unknown;
  event?: unknown;
  headline?: unknown;
  description?: unknown;
  severity?: unknown;
  urgency?: unknown;
  certainty?: unknown;
  senderName?: unknown;
  onset?: unknown;
  expires?: unknown;
  web?: unknown;
  eventCode?: unknown;
  parameter?: unknown;
  area?: unknown;
};

type RawAlert = {
  identifier?: unknown;
  sender?: unknown;
  sent?: unknown;
  status?: unknown;
  msgType?: unknown;
  info?: RawInfo | RawInfo[];
};

function isEnglish(info: RawInfo): boolean {
  return /^en/i.test(str(info.language) ?? "");
}

function isIcelandic(info: RawInfo): boolean {
  return /^is/i.test(str(info.language) ?? "");
}

/** Reads one field across both language variants. */
function localized(
  en: RawInfo | undefined,
  is: RawInfo | undefined,
  key: keyof RawInfo,
): LocalizedText {
  return { en: str(en?.[key]), is: str(is?.[key]) };
}

/** Finds a CAP `value`/`valueName` pair by its name. */
function namedValue(raw: unknown, valueName: string): string | null {
  for (const entry of asArray(raw)) {
    if (!entry || typeof entry !== "object") continue;
    const pair = entry as { value?: unknown; valueName?: unknown };
    if (str(pair.valueName)?.toLowerCase() === valueName.toLowerCase()) {
      return str(pair.value);
    }
  }
  return null;
}

/**
 * Converts a CAP polygon string to a GeoJSON polygon.
 *
 * Input: `"63.9,-22.1 64.0,-22.3 …"` — `lat,lon`, space-separated, with the
 * first point repeated at the end to close the ring.
 */
export function capPolygonToGeoJson(raw: unknown): GeoJSON.Polygon | null {
  const text = str(raw);
  if (!text) return null;

  const ring: Array<[number, number]> = [];
  for (const pair of text.trim().split(/\s+/)) {
    const [latText, lonText] = pair.split(",");
    const lat = Number(latText);
    const lon = Number(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    // GeoJSON is [longitude, latitude]; CAP is latitude,longitude.
    ring.push([lon, lat]);
  }

  if (ring.length < 3) return null;

  const first = ring[0] as [number, number];
  const last = ring[ring.length - 1] as [number, number];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  if (ring.length < 4) return null;

  return { type: "Polygon", coordinates: [ring] };
}

function toAreas(en: RawInfo | undefined, is: RawInfo | undefined): AlertArea[] {
  const enAreas = asArray(en?.area as unknown);
  const isAreas = asArray(is?.area as unknown);
  const count = Math.max(enAreas.length, isAreas.length);

  const areas: AlertArea[] = [];
  for (let i = 0; i < count; i += 1) {
    const enArea = enAreas[i] as { areaDesc?: unknown; polygon?: unknown } | undefined;
    const isArea = isAreas[i] as { areaDesc?: unknown; polygon?: unknown } | undefined;
    areas.push({
      description: { en: str(enArea?.areaDesc), is: str(isArea?.areaDesc) },
      geometry: capPolygonToGeoJson(enArea?.polygon ?? isArea?.polygon),
    });
  }
  return areas;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  fallback: T,
): T {
  const raw = str(value);
  return raw && allowed.has(raw) ? (raw as T) : fallback;
}

/**
 * Normalizes one CAP message.
 *
 * Returns `null` for anything that is not a live public warning — a drill, a
 * draft, or a message with no identifier — rather than passing it through for
 * the UI to filter. The decision belongs here, once.
 */
export function normalizeCapMessage(payload: unknown): OfficialAlert | null {
  const root = payload as { alert?: RawAlert } | RawAlert | null;
  if (!root || typeof root !== "object") return null;

  const alert = ("alert" in root ? root.alert : root) as RawAlert | undefined;
  if (!alert || typeof alert !== "object") return null;

  if (str(alert.status)?.toLowerCase() !== LIVE_STATUS) return null;

  const id = str(alert.identifier);
  const sentAt = iso(alert.sent);
  if (!id || !sentAt) return null;

  const infos = asArray(alert.info);
  if (infos.length === 0) return null;

  const en = infos.find(isEnglish) ?? infos[0];
  const is = infos.find(isIcelandic);
  const primary = en ?? (infos[0] as RawInfo);

  return {
    id,
    sender: str(alert.sender) ?? "unknown",
    senderName: str(primary.senderName),
    sentAt,
    onsetAt: iso(primary.onset),
    expiresAt: iso(primary.expires),
    messageType: str(alert.msgType) ?? "Alert",
    category: (str(primary.category) as AlertCategory) ?? "Other",
    alertType: namedValue(primary.eventCode, "alertType"),
    event: localized(en, is, "event"),
    headline: localized(en, is, "headline"),
    description: localized(en, is, "description"),
    severity: oneOf<AlertSeverity>(primary.severity, SEVERITIES, "Unknown"),
    urgency: oneOf<AlertUrgency>(primary.urgency, URGENCIES, "Unknown"),
    certainty: oneOf<AlertCertainty>(primary.certainty, CERTAINTIES, "Unknown"),
    colour: (() => {
      const colour = namedValue(primary.parameter, "Color");
      return colour && COLOURS.has(colour) ? (colour as AlertColour) : null;
    })(),
    areas: toAreas(en, is),
    url: str(primary.web),
  };
}

/**
 * Drops alerts whose `expires` has passed.
 *
 * The broker's "active" listing is authoritative, but a cached response can
 * outlive an alert. Showing an expired warning is worse than showing none.
 */
export function dropExpired(
  alerts: readonly OfficialAlert[],
  now: Date = new Date(),
): OfficialAlert[] {
  const nowMs = now.getTime();
  return alerts.filter((alert) => {
    if (!alert.expiresAt) return true;
    const expires = Date.parse(alert.expiresAt);
    return !Number.isFinite(expires) || expires > nowMs;
  });
}
