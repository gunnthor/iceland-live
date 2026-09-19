import { describe, expect, it } from "vitest";
import { normalizeAirQuality } from "./air-quality-provider";

/** The shape api.ust.is actually returns, trimmed. */
const LATEST = {
  "STA-IS0052A": {
    name: "Akureyri Strandgata",
    local_id: "STA-IS0052A",
    parameters: {
      SO2: {
        unit: "µg/m3",
        resolution: "1h",
        "0": { endtime: "2026-09-19 17:00:00", value: "3.6063", verification: 3 },
        "1": { endtime: "2026-09-19 16:00:00", value: "9.9999", verification: 3 },
      },
      H2S: {
        unit: "µg/m3",
        resolution: "1h",
        "0": { endtime: "2026-09-19 17:00:00", value: "1.5", verification: 1 },
      },
    },
  },
  "STA-NOPOS": {
    name: "Station with no metadata",
    parameters: { SO2: { unit: "µg/m3", "0": { endtime: "2026-09-19 17:00:00", value: "5" } } },
  },
};

const STATIONS = [
  {
    local_id: "STA-IS0052A",
    name: "Akureyri Strandgata",
    municipality: "Akureyri",
    network_name: "Umhverfis- og orkustofnun",
    station_classification: "background",
    altitude: 10,
    latitude: "65.6835",
    longitude: "-18.0878",
  },
];

describe("normalizeAirQuality", () => {
  it("joins measurements to station positions by local_id", () => {
    const stations = normalizeAirQuality(LATEST, STATIONS);

    expect(stations).toHaveLength(1);
    expect(stations[0]).toMatchObject({
      id: "STA-IS0052A",
      name: "Akureyri Strandgata",
      latitude: 65.6835,
      longitude: -18.0878,
      municipality: "Akureyri",
      classification: "background",
    });
  });

  it("drops a station with no position rather than placing it at zero", () => {
    const stations = normalizeAirQuality(LATEST, STATIONS);
    expect(stations.some((s) => s.id === "STA-NOPOS")).toBe(false);
  });

  it("takes the newest sample by timestamp, not by index", () => {
    // Index "1" is deliberately the larger value; picking by key order would
    // take it and report an hour-old reading as current.
    const so2 = normalizeAirQuality(LATEST, STATIONS)[0]?.latest.find(
      (r) => r.pollutant === "SO2",
    );
    expect(so2?.value).toBeCloseTo(3.6063, 4);
    expect(so2?.observedAt).toBe("2026-09-19T17:00:00.000Z");
  });

  it("maps the agency's verification codes", () => {
    const readings = normalizeAirQuality(LATEST, STATIONS)[0]?.latest ?? [];
    expect(readings.find((r) => r.pollutant === "SO2")?.verification).toBe("unverified");
    expect(readings.find((r) => r.pollutant === "H2S")?.verification).toBe("verified");
  });

  it("drops physically impossible negative concentrations", () => {
    // ~3% of live readings carry one; it is baseline drift, not a measurement.
    const withNegative = {
      "STA-IS0052A": {
        name: "Akureyri Strandgata",
        parameters: {
          H2S: {
            unit: "µg/m3",
            "0": { endtime: "2026-09-19 17:00:00", value: "-6.791", verification: 3 },
          },
        },
      },
    };
    expect(normalizeAirQuality(withNegative, STATIONS)).toEqual([]);
  });

  it("keeps a genuine zero", () => {
    const zero = {
      "STA-IS0052A": {
        name: "Akureyri Strandgata",
        parameters: {
          H2S: { unit: "µg/m3", "0": { endtime: "2026-09-19 17:00:00", value: "0", verification: 3 } },
        },
      },
    };
    expect(normalizeAirQuality(zero, STATIONS)[0]?.latest[0]?.value).toBe(0);
  });

  it("reads the agency's timestamps as UTC", () => {
    const reading = normalizeAirQuality(LATEST, STATIONS)[0]?.latest[0];
    expect(reading?.observedAt).toMatch(/Z$/);
  });

  it("returns nothing for junk", () => {
    expect(normalizeAirQuality(null, STATIONS)).toEqual([]);
    expect(normalizeAirQuality({}, STATIONS)).toEqual([]);
    expect(normalizeAirQuality(LATEST, null)).toEqual([]);
  });
});
