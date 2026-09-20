import { describe, expect, it } from "vitest";
import { chooseFocus } from "./watch-focus";
import type { OfficialAlert } from "@/domain/alert";
import type { VolcanicSystem } from "@/domain/volcano";
import type { RegionTally } from "@/analytics/stats";

function alert(overrides: Partial<OfficialAlert> = {}): OfficialAlert {
  return {
    id: "a",
    sender: "IMO",
    senderName: null,
    sentAt: "2026-09-20T00:00:00.000Z",
    onsetAt: null,
    expiresAt: null,
    messageType: "Alert",
    category: "Geo",
    alertType: "Landslide",
    event: { en: "Landslide", is: null },
    headline: { en: null, is: null },
    description: { en: null, is: null },
    severity: "Severe",
    urgency: "Immediate",
    certainty: "Likely",
    colour: "Orange",
    areas: [
      {
        description: { en: "Seydisfjordur", is: null },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-14.0, 65.2],
              [-13.8, 65.2],
              [-13.8, 65.3],
              [-14.0, 65.3],
              [-14.0, 65.2],
            ],
          ],
        },
      },
    ],
    url: null,
    ...overrides,
  };
}

function system(overrides: Partial<VolcanicSystem> = {}): VolcanicSystem {
  return {
    code: "GRI",
    name: "Grimsvotn",
    altName: null,
    smithsonianId: null,
    zoneCode: null,
    zoneName: null,
    summitElevationM: null,
    latitude: 64.416,
    longitude: -17.316,
    aviation: { colour: "ORANGE", description: null, publishedAt: null },
    alertLevel: null,
    features: [],
    ...overrides,
  };
}

function region(name: string, latitude: number, longitude: number): RegionTally {
  return {
    region: name,
    count: 40,
    largestMagnitude: 2.4,
    centre: { latitude, longitude },
    latestAt: "2026-09-20T00:00:00.000Z",
  };
}

const REYKJANES = region("Reykjanes", 63.9, -22.3);

describe("chooseFocus", () => {
  it("prefers a geological warning over everything else", () => {
    const focus = chooseFocus({
      alerts: [alert()],
      systems: [system()],
      regions: [REYKJANES],
    });
    expect(focus.reason).toBe("official-warning");
    expect(focus.label).toBe("Landslide — Seydisfjordur");
    // Mean of the ring's vertices, which is only ever "roughly where".
    expect(focus.latitude).toBeCloseTo(65.24, 2);
    expect(focus.longitude).toBeCloseTo(-13.92, 2);
  });

  it("takes the most serious warning when several are in force", () => {
    const focus = chooseFocus({
      alerts: [
        alert({ id: "minor", colour: "Yellow", severity: "Minor", event: { en: "Ashfall", is: null } }),
        alert({ id: "worst", colour: "Red", severity: "Extreme", event: { en: "Volcanic eruption", is: null } }),
      ],
      systems: [],
      regions: [REYKJANES],
    });
    expect(focus.label).toContain("Volcanic eruption");
  });

  it("ignores weather warnings", () => {
    // Iceland has these most weeks over large parts of the country; a wind
    // warning is not a reason to stop watching a volcano.
    const focus = chooseFocus({
      alerts: [alert({ category: "Met", alertType: "Wind", event: { en: "Wind", is: null } })],
      systems: [],
      regions: [REYKJANES],
    });
    expect(focus.reason).toBe("seismicity");
  });

  it("ignores a warning it cannot place on the map", () => {
    const focus = chooseFocus({
      alerts: [alert({ areas: [{ description: { en: "Nowhere", is: null }, geometry: null }] })],
      systems: [],
      regions: [REYKJANES],
    });
    expect(focus.reason).toBe("seismicity");
  });

  it("falls to an orange or red volcano when no warning is in force", () => {
    const focus = chooseFocus({ alerts: [], systems: [system()], regions: [REYKJANES] });
    expect(focus.reason).toBe("aviation-code");
    expect(focus.label).toBe("Grimsvotn — aviation orange");
    expect(focus.latitude).toBe(64.416);
  });

  it("prefers red to orange", () => {
    const focus = chooseFocus({
      alerts: [],
      systems: [
        system(),
        system({
          code: "KAT",
          name: "Katla",
          latitude: 63.63,
          longitude: -19.05,
          aviation: { colour: "RED", description: null, publishedAt: null },
        }),
      ],
      regions: [REYKJANES],
    });
    expect(focus.label).toContain("Katla");
  });

  it("does not treat yellow as a trigger", () => {
    // Icelandic systems sit at yellow for months; it would pin the recorder
    // to whichever has been restless longest and never release it.
    const focus = chooseFocus({
      alerts: [],
      systems: [system({ aviation: { colour: "YELLOW", description: null, publishedAt: null } })],
      regions: [REYKJANES],
    });
    expect(focus.reason).toBe("seismicity");
    expect(focus.label).toBe("Reykjanes");
  });

  it("skips a volcano with no published position", () => {
    const focus = chooseFocus({
      alerts: [],
      systems: [system({ latitude: null, longitude: null })],
      regions: [REYKJANES],
    });
    expect(focus.reason).toBe("seismicity");
  });

  it("takes the busiest region with a position, not merely the first", () => {
    const focus = chooseFocus({
      alerts: [],
      systems: [],
      regions: [{ ...region("Unplaced", 0, 0), centre: null }, REYKJANES],
    });
    expect(focus.reason).toBe("seismicity");
    expect(focus.label).toBe("Reykjanes");
  });

  it("falls back to the default view when there is nothing to point at", () => {
    // "No earthquakes anywhere" is not a reason to stop watching the
    // peninsula with the eruptions on it.
    const focus = chooseFocus({ alerts: [], systems: [], regions: [] });
    expect(focus.reason).toBe("default");
    expect(focus.label).toBeNull();
    expect(focus.latitude).toBeGreaterThan(62);
    expect(focus.latitude).toBeLessThan(67);
  });
});
