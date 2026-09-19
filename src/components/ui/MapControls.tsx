"use client";

import { MAP_FOCUSES, type MapFocus } from "@/lib/geo";
import type { LavaFlowProperties } from "@/domain/reykjanes";

/** "16 Jul - 5 Aug 2025", collapsing a repeated month or year. */
function formatEruptionDates(flow: LavaFlowProperties): string {
  const format = (iso: string, withYear: boolean) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    });

  if (!flow.startedAt) return flow.endedAt ? `ended ${format(flow.endedAt, true)}` : "dates unknown";
  if (!flow.endedAt) return `from ${format(flow.startedAt, true)}`;
  if (flow.startedAt === flow.endedAt) return format(flow.endedAt, true);

  const sameYear = flow.startedAt.slice(0, 4) === flow.endedAt.slice(0, 4);
  return `${format(flow.startedAt, !sameYear)} \u2013 ${format(flow.endedAt, true)}`;
}
import { cn } from "@/lib/format";

/**
 * What the Reykjanes layer draws, and where each part comes from.
 *
 * Worth stating explicitly: the lava outlines are surveys of eruptions that
 * have ended, not a live flow front. The barriers are the one feature drawn
 * brightly, because they are the built structures a reader is most likely to
 * be looking for.
 */
function ReykjanesLegend({ latestEruption }: { latestEruption: LavaFlowProperties | null }) {
  const items: Array<[swatch: React.ReactNode, label: string]> = [
    [<span key="l" className="h-2 w-3 rounded-[2px]" style={{ backgroundColor: "#4a2418", border: "1px solid #8a4a30" }} />, "Lava, 2021-2025 eruptions"],
    [<span key="b" className="h-[2px] w-3 rounded-full" style={{ backgroundColor: "#d8dee8" }} />, "Lava barriers"],
    [<span key="g" className="h-[2px] w-3 rounded-full" style={{ backgroundImage: "repeating-linear-gradient(90deg,#6f8296 0 3px,transparent 3px 5px)" }} />, "Grindavik graben"],
    [<span key="f" className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#8fa3bd" }} />, "Geothermal plants"],
  ];

  return (
    /*
      Legends are desktop-only. On a phone this key would cover a third of the
      map to explain four line styles that are largely self-evident on screen,
      and the map is the thing people came for.
    */
    <div className="panel animate-fade-rise hidden w-[196px] rounded-md px-3 py-2.5 lg:block">
      <p className="label">Reykjanes detail</p>
      <ul className="mt-2 space-y-1.5">
        {items.map(([swatch, label]) => (
          <li key={label} className="flex items-center gap-2">
            <span aria-hidden="true" className="flex w-3 shrink-0 justify-center">
              {swatch}
            </span>
            <span className="text-[11px] leading-tight text-[var(--color-ink-muted)]">{label}</span>
          </li>
        ))}
      </ul>
      {latestEruption && (
        <div className="mt-2 border-t border-[var(--color-line)] pt-2">
          <p className="label">Most recent eruption</p>
          <p className="mt-1 text-[11px] leading-tight text-[var(--color-ink)]">
            {latestEruption.name}
          </p>
          <p className="tnum mt-0.5 text-[10px] leading-relaxed text-[var(--color-ink-dim)]">
            {formatEruptionDates(latestEruption)}
            {latestEruption.areaKm2 !== null && (
              <>
                <span className="px-1 text-[var(--color-ink-faint)]">&middot;</span>
                {latestEruption.areaKm2} km&sup2;
              </>
            )}
            {latestEruption.volumeKm3 !== null && (
              <>
                <span className="px-1 text-[var(--color-ink-faint)]">&middot;</span>
                {latestEruption.volumeKm3} km&sup3;
              </>
            )}
          </p>
        </div>
      )}

      <p className="mt-2 border-t border-[var(--color-line)] pt-2 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
        Surveyed outlines of eruptions that have ended, not a live flow front.
        N&aacute;tt&uacute;rufr&aelig;&eth;istofnun, Landm&aelig;lingar &Iacute;slands, IMO and Orkustofnun.
      </p>
    </div>
  );
}

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
type LayerToggleProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  available: boolean;
  loading?: boolean;
  title: string;
  dotColour: string;
};

function LayerToggle({
  label,
  checked,
  onChange,
  available,
  loading,
  title,
  dotColour,
}: LayerToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={!available}
      onClick={() => onChange(!checked)}
      title={title}
      className={cn(
        "panel flex w-full items-center gap-2 rounded-md px-3 py-2 text-[11px] font-medium transition-colors duration-150",
        checked ? "text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]",
        available ? "hover:bg-white/[0.06] hover:text-[var(--color-ink)]" : "cursor-not-allowed opacity-45",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-150",
          loading && "animate-breathe",
        )}
        style={{ backgroundColor: checked || loading ? dotColour : "rgb(255 255 255 / 0.2)" }}
      />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

export function MapControls({
  onFocus,
  showVolcanoes,
  onToggleVolcanoes,
  volcanoesAvailable,
  showReykjanes,
  onToggleReykjanes,
  reykjanesAvailable,
  reykjanesLoading,
  latestEruption,
  className,
}: {
  onFocus: (focus: MapFocus) => void;
  showVolcanoes: boolean;
  onToggleVolcanoes: (show: boolean) => void;
  volcanoesAvailable: boolean;
  showReykjanes: boolean;
  onToggleReykjanes: (show: boolean) => void;
  reykjanesAvailable: boolean;
  reykjanesLoading: boolean;
  /** Newest mapped lava flow, shown in the Reykjanes legend. */
  latestEruption: LavaFlowProperties | null;
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
        <div className="panel animate-fade-rise hidden w-[196px] rounded-md px-3 py-2.5 lg:block">
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

      {showReykjanes && reykjanesAvailable && (
        <ReykjanesLegend latestEruption={latestEruption} />
      )}

      <div className="flex w-auto flex-col gap-1.5 lg:w-[196px]">
        <LayerToggle
          label="Volcanic systems"
          checked={showVolcanoes}
          onChange={onToggleVolcanoes}
          available={volcanoesAvailable}
          dotColour="var(--color-volcano)"
          title={
            volcanoesAvailable
              ? "Volcanic system outlines from the Catalogue of Icelandic Volcanoes, with each system's official IMO aviation colour code"
              : "Volcanic system data is not available right now"
          }
        />
        <LayerToggle
          label="Reykjanes detail"
          checked={showReykjanes}
          onChange={onToggleReykjanes}
          available={reykjanesAvailable}
          loading={reykjanesLoading}
          dotColour="#d8dee8"
          title={
            reykjanesAvailable
              ? "Lava from the 2021-2025 eruptions, the lava barriers protecting Grindavik and Svartsengi, and the Grindavik graben"
              : "Reykjanes map layers are not available right now"
          }
        />
      </div>
    </div>
  );
}
