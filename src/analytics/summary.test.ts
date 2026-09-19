import { describe, expect, it } from "vitest";
import type { Earthquake } from "@/domain/earthquake";
import { computeStats } from "./stats";
import { buildSummary } from "./summary";

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

const WINDOW = {
  from: new Date("2026-09-18T12:00:00.000Z"),
  to: new Date("2026-09-19T12:00:00.000Z"),
};

function summarise(quakes: Earthquake[], range: "24h" | "7d" = "24h") {
  return buildSummary(quakes, computeStats(quakes, WINDOW), range);
}

describe("buildSummary", () => {
  it("says plainly when nothing was recorded", () => {
    const summary = summarise([]);
    expect(summary.text).toBe(
      "No earthquakes were recorded in the Iceland region during the last 24 hours.",
    );
  });

  it("uses singular wording for a single event", () => {
    const summary = summarise([quake()]);
    expect(summary.sentences[0]).toBe("One earthquake has been recorded during the last 24 hours.");
  });

  it("opens with the count and the window", () => {
    const summary = summarise(Array.from({ length: 126 }, () => quake()));
    expect(summary.sentences[0]).toBe("126 earthquakes have been recorded during the last 24 hours.");
  });

  it("names a dominant region with its share", () => {
    const quakes = [
      ...Array.from({ length: 80 }, () => quake({ region: "Reykjanes" })),
      ...Array.from({ length: 20 }, () => quake({ region: "Katla" })),
    ];
    expect(summarise(quakes).text).toContain("concentrated around Reykjanes, which accounts for 80% of events");
  });

  it("does not claim concentration when activity is spread out", () => {
    const quakes = [
      ...Array.from({ length: 10 }, () => quake({ region: "Reykjanes" })),
      ...Array.from({ length: 10 }, () => quake({ region: "Katla" })),
      ...Array.from({ length: 10 }, () => quake({ region: "Askja" })),
      ...Array.from({ length: 10 }, () => quake({ region: "Hekla" })),
    ];
    const text = summarise(quakes).text;
    expect(text).not.toContain("concentrated");
    expect(text).toContain("spread across several areas");
  });

  it("reports the largest event with magnitude, place and local time", () => {
    const quakes = [
      quake({ magnitude: 0.4 }),
      quake({ magnitude: 3.1, region: "Reykjanes", occurredAt: "2026-09-19T11:32:00.000Z" }),
    ];
    // Iceland is UTC+0 all year, so 11:32Z renders as 11:32.
    expect(summarise(quakes).text).toContain("The largest event was M 3.1 near Reykjanes at 11:32.");
  });

  it("includes the date in the largest-event time for multi-day ranges", () => {
    const quakes = [quake({ magnitude: 3.1, occurredAt: "2026-09-19T11:32:00.000Z" })];
    expect(summarise(quakes, "7d").text).toMatch(/19 Sep, 11:32/);
  });

  it("flags a mostly unreviewed catalogue as preliminary", () => {
    const quakes = [
      ...Array.from({ length: 18 }, () => quake({ reviewStatus: "automatic" })),
      ...Array.from({ length: 2 }, () => quake({ reviewStatus: "reviewed" })),
    ];
    expect(summarise(quakes).text).toContain(
      "10% of these events have been reviewed by a seismologist",
    );
  });

  it("does not add a review caveat when most events are reviewed", () => {
    const quakes = Array.from({ length: 20 }, () => quake({ reviewStatus: "reviewed" }));
    expect(summarise(quakes).text).not.toContain("reviewed by a seismologist");
  });

  it("is deterministic", () => {
    const quakes = Array.from({ length: 30 }, (_, i) => quake({ magnitude: i / 10 }));
    expect(summarise(quakes).text).toBe(summarise(quakes).text);
  });

  it("never interprets what the activity means", () => {
    const quakes = Array.from({ length: 200 }, () => quake({ magnitude: 3.4 }));
    const forbidden = /precursor|imminent|erupt|warning|evacuat|danger|likely|suggests|indicates/i;
    expect(summarise(quakes).text).not.toMatch(forbidden);
  });
});
