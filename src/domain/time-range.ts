/** Selectable observation windows. These drive the map, stats, chart and feed. */
export const TIME_RANGE_IDS = ["1h", "6h", "24h", "7d", "30d"] as const;

export type TimeRangeId = (typeof TIME_RANGE_IDS)[number];

export const DEFAULT_TIME_RANGE: TimeRangeId = "24h";

export type TimeRange = {
  id: TimeRangeId;
  /** Window length in milliseconds. */
  durationMs: number;
  /** Compact control label, e.g. "24H". */
  label: string;
  /** Prose form used in sentences, e.g. "the last 24 hours". */
  phrase: string;
  /** Short suffix for stat tiles, e.g. "last 24h". */
  statSuffix: string;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const TIME_RANGES: Record<TimeRangeId, TimeRange> = {
  "1h": { id: "1h", durationMs: HOUR, label: "1H", phrase: "the last hour", statSuffix: "last 1h" },
  "6h": { id: "6h", durationMs: 6 * HOUR, label: "6H", phrase: "the last 6 hours", statSuffix: "last 6h" },
  "24h": { id: "24h", durationMs: DAY, label: "24H", phrase: "the last 24 hours", statSuffix: "last 24h" },
  "7d": { id: "7d", durationMs: 7 * DAY, label: "7D", phrase: "the last 7 days", statSuffix: "last 7d" },
  "30d": { id: "30d", durationMs: 30 * DAY, label: "30D", phrase: "the last 30 days", statSuffix: "last 30d" },
};

/** The widest window we ever request upstream. One fetch serves every range. */
export const MAX_RANGE: TimeRangeId = "30d";

export function isTimeRangeId(value: unknown): value is TimeRangeId {
  return typeof value === "string" && (TIME_RANGE_IDS as readonly string[]).includes(value);
}

/** Parses a URL/query value into a range, falling back to the default. */
export function parseTimeRange(value: unknown): TimeRangeId {
  return isTimeRangeId(value) ? value : DEFAULT_TIME_RANGE;
}

/** Resolves a range to absolute [from, to) instants. */
export function resolveWindow(range: TimeRangeId, now: Date = new Date()): { from: Date; to: Date } {
  const to = now;
  const from = new Date(now.getTime() - TIME_RANGES[range].durationMs);
  return { from, to };
}
