import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatDay,
  formatDayClock,
  formatExact,
  formatIcelandTime,
  formatRelative,
  formatRelativeLong,
} from "./time";

const NOON = "2026-09-19T12:00:00.000Z";

describe("Iceland time formatting", () => {
  it("renders UTC as-is, because Iceland does not shift", () => {
    // Iceland is UTC+00:00 year-round with no daylight saving.
    expect(formatClock("2026-09-19T14:32:00Z")).toBe("14:32");
    // Same in midwinter — a zone that observed DST would differ here.
    expect(formatClock("2026-01-19T14:32:00Z")).toBe("14:32");
  });

  it("converts an offset timestamp to Icelandic local time", () => {
    expect(formatClock("2026-09-19T16:32:00+02:00")).toBe("14:32");
  });

  it("uses a three-letter month so date columns keep their width", () => {
    // en-GB renders September as "Sept"; every other month is three letters.
    expect(formatDay("2026-09-19T12:00:00Z")).toBe("19 Sep");
    expect(formatDay("2026-08-19T12:00:00Z")).toBe("19 Aug");
    expect(formatDayClock("2026-09-19T14:32:00Z")).toBe("19 Sep, 14:32");
  });

  it("spells the exact form out unambiguously", () => {
    expect(formatExact("2026-09-19T14:32:11Z")).toContain("2026");
    expect(formatExact("2026-09-19T14:32:11Z")).toContain("14:32:11");
    expect(formatExact("2026-09-19T14:32:11Z")).toContain("(UTC)");
  });

  it("adds the date only for ranges that span more than a day", () => {
    expect(formatIcelandTime(NOON, "24h")).toBe("12:00");
    expect(formatIcelandTime(NOON, "6h")).toBe("12:00");
    expect(formatIcelandTime(NOON, "7d")).toBe("19 Sep, 12:00");
    expect(formatIcelandTime(NOON, "30d")).toBe("19 Sep, 12:00");
  });
});

describe("formatRelative", () => {
  const now = Date.parse(NOON);
  const ago = (ms: number) => formatRelative(new Date(now - ms).toISOString(), now);

  it("collapses the last minute to 'just now'", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(30_000)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(ago(4 * 60_000)).toBe("4 min ago");
    expect(ago(59 * 60_000)).toBe("59 min ago");
    expect(ago(3 * 3_600_000)).toBe("3 h ago");
    expect(ago(6 * 86_400_000)).toBe("6 d ago");
  });

  it("does not report a future timestamp as negative", () => {
    // Clock skew between the browser and IMO should not print "-1 min ago".
    expect(formatRelative(new Date(now + 5000).toISOString(), now)).toBe("just now");
  });

  it("returns a dash for an unparseable value rather than 'NaN min ago'", () => {
    expect(formatRelative("not a date", now)).toBe("—");
  });
});

describe("formatRelativeLong", () => {
  const now = Date.parse(NOON);
  const ago = (ms: number) => formatRelativeLong(new Date(now - ms).toISOString(), now);

  it("uses full words and singular/plural correctly", () => {
    expect(ago(1000)).toBe("1 second ago");
    expect(ago(5000)).toBe("5 seconds ago");
    expect(ago(60_000)).toBe("1 minute ago");
    expect(ago(120_000)).toBe("2 minutes ago");
    expect(ago(3_600_000)).toBe("1 hour ago");
    expect(ago(86_400_000)).toBe("1 day ago");
  });

  it("adds the smaller unit when it is not zero", () => {
    expect(ago(3_600_000 + 25 * 60_000)).toBe("1 h 25 min ago");
    expect(ago(86_400_000 + 3 * 3_600_000)).toBe("1 d 3 h ago");
  });
});
