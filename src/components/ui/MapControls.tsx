"use client";

import { MAP_FOCUSES, type MapFocus } from "@/lib/geo";
import { cn } from "@/lib/format";

/**
 * The official ICAO aviation colour codes, with IMO's own wording.
 *
 * Shown in their published colours and labelled as IMO's, so a reader can never
 * mistake an official assessment for one of our statistical observations.
 */
const AVIATION_LEGEND: Array<[colour: string, label: string]> = [
  ["#3fb27f", "Green — normal, non-eruptive"],
  ["#e8c34a", "Yellow — signs of elevated unrest"],
  ["#e8913c", "Orange — heightened unrest or minor eruption"],
  ["#e2564a", "Red — eruption imminent or under way"],
];

/**
 * Quick-focus viewpoints and layer toggles.
 *
 * The focus list comes from `MAP_FOCUSES`, so adding Svartsengi, Sundhnúkur or
 * Grindavík later is a one-line change there rather than a change here.
 */
export function MapControls({
  onFocus,
  showVolcanoes,
  onToggleVolcanoes,
  volcanoesAvailable,
  className,
}: {
  onFocus: (focus: MapFocus) => void;
  showVolcanoes: boolean;
  onToggleVolcanoes: (show: boolean) => void;
  volcanoesAvailable: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-end gap-1.5", className)}>
      <div className="panel flex overflow-hidden rounded-md">
        {MAP_FOCUSES.map((focus, index) => (
          <button
            key={focus.id}
            type="button"
            onClick={() => onFocus(focus)}
            title={focus.description}
            className={cn(
              "px-3 py-2 text-[11px] font-medium text-[var(--color-ink-muted)] transition-colors duration-150 hover:bg-white/[0.06] hover:text-[var(--color-ink)]",
              index > 0 && "border-l border-[var(--color-line)]",
            )}
          >
            {focus.label}
          </button>
        ))}
      </div>

      {showVolcanoes && volcanoesAvailable && (
        <div className="panel animate-fade-rise w-[196px] rounded-md px-3 py-2.5">
          <p className="label">IMO aviation colour code</p>
          <ul className="mt-2 space-y-1">
            {AVIATION_LEGEND.map(([colour, label]) => (
              <li key={colour} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: colour }}
                />
                <span className="text-[11px] leading-tight text-[var(--color-ink-muted)]">
                  {label}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-[var(--color-line)] pt-2 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
            Issued by the Icelandic Meteorological Office. Lines are volcanic system
            outlines from the Catalogue of Icelandic Volcanoes.
          </p>
        </div>
      )}

      <button
        type="button"
        role="switch"
        aria-checked={showVolcanoes}
        disabled={!volcanoesAvailable}
        onClick={() => onToggleVolcanoes(!showVolcanoes)}
        title={
          volcanoesAvailable
            ? "Volcanic system outlines from the Catalogue of Icelandic Volcanoes, with each system's official IMO aviation colour code"
            : "Volcanic system data is not available right now"
        }
        className={cn(
          "panel flex items-center gap-2 rounded-md px-3 py-2 text-[11px] font-medium transition-colors duration-150",
          showVolcanoes
            ? "text-[var(--color-ink)]"
            : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
          volcanoesAvailable ? "hover:bg-white/[0.06]" : "cursor-not-allowed opacity-45",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 rounded-full transition-colors duration-150",
            showVolcanoes ? "bg-[var(--color-volcano)]" : "bg-white/20",
          )}
        />
        Volcanic systems
      </button>
    </div>
  );
}
