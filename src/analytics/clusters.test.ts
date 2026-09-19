import { describe, expect, it } from "vitest";
import type { Earthquake } from "@/domain/earthquake";
import { LAT_DEGREES_PER_KM } from "@/lib/geo";
import {
  clusterQuakes,
  detectObservations as rawDetectObservations,
  CLUSTER_MAX_RADIUS_KM,
  OBSERVATION_MAX_WINDOW_HOURS,
  DENSE_CLUSTER_MIN_EVENTS,
  MODERATE_MIN_EVENTS,
  RATE_MIN_BASELINE_EVENTS,
} from "./clusters";

let counter = 0;

function quake(overrides: Partial<Earthquake> = {}): Earthquake {
  counter += 1;
  return {
    id: `IMO-${counter}`,
    occurredAt: "2026-09-19T12:00:00.000Z",
    updatedAt: null,
    latitude: 63.9,
    longitude: -22.1,
    depthKm: 5,
    magnitude: 1,
    magnitudeType: "ML_SIL",
    region: "Reykjanes",
    eventType: "earthquake",
    reviewStatus: "reviewed",
    evaluationMode: "manual",
    source: "IMO",
    ...overrides,
  };
}

/** `count` events jittered within roughly 1 km of a centre. */
function blob(
  count: number,
  centre: { latitude: number; longitude: number },
  overrides: Partial<Earthquake> = {},
): Earthquake[] {
  return Array.from({ length: count }, (_, i) =>
    quake({
      // Deterministic offsets under 1 km so the blob is well inside eps.
      latitude: centre.latitude + ((i % 5) - 2) * 0.002,
      longitude: centre.longitude + ((i % 3) - 1) * 0.004,
      ...overrides,
    }),
  );
}

/** Most assertions care only about the observations, not the window envelope. */
function detectObservations(input: Parameters<typeof rawDetectObservations>[0]) {
  return rawDetectObservations(input).observations;
}

const REYKJANES = { latitude: 63.9, longitude: -22.1 };
const MYVATN = { latitude: 65.6, longitude: -16.9 };

describe("clusterQuakes", () => {
  it("returns nothing for an empty catalogue", () => {
    expect(clusterQuakes([])).toEqual([]);
  });

  it("finds a single dense group", () => {
    const clusters = clusterQuakes(blob(20, REYKJANES));
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.events).toHaveLength(20);
    expect(clusters[0]?.radiusKm).toBeLessThan(2);
  });

  it("separates groups that are far apart", () => {
    const clusters = clusterQuakes([...blob(15, REYKJANES), ...blob(12, MYVATN)]);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.events.length).sort((a, b) => b - a)).toEqual([15, 12]);
  });

  it("treats isolated events as noise rather than a cluster", () => {
    const scattered = Array.from({ length: 6 }, (_, i) =>
      quake({ latitude: 63.9 + i * 0.5, longitude: -22.1 + i * 0.5 }),
    );
    expect(clusterQuakes(scattered)).toEqual([]);
  });

  it("does not merge groups separated by more than eps", () => {
    // 12 km apart, comfortably beyond the 5 km eps.
    const north = { latitude: REYKJANES.latitude + 12 * LAT_DEGREES_PER_KM, longitude: REYKJANES.longitude };
    const clusters = clusterQuakes([...blob(10, REYKJANES), ...blob(10, north)]);
    expect(clusters).toHaveLength(2);
  });

  it("names a cluster after the region most of its events report", () => {
    const clusters = clusterQuakes([
      ...blob(10, REYKJANES, { region: "Kleifarvatn" }),
      ...blob(3, REYKJANES, { region: "Reykjanes" }),
    ]);
    expect(clusters[0]?.region).toBe("Kleifarvatn");
  });

  it("reports the time span and largest magnitude of its members", () => {
    const clusters = clusterQuakes([
      ...blob(8, REYKJANES, { occurredAt: "2026-09-19T08:00:00.000Z", magnitude: 0.5 }),
      ...blob(8, REYKJANES, { occurredAt: "2026-09-19T14:00:00.000Z", magnitude: 2.7 }),
    ]);
    expect(clusters[0]?.earliestAt).toBe("2026-09-19T08:00:00.000Z");
    expect(clusters[0]?.latestAt).toBe("2026-09-19T14:00:00.000Z");
    expect(clusters[0]?.largestMagnitude).toBe(2.7);
  });

  it("counts M2+ members", () => {
    const clusters = clusterQuakes([
      ...blob(10, REYKJANES, { magnitude: 0.4 }),
      ...blob(3, REYKJANES, { magnitude: 2.2 }),
    ]);
    expect(clusters[0]?.countM2Plus).toBe(3);
  });
});

