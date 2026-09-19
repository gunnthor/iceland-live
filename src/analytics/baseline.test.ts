import { describe, expect, it } from "vitest";
import type { Earthquake } from "@/domain/earthquake";
import {
  baselineMethod,
  computeRegionBaseline,
  describeBaseline,
  MIN_BASELINE_EVENTS,
  MIN_RECENT_EVENTS,
} from "./baseline";

let counter = 0;
function quake(region: string, occurredAt: string): Earthquake {
  counter += 1;
  return {
    id: `IMO-${counter}`,
    occurredAt,
    updatedAt: null,
    latitude: 63.9,
    longitude: -22.1,
    depthKm: 5,
    magnitude: 1,
    magnitudeType: "ML_SIL",
    region,
    eventType: "earthquake",
    reviewStatus: "reviewed",
    evaluationMode: "manual",
    source: "IMO",
  };
}

const TO = new Date("2026-09-19T12:00:00Z");
const FROM = new Date("2026-09-18T12:00:00Z"); // 1-day observation window

/** `count` events spread evenly across [startDaysAgo, endDaysAgo) before TO. */
function spread(region: string, count: number, startDaysAgo: number, endDaysAgo: number): Earthquake[] {
  const startMs = TO.getTime() - startDaysAgo * 86_400_000;
  const endMs = TO.getTime() - endDaysAgo * 86_400_000;
  return Array.from({ length: count }, (_, i) =>
    quake(region, new Date(startMs + ((endMs - startMs) * i) / count).toISOString()),
  );
}

describe("computeRegionBaseline", () => {
  it("reports a rate increase against the region's own history", () => {
    // 29 baseline days at ~2/day, then 20 events in the final day.
    const catalogue = [
      ...spread("Reykjanes", 58, 30, 1),
      ...spread("Reykjanes", 20, 1, 0),
    ];

    const baseline = computeRegionBaseline("Reykjanes", { catalogue, from: FROM, to: TO });

    expect(baseline).not.toBeNull();
    expect(baseline?.recentCount).toBe(20);
    expect(baseline?.baselineCount).toBe(58);
    expect(baseline?.recentPerDay).toBeCloseTo(20, 0);
    expect(baseline?.baselinePerDay).toBeCloseTo(2, 0);
    expect(baseline?.ratio).toBeGreaterThan(8);
  });

  it("excludes the observation window from its own baseline", () => {
    // If the burst were counted in the baseline the ratio would be dragged
    // toward 1 and the increase would disappear.
    const catalogue = [...spread("Reykjanes", 30, 30, 1), ...spread("Reykjanes", 100, 1, 0)];
    const baseline = computeRegionBaseline("Reykjanes", { catalogue, from: FROM, to: TO });

    expect(baseline?.baselineCount).toBe(30);
    expect(baseline?.recentCount).toBe(100);
    expect(baseline?.ratio).toBeGreaterThan(50);
  });

  it("counts only the named region", () => {
    const catalogue = [
      ...spread("Reykjanes", 40, 30, 1),
      ...spread("Katla", 400, 30, 1),
      ...spread("Reykjanes", 10, 1, 0),
      ...spread("Katla", 900, 1, 0),
    ];
    const baseline = computeRegionBaseline("Reykjanes", { catalogue, from: FROM, to: TO });

    expect(baseline?.recentCount).toBe(10);
    expect(baseline?.baselineCount).toBe(40);
  });

  it("reports a quiet period as a ratio below one", () => {
    // Baseline ~10/day (290 over 29 days) against 5 in the final day.
    const catalogue = [...spread("Reykjanes", 290, 30, 1), ...spread("Reykjanes", 5, 1, 0)];
    const baseline = computeRegionBaseline("Reykjanes", { catalogue, from: FROM, to: TO });

    expect(baseline?.baselinePerDay).toBeCloseTo(10, 0);
    expect(baseline?.recentPerDay).toBeCloseTo(5, 0);
    expect(baseline?.ratio).toBeCloseTo(0.5, 1);
  });

  it("stays silent rather than over-claiming in a genuinely quiet region", () => {
    // A region averaging ~2/day cannot produce a reportable "quiet" day: five
    // events is the floor for saying anything, and five in a day is already
    // above that baseline. Silence is the right answer, not a made-up ratio.
    const catalogue = [...spread("Katla", 58, 30, 1), ...spread("Katla", 1, 1, 0)];
    expect(computeRegionBaseline("Katla", { catalogue, from: FROM, to: TO })).toBeNull();
  });

  // --- Refusals: cases where a ratio would be noise dressed as insight ---

  it("declines when the region has too little history to compare against", () => {
    const catalogue = [
      ...spread("Reykjanes", MIN_BASELINE_EVENTS - 1, 30, 1),
      ...spread("Reykjanes", 20, 1, 0),
    ];
    expect(computeRegionBaseline("Reykjanes", { catalogue, from: FROM, to: TO })).toBeNull();
  });

  it("declines when too few events fall in the window", () => {
    const catalogue = [
      ...spread("Reykjanes", 60, 30, 1),
      ...spread("Reykjanes", MIN_RECENT_EVENTS - 1, 1, 0),
    ];
    expect(computeRegionBaseline("Reykjanes", { catalogue, from: FROM, to: TO })).toBeNull();
  });

  it("declines when the catalogue is too short to establish a baseline", () => {
    // Only two days of history before the window.
    const catalogue = [...spread("Reykjanes", 40, 2, 1), ...spread("Reykjanes", 20, 1, 0)];
    expect(computeRegionBaseline("Reykjanes", { catalogue, from: FROM, to: TO })).toBeNull();
  });

  it("declines for an unknown region and an empty catalogue", () => {
    const catalogue = spread("Reykjanes", 60, 30, 0);
    expect(computeRegionBaseline("Nowhere", { catalogue, from: FROM, to: TO })).toBeNull();
    expect(computeRegionBaseline("Reykjanes", { catalogue: [], from: FROM, to: TO })).toBeNull();
  });

  it("declines for a zero-length window", () => {
    const catalogue = spread("Reykjanes", 60, 30, 0);
    expect(computeRegionBaseline("Reykjanes", { catalogue, from: TO, to: TO })).toBeNull();
  });
});

