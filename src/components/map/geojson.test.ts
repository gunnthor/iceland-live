import { describe, expect, it } from "vitest";
import type { RoadWeatherStation } from "@/domain/roads";
import { toWindGeoJson } from "./geojson";

function station(overrides: Partial<RoadWeatherStation> = {}): RoadWeatherStation {
  return {
    id: 1,
    name: "Gíghæð",
    latitude: 63.88,
    longitude: -22.42,
    altitudeM: 100,
    observedAt: "2026-09-19T17:40:00.000Z",
    windDirectionDeg: 0,
    windDirectionLabel: "N",
    windSpeedMs: 8,
    windGustMs: 12,
    airTempC: 5,
    roadTempC: 7,
    relativeHumidity: 80,
    ...overrides,
  };
}

describe("toWindGeoJson", () => {
  it("points the arrow downwind, not into the wind", () => {
    // Meteorology reports the direction wind comes FROM. A northerly (0°)
    // carries air southwards, so the arrow must bear 180°. Getting this
    // backwards would send a gas plume the opposite way on the map.
    expect(toWindGeoJson([station({ windDirectionDeg: 0 })]).features[0]?.properties.towards).toBe(
      180,
    );
    expect(toWindGeoJson([station({ windDirectionDeg: 90 })]).features[0]?.properties.towards).toBe(
      270,
    );
  });

  it("wraps past 360 rather than producing an out-of-range bearing", () => {
    expect(
      toWindGeoJson([station({ windDirectionDeg: 200 })]).features[0]?.properties.towards,
    ).toBe(20);
    expect(
      toWindGeoJson([station({ windDirectionDeg: 350 })]).features[0]?.properties.towards,
    ).toBe(170);
  });

  it("uses [lon, lat] order", () => {
    const feature = toWindGeoJson([station()]).features[0];
    expect(feature?.geometry.coordinates).toEqual([-22.42, 63.88]);
  });

  it("skips stations with no wind reading rather than drawing a default arrow", () => {
    expect(toWindGeoJson([station({ windDirectionDeg: null })]).features).toHaveLength(0);
    expect(toWindGeoJson([station({ windSpeedMs: null })]).features).toHaveLength(0);
  });

  it("falls back to the speed when no gust is reported", () => {
    const feature = toWindGeoJson([station({ windGustMs: null })]).features[0];
    expect(feature?.properties.gust).toBe(8);
  });
});
