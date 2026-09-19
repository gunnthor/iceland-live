import { describe, expect, it } from "vitest";
import { traceOptions } from "./AirTrace";
import type { AirQualityStation, Reading } from "@/domain/air-quality";

function series(values: number[], endingAt = Date.parse("2026-09-19T22:00:00Z")) {
  return values.map((value, index) => ({
    at: new Date(endingAt - (values.length - 1 - index) * 3_600_000).toISOString(),
    value,
  }));
}

function reading(overrides: Partial<Reading> & Pick<Reading, "pollutant" | "value">): Reading {
  return {
    unit: "µg/m3",
    observedAt: "2026-09-19T22:00:00Z",
    resolution: "1h",
    verification: "unverified",
    ...overrides,
  };
}

function station(id: string, name: string, latest: Reading[]): AirQualityStation {
  return {
    id,
    name,
    latitude: 63.9,
    longitude: -22.4,
    municipality: null,
    network: null,
    classification: "background",
    altitudeM: null,
    latest,
  };
}

describe("traceOptions", () => {
  it("offers only pollutants that carry a series", () => {
    // The provider keeps series for the headline pollutants alone, so the
    // others have a current value and nothing to plot.
    const options = traceOptions([
      station("a", "Grindavik", [
        reading({ pollutant: "SO2", value: 12, series: series([4, 8, 12]) }),
        reading({ pollutant: "NO2", value: 30, series: series([10, 20, 30]) }),
        reading({ pollutant: "H2S", value: 3 }),
      ]),
    ]);

    expect(options.map((option) => option.pollutant)).toEqual(["SO2"]);
  });

  it("needs more than one sample before a line means anything", () => {
    const options = traceOptions([
      station("a", "Grindavik", [reading({ pollutant: "SO2", value: 12, series: series([12]) })]),
    ]);
    expect(options).toEqual([]);
  });

  it("puts the volcanic gases first, whatever the numbers are", () => {
    // Particulates are routinely an order of magnitude larger in µg/m³, so
    // ordering on value alone would bury SO₂ under road dust every time.
    const options = traceOptions([
      station("a", "Reykjavik", [
        reading({ pollutant: "PM10", value: 90, series: series([50, 70, 90]) }),
      ]),
      station("b", "Grindavik", [
        reading({ pollutant: "SO2", value: 5, series: series([1, 3, 5]) }),
      ]),
    ]);

    expect(options.map((option) => option.pollutant)).toEqual(["SO2", "PM10"]);
  });

  it("leads with the station reporting most of the same pollutant", () => {
    const options = traceOptions([
      station("a", "Quiet", [reading({ pollutant: "SO2", value: 2, series: series([1, 2]) })]),
      station("b", "Busy", [reading({ pollutant: "SO2", value: 40, series: series([20, 40]) })]),
    ]);
    expect(options[0]?.label).toBe("Busy · SO2");
  });

  it("lists every plottable pair, not one per station", () => {
    const options = traceOptions([
      station("a", "Grindavik", [
        reading({ pollutant: "SO2", value: 12, series: series([4, 12]) }),
        reading({ pollutant: "H2S", value: 6, series: series([2, 6]) }),
        reading({ pollutant: "PM10", value: 20, series: series([10, 20]) }),
      ]),
    ]);
    expect(options.map((option) => option.pollutant)).toEqual(["SO2", "H2S", "PM10"]);
    expect(new Set(options.map((option) => option.key)).size).toBe(3);
  });

  it("returns nothing when the network is empty or reporting nothing charted", () => {
    expect(traceOptions([])).toEqual([]);
    expect(traceOptions([station("a", "Nowhere", [])])).toEqual([]);
  });
});