describe("describeBaseline", () => {
  const make = (ratio: number, baselineDays = 29) => ({
    region: "Reykjanes",
    recentPerDay: 2 * ratio,
    baselinePerDay: 2,
    ratio,
    baselineDays,
    recentCount: 20,
    baselineCount: 58,
  });

  it("states an increase as a plain multiple", () => {
    expect(describeBaseline(make(3))).toBe(
      "That is about 3× the usual rate for Reykjanes over the preceding 29 days.",
    );
  });

  it("calls a ratio near one typical rather than quoting a number", () => {
    expect(describeBaseline(make(1.1))).toContain("close to the usual rate");
    expect(describeBaseline(make(0.9))).toContain("close to the usual rate");
  });

  it("states a decrease as a multiple lower", () => {
    expect(describeBaseline(make(0.25))).toContain("about 4× lower than the usual rate");
  });

  it("stops quoting precision where it stops being meaningful", () => {
    expect(describeBaseline(make(45))).toContain("over 20×");
  });

  it("always names the period it compared against", () => {
    for (const ratio of [0.2, 1, 3, 50]) {
      expect(describeBaseline(make(ratio, 12))).toContain("preceding 12 days");
    }
  });

  it("never claims more than a rate comparison", () => {
    const forbidden = /unusual|abnormal|alarming|dangerous|precursor|imminent|expect|predict|warn/i;
    for (const ratio of [0.1, 0.5, 1, 2, 10, 100]) {
      expect(describeBaseline(make(ratio))).not.toMatch(forbidden);
    }
  });
});

describe("baselineMethod", () => {
  it("shows both counts, both rates, and the exclusion", () => {
    const method = baselineMethod({
      region: "Reykjanes",
      recentPerDay: 20,
      baselinePerDay: 2,
      ratio: 10,
      baselineDays: 29,
      recentCount: 20,
      baselineCount: 58,
    });

    expect(method).toContain("whole of Reykjanes, not just the cluster");
    expect(method).toContain("20 events during this window");
    expect(method).toContain("58 over the preceding");
    expect(method).toContain("preceding 29 days");
    expect(method).toContain("excluded from the baseline");
    expect(method).toContain("not a probability or a forecast");
  });
});
