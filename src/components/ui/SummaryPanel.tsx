"use client";

import { useState } from "react";
import type { ActivityObservation } from "@/analytics/clusters";
import type { Summary } from "@/analytics/summary";
import { cn } from "@/lib/format";

/**
 * The "what's happening" block.
 *
 * Two things live here and they are kept visibly distinct:
 *
 *  - The **summary**, a deterministic sentence or two generated from the
 *    catalogue. No model, no interpretation.
 *  - **Observations**, thresholded statistical findings. Each one can be
 *    expanded to show exactly how it was calculated, because a reader deserves
 *    to check our arithmetic rather than take "elevated activity" on trust.
 *
 * Neither is a hazard assessment, and the footnote says so.
 */

function ObservationRow({
  observation,
  onFocus,
}: {
  observation: ActivityObservation;
  onFocus: (observation: ActivityObservation) => void;
}) {
  const [showMethod, setShowMethod] = useState(false);

  return (
    <li className="border-t border-[var(--color-line)] first:border-t-0">
      <div className="px-4 py-3">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-quake-recent)]"
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-[12px] font-medium leading-tight text-[var(--color-ink)]">
              {observation.headline}
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
              {observation.detail}
            </p>

            <div className="mt-1 flex items-center gap-1">
              {observation.focus && (
                <button
                  type="button"
                  onClick={() => onFocus(observation)}
                  className="-ml-1.5 rounded px-1.5 py-2 text-[11px] text-[var(--color-ink-dim)] underline-offset-2 transition-colors duration-150 hover:text-[var(--color-ink)] hover:underline"
                >
                  Show on map
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowMethod((open) => !open)}
                aria-expanded={showMethod}
                className="rounded px-1.5 py-2 text-[11px] text-[var(--color-ink-dim)] underline-offset-2 transition-colors duration-150 hover:text-[var(--color-ink)] hover:underline"
              >
                {showMethod ? "Hide method" : "How is this calculated?"}
              </button>
            </div>

            {showMethod && (
              <p className="animate-fade-rise mt-2 rounded border border-[var(--color-line)] bg-white/[0.02] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
                {observation.method}
              </p>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

export function SummaryPanel({
  summary,
  observations,
  observationWindowCapped,
  onFocusObservation,
  className,
}: {
  summary: Summary;
  observations: readonly ActivityObservation[];
  observationWindowCapped: boolean;
  onFocusObservation: (observation: ActivityObservation) => void;
  className?: string;
}) {
  return (
    <section aria-label="What is happening" className={cn("", className)}>
      <div className="px-4 pb-4 pt-4">
        <h2 className="label">What&rsquo;s happening</h2>
        <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          {summary.sentences.map((sentence, index) => (
            <span key={sentence} className={index === 0 ? "text-[var(--color-ink)]" : undefined}>
              {sentence}{" "}
            </span>
          ))}
        </p>
      </div>

      {observations.length > 0 && (
        <div className="border-t border-[var(--color-line)]">
          <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
            <h2 className="label">Observations</h2>
            {observationWindowCapped && (
              <span
                className="text-[10px] text-[var(--color-ink-faint)]"
                title="Observations describe current activity, so they are computed over the most recent 48 hours even when a longer range is selected."
              >
                last 48h
              </span>
            )}
          </div>
          <ul>
            {observations.map((observation) => (
              <ObservationRow
                key={observation.id}
                observation={observation}
                onFocus={onFocusObservation}
              />
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-[var(--color-line)] px-4 py-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
        These are statistical summaries of IMO&rsquo;s earthquake catalogue, not hazard assessments.
        Official warnings come from the{" "}
        <a
          href="https://en.vedur.is/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 transition-colors hover:text-[var(--color-ink-dim)]"
        >
          Icelandic Meteorological Office
        </a>{" "}
        and{" "}
        <a
          href="https://www.almannavarnir.is/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 transition-colors hover:text-[var(--color-ink-dim)]"
        >
          Almannavarnir
        </a>
        .
      </p>
    </section>
  );
}
