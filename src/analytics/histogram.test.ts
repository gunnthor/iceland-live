import { describe, expect, it } from "vitest";
import type { Earthquake } from "@/domain/earthquake";
import { TIME_RANGES, TIME_RANGE_IDS } from "@/domain/time-range";
import { buildHistogram, binWidthMs } from "./histogram";

function quake(occurredAt: string, magnitude: number | null = 1): Earthquake {
  return {
    id: `IMO-${occurredAt}-${magnitude}`,
    occurredAt,
    updatedAt: null,
    latitude: 63.9,
    longitude: -22.1,
    depthKm: 5,
    magnitude,
    magnitudeType: "ML_SIL",
    region: "Reykjanes",
    eventType: "earthquake",
    reviewStatus: "reviewed",
    evaluationMode: "manual",
    source: "IMO",
  };
}

const TO = new Date("2026-09-19T12:00:00.000Z");

describe("buildHistogram", () => {
  it("keeps every range within a readable number of bars", () => {
    for (const range of TIME_RANGE_IDS) {
      const { bins } = buildHistogram([], range, TO);
      expect(bins.length).toBeGreaterThanOrEqual(30);
      expect(bins.length).toBeLessThanOrEqual(60);
    }
  });

  it("covers exactly the requested window with contiguous bins", () => {
    for (const range of TIME_RANGE_IDS) {
      const histogram = buildHistogram([], range, TO);
      expect(histogram.toMs - histogram.fromMs).toBe(TIME_RANGES[range].durationMs);
      expect(histogram.bins[0]?.startMs).toBe(histogram.fromMs);
      expect(histogram.bins[histogram.bins.length - 1]?.endMs).toBe(histogram.toMs);

      for (let i = 1; i < histogram.bins.length; i += 1) {
        expect(histogram.bins[i]?.startMs).toBe(histogram.bins[i - 1]?.endMs);
      }
    }
  });

  it("widens bins as the range grows", () => {
    expect(binWidthMs("1h")).toBeLessThan(binWidthMs("6h"));
    expect(binWidthMs("6h")).toBeLessThan(binWidthMs("24h"));
    expect(binWidthMs("24h")).toBeLessThan(binWidthMs("7d"));
    expect(binWidthMs("7d")).toBeLessThan(binWidthMs("30d"));
  });

  it("counts an event into exactly one bin", () => {
    const histogram = buildHistogram([quake("2026-09-19T11:45:00.000Z")], "24h", TO);
    expect(histogram.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(1);
  });

  it("places an event at a bin boundary in the later bin", () => {
    // 24h bins are 30 minutes wide and aligned to the window start (12:00Z - 24h).
    const histogram = buildHistogram([quake("2026-09-19T11:30:00.000Z")], "24h", TO);
    const filled = histogram.bins.findIndex((bin) => bin.count > 0);
    expect(histogram.bins[filled]?.startMs).toBe(Date.parse("2026-09-19T11:30:00.000Z"));
  });

  it("tracks the largest magnitude per bin", () => {
    const histogram = buildHistogram(
      [
        quake("2026-09-19T11:45:00.000Z", 0.4),
        quake("2026-09-19T11:50:00.000Z", 3.1),
        quake("2026-09-19T11:55:00.000Z", 1.2),
      ],
      "24h",
      TO,
    );
    const bin = histogram.bins.find((b) => b.count > 0);
    expect(bin?.count).toBe(3);
    expect(bin?.maxMagnitude).toBe(3.1);
  });

  it("leaves maxMagnitude null when no event in the bin reports one", () => {
    const histogram = buildHistogram([quake("2026-09-19T11:45:00.000Z", null)], "24h", TO);
    const bin = histogram.bins.find((b) => b.count > 0);
    expect(bin?.count).toBe(1);
    expect(bin?.maxMagnitude).toBeNull();
  });

  it("excludes events outside the window", () => {
    const histogram = buildHistogram(
      [quake("2026-09-17T12:00:00.000Z"), quake("2026-09-19T13:00:00.000Z")],
      "24h",
      TO,
    );
    expect(histogram.peakCount).toBe(0);
  });

  it("reports the peak count for the chart axis", () => {
    const histogram = buildHistogram(
      [
        quake("2026-09-19T11:45:00.000Z", 1),
        quake("2026-09-19T11:46:00.000Z", 1.1),
        quake("2026-09-19T05:00:00.000Z", 1.2),
      ],
      "24h",
      TO,
    );
    expect(histogram.peakCount).toBe(2);
  });

  it("returns zeroed bins rather than an empty chart when there is no data", () => {
    const histogram = buildHistogram([], "6h", TO);
    expect(histogram.peakCount).toBe(0);
    expect(histogram.bins.every((bin) => bin.count === 0)).toBe(true);
  });
});
