"use client";

import { useMemo, useState } from "react";
import type { RegionTally } from "@/analytics/stats";
import { cn, formatCount, formatMagnitudeValue } from "@/lib/format";
import { formatRelative } from "@/lib/time";

/**
 * Where Iceland is busy right now.
 *
 * Region counts already existed internally, used only to pick a name for the
 * summary sentence. Exposed as a list — with each region's rate against its own
 * year — they answer a question the map cannot: not "where are the dots" but
 * "which of these places is unusual for itself". A hundred events at
 * Kleifarvatn is a Tuesday; twenty at Öræfajökull is not.
 *
 * Sorting by "unusual" is the reason this exists, so that is the default.
 */

export type RegionSort = "unusual" | "count" | "largest";

const SORTS: Array<{ id: RegionSort; label: string; description: string }> = [
  { id: "unusual", label: "Unusual", description: "Highest rate against the region's own year" },
  { id: "count", label: "Count", description: "Most events in this window" },
  { id: "largest", label: "Largest", description: "Highest magnitude" },
];

/** How many regions to list. Beyond this the tail is single-event noise. */
const LIMIT = 12;

function sortRegions(regions: readonly RegionTally[], sort: RegionSort): RegionTally[] {
  const list = [...regions];
  switch (sort) {
    case "unusual":
      // Regions with no comparison sort below those that have one, rather than
      // being treated as a ratio of zero.
      return list.sort(
        (a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.count - a.count,
      );
    case "largest":
      return list.sort(
        (a, b) =>
          (b.largestMagnitude ?? -Infinity) - (a.largestMagnitude ?? -Infinity) ||
          b.count - a.count,
      );
    case "count":
    default:
      return list.sort((a, b) => b.count - a.count);
  }
}

/** `9.6×`, or null when there is no comparison to show. */
function formatRatio(ratio: number | undefined): string | null {
  if (ratio === undefined) return null;
  if (ratio >= 10) return `${Math.round(ratio)}×`;
  const rounded = Math.round(ratio * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}×`;
}

/** Colour cue for how far from ordinary a region is. Deliberately restrained. */
function ratioTone(ratio: number | undefined): string {
  if (ratio === undefined) return "text-[var(--color-ink-faint)]";
  if (ratio >= 5) return "text-[var(--color-quake-now)]";
  if (ratio >= 2) return "text-[var(--color-quake-recent)]";
  return "text-[var(--color-ink-dim)]";
}

export function RegionList({
  regions,
  nowMs,
  onSelect,
}: {
  regions: readonly RegionTally[];
  nowMs: number;
  /** Frames the region's events on the map. */
  onSelect: (region: RegionTally) => void;
}) {
  const [sort, setSort] = useState<RegionSort>("unusual");
  const sorted = useMemo(() => sortRegions(regions, sort).slice(0, LIMIT), [regions, sort]);

  if (regions.length === 0) return null;

  return (
    <section aria-label="Activity by region" className="border-t border-[var(--color-line)]">
      <header className="flex items-center justify-between gap-3 px-4 pb-1 pt-3">
        <h2 className="label">
          By region
          <span className="tnum ml-2 text-[var(--color-ink-faint)]">{regions.length}</span>
        </h2>
        <div role="radiogroup" aria-label="Sort regions" className="flex items-center gap-0.5">
          {SORTS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={sort === option.id}
              title={option.description}
              onClick={() => setSort(option.id)}
              className={cn(
                "flex min-h-9 items-center rounded px-2.5 text-[11px] transition-colors duration-150 lg:min-h-7 lg:px-2",
                sort === option.id
                  ? "bg-white/[0.1] text-[var(--color-ink)]"
                  : "text-[var(--color-ink-dim)] hover:bg-white/[0.05] hover:text-[var(--color-ink-muted)]",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
        {sorted.map((region) => {
          const ratio = formatRatio(region.ratio);
          return (
            <li key={region.region}>
              <button
                type="button"
                onClick={() => onSelect(region)}
                className="row-button flex items-center gap-3 px-4 py-2.5"
              >
                <span className="tnum w-11 shrink-0 text-right text-[13px] font-medium leading-none text-[var(--color-ink)]">
                  {formatCount(region.count)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-tight text-[var(--color-ink)]">
                    {region.region}
                  </span>
                  <span className="tnum mt-0.5 block text-[11px] leading-tight text-[var(--color-ink-dim)]">
                    {region.largestMagnitude !== null && (
                      <>
                        max M {formatMagnitudeValue(region.largestMagnitude)}
                        <span className="px-1.5 text-[var(--color-ink-faint)]">·</span>
                      </>
                    )}
                    {region.latestAt ? formatRelative(region.latestAt, nowMs) : "—"}
                  </span>
                </span>
                <span
                  className={cn("tnum shrink-0 text-[12px] font-medium", ratioTone(region.ratio))}
                  title={
                    ratio
                      ? `${ratio} this region's average daily rate over the past year`
                      : "Not enough history for a comparison"
                  }
                >
                  {ratio ?? "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="border-t border-[var(--color-line)] px-4 py-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
        The right-hand figure is this window&rsquo;s rate against that region&rsquo;s own average
        over the past year. A dash means too little history to compare. Regions are
        IMO&rsquo;s own seismic areas.
      </p>
    </section>
  );
}
