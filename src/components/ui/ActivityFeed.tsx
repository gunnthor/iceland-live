"use client";

import { useMemo } from "react";
import type { Earthquake } from "@/domain/earthquake";
import { cn, formatDepth, formatMagnitudeValue } from "@/lib/format";
import { formatRelative } from "@/lib/time";
import { EmptyState } from "./States";

export type FeedSort = "newest" | "magnitude" | "depth";

export const FEED_SORTS: Array<{ id: FeedSort; label: string; description: string }> = [
  { id: "newest", label: "Newest", description: "Most recent first" },
  { id: "magnitude", label: "Magnitude", description: "Largest first" },
  { id: "depth", label: "Depth", description: "Deepest first" },
];

/**
 * How many events the feed renders.
 *
 * A 30-day window holds a few thousand events; rendering them all would cost
 * more than it is worth when nobody scrolls past the first hundred. The map
 * still shows every event, and the count in the header states the true total.
 */
export const FEED_LIMIT = 150;

export function sortQuakes(quakes: readonly Earthquake[], sort: FeedSort): Earthquake[] {
  const sorted = [...quakes];
  switch (sort) {
    case "magnitude":
      // Events without a magnitude sort last rather than as if they were zero.
      return sorted.sort(
        (a, b) => (b.magnitude ?? -Infinity) - (a.magnitude ?? -Infinity),
      );
    case "depth":
      return sorted.sort((a, b) => (b.depthKm ?? -Infinity) - (a.depthKm ?? -Infinity));
    case "newest":
    default:
      return sorted.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
}

/** Colour band by magnitude, used for the leading rule on each row. */
function magnitudeTone(magnitude: number | null): string {
  if (magnitude === null) return "bg-white/10";
  if (magnitude >= 3) return "bg-[var(--color-quake-now)]";
  if (magnitude >= 2) return "bg-[var(--color-quake-recent)]";
  if (magnitude >= 1) return "bg-white/25";
  return "bg-white/12";
}

function FeedRow({
  quake,
  selected,
  nowMs,
  onSelect,
}: {
  quake: Earthquake;
  selected: boolean;
  nowMs: number;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(quake.id)}
        aria-current={selected}
        className="row-button group flex items-center gap-3 px-4 py-2.5"
      >
        <span
          aria-hidden="true"
          className={cn("h-7 w-[2px] shrink-0 rounded-full", magnitudeTone(quake.magnitude))}
        />
        <span className="tnum w-[42px] shrink-0 text-[15px] font-medium leading-none text-[var(--color-ink)]">
          {formatMagnitudeValue(quake.magnitude)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-tight text-[var(--color-ink)]">
            {quake.region ?? "Unnamed area"}
          </span>
          <span className="tnum mt-0.5 block text-[11px] leading-tight text-[var(--color-ink-dim)]">
            {formatRelative(quake.occurredAt, nowMs)}
            <span className="px-1.5 text-[var(--color-ink-faint)]">·</span>
            {formatDepth(quake.depthKm)}
            {quake.reviewStatus === "automatic" && (
              <>
                <span className="px-1.5 text-[var(--color-ink-faint)]">·</span>
                <span title="Automatic solution, not yet reviewed by a seismologist">auto</span>
              </>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

export function ActivityFeed({
  quakes,
  sort,
  onSortChange,
  selectedId,
  nowMs,
  onSelect,
  onWiden,
}: {
  quakes: readonly Earthquake[];
  sort: FeedSort;
  onSortChange: (sort: FeedSort) => void;
  selectedId: string | null;
  nowMs: number;
  onSelect: (id: string) => void;
  /** Offered when the window is empty; absent on the widest range. */
  onWiden?: () => void;
}) {
  const sorted = useMemo(() => sortQuakes(quakes, sort).slice(0, FEED_LIMIT), [quakes, sort]);
  const truncated = quakes.length > FEED_LIMIT;

  return (
    <section aria-label="Recent earthquakes" className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--color-line)] bg-[rgb(9_12_17/0.92)] px-4 py-2.5 backdrop-blur-sm">
        <h2 className="label">
          Activity
          {quakes.length > 0 && (
            <span className="tnum ml-2 text-[var(--color-ink-faint)]">{quakes.length}</span>
          )}
        </h2>
        <div
          role="radiogroup"
          aria-label="Sort earthquakes"
          className="flex items-center gap-0.5"
        >
          {FEED_SORTS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={sort === option.id}
              title={option.description}
              onClick={() => onSortChange(option.id)}
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

      {sorted.length === 0 ? (
        <EmptyState
          title="No earthquakes in this window"
          body="Quiet periods are normal. Try a longer range to see recent activity."
          action={onWiden ? { label: "Widen the range", onClick: onWiden } : undefined}
        />
      ) : (
        <>
          <ul className="divide-y divide-[var(--color-line)]">
            {sorted.map((quake) => (
              <FeedRow
                key={quake.id}
                quake={quake}
                selected={quake.id === selectedId}
                nowMs={nowMs}
                onSelect={onSelect}
              />
            ))}
          </ul>
          {truncated && (
            <p className="border-t border-[var(--color-line)] px-4 py-3 text-[11px] text-[var(--color-ink-faint)]">
              Showing the first {FEED_LIMIT} of {quakes.length.toLocaleString("en-GB")}. All events
              are plotted on the map.
            </p>
          )}
        </>
      )}
    </section>
  );
}
