/**
 * The "What's happening?" summary.
 *
 * Every sentence is generated deterministically from the normalized catalogue —
 * no language model is involved, and the same input always produces the same
 * text. The summary reports counts, places and magnitudes; it never
 * characterises what the activity means.
 *
 * Structure:
 *   1. How many events, over what window.
 *   2. Where activity is concentrated, when one region clearly dominates.
 *   3. The largest event, with its magnitude, place and local time.
 *   4. A note when the catalogue is still mostly unreviewed.
 */

import type { Earthquake } from "@/domain/earthquake";
import { TIME_RANGES, type TimeRangeId } from "@/domain/time-range";
import { formatIcelandTime } from "@/lib/time";
import { formatMagnitude } from "@/lib/format";
import { tallyByRegion, type EarthquakeStats } from "./stats";

/** A region must hold at least this share of events to be called out. */
export const DOMINANT_REGION_SHARE = 0.35;

/** Below this reviewed share we tell the reader the catalogue is preliminary. */
export const PRELIMINARY_REVIEWED_SHARE = 0.5;

export type Summary = {
  /** Sentences, already ordered. Rendered as one paragraph. */
  sentences: string[];
  /** Convenience join for meta descriptions and share text. */
  text: string;
};

export function buildSummary(
  quakes: readonly Earthquake[],
  stats: EarthquakeStats,
  range: TimeRangeId,
): Summary {
  const phrase = TIME_RANGES[range].phrase;
  const sentences: string[] = [];

  if (stats.count === 0) {
    sentences.push(
      `No earthquakes were recorded in the Iceland region during ${phrase}.`,
    );
    return { sentences, text: sentences.join(" ") };
  }

  sentences.push(
    stats.count === 1
      ? `One earthquake has been recorded during ${phrase}.`
      : `${stats.count.toLocaleString("en-GB")} earthquakes have been recorded during ${phrase}.`,
  );

  const regions = tallyByRegion(quakes);
  const leader = regions[0];
  if (leader && leader.count / stats.count >= DOMINANT_REGION_SHARE) {
    const share = Math.round((leader.count / stats.count) * 100);
    sentences.push(
      `Most activity is concentrated around ${leader.region}, which accounts for ${share}% of events.`,
    );
  } else if (regions.length >= 2 && regions[1]) {
    sentences.push(
      `Activity is spread across several areas, led by ${leader?.region} and ${regions[1].region}.`,
    );
  }

  const largest = stats.largest;
  if (largest && largest.magnitude !== null) {
    const where = largest.region ? ` near ${largest.region}` : "";
    sentences.push(
      `The largest event was ${formatMagnitude(largest.magnitude)}${where} at ${formatIcelandTime(largest.occurredAt, range)}.`,
    );
  }

  if (stats.count >= 10 && stats.reviewedCount / stats.count < PRELIMINARY_REVIEWED_SHARE) {
    const share = Math.round((stats.reviewedCount / stats.count) * 100);
    sentences.push(
      `${share}% of these events have been reviewed by a seismologist; the rest are automatic solutions that may change.`,
    );
  }

  return { sentences, text: sentences.join(" ") };
}
