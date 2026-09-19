"use client";

import { useRef } from "react";
import { TIME_RANGES, TIME_RANGE_IDS, type TimeRangeId } from "@/domain/time-range";
import { cn } from "@/lib/format";

/**
 * The window selector.
 *
 * Implemented as a radiogroup with roving tabindex rather than a row of
 * buttons: it is a single choice from a set, so arrow keys should move between
 * options and Tab should skip past the whole group.
 */
export function RangeControl({
  value,
  onChange,
  className,
}: {
  value: TimeRangeId;
  onChange: (range: TimeRangeId) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (delta === 0) return;

    event.preventDefault();
    const index = TIME_RANGE_IDS.indexOf(value);
    const next = TIME_RANGE_IDS[(index + delta + TIME_RANGE_IDS.length) % TIME_RANGE_IDS.length];
    if (!next) return;
    onChange(next);
    containerRef.current?.querySelector<HTMLButtonElement>(`[data-range="${next}"]`)?.focus();
  };

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label="Time range"
      onKeyDown={onKeyDown}
      className={cn(
        "flex items-center gap-0.5 rounded-md border border-[var(--color-line)] bg-white/[0.03] p-0.5",
        className,
      )}
    >
      {TIME_RANGE_IDS.map((id) => {
        const selected = id === value;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            data-range={id}
            aria-checked={selected}
            aria-label={`Show ${TIME_RANGES[id].phrase.replace("the last ", "the last ")}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            className={cn(
              // min-h-11 on touch screens: these are the most-used controls in
              // the interface and need to be reachable with a thumb.
              "tnum relative flex min-h-11 min-w-[44px] items-center justify-center rounded px-2.5 text-[12px] font-medium tracking-wide transition-colors duration-150 lg:min-h-8 lg:min-w-[38px] lg:text-[11px]",
              selected
                ? "bg-white/[0.11] text-[var(--color-ink)]"
                : "text-[var(--color-ink-dim)] hover:bg-white/[0.05] hover:text-[var(--color-ink-muted)]",
            )}
          >
            {TIME_RANGES[id].label}
          </button>
        );
      })}
    </div>
  );
}
