/**
 * The written brief: everything on screen, composed into something sendable.
 *
 * ## Why this exists
 *
 * The rest of the interface is panels. Panels are for a person sitting in
 * front of a map, and that is not what people do with this kind of
 * information — they send it. A farmer tells a neighbour, a guide tells a
 * group, somebody pastes a paragraph into a message at eleven at night. Until
 * now the only sendable thing here was a link to a map that has to be read.
 *
 * So this composes the pieces that are already deterministic — the summary,
 * the observations, the regional rates, IMO's warnings, IMO's aviation
 * colours, IMO's dispersal runs — into one document with a shape and an
 * order. It computes nothing new. Every number in it has already been
 * computed and tested somewhere else in this codebase; the brief's whole job
 * is arrangement and framing.
 *
 * ## Our voice and IMO's, kept apart
 *
 * A document that mixes "46 earthquakes were recorded" with "an eruption may
 * be imminent" and attributes neither is worse than no document. So every
 * section is one or the other, and the types say which:
 *
 *   - **Analytic text** is ours. Arithmetic over IMO's catalogue, stated
 *     flatly, never characterised. `analyticText` returns all of it, and a
 *     test holds it to the same language guard the summary and the
 *     observations are already held to.
 *   - **Framing text** is also ours, but it is about the document and its
 *     sources rather than about the activity. It has to be able to say the
 *     word "warning", because naming IMO's product is the entire point of the
 *     section it introduces. `framingText` returns it, guarded against
 *     prediction rather than against vocabulary.
 *   - **Relayed text** is IMO's, reproduced in their wording with their name
 *     on it. It is neither of the above and is never rewritten, shortened or
 *     summarised here.
 *
 * ## "Nothing to report" is not "we could not ask"
 *
 * Each relayed section carries `unavailable`. A brief that renders an empty
 * warnings list because the CAP broker timed out, and renders an empty
 * warnings list because Iceland is quiet, would be telling two different
 * people the same thing. Only one of them would be right, and the one who was
 * wrong is the one who needed it.
 */

import type { ActivityObservation } from "./clusters";
import type { Summary } from "./summary";
import { TYPICAL_BAND } from "./baseline";
import type { RegionTally } from "./stats";
import type { AlertColour, AlertSeverity, OfficialAlert } from "@/domain/alert";
import { preferEnglish, sortAlerts } from "@/domain/alert";
import type { AviationColour, VolcanicSystem } from "@/domain/volcano";
import { aviationRank, isAboveBackground } from "@/domain/volcano";
import type { DispersionHazard, DispersionRun } from "@/domain/dispersion";
import { TIME_RANGES, type TimeRangeId } from "@/domain/time-range";

/**
 * A run of items from one source, with our framing and its failure state.
 *
 * `lead` is written whether or not there is anything in `items`, because a
 * section that vanishes when empty teaches the reader nothing — and "there
 * are none" is frequently the most useful line in a brief.
 */
export type BriefSection<T> = {
  /** Ours: what this section is, and what it is not. */
  lead: string;
  items: T[];
  /** Ours: set only when the source could not be reached. */
  unavailable: string | null;
};

/** IMO's warning, relayed. Every string here is theirs. */
export type BriefWarning = {
  id: string;
  event: string;
  headline: string | null;
  areas: string[];
  severity: AlertSeverity;
  colour: AlertColour | null;
  sentAt: string;
  expiresAt: string | null;
  senderName: string | null;
  url: string | null;
};

/** IMO's published status for one volcanic system, relayed. */
export type BriefVolcano = {
  name: string;
  aviationColour: AviationColour | null;
  /** IMO's VALS label, when one has been issued. */
  alertLevel: string | null;
  zone: string | null;
};

/** Ours, lifted whole from the observation that generated it. */
export type BriefObservationItem = {
  headline: string;
  detail: string;
  context: string | null;
  method: string;
  span: { from: string; to: string };
};

export type BriefRegionItem = {
  region: string;
  count: number;
  largestMagnitude: number | null;
  /** Ours: a flat rendering of the rate, or null when history allowed none. */
  comparison: string | null;
};

/** IMO's scenario, relayed, with the inputs it was given. */
export type BriefScenario = {
  id: string;
  volcano: string;
  scenario: string;
  hazard: DispersionHazard;
  columnHeightM: number | null;
  startsAt: string;
  durationHours: number;
  viewerUrl: string;
};

