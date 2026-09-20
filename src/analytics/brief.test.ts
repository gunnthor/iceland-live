import { describe, expect, it } from "vitest";

import type { OfficialAlert } from "@/domain/alert";
import type { DispersionRun } from "@/domain/dispersion";
import type { VolcanicSystem } from "@/domain/volcano";
import {
  BRIEF_MAX_REGIONS,
  analyticText,
  buildBrief,
  describeRegionRate,
  framingText,
  type BriefInput,
} from "./brief";

const GENERATED_AT = new Date("2026-09-20T09:00:00.000Z");
const WINDOW = {
  from: new Date("2026-09-19T09:00:00.000Z"),
  to: new Date("2026-09-20T09:00:00.000Z"),
};

function alert(overrides: Partial<OfficialAlert> = {}): OfficialAlert {
  return {
    id: "urn:oid:1.2.3",
    sender: "IMO-Icelandic_Met_Office",
    senderName: "IMO - Meteorologist on duty",
    sentAt: "2026-09-20T06:00:00.000Z",
    onsetAt: null,
    expiresAt: "2026-09-20T18:00:00.000Z",
    messageType: "Alert",
    category: "Met",
    alertType: "Wind",
    event: { en: "Wind warning", is: null },
    headline: { en: "Southeast 18-25 m/s", is: null },
    description: { en: "Travel is not recommended.", is: null },
    severity: "Moderate",
    urgency: "Expected",
    certainty: "Likely",
    colour: "Yellow",
    areas: [{ description: { en: "Southeast", is: null }, geometry: null }],
    url: "https://en.vedur.is/warnings",
    ...overrides,
  } as OfficialAlert;
}

function system(overrides: Partial<VolcanicSystem> = {}): VolcanicSystem {
  return {
    code: "KAT",
    name: "Katla",
    altName: null,
    smithsonianId: null,
    zoneCode: "EVZ",
    zoneName: "Eastern Volcanic Zone",
    summitElevationM: 1450,
    latitude: 63.63,
    longitude: -19.05,
    aviation: { colour: "YELLOW", description: null, publishedAt: null },
    alertLevel: null,
    features: [],
    ...overrides,
  } as VolcanicSystem;
}

function run(overrides: Partial<DispersionRun> = {}): DispersionRun {
  return {
    id: "0189c0de-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
    scenario: "Grindavik10000",
    volcano: "Reykjanes",
    model: "NAME",
    hazard: "ash",
    latitude: 63.85,
    longitude: -22.44,
    columnHeightM: 10000,
    startsAt: "2026-09-20T00:00:00.000Z",
    durationHours: 48,
    createdAt: "2026-09-20T01:00:00.000Z",
    bounds: { west: -40, south: 60, east: -0.03, north: 72.95 },
    layers: [],
    viewerUrl: "https://en.vedur.is/dispersion",
    ...overrides,
  } as DispersionRun;
}

function input(overrides: Partial<BriefInput> = {}): BriefInput {
  return {
    generatedAt: GENERATED_AT,
    range: "24h",
    window: WINDOW,
    summary: {
      sentences: ["46 earthquakes have been recorded during the last 24 hours."],
      text: "46 earthquakes have been recorded during the last 24 hours.",
    },
    observations: [],
    regions: [],
    alerts: { items: [], unavailable: null },
    systems: { items: [], unavailable: null },
    runs: { items: [], unavailable: null },
    ...overrides,
  };
}

describe("buildBrief", () => {
  it("is deterministic", () => {
    const once = buildBrief(input({ alerts: { items: [alert()], unavailable: null } }));
    const twice = buildBrief(input({ alerts: { items: [alert()], unavailable: null } }));
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });

  it("states what the document is before it states anything about Iceland", () => {
    const brief = buildBrief(input());
    expect(brief.standing.length).toBeGreaterThan(0);
    expect(brief.standing[0]).toContain("not an official warning");
  });

  describe("nothing to report is not we could not ask", () => {
    /*
     * The distinction the whole document rests on. An empty warnings list
     * because Iceland is quiet and an empty warnings list because the broker
     * timed out would tell two readers the same thing, and only one of them
     * would be right.
     */
    it("leaves a reachable but empty source unqualified", () => {
      const brief = buildBrief(input());
      expect(brief.warnings.items).toEqual([]);
      expect(brief.warnings.unavailable).toBeNull();
    });

    it("says so when a source could not be reached", () => {
      const brief = buildBrief(
        input({ alerts: { items: [], unavailable: "warnings" } }),
      );
      expect(brief.warnings.unavailable).toMatch(/could not be reached/i);
      expect(brief.warnings.unavailable).toMatch(/for want of an answer/i);
    });

    it("never carries items from a source it has marked unavailable", () => {
      // A stale list rendered under a failure notice would be the worst of both.
      const brief = buildBrief(
        input({ alerts: { items: [alert()], unavailable: "warnings" } }),
      );
      expect(brief.warnings.items).toEqual([]);
    });

    it("leads every section whether or not it has anything in it", () => {
      const brief = buildBrief(input());
      for (const section of [
        brief.regions,
        brief.observations,
        brief.warnings,
        brief.volcanoes,
        brief.scenarios,
      ]) {
        expect(section.lead.length).toBeGreaterThan(0);
      }
    });
  });

  describe("relaying IMO", () => {
    it("reproduces a warning in IMO's wording, with IMO's name on it", () => {
      const brief = buildBrief(input({ alerts: { items: [alert()], unavailable: null } }));
      const [warning] = brief.warnings.items;
      expect(warning?.event).toBe("Wind warning");
      expect(warning?.headline).toBe("Southeast 18-25 m/s");
      expect(warning?.colour).toBe("Yellow");
      expect(warning?.senderName).toBe("IMO - Meteorologist on duty");
      expect(warning?.areas).toEqual(["Southeast"]);
    });

    it("lists only the systems IMO has raised above normal", () => {
      const brief = buildBrief(
        input({
          systems: {
            items: [
              system({ name: "Hekla", aviation: null }),
              system({ name: "Katla" }),
              system({
                name: "Grimsvotn",
                aviation: { colour: "ORANGE", description: null, publishedAt: null },
              }),
            ],
            unavailable: null,
          },
        }),
      );
      // Green and unset are absent; the most serious comes first.
      expect(brief.volcanoes.items.map((item) => item.name)).toEqual(["Grimsvotn", "Katla"]);
    });

    it("carries a column height as the input it is", () => {
      const brief = buildBrief(input({ runs: { items: [run()], unavailable: null } }));
      expect(brief.scenarios.items[0]?.columnHeightM).toBe(10000);
      expect(brief.scenarios.lead).toMatch(/never a measurement/i);
      expect(brief.scenarios.lead).toMatch(/eruptions that are not happening/i);
    });
  });

  it("stops listing regions before the tail becomes noise", () => {
    const regions = Array.from({ length: BRIEF_MAX_REGIONS + 4 }, (_, index) => ({
      region: `Region ${index}`,
      count: 100 - index,
      largestMagnitude: 2,
      centre: null,
      latestAt: null,
    }));
    const brief = buildBrief(input({ regions }));
    expect(brief.regions.items).toHaveLength(BRIEF_MAX_REGIONS);
    expect(brief.regions.items[0]?.region).toBe("Region 0");
  });
});