describe("detectObservations", () => {
  const from = new Date("2026-09-19T00:00:00.000Z");
  const to = new Date("2026-09-19T12:00:00.000Z");

  it("reports nothing for an empty catalogue", () => {
    expect(detectObservations({ quakes: [], from, to })).toEqual([]);
  });

  it("stays quiet during ordinary low activity", () => {
    const quiet = Array.from({ length: 5 }, (_, i) =>
      quake({ latitude: 63.9 + i * 0.4, occurredAt: "2026-09-19T06:00:00.000Z" }),
    );
    expect(detectObservations({ quakes: quiet, from, to })).toEqual([]);
  });

  it("does not report a cluster below the minimum event count", () => {
    const justUnder = blob(DENSE_CLUSTER_MIN_EVENTS - 1, REYKJANES, {
      occurredAt: "2026-09-19T06:00:00.000Z",
    });
    const observations = detectObservations({ quakes: justUnder, from, to });
    expect(observations.filter((o) => o.kind === "dense-cluster")).toEqual([]);
  });

  it("reports a dense cluster with neutral wording and the underlying numbers", () => {
    const quakes = blob(20, REYKJANES, {
      region: "Kleifarvatn",
      occurredAt: "2026-09-19T06:00:00.000Z",
      magnitude: 0.4,
    });
    const dense = detectObservations({ quakes, from, to }).find((o) => o.kind === "dense-cluster");

    expect(dense).toBeDefined();
    expect(dense?.headline).toBe("Elevated earthquake activity");
    expect(dense?.detail).toContain("20 earthquakes");
    expect(dense?.detail).toContain("Kleifarvatn");
    expect(dense?.eventIds).toHaveLength(20);
    expect(dense?.focus?.centre.latitude).toBeCloseTo(REYKJANES.latitude, 1);
  });

  it("never uses predictive or hazard language", () => {
    const quakes = [
      ...blob(25, REYKJANES, { occurredAt: "2026-09-19T11:00:00.000Z", magnitude: 2.5 }),
      ...blob(8, REYKJANES, { occurredAt: "2026-09-19T02:00:00.000Z", magnitude: 0.3 }),
    ];
    const observations = detectObservations({ quakes, from, to });
    expect(observations.length).toBeGreaterThan(0);

    const forbidden = /precursor|erupt|imminent|warning|evacuat|danger|risk|predict|expect/i;
    for (const observation of observations) {
      expect(observation.headline).not.toMatch(forbidden);
      expect(observation.detail).not.toMatch(forbidden);
    }
  });

  it("reports repeated M2+ events inside a cluster", () => {
    const quakes = [
      ...blob(15, REYKJANES, { occurredAt: "2026-09-19T06:00:00.000Z", magnitude: 0.5 }),
      ...blob(MODERATE_MIN_EVENTS, REYKJANES, { occurredAt: "2026-09-19T07:00:00.000Z", magnitude: 2.3 }),
    ];
    const moderate = detectObservations({ quakes, from, to }).find(
      (o) => o.kind === "repeated-moderate",
    );

    expect(moderate?.detail).toContain(`${MODERATE_MIN_EVENTS} earthquakes`);
    expect(moderate?.eventIds).toHaveLength(MODERATE_MIN_EVENTS);
  });

  it("reports a rate increase when recent activity outpaces the baseline", () => {
    const quakes = [
      // Baseline: 6 events across the first 8 hours.
      ...Array.from({ length: 6 }, (_, i) =>
        quake({ latitude: 63.9 + i * 0.3, occurredAt: `2026-09-19T0${i}:00:00.000Z` }),
      ),
      // Recent: 20 events in the final 4 hours.
      ...Array.from({ length: 20 }, (_, i) =>
        quake({ latitude: 65 + i * 0.05, occurredAt: "2026-09-19T10:00:00.000Z" }),
      ),
    ];

    const rate = detectObservations({ quakes, from, to }).find((o) => o.kind === "rate-increase");
    expect(rate?.headline).toBe("Increased earthquake frequency");
    expect(rate?.detail).toContain("20 earthquakes");
  });

  it("does not report a rate increase when the baseline is too small to compare against", () => {
    const quakes = [
      ...Array.from({ length: RATE_MIN_BASELINE_EVENTS - 1 }, (_, i) =>
        quake({ latitude: 63.9 + i * 0.3, occurredAt: "2026-09-19T02:00:00.000Z" }),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        quake({ latitude: 65 + i * 0.05, occurredAt: "2026-09-19T10:00:00.000Z" }),
      ),
    ];

    const rate = detectObservations({ quakes, from, to }).find((o) => o.kind === "rate-increase");
    expect(rate).toBeUndefined();
  });

  it("does not report a rate increase for steady activity", () => {
    const quakes = Array.from({ length: 36 }, (_, i) =>
      quake({
        latitude: 63.5 + (i % 12) * 0.25,
        occurredAt: new Date(from.getTime() + (i / 36) * 12 * 3_600_000).toISOString(),
      }),
    );
    const rate = detectObservations({ quakes, from, to }).find((o) => o.kind === "rate-increase");
    expect(rate).toBeUndefined();
  });

  it("documents the calculation behind every observation it emits", () => {
    const quakes = blob(20, REYKJANES, { occurredAt: "2026-09-19T06:00:00.000Z", magnitude: 2.4 });
    const observations = detectObservations({ quakes, from, to });

    expect(observations.length).toBeGreaterThan(0);
    for (const observation of observations) {
      expect(observation.method.length).toBeGreaterThan(20);
    }
  });
});