export type Brief = {
  generatedAt: string;
  range: TimeRangeId;
  window: { from: string; to: string };
  /** Ours: what this document is and is not. Always first, always present. */
  standing: string[];
  /** Ours: the deterministic summary, unchanged. */
  summary: string[];
  regions: BriefSection<BriefRegionItem>;
  observations: BriefSection<BriefObservationItem>;
  warnings: BriefSection<BriefWarning>;
  volcanoes: BriefSection<BriefVolcano>;
  scenarios: BriefSection<BriefScenario>;
};

/** A source that may not have answered. */
export type Fetched<T> = { items: readonly T[]; unavailable: string | null };

export type BriefInput = {
  generatedAt: Date;
  range: TimeRangeId;
  window: { from: Date; to: Date };
  summary: Summary;
  observations: readonly ActivityObservation[];
  regions: readonly (RegionTally & { ratio?: number; percentile?: number })[];
  alerts: Fetched<OfficialAlert>;
  systems: Fetched<VolcanicSystem>;
  runs: Fetched<DispersionRun>;
};

/** Regions listed. Beyond this the tail is noise in a document meant to be read. */
export const BRIEF_MAX_REGIONS = 8;

/**
 * The standing statement.
 *
 * First, every time, unconditional. A brief is read out of context by
 * definition — that is what makes it a brief — so what it is cannot be
 * something the reader has to have inferred from the page it came from.
 */
const STANDING: string[] = [
  "This is an automatically assembled summary of published data, produced at the time shown above. It is not an official warning, not a forecast, and not a hazard assessment.",
  "Official status for Iceland is published by the Icelandic Meteorological Office. Where this document relays it, it is marked as theirs and reproduced in their wording. Everything else here is arithmetic over their published catalogue, and says which arithmetic.",
  "For any decision that matters, read IMO's own pages rather than this one.",
];

