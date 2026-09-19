"use client";

import type { EarthquakeStats } from "@/analytics/stats";
import { TIME_RANGES, type TimeRangeId } from "@/domain/time-range";
import { formatCount, formatDepth, formatMagnitude } from "@/lib/format";
import { formatRelative } from "@/lib/time";

type StatTileProps = {
  label: string;
  value: string;
  /** Secondary line: a place, a unit, a qualifier. */
  hint?: string | null;
  /** Called when the tile refers to an event the map can show. */
  onClick?: () => void;
  title?: string;
};

function StatTile({ label, value, hint, onClick, title }: StatTileProps) {
  const content = (
    <>
      <div className="label">{label}</div>
      <div className="tnum mt-1.5 text-[19px] font-medium leading-none tracking-tight text-[var(--color-ink)] sm:text-[21px]">
        {value}
      </div>
      <div className="mt-1 truncate text-[11px] leading-none text-[var(--color-ink-dim)]">
        {hint ?? " "}
      </div>
    </>
  );

  if (!onClick) {
    return <div className="min-w-[88px] shrink-0 px-3.5 first:pl-0">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="min-w-[88px] shrink-0 rounded-md px-3.5 py-1 text-left transition-colors duration-150 hover:bg-white/[0.05] first:pl-0"
    >
      {content}
    </button>
  );
}

/**
 * The headline numbers.
 *
 * Every value is computed from the events currently in the window — nothing
 * here is a running total or carried over from another range.
 */
export function StatBar({
  stats,
  range,
  nowMs,
  onFocusEvent,
}: {
  stats: EarthquakeStats;
  range: TimeRangeId;
  nowMs: number;
  onFocusEvent: (eventId: string) => void;
}) {
  const { largest, deepest, latest } = stats;

  return (
    /*
      The strip scrolls on a narrow screen rather than shrinking the numbers to
      fit. The mask fades the trailing edge so it is visibly cut off rather than
      looking like the row simply ends there.
    */
    <div className="relative">
      <div
        className="flex items-start divide-x divide-[var(--color-line)] overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] [scrollbar-width:none] lg:[mask-image:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label={`Summary statistics for ${TIME_RANGES[range].phrase}`}
      >
      <StatTile
        label="Earthquakes"
        value={formatCount(stats.count)}
        hint={TIME_RANGES[range].statSuffix}
      />
      <StatTile
        label="Largest"
        value={largest ? formatMagnitude(largest.magnitude) : "—"}
        hint={largest?.region ?? (stats.count > 0 ? "no magnitude" : null)}
        onClick={largest ? () => onFocusEvent(largest.id) : undefined}
        title={largest ? "Show this event on the map" : undefined}
      />
      <StatTile
        label="Deepest"
        value={deepest ? formatDepth(deepest.depthKm) : "—"}
        hint={deepest?.region ?? null}
        onClick={deepest ? () => onFocusEvent(deepest.id) : undefined}
        title={deepest ? "Show this event on the map" : undefined}
      />
      <StatTile
        label="Latest"
        value={latest ? formatRelative(latest.occurredAt, nowMs) : "—"}
        hint={latest?.region ?? null}
        onClick={latest ? () => onFocusEvent(latest.id) : undefined}
        title={latest ? "Show this event on the map" : undefined}
      />
      </div>
    </div>
  );
}