describe("observation guards", () => {
  const from = new Date("2026-09-19T00:00:00.000Z");
  const to = new Date("2026-09-19T12:00:00.000Z");

  it("declines to call a wide spread of events a cluster", () => {
    // A chain of dense blobs stepping north, each within eps of the next, so
    // DBSCAN links them into one group tens of kilometres across.
    const chain: Earthquake[] = [];
    for (let step = 0; step < 12; step += 1) {
      chain.push(
        ...blob(6, {
          latitude: REYKJANES.latitude + step * 4 * LAT_DEGREES_PER_KM,
          longitude: REYKJANES.longitude,
        }),
      );
    }

    const linked = clusterQuakes(chain);
    expect(linked).toHaveLength(1);
    expect(linked[0]?.radiusKm).toBeGreaterThan(CLUSTER_MAX_RADIUS_KM);

    // It is a valid DBSCAN cluster, but not something we will describe as one.
    const observations = detectObservations({ quakes: chain, from, to });
    expect(observations.filter((o) => o.kind === "dense-cluster")).toEqual([]);
  });

  it("still reports a genuinely compact cluster", () => {
    const observations = detectObservations({
      quakes: blob(20, REYKJANES, { occurredAt: "2026-09-19T06:00:00.000Z" }),
      from,
      to,
    });
    expect(observations.some((o) => o.kind === "dense-cluster")).toBe(true);
  });

  it("caps the observation window for long ranges", () => {
    const thirtyDaysAgo = new Date(to.getTime() - 30 * 24 * 3_600_000);
    const result = rawDetectObservations({ quakes: [], from: thirtyDaysAgo, to });

    expect(result.windowCapped).toBe(true);
    expect(Date.parse(result.window.to) - Date.parse(result.window.from)).toBe(
      OBSERVATION_MAX_WINDOW_HOURS * 3_600_000,
    );
  });

  it("leaves short ranges uncapped", () => {
    const result = rawDetectObservations({ quakes: [], from, to });
    expect(result.windowCapped).toBe(false);
    expect(result.window.from).toBe(from.toISOString());
  });

  it("ignores events older than the capped window", () => {
    const to30 = new Date("2026-09-19T12:00:00.000Z");
    const from30 = new Date(to30.getTime() - 30 * 24 * 3_600_000);

    // A dense burst 10 days ago must not surface as current activity.
    const old = blob(40, REYKJANES, { occurredAt: "2026-09-09T12:00:00.000Z" });
    const result = rawDetectObservations({ quakes: old, from: from30, to: to30 });

    expect(result.observations).toEqual([]);
  });
});

