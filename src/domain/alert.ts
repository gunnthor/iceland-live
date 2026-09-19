/**
 * Official warnings, as issued by the Icelandic Meteorological Office.
 *
 * These are **not ours**. Everything in this file describes someone else's
 * assessment, and the interface presents it as such — visually and in wording
 * distinct from the statistical observations in `src/analytics`. We never
 * derive, infer or adjust an alert; we relay it.
 *
 * The wire format is OASIS CAP 1.2 (Common Alerting Protocol), which IMO
 * publishes through its CAP broker.
 */

/** CAP `severity`, ordered from least to most severe. */
export type AlertSeverity = "Unknown" | "Minor" | "Moderate" | "Severe" | "Extreme";

/** CAP `urgency`. */
export type AlertUrgency = "Unknown" | "Past" | "Future" | "Expected" | "Immediate";

/** CAP `certainty`. */
export type AlertCertainty = "Unknown" | "Unlikely" | "Possible" | "Likely" | "Observed";

/**
 * The colour IMO assigns the warning, carried in a CAP `parameter` named
 * "Color". This is IMO's own public-facing scale, not a CAP field.
 */
export type AlertColour = "Yellow" | "Orange" | "Red";

/**
 * CAP `category`. `Met` is weather, `Geo` covers landslide, earthquake and
 * volcanic hazards — the distinction is what lets the interface tell a wind
 * warning apart from a geological one.
 */
export type AlertCategory =
  | "Met"
  | "Geo"
  | "Safety"
  | "Security"
  | "Rescue"
  | "Fire"
  | "Health"
  | "Env"
  | "Transport"
  | "Infra"
  | "CBRNE"
  | "Other"
  | (string & {});

/** Text that IMO publishes in both languages. */
export type LocalizedText = {
  en: string | null;
  is: string | null;
};

export type AlertArea = {
  /** Area name as IMO writes it, e.g. "Southeast Iceland". */
  description: LocalizedText;
  /** Warning extent, already converted to GeoJSON winding and axis order. */
  geometry: GeoJSON.Polygon | null;
};

export type OfficialAlert = {
  /** CAP `identifier`; unique per message. */
  id: string;
  /** CAP `sender`, e.g. "IMO-Icelandic_Met_Office". */
  sender: string;
  /** Human-readable issuing desk, e.g. "IMO - Meteorologist on duty". */
  senderName: string | null;
  /** When the message was issued. */
  sentAt: string;
  /** When the warned-of conditions begin, if stated. */
  onsetAt: string | null;
  /** When the warning lapses, if stated. */
  expiresAt: string | null;
  /** CAP `msgType`: Alert, Update, Cancel… */
  messageType: string;
  category: AlertCategory;
  /** IMO's alert type from `eventCode`, e.g. "Wind", "Snow", "Landslide". */
  alertType: string | null;
  event: LocalizedText;
  headline: LocalizedText;
  description: LocalizedText;
  severity: AlertSeverity;
  urgency: AlertUrgency;
  certainty: AlertCertainty;
  colour: AlertColour | null;
  areas: AlertArea[];
  /** IMO's page for this warning. */
  url: string | null;
};

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  Unknown: 0,
  Minor: 1,
  Moderate: 2,
  Severe: 3,
  Extreme: 4,
};

const COLOUR_RANK: Record<AlertColour, number> = { Yellow: 1, Orange: 2, Red: 3 };

/** Higher is more serious. Used only for ordering, never to invent a level. */
export function alertRank(alert: OfficialAlert): number {
  const colour = alert.colour ? COLOUR_RANK[alert.colour] : 0;
  return colour * 10 + SEVERITY_RANK[alert.severity];
}

/** Most serious first, then soonest to take effect. */
export function sortAlerts(alerts: readonly OfficialAlert[]): OfficialAlert[] {
  return [...alerts].sort(
    (a, b) => alertRank(b) - alertRank(a) || a.sentAt.localeCompare(b.sentAt),
  );
}

/**
 * True when an alert concerns a geological hazard rather than the weather.
 *
 * Iceland Live is a geological product, so these are surfaced first — but
 * weather warnings are still shown, because "is it safe to drive to Grindavík"
 * is a wind question as often as a lava one.
 */
export function isGeological(alert: OfficialAlert): boolean {
  return alert.category === "Geo";
}

/** Best available text for a field, preferring English. */
export function preferEnglish(text: LocalizedText): string | null {
  return text.en ?? text.is;
}
