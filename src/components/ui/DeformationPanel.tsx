"use client";

import { spanDays, type Interferogram } from "@/domain/deformation";
import { cn } from "@/lib/format";

/**
 * IMO's published interferograms.
 *
 * ## What this shows, and what it deliberately does not
 *
 * An interferogram is a finished IMO product: two radar acquisitions differenced
 * to show how the ground moved between them. We list them and lay the published
 * image over the map. We do not measure anything from it, do not quote
 * centimetres, and do not say what the movement means.
 *
 * There is no GNSS time series here because IMO does not publish one through
 * this API — only station metadata and raw observation files. Deriving
 * displacements from those requires geodetic processing that this project has
 * no business doing and presenting as fact.
 */

const MAX_LISTED = 6;

/** "ascending" -> "asc. orbit", which fits the row without abbreviating to noise. */
function formatOrbit(direction: string): string {
  if (direction === "ascending") return "asc. orbit";
  if (direction === "descending") return "desc. orbit";
  return direction;
}

function InterferogramRow({
  item,
  selected,
  onSelect,
}: {
  item: Interferogram;
  selected: boolean;
  onSelect: (item: Interferogram) => void;
}) {
  const days = spanDays(item);

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item)}
        aria-pressed={selected}
        className="row-button flex items-center gap-3 px-4 py-2.5"
        aria-current={selected}
      >
        <span
          aria-hidden="true"
          className={cn(
            "h-7 w-[2px] shrink-0 rounded-full",
            selected ? "bg-[#8ab4f8]" : "bg-white/12",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-tight text-[var(--color-ink)]">
            {item.focusArea}
          </span>
          <span className="tnum mt-0.5 block text-[11px] leading-tight text-[var(--color-ink-dim)]">
            {item.startDate} &rarr; {item.endDate}
            <span className="px-1.5 text-[var(--color-ink-faint)]">&middot;</span>
            {days} {days === 1 ? "day" : "days"}
          </span>
          <span className="mt-0.5 block text-[11px] leading-tight text-[var(--color-ink-faint)]">
            {item.satellite}
            <span className="px-1.5">&middot;</span>
            {/*
              Orbit direction is not a detail: the same pair of dates is often
              published twice, once per look direction, and each is sensitive to
              different ground motion. Without it two rows are indistinguishable.
            */}
            {formatOrbit(item.orbitDirection)}
          </span>
        </span>
        {selected && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-[#8ab4f8]">
            On map
          </span>
        )}
      </button>
    </li>
  );
}

export function DeformationPanel({
  interferograms,
  selectedId,
  onSelect,
  onClear,
  loading,
  unavailable,
}: {
  interferograms: readonly Interferogram[];
  selectedId: string | null;
  onSelect: (item: Interferogram) => void;
  onClear: () => void;
  loading: boolean;
  unavailable: boolean;
}) {
  const listed = interferograms.slice(0, MAX_LISTED);

  return (
    <section aria-label="Ground deformation" className="border-t border-[var(--color-line)]">
      <div className="flex items-baseline justify-between gap-2 px-4 pb-1 pt-3">
        <h2 className="label">Ground deformation</h2>
        {selectedId && (
          <button
            type="button"
            onClick={onClear}
            className="rounded px-1 text-[10px] text-[var(--color-ink-dim)] underline-offset-2 transition-colors hover:text-[var(--color-ink)] hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      {loading && (
        <p className="px-4 pb-3 text-[11px] text-[var(--color-ink-dim)]">
          Loading interferograms&hellip;
        </p>
      )}

      {unavailable && (
        <p className="px-4 pb-3 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
          Deformation products could not be loaded.
        </p>
      )}

      {!loading && !unavailable && listed.length === 0 && (
        <p className="px-4 pb-3 text-[11px] text-[var(--color-ink-dim)]">
          No published interferograms.
        </p>
      )}

      {listed.length > 0 && (
        <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
          {listed.map((item) => (
            <InterferogramRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}

      <p className="border-t border-[var(--color-line)] px-4 py-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
        Satellite radar interferograms published by IMO. Each colour cycle is one
        fringe of movement along the satellite&rsquo;s line of sight between the two
        dates. We show IMO&rsquo;s image as published and measure nothing from it.
        IMO publishes no GNSS displacement series through this API, so the station
        layer shows instrument locations only.
      </p>
    </section>
  );
}
