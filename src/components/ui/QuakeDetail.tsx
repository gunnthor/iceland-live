"use client";

import type { Earthquake } from "@/domain/earthquake";
import {
  horizontalUncertaintyKm,
  isFixedDepth,
  type EarthquakeDetail,
} from "@/domain/earthquake-detail";
import {
  formatCoordinates,
  formatDepth,
  formatMagnitude,
  formatMagnitudeType,
  formatWithUncertainty,
} from "@/lib/format";
import { formatExact, formatRelativeLong } from "@/lib/time";

function Field({
  label,
  value,
  mono = false,
  title,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd
        title={title}
        className={`mt-1.5 truncate text-[13px] text-[var(--color-ink)] ${mono ? "font-[family-name:var(--font-mono)] text-[12px]" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

/** Plain-language gloss on IMO's review state. */
function reviewLabel(quake: Earthquake): { text: string; note: string } {
  switch (quake.reviewStatus) {
    case "reviewed":
      return {
        text: "Reviewed",
        note: "A seismologist has reviewed this solution.",
      };
    case "automatic":
      return {
        text: "Automatic",
        note: "Detected automatically and not yet reviewed. Location and magnitude may change.",
      };
    default:
      return { text: "Unknown", note: "IMO did not report a review status for this event." };
  }
}

/**
 * Everything IMO tells us about one event.
 *
 * Unreported fields show an em dash rather than a zero or a blank: "we were not
 * told" and "it was zero" are different statements, and depth in particular can
 * legitimately be zero.
 */
/**
 * How to present depth, given what IMO actually determined.
 *
 * Three genuinely different situations that a single "10.0 km" would flatten:
 * a depth solved for from the data (show the error bar), a depth an operator
 * fixed because the data would not constrain it (say so — its zero uncertainty
 * means "not determined", not "exact"), and no detail loaded yet (fall back to
 * the catalogue value).
 */
function depthPresentation(
  quake: Earthquake,
  detail: EarthquakeDetail | null,
): { value: string; note: string | null } {
  if (!detail?.depthKm) {
    return { value: formatDepth(quake.depthKm), note: null };
  }

  if (isFixedDepth(detail)) {
    return {
      value: `${detail.depthKm.value.toFixed(1)} km (fixed)`,
      note: "Depth was assigned by the operator, not determined from the recorded data. IMO fixes depth — usually at 10 km — when the available phases cannot constrain it.",
    };
  }

  return {
    value: formatWithUncertainty(detail.depthKm.value, detail.depthKm.uncertainty, "km"),
    note: null,
  };
}

export function QuakeDetail({
  quake,
  detail,
  detailLoading,
  nowMs,
  onBack,
  onLocate,
}: {
  quake: Earthquake;
  /** Full solution with uncertainties, once it has loaded. */
  detail: EarthquakeDetail | null;
  detailLoading: boolean;
  nowMs: number;
  onBack: () => void;
  onLocate: () => void;
}) {
  const review = reviewLabel(quake);
  const magnitudeType = formatMagnitudeType(quake.magnitudeType);
  const depth = depthPresentation(quake, detail);
  const horizontal = detail ? horizontalUncertaintyKm(detail) : null;
  const confidence =
    detail?.depthKm?.confidenceLevel ?? detail?.latitude?.confidenceLevel ?? null;

  return (
    <section aria-label="Earthquake details" className="animate-fade-rise">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--color-line)] bg-[rgb(9_12_17/0.92)] px-4 py-2.5 backdrop-blur-sm">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1.5 flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-[var(--color-ink-dim)] transition-colors duration-150 hover:bg-white/[0.05] hover:text-[var(--color-ink)]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M7.5 2.5 4 6l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back to activity
        </button>
        <button
          type="button"
          onClick={onLocate}
          className="rounded px-2 py-1 text-[11px] text-[var(--color-ink-dim)] transition-colors duration-150 hover:bg-white/[0.05] hover:text-[var(--color-ink)]"
        >
          Centre on map
        </button>
      </header>

      <div className="px-4 pb-5 pt-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="tnum text-[34px] font-medium leading-none tracking-tight text-[var(--color-ink)]">
            {formatMagnitude(quake.magnitude)}
          </span>
          {detail?.magnitude?.uncertainty != null && (
            <span className="tnum text-[13px] text-[var(--color-ink-muted)]">
              &plusmn; {detail.magnitude.uncertainty.toFixed(2)}
            </span>
          )}
          {magnitudeType && (
            <span className="text-[11px] text-[var(--color-ink-dim)]">{magnitudeType}</span>
          )}
        </div>

        <p className="mt-2 text-[14px] text-[var(--color-ink-muted)]">
          {quake.region ?? "Unnamed area"}
        </p>

        <p className="tnum mt-1 text-[12px] text-[var(--color-ink-dim)]">
          {formatRelativeLong(quake.occurredAt, nowMs)}
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5">
          <Field label="Depth" value={depth.value} title={depth.note ?? undefined} />
          <Field
            label="Status"
            value={
              <span className="flex items-center gap-1.5" title={review.note}>
                {review.text}
              </span>
            }
            title={review.note}
          />
          {horizontal !== null && (
            <Field
              label="Location accuracy"
              value={`\u00B1 ${horizontal.toFixed(1)} km`}
              title="Latitude and longitude uncertainties combined in quadrature, as reported by IMO."
            />
          )}
          {detail?.originTime?.uncertaintySeconds != null && (
            <Field
              label="Time accuracy"
              value={`\u00B1 ${detail.originTime.uncertaintySeconds.toFixed(2)} s`}
            />
          )}
          <div className="col-span-2">
            <Field
              label="Time (Iceland, UTC)"
              value={formatExact(quake.occurredAt)}
              mono
            />
          </div>
          <div className="col-span-2">
            <Field
              label="Coordinates"
              value={formatCoordinates(quake.latitude, quake.longitude)}
              mono
            />
          </div>
          <div className="col-span-2">
            <Field label="Event ID" value={quake.id} mono title={quake.id} />
          </div>
          {quake.eventType && quake.eventType !== "earthquake" && (
            <div className="col-span-2">
              <Field label="Event type" value={quake.eventType} />
            </div>
          )}
          {quake.updatedAt && quake.updatedAt !== quake.occurredAt && (
            <div className="col-span-2">
              <Field label="Solution last revised" value={formatExact(quake.updatedAt)} mono />
            </div>
          )}
        </dl>

        {depth.note && (
          <p className="animate-fade-rise mt-5 rounded border border-[var(--color-line)] bg-white/[0.02] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
            {depth.note}
          </p>
        )}

        <p className="mt-6 border-t border-[var(--color-line)] pt-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
          {review.note}{" "}
          {confidence !== null && (
            <>Uncertainties are quoted at {confidence}% confidence. </>
          )}
          {detailLoading && <>Loading the full solution&hellip; </>}
          Source: Icelandic Meteorological Office.
        </p>
      </div>
    </section>
  );
}
