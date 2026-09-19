"use client";

import { useMemo, useState } from "react";
import type { Earthquake } from "@/domain/earthquake";
import { cn, formatDepth, formatMagnitudeValue } from "@/lib/format";
import { formatDayClock } from "@/lib/time";

/**
 * Depth against time for a set of events.
 *
 * Depth is on every event in the catalogue and until now only the single
 * deepest was ever reported. Plotted against time it shows something the map
 * cannot: whether a cluster is confined to one level or spans the crust, and
 * whether that changed over the episode.
 *
 * Deliberately descriptive. Migration of depth over time is a thing people read
 * a great deal into, so this draws the measurements and says nothing about
 * them — the axis labels and the events are the whole content.
 *
 * Events whose depth IMO fixed rather than measured are drawn hollow. A fixed
 * depth is a placeholder, usually 10 km, and letting it sit among measured
 * values as a solid dot would invent a horizontal band that is an artefact of
 * the processing rather than a feature of the crust.
 */

const HEIGHT = 132;
const PAD_LEFT = 30;
const PAD_RIGHT = 6;
const PAD_TOP = 8;
const PAD_BOTTOM = 18;

/** IMO's convention when depth cannot be constrained. */
const FIXED_DEPTH_KM = 10;

/**
 * Whether this event's depth looks assigned rather than measured.
 *
 * The bulk catalogue carries no `depthType`, so this is inferred from the value
 * being exactly the convention. It is a presentational hint only — the detail
 * panel gets the real answer from the per-event endpoint.
 */
function looksFixed(quake: Earthquake): boolean {
  return quake.depthKm === FIXED_DEPTH_KM;
}

function magnitudeRadius(magnitude: number | null): number {
  if (magnitude === null) return 1.6;
  return Math.max(1.5, Math.min(7, 1.8 + Math.max(0, magnitude + 1) * 1.3));
}

export function DepthProfile({
  quakes,
  onSelect,
  selectedId,
  className,
}: {
  quakes: readonly Earthquake[];
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  className?: string;
}) {
  const [hovered, setHovered] = useState<Earthquake | null>(null);

  const points = useMemo(() => {
    const usable = quakes.filter(
      (quake) => quake.depthKm !== null && Number.isFinite(Date.parse(quake.occurredAt)),
    );
    if (usable.length === 0) return null;

    const times = usable.map((quake) => Date.parse(quake.occurredAt));
    const depths = usable.map((quake) => quake.depthKm as number);

    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    // A single instant would divide by zero; give it a nominal hour.
    const timeSpan = maxTime - minTime || 3_600_000;
    // Always start the depth axis at the surface: a cluster 4–6 km down should
    // look deep, not fill the panel because the axis was cropped to fit it.
    const maxDepth = Math.max(2, Math.ceil(Math.max(...depths)));

    return { usable, minTime, timeSpan, maxDepth };
  }, [quakes]);

  if (!points) {
    return (
      <p className={cn("text-[11px] text-[var(--color-ink-dim)]", className)}>
        No depth measurements in this group.
      </p>
    );
  }

  const { usable, minTime, timeSpan, maxDepth } = points;
  // A viewBox keeps the chart resolution-independent without measuring width.
  const WIDTH = 320;
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const x = (time: number) => PAD_LEFT + ((time - minTime) / timeSpan) * plotWidth;
  const y = (depth: number) => PAD_TOP + (depth / maxDepth) * plotHeight;

  const depthTicks = [0, maxDepth / 2, maxDepth];

  return (
    <div className={cn("select-none", className)}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="label">Depth over time</span>
        <span className="tnum text-[10px] text-[var(--color-ink-dim)]">
          {hovered ? (
            <>
              M {formatMagnitudeValue(hovered.magnitude)}
              <span className="px-1 text-[var(--color-ink-faint)]">·</span>
              {formatDepth(hovered.depthKm)}
              <span className="px-1 text-[var(--color-ink-faint)]">·</span>
              {formatDayClock(hovered.occurredAt)}
            </>
          ) : (
            <>{usable.length} events with depth</>
          )}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full overflow-visible"
        role="img"
        aria-label={`Depth against time for ${usable.length} earthquakes, from the surface to ${maxDepth} kilometres.`}
        onMouseLeave={() => setHovered(null)}
      >
        {depthTicks.map((depth) => (
          <g key={depth}>
            <line
              x1={PAD_LEFT}
              y1={y(depth)}
              x2={WIDTH - PAD_RIGHT}
              y2={y(depth)}
              stroke="var(--color-line)"
              strokeWidth={0.5}
            />
            <text
              x={PAD_LEFT - 5}
              y={y(depth) + 3}
              textAnchor="end"
              fontSize={8}
              fill="var(--color-ink-faint)"
              className="tnum"
            >
              {Math.round(depth)}
            </text>
          </g>
        ))}
        <text
          x={2}
          y={PAD_TOP + plotHeight / 2}
          fontSize={8}
          fill="var(--color-ink-faint)"
          transform={`rotate(-90 2 ${PAD_TOP + plotHeight / 2})`}
          textAnchor="middle"
        >
          km
        </text>

        {usable.map((quake) => {
          const fixed = looksFixed(quake);
          const selected = quake.id === selectedId;
          const cx = x(Date.parse(quake.occurredAt));
          const cy = y(quake.depthKm as number);
          const r = magnitudeRadius(quake.magnitude);

          return (
            <circle
              key={quake.id}
              cx={cx}
              cy={cy}
              r={r}
              fill={fixed ? "none" : selected ? "#ffffff" : "var(--color-quake-recent)"}
              fillOpacity={fixed ? 0 : selected ? 1 : 0.55}
              stroke={selected ? "#ffffff" : "var(--color-quake-recent)"}
              strokeWidth={fixed ? 0.8 : selected ? 1.2 : 0}
              strokeOpacity={fixed ? 0.7 : 1}
              className={onSelect ? "cursor-pointer" : undefined}
              onMouseEnter={() => setHovered(quake)}
              onClick={() => onSelect?.(quake.id)}
            />
          );
        })}

        <text x={PAD_LEFT} y={HEIGHT - 5} fontSize={8} fill="var(--color-ink-faint)" className="tnum">
          {formatDayClock(minTime)}
        </text>
        <text
          x={WIDTH - PAD_RIGHT}
          y={HEIGHT - 5}
          textAnchor="end"
          fontSize={8}
          fill="var(--color-ink-faint)"
          className="tnum"
        >
          {formatDayClock(minTime + timeSpan)}
        </text>
      </svg>

      {usable.some(looksFixed) && (
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
          Hollow points sit at exactly {FIXED_DEPTH_KM} km, the value IMO assigns when depth
          cannot be determined from the data.
        </p>
      )}
    </div>
  );
}