describe("the brief's own voice", () => {
  /** Everything a brief can hold, so the guards see the widest surface. */
  function populated() {
    return buildBrief(
      input({
        observations: [
          {
            id: "obs-1",
            kind: "dense-cluster",
            headline: "Elevated earthquake activity",
            detail: "46 earthquakes within 6 km of Reykjanes over 26 hours.",
            method: "Events grouped by distance, then counted.",
            context: "About 3x the usual rate for Reykjanes over the past year.",
            span: { from: WINDOW.from.toISOString(), to: WINDOW.to.toISOString() },
            eventIds: ["IMO-1"],
          },
        ],
        regions: [
          {
            region: "Reykjanes",
            count: 46,
            largestMagnitude: 3.1,
            centre: null,
            latestAt: null,
            ratio: 3.2,
            percentile: 0.97,
          },
        ],
        alerts: { items: [alert()], unavailable: null },
        systems: { items: [system()], unavailable: null },
        runs: { items: [run()], unavailable: null },
      }),
    );
  }

  it("never interprets what the activity means", () => {
    // The same guard the summary and the observations are already held to.
    const forbidden = /precursor|imminent|erupt|warning|evacuat|danger|likely|suggests|indicates/i;
    for (const sentence of analyticText(populated())) {
      expect(sentence).not.toMatch(forbidden);
    }
  });

  it("never predicts, even where it is allowed to name IMO's products", () => {
    /*
     * Framing text has to be able to say "warning" — a warnings section that
     * cannot print the word would be unreadable — so it is guarded against
     * predicting rather than against vocabulary.
     */
    const forbidden = /\b(imminent|precursor|evacuat\w*|predict\w*|anticipat\w*)\b/i;
    for (const sentence of framingText(populated())) {
      expect(sentence).not.toMatch(forbidden);
    }
  });

  it("keeps IMO's words out of the text held to our guard", () => {
    /*
     * The point of the split. IMO's wind warning says "warning" and would fail
     * the analytic guard, which is exactly why it is not ours to be guarded.
     */
    const brief = populated();
    const ours = [...analyticText(brief), ...framingText(brief)];
    expect(ours).not.toContain("Wind warning");
    expect(ours).not.toContain("Southeast 18-25 m/s");
    expect(brief.warnings.items[0]?.event).toBe("Wind warning");
  });
});

describe("describeRegionRate", () => {
  it("says nothing when there is no comparison to make", () => {
    expect(describeRegionRate(undefined, undefined)).toBeNull();
    expect(describeRegionRate(0, 0.99)).toBeNull();
    expect(describeRegionRate(Number.NaN, 0.99)).toBeNull();
  });

  it("calls an ordinary rate ordinary", () => {
    expect(describeRegionRate(1.1, undefined)).toMatch(/close to its usual rate/i);
  });

  it("states a raised rate as a measurement and not as a judgement", () => {
    const text = describeRegionRate(3.2, undefined);
    expect(text).toMatch(/about 3.2× its usual rate/i);
    expect(text).not.toMatch(/unusual|alarming|dramatic/i);
  });

  it("states a lowered rate the right way round", () => {
    expect(describeRegionRate(0.25, undefined)).toMatch(/about 4× lower/i);
  });

  it("adds a rank only to a rate already outside the typical band", () => {
    /*
     * In a region whose daily count barely varies, a rate a shade above the
     * mean can outrank every day on record while being entirely ordinary.
     * "Close to the usual rate, and among the busiest days ever" is a sentence
     * that contradicts itself.
     */
    expect(describeRegionRate(1.1, 0.99)).not.toMatch(/higher than|busiest/i);
    expect(describeRegionRate(3.2, 0.97)).toMatch(/higher than 97% of days/i);
    expect(describeRegionRate(3.2, 0.5)).not.toMatch(/higher than|busiest/i);
  });
});
