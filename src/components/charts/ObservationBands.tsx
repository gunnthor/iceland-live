"use client";

import type { ActivityObservation } from "@/analytics/clusters";

/**
 * The periods the observations are about, drawn behind a chart.
 *
 * ## What this is for
 *
 * The panel says "45 earthquakes within 6 km of Norðurland over 8 hours" and
 * the chart shows a day of bars. Which eight hours? Until now the reader had
 * to work that out from a clock in one place and an axis in another. A band
 * puts the sentence and the shape in the same coordinates.
 *
 * Drawn on the air trace too, on the same x-domain, which is the whole point:
 * a gas episode and the period an observation describes either line up or
 * they do not, and that should be visible rather than inferred.
 *
 * ## What it is not
 *
 * A band is a period, not a claim about it. Two things overlapping in time is
 * not evidence that one caused the other, and nothing here computes or
 * suggests a relationship — the observations remain arithmetic over the
 * earthquake catalogue, and the air trace remains a separate measurement.
 *
 * ## Why a shared component
 *
 * Two charts have to agree exactly on where a band sits, or the alignment
 * they exist to show is the thing that misleads. One projection, used twice.
 */

export type Band = { id: string; fromMs: number; toMs: number; label: string };

/**
 * A band covering this much of the window is not drawn.
 *
 * "Repeated M2.0+ events" is counted over the whole window, so its span is
 * the whole window — a wash across every bar, marking nothing, while making
 * the data underneath harder to read. A band earns its ink by distinguishing
 * part of the chart from the rest.
 *
 * The observation itself is unaffected: it keeps its span, its sentence still
 * says what period it counted over, and it simply has no band.
 */
const MAX_COVERAGE = 0.95;

/** The observations that have something to draw inside this window. */
export function bandsFor(
  observations: readonly ActivityObservation[],
  fromMs: number,
  toMs: number,
): Band[] {
  const bands: Band[] = [];

  for (const observation of observations) {
    const start = Date.parse(observation.span.from);
    const end = Date.parse(observation.span.to);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    // Clipped to the chart rather than dropped: an observation that began
    // before the window still ran during part of it, and showing only the
    // visible part is honest in a way that showing nothing is not.
    const clippedFrom = Math.max(start, fromMs);
    const clippedTo = Math.min(end, toMs);
    if (clippedTo <= clippedFrom) continue;

    if ((clippedTo - clippedFrom) / (toMs - fromMs) >= MAX_COVERAGE) continue;

    bands.push({
      id: observation.id,
      fromMs: clippedFrom,
      toMs: clippedTo,
      label: observation.headline,
    });
  }

  return bands;
}

/**
 * A description of the bands for readers who are not looking at the chart.
 *
 * The charts carry an `aria-label` describing their own shape; without this
 * the bands would be a purely visual layer, which for a product whose whole
 * claim is that the text and the picture say the same thing would be a poor
 * showing.
 */
export function describeBands(bands: readonly Band[], format: (ms: number) => string): string {
  if (bands.length === 0) return "";
  const parts = bands.map(
    (band) => `${band.label}, ${format(band.fromMs)} to ${format(band.toMs)}`,
  );
  return ` Periods described by the observations: ${parts.join("; ")}.`;
}

/**
 * Renders the bands as SVG. Must be the first child of the chart's `<svg>` so
 * it sits behind the data.
 */
export function ObservationBands({
  bands,
  fromMs,
  toMs,
  width,
  height,
  /**
   * Draws the marker on the baseline. Off for the shorter chart, where the
   * second copy of a line the chart above already carries is noise.
   */
  showRule = true,
}: {
  bands: readonly Band[];
  fromMs: number;
  toMs: number;
  width: number;
  height: number;
  showRule?: boolean;
}) {
  const span = toMs - fromMs;
  if (span <= 0 || width <= 0 || bands.length === 0) return null;

  return (
    <g aria-hidden="true">
      {bands.map((band) => {
        const x = ((band.fromMs - fromMs) / span) * width;
        // A band an hour wide in a 30-day window rounds to nothing; a hairline
        // still says "here", which is the information.
        const w = Math.max(((band.toMs - band.fromMs) / span) * width, 1.5);
        return (
          <g key={band.id}>
            {/*
              Barely there. The fill's job is to suggest an extent, not to
              highlight it: a wash strong enough to notice on its own is a
              wash strong enough to dim the bars it sits behind, and the bars
              are the data.
            */}
            <rect x={x} y={0} width={w} height={height} fill="rgb(232 145 60 / 0.045)" />
            {/*
              The precise statement is made on the baseline instead, where a
              solid segment can be read off against the axis without covering
              anything.
            */}
            {showRule && (
              <line
                x1={x}
                y1={height - 0.75}
                x2={x + w}
                y2={height - 0.75}
                stroke="rgb(232 145 60 / 0.55)"
                strokeWidth={1.5}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}
