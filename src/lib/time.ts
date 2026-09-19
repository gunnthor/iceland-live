/**
 * Time handling.
 *
 * All instants move through the app as ISO 8601 UTC strings and are only
 * converted for display. Iceland observes UTC+00:00 all year and does not use
 * daylight saving, but we still format through the IANA zone
 * `Atlantic/Reykjavik` rather than hard-coding that assumption.
 */

import type { TimeRangeId } from "@/domain/time-range";

export const ICELAND_TIME_ZONE = "Atlantic/Reykjavik";

const clockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ICELAND_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dayClockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ICELAND_TIME_ZONE,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const exactFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ICELAND_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ICELAND_TIME_ZONE,
  day: "numeric",
  month: "short",
});

/**
 * Trims a four-letter month abbreviation to three.
 *
 * `en-GB` renders September as "Sept" while every other month is three letters.
 * In prose that is fine, but the timeline axis and the activity feed put dates
 * in narrow columns where the extra character shifts the layout, so the compact
 * formatters normalise it.
 */
function shortenMonth(value: string): string {
  return value.replace(/\bSept\b/, "Sep");
}

/** `14:32` — Icelandic local time. */
export function formatClock(iso: string | number | Date): string {
  return clockFormatter.format(toDate(iso));
}

/** `19 Sep, 14:32` — Icelandic local time. */
export function formatDayClock(iso: string | number | Date): string {
  return shortenMonth(dayClockFormatter.format(toDate(iso)));
}

/** `19 Sep` — Icelandic local date. */
export function formatDay(iso: string | number | Date): string {
  return shortenMonth(dayFormatter.format(toDate(iso)));
}

/** `Fri, 19 Sep 2026, 14:32:11 (UTC)` — the full, unambiguous form. */
export function formatExact(iso: string | number | Date): string {
  return `${exactFormatter.format(toDate(iso))} (UTC)`;
}

/**
 * Picks the shortest unambiguous form for the selected range: within a day the
 * clock alone is enough, longer windows need the date too.
 */
export function formatIcelandTime(iso: string | number | Date, range: TimeRangeId): string {
  return range === "7d" || range === "30d" ? formatDayClock(iso) : formatClock(iso);
}

/**
 * Compact elapsed time: `just now`, `4 min ago`, `3 h ago`, `6 d ago`.
 *
 * Deliberately terse — these appear in dense lists where a full phrase would
 * crowd out the data.
 */
export function formatRelative(iso: string | number | Date, now: number = Date.now()): string {
  const then = toDate(iso).getTime();
  if (!Number.isFinite(then)) return "—";

  const seconds = Math.round((now - then) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 45) return "just now";

  /*
   * Each unit is derived from the one above it, not independently from
   * `seconds`. Mixing a rounded minute count with a floored hour count leaves a
   * gap: at 59.5 minutes the minutes round to 60, so the minutes branch is
   * skipped, while `floor(seconds / 3600)` is still 0 — and the label reads
   * "0 h ago".
   */
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

/** Longer elapsed form used in the detail panel. */
export function formatRelativeLong(iso: string | number | Date, now: number = Date.now()): string {
  const then = toDate(iso).getTime();
  if (!Number.isFinite(then)) return "—";

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"} ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes === 0
      ? `${hours} hour${hours === 1 ? "" : "s"} ago`
      : `${hours} h ${restMinutes} min ago`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0
    ? `${days} day${days === 1 ? "" : "s"} ago`
    : `${days} d ${restHours} h ago`;
}

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
