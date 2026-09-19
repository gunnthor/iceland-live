/**
 * Air quality measurements from the Environment and Energy Agency
 * (Umhverfis- og orkustofnun).
 *
 * ## Why this matters here
 *
 * Volcanic gas is the hazard from a Reykjanes eruption that most often reaches
 * people far from it. SO₂ and H₂S are what the monitoring network measures, and
 * the network is dense enough around the capital region and Reykjanes to show
 * where a plume has gone.
 *
 * ## What we do not do
 *
 * We report measurements and never grade them. The agency publishes a health
 * scale for these pollutants and is the place to read one; a colour band
 * invented here would be a health judgement this project has no standing to
 * make. Values carry their units, their time, and whether they have been
 * verified — and nothing else.
 */

/** Pollutants the network reports. Others may appear; unknown codes pass through. */
export type Pollutant =
  | "SO2"
  | "H2S"
  | "PM10"
  | "PM2.5"
  | "PM1"
  | "NO2"
  | "NO"
  | "NOX as NO2"
  | "O3"
  | "CO"
  | (string & {});

/**
 * The pollutants this product leads with, in order.
 *
 * SO₂ and H₂S first because they are the volcanic ones; particulates next
 * because an eruption lofts ash and because they are what a reader is likely to
 * recognise.
 */
export const VOLCANIC_POLLUTANTS: readonly Pollutant[] = ["SO2", "H2S"];
export const HEADLINE_POLLUTANTS: readonly Pollutant[] = ["SO2", "H2S", "PM10", "PM2.5"];

/**
 * Whether a reading has been through the agency's review.
 *
 * The API reports `1` for verified and `3` for not verified. Everything served
 * in real time is `3`, which is the same situation as an unreviewed earthquake
 * solution and is labelled the same way.
 */
export type VerificationState = "verified" | "unverified" | "unknown";

export type Reading = {
  pollutant: Pollutant;
  /** Measured value in `unit`. */
  value: number;
  /** As published, e.g. "µg/m3". */
  unit: string;
  /** End of the averaging period, ISO instant. */
  observedAt: string;
  /** Averaging period as published, e.g. "1h". */
  resolution: string | null;
  verification: VerificationState;
};

export type AirQualityStation = {
  /** Agency identifier, e.g. "STA-IS0052A". */
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  municipality: string | null;
  /** Operator, e.g. "Umhverfis- og orkustofnun" or an industrial network. */
  network: string | null;
  /** Agency classification, e.g. "background", "traffic", "industrial". */
  classification: string | null;
  altitudeM: number | null;
  /** Most recent reading per pollutant. */
  latest: Reading[];
};

/** The most recent reading for a pollutant at a station, if it reports one. */
export function readingFor(
  station: AirQualityStation,
  pollutant: Pollutant,
): Reading | null {
  return station.latest.find((reading) => reading.pollutant === pollutant) ?? null;
}

/** Stations reporting any volcanic gas, most recent reading first. */
export function stationsReportingGas(
  stations: readonly AirQualityStation[],
): AirQualityStation[] {
  return stations.filter((station) =>
    VOLCANIC_POLLUTANTS.some((pollutant) => readingFor(station, pollutant) !== null),
  );
}

/**
 * Highest value of a pollutant across the network, for the map legend.
 * Returns null when nothing reports it.
 */
export function networkPeak(
  stations: readonly AirQualityStation[],
  pollutant: Pollutant,
): number | null {
  let peak: number | null = null;
  for (const station of stations) {
    const reading = readingFor(station, pollutant);
    if (reading && (peak === null || reading.value > peak)) peak = reading.value;
  }
  return peak;
}
