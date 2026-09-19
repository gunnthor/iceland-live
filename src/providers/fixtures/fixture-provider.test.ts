import { describe, expect, it } from "vitest";
import { NON_EARTHQUAKE_EVENT_TYPES } from "@/domain/earthquake";
import { FixtureEarthquakeProvider } from "./fixture-provider";

/**
 * The fixture is a real IMO payload, so these double as a check that the
 * normalizer still handles genuine upstream data rather than only the small
 * hand-written rows in `normalize.test.ts`.
 */
describe("FixtureEarthquakeProvider", () => {
  const wideWindow = {
    from: new Date("2000-01-01T00:00:00Z"),
    to: new Date("2100-01-01T00:00:00Z"),
  };

  it("parses the snapshot into a substantial catalogue", async () => {
    const result = await new FixtureEarthquakeProvider({ shiftToNow: false }).fetchEarthquakes(
      wideWindow,
    );
    expect(result.data.length).toBeGreaterThan(500);
  });

  it("always reports itself as fixture data, never as live", async () => {
    const result = await new FixtureEarthquakeProvider().fetchEarthquakes(wideWindow);
    expect(result.meta.freshness).toBe("fixture");
    expect(result.meta.attribution.note).toMatch(/Not current/i);
  });

  it("excludes events IMO classified as something other than an earthquake", async () => {
    const result = await new FixtureEarthquakeProvider({ shiftToNow: false }).fetchEarthquakes(
      wideWindow,
    );
    for (const quake of result.data) {
      if (quake.eventType === null) continue;
      expect(NON_EARTHQUAKE_EVENT_TYPES.has(quake.eventType)).toBe(false);
    }
  });

  it("produces events with usable coordinates and times throughout", async () => {
    const result = await new FixtureEarthquakeProvider({ shiftToNow: false }).fetchEarthquakes(
      wideWindow,
    );
    for (const quake of result.data) {
      expect(Number.isFinite(quake.latitude)).toBe(true);
      expect(Number.isFinite(quake.longitude)).toBe(true);
      expect(Number.isNaN(Date.parse(quake.occurredAt))).toBe(false);
      expect(quake.source).toBe("IMO");
    }
  });

  it("covers the Iceland region", async () => {
    const result = await new FixtureEarthquakeProvider({ shiftToNow: false }).fetchEarthquakes(
      wideWindow,
    );
    for (const quake of result.data) {
      expect(quake.latitude).toBeGreaterThan(60);
      expect(quake.latitude).toBeLessThan(70);
      expect(quake.longitude).toBeGreaterThan(-30);
      expect(quake.longitude).toBeLessThan(-10);
    }
  });

  it("honours the requested window", async () => {
    const provider = new FixtureEarthquakeProvider({ shiftToNow: true });
    const all = await provider.fetchEarthquakes(wideWindow);
    const recent = await provider.fetchEarthquakes({
      from: new Date(Date.now() - 3_600_000),
      to: new Date(Date.now() + 1000),
    });

    expect(recent.data.length).toBeLessThan(all.data.length);
    for (const quake of recent.data) {
      expect(Date.parse(quake.occurredAt)).toBeGreaterThanOrEqual(Date.now() - 3_700_000);
    }
  });

  it("shifts the snapshot forward without altering the shape of the activity", async () => {
    const frozen = await new FixtureEarthquakeProvider({ shiftToNow: false }).fetchEarthquakes(
      wideWindow,
    );
    const shifted = await new FixtureEarthquakeProvider({ shiftToNow: true }).fetchEarthquakes(
      wideWindow,
    );

    expect(shifted.data).toHaveLength(frozen.data.length);

    // The gap between the two newest events must survive the shift.
    const gap = (list: typeof frozen.data) =>
      Date.parse(list[0]!.occurredAt) - Date.parse(list[1]!.occurredAt);
    expect(gap(shifted.data)).toBe(gap(frozen.data));

    // ...and the newest event should now be approximately now.
    expect(Math.abs(Date.parse(shifted.data[0]!.occurredAt) - Date.now())).toBeLessThan(5000);
  });
});