/** `9.6x`, matching how the region list writes the same number on screen. */
function formatFactor(ratio: number): string {
  if (ratio >= 10) return `${Math.round(ratio)}×`;
  const rounded = Math.round(ratio * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}×`;
}

/**
 * A region's rate against its own year, stated flatly.
 *
 * The same shape as `describeBaseline`, which works from a full
 * `RegionBaseline`; here only the ratio and the percentile have been carried
 * this far, so this says only what those two support. The rank qualifies a
 * rate that is already outside the typical band and never asserts anything on
 * its own — a region whose daily count barely varies can outrank every day on
 * record while being entirely ordinary.
 */
export function describeRegionRate(
  ratio: number | undefined,
  percentile: number | undefined,
): string | null {
  if (ratio === undefined || !Number.isFinite(ratio) || ratio <= 0) return null;

  const rate =
    ratio >= TYPICAL_BAND.low && ratio <= TYPICAL_BAND.high
      ? "Close to its usual rate over the past year."
      : ratio < TYPICAL_BAND.low
        ? `About ${formatFactor(1 / ratio)} lower than its usual rate over the past year.`
        : `About ${formatFactor(ratio)} its usual rate over the past year.`;

  if (percentile === undefined || percentile < 0.9 || ratio <= TYPICAL_BAND.high) return rate;

  const share = Math.round((1 - percentile) * 100);
  return share <= 0
    ? `${rate} At that rate it is among the busiest days for this area in the past year.`
    : `${rate} That rate is higher than ${Math.round(percentile * 100)}% of days in the past year.`;
}

function volcanoesOf(systems: readonly VolcanicSystem[]): BriefVolcano[] {
  return systems
    .filter(isAboveBackground)
    .sort(
      (a, b) =>
        aviationRank(b.aviation?.colour) - aviationRank(a.aviation?.colour) ||
        (b.alertLevel?.level ?? 0) - (a.alertLevel?.level ?? 0) ||
        a.name.localeCompare(b.name),
    )
    .map((system) => ({
      name: system.name,
      aviationColour: system.aviation?.colour ?? null,
      alertLevel: system.alertLevel?.code ?? null,
      zone: system.zoneName,
    }));
}

function warningsOf(alerts: readonly OfficialAlert[]): BriefWarning[] {
  return sortAlerts(alerts).map((alert) => ({
    id: alert.id,
    // IMO's own event name, never ours. The fallback is a label, not a summary.
    event: preferEnglish(alert.event) ?? alert.alertType ?? "Warning",
    headline: preferEnglish(alert.headline),
    areas: alert.areas
      .map((area) => preferEnglish(area.description))
      .filter((area): area is string => area !== null),
    severity: alert.severity,
    colour: alert.colour,
    sentAt: alert.sentAt,
    expiresAt: alert.expiresAt,
    senderName: alert.senderName,
    url: alert.url,
  }));
}

export function buildBrief(input: BriefInput): Brief {
  const { generatedAt, range, window, summary, observations, regions, alerts, systems, runs } =
    input;

  return {
    generatedAt: generatedAt.toISOString(),
    range,
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    standing: [...STANDING],
    summary: [...summary.sentences],

    regions: {
      lead: `Events during ${TIME_RANGES[range].phrase} by IMO seismic region, busiest first. A rate is compared with that region's own past year, because forty events a day means one thing on the Reykjanes Ridge and another under a volcano that rarely moves.`,
      items: regions.slice(0, BRIEF_MAX_REGIONS).map((region) => ({
        region: region.region,
        count: region.count,
        largestMagnitude: region.largestMagnitude,
        comparison: describeRegionRate(region.ratio, region.percentile),
      })),
      unavailable: null,
    },

    observations: {
      lead: "Findings that met their thresholds during this window. Each states the numbers behind it and the method that produced it, so the arithmetic can be checked rather than taken on trust. A quiet period produces none, and none of these is a hazard assessment.",
      items: observations.map((observation) => ({
        headline: observation.headline,
        detail: observation.detail,
        context: observation.context ?? null,
        method: observation.method,
        span: observation.span,
      })),
      unavailable: null,
    },

    warnings: {
      lead: "Warnings currently in force, relayed from the Icelandic Meteorological Office in their own wording. Every kind is listed, not only the geological ones: most Icelandic warnings are about weather, and those are the ones that shut roads.",
      items: alerts.unavailable ? [] : warningsOf(alerts.items),
      unavailable: alerts.unavailable
        ? "IMO's warning service could not be reached, so this section is empty for want of an answer rather than for want of a warning. Read nothing into it; check IMO's own page."
        : null,
    },

    volcanoes: {
      lead: "Volcanic systems IMO currently places above their normal state, with IMO's own aviation colour code and alert level. Several Icelandic systems hold at yellow for months or years at a time, so a system appearing here is not by itself a change.",
      items: systems.unavailable ? [] : volcanoesOf(systems.items),
      unavailable: systems.unavailable
        ? "IMO's volcano status could not be reached, so this section is empty for want of an answer rather than for want of a change."
        : null,
    },

    scenarios: {
      lead: "Dispersal simulations IMO is currently publishing. These model eruptions that are not happening: IMO produces them several times a day for selected volcanoes so that the answer already exists if one ever starts. A column height is an input the model was given — a question, never a measurement — and the published record does not distinguish a routine run from one produced for a real event.",
      items: runs.unavailable
        ? []
        : runs.items.map((run) => ({
            id: run.id,
            volcano: run.volcano,
            scenario: run.scenario,
            hazard: run.hazard,
            columnHeightM: run.columnHeightM,
            startsAt: run.startsAt,
            durationHours: run.durationHours,
            viewerUrl: run.viewerUrl,
          })),
      unavailable: runs.unavailable
        ? "IMO's dispersion service could not be reached. Its absence here says nothing about any volcano."
        : null,
    },
  };
}

/**
 * Everything the brief asserts, in its own voice, about the activity itself.
 *
 * This is the text that must never characterise what it reports, and a test
 * holds it to the same guard the summary and the observations already pass.
 * Relayed text is deliberately absent: IMO's warnings say "warning" and their
 * aviation scale speaks of eruptions, as they should.
 */
export function analyticText(brief: Brief): string[] {
  return [
    ...brief.summary,
    ...brief.observations.items.flatMap((item) =>
      [item.headline, item.detail, item.context, item.method].filter(
        (value): value is string => value !== null,
      ),
    ),
    ...brief.regions.items.flatMap((item) => (item.comparison ? [item.comparison] : [])),
  ];
}

/**
 * Everything the brief says about itself and about where its sections came
 * from.
 *
 * Held to a different standard from `analyticText`, on purpose. This text has
 * to name IMO's products to introduce them — a warnings section that cannot
 * print the word "warning" would be unreadable — so it is guarded against
 * predicting rather than against vocabulary.
 */
export function framingText(brief: Brief): string[] {
  const sections = [
    brief.regions,
    brief.observations,
    brief.warnings,
    brief.volcanoes,
    brief.scenarios,
  ];
  return [
    ...brief.standing,
    ...sections.map((section) => section.lead),
    ...sections.flatMap((section) => (section.unavailable ? [section.unavailable] : [])),
  ];
}