describe("observation spans", () => {
  /** A tight cluster, so the dense-cluster observation always fires. */
  function burst(count: number, startMs: number, stepMs: number): Earthquake[] {
    return Array.from({ length: count }, (_, index) =>
      quake({
        id: `b${index}`,
        latitude: 63.9 + index * 0.0005,
        longitude: -22.4 + index * 0.0005,
        occurredAt: new Date(startMs + index * stepMs).toISOString(),
        region: "Reykjanes",
      }),
    );
  }

  const to = new Date("2026-09-19T22:00:00.000Z");
  const from = new Date("2026-09-18T22:00:00.000Z");

  it("gives a dense cluster the extent of its own events", () => {
    // The sentence says "over N hours"; the band has to be those hours.
    const start = Date.parse("2026-09-19T14:00:00.000Z");
    const quakes = burst(14, start, 30 * 60_000);
    const { observations } = rawDetectObservations({ quakes, from, to });

    const dense = observations.find((item) => item.kind === "dense-cluster");
    expect(dense?.span.from).toBe("2026-09-19T14:00:00.000Z");
    expect(dense?.span.to).toBe(quakes[quakes.length - 1]?.occurredAt);
  });

  it("gives repeated moderate events the window its sentence counts over", () => {
    const start = Date.parse("2026-09-19T14:00:00.000Z");
    const quakes = burst(14, start, 30 * 60_000).map((event, index) =>
      index < 4 ? { ...event, magnitude: 2.4 } : event,
    );
    const { observations, window } = rawDetectObservations({ quakes, from, to });

    const moderate = observations.find((item) => item.kind === "repeated-moderate");
    expect(moderate).toBeDefined();
    expect(moderate?.span).toEqual(window);
  });

  it("gives a rate increase only the recent third", () => {
    // Its sentence is about the most recent third, so a band covering the
    // whole window would contradict the text above it.
    const quakes = [
      ...burst(6, from.getTime() + 60_000, 60 * 60_000),
      ...burst(16, to.getTime() - 7 * 3_600_000, 20 * 60_000).map((event, index) => ({
        ...event,
        id: `r${index}`,
      })),
    ];
    const { observations, window } = rawDetectObservations({ quakes, from, to });

    const rate = observations.find((item) => item.kind === "rate-increase");
    expect(rate).toBeDefined();

    const windowFrom = Date.parse(window.from);
    const windowTo = Date.parse(window.to);
    const expectedSplit = windowFrom + (windowTo - windowFrom) * (2 / 3);
    expect(Date.parse(rate!.span.from)).toBe(Math.round(expectedSplit));
    expect(rate!.span.to).toBe(window.to);
  });

  it("never produces a span outside the observation window", () => {
    const quakes = burst(14, Date.parse("2026-09-19T14:00:00.000Z"), 30 * 60_000);
    const { observations, window } = rawDetectObservations({ quakes, from, to });

    expect(observations.length).toBeGreaterThan(0);
    for (const observation of observations) {
      expect(Date.parse(observation.span.from)).toBeGreaterThanOrEqual(Date.parse(window.from));
      expect(Date.parse(observation.span.to)).toBeLessThanOrEqual(Date.parse(window.to));
      expect(Date.parse(observation.span.from)).toBeLessThanOrEqual(
        Date.parse(observation.span.to),
      );
    }
  });
});
