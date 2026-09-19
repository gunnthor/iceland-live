"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Histogram, TimeBin } from "@/analytics/histogram";
import type { Earthquake } from "@/domain/earthquake";
import type { TimeRangeId } from "@/domain/time-range";
import { cn, formatCount, formatMagnitudeValue } from "@/lib/format";
import { formatClock, formatDay, formatDayClock } from "@/lib/time";

/**
 * Activity over the selected window.
 *
 * Bar height is the event count, on a linear scale — a histogram that
 * compresses its own axis is a histogram that lies, so the peak is labelled and
 * everything is measured against it.
 *
 * Bar colour is the largest magnitude in that bin. Counts tell you how busy a
 * period was; colour tells you whether any of it mattered, which a count alone
 * cannot. A bin of forty M0 events and a bin holding one M3.4 are different
 * facts and should not look the same.
 *
 * Selecting a bar selects the largest event inside it.
 */

const HEIGHT = 74;
const AXIS_HEIGHT = 16;

function barColour(maxMagnitude: number | null): string {
  if (maxMagnitude === null) return "var(--color-quake-old)";
  if (maxMagnitude >= 3) return "var(--color-quake-now)";
  if (maxMagnitude >= 2) return "var(--color-quake-recent)";
  if (maxMagnitude >= 1) return "#7d8797";
  return "#525c6b";
}

/** Axis ticks: roughly one label per 120px, snapped to bin boundaries. */
function tickIndices(binCount: number, width: number): number[] {
  const target = Math.max(2, Math.floor(width / 120));
  const step = Math.max(1, Math.round(binCount / target));
  const ticks: number[] = [];
  for (let i = 0; i < binCount; i += step) ticks.push(i);
  return ticks;
}

function formatTick(ms: number, range: TimeRangeId): string {
  if (range === "30d") return formatDay(ms);
  if (range === "7d") return formatDayClock(ms);
  return formatClock(ms);
}

export function Timeline({
  histogram,
  quakes,
  range,
  selectedId,
  onSelect,
  className,
}: {
  histogram: Histogram;
  quakes: readonly Earthquake[];
  range: TimeRangeId;
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const bins = histogram.bins;
  const peak = Math.max(1, histogram.peakCount);

  /** Index of the largest-magnitude event in each bin, for selection. */
  const largestPerBin = useMemo(() => {
    const result = new Map<number, Earthquake>();
    for (const quake of quakes) {
      const at = Date.parse(quake.occurredAt);
      if (!Number.isFinite(at) || at < histogram.fromMs || at >= histogram.toMs) continue;
      const index = Math.min(
        bins.length - 1,
        Math.floor((at - histogram.fromMs) / histogram.binMs),
      );
      const current = result.get(index);
      if (!current || (quake.magnitude ?? -Infinity) > (current.magnitude ?? -Infinity)) {
        result.set(index, quake);
      }
    }
    return result;
  }, [quakes, bins.length, histogram.fromMs, histogram.toMs, histogram.binMs]);

  const selectBin = useCallback(
    (index: number) => {
      const quake = largestPerBin.get(index);
      if (quake) onSelect(quake.id);
    },
    [largestPerBin, onSelect],
  );

  const barWidth = width > 0 ? width / bins.length : 0;
  const gap = barWidth > 6 ? 1.5 : barWidth > 3 ? 1 : 0.5;
  const active = hovered !== null ? bins[hovered] : null;

  /** The bin holding the selected event, so the chart reflects the selection. */
  const selectedBin = useMemo(() => {
    if (!selectedId) return null;
    for (const [index, quake] of largestPerBin) {
      if (quake.id === selectedId) return index;
    }
    const quake = quakes.find((q) => q.id === selectedId);
    if (!quake) return null;
    const at = Date.parse(quake.occurredAt);
    if (at < histogram.fromMs || at >= histogram.toMs) return null;
    return Math.min(bins.length - 1, Math.floor((at - histogram.fromMs) / histogram.binMs));
  }, [selectedId, largestPerBin, quakes, histogram.fromMs, histogram.toMs, histogram.binMs, bins.length]);

  const ticks = width > 0 ? tickIndices(bins.length, width) : [];

  return (
    <div className={cn("select-none", className)}>
      <div className="mb-1.5 flex items-baseline justify-between px-0.5">
        <h2 className="label">Activity over time</h2>
        <p className="tnum text-[11px] text-[var(--color-ink-dim)]">
          {active ? (
            <>
              <span className="text-[var(--color-ink)]">{formatCount(active.count)}</span>
              {active.count === 1 ? " event" : " events"}
              {active.maxMagnitude !== null && (
                <>
                  <span className="px-1.5 text-[var(--color-ink-faint)]">·</span>
                  max M {formatMagnitudeValue(active.maxMagnitude)}
                </>
              )}
              <span className="px-1.5 text-[var(--color-ink-faint)]">·</span>
              {formatTick(active.startMs, range === "1h" || range === "6h" ? range : "24h")}
            </>
          ) : (
            <>peak {formatCount(histogram.peakCount)} per bar</>
          )}
        </p>
      </div>

      <div ref={containerRef} className="relative w-full">
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT + AXIS_HEIGHT}
            role="img"
            aria-label={`Earthquake counts over ${bins.length} intervals. Peak ${histogram.peakCount} events in one interval.`}
            onMouseLeave={() => setHovered(null)}
            className="overflow-visible"
          >
            {/* Baseline */}
            <line
              x1={0}
              y1={HEIGHT}
              x2={width}
              y2={HEIGHT}
              stroke="var(--color-line-strong)"
              strokeWidth={1}
            />

            {bins.map((bin: TimeBin, index) => {
              const x = index * barWidth;
              const height = bin.count === 0 ? 0 : Math.max(1.5, (bin.count / peak) * (HEIGHT - 6));
              const isHovered = hovered === index;
              const isSelected = selectedBin === index;

              return (
                <g key={bin.startMs}>
                  {/* Full-height hit area: thin bars are otherwise unhittable. */}
                  <rect
                    x={x}
                    y={0}
                    width={Math.max(barWidth, 3)}
                    height={HEIGHT}
                    fill="transparent"
                    onMouseEnter={() => setHovered(index)}
                    onClick={() => selectBin(index)}
                    className={largestPerBin.has(index) ? "cursor-pointer" : undefined}
                  />
                  {(isHovered || isSelected) && (
                    <rect
                      x={x}
                      y={0}
                      width={Math.max(barWidth, 3)}
                      height={HEIGHT}
                      fill="rgb(255 255 255 / 0.05)"
                      pointerEvents="none"
                    />
                  )}
                  {height > 0 && (
                    <rect
                      x={x + gap / 2}
                      y={HEIGHT - height}
                      width={Math.max(barWidth - gap, 0.8)}
                      height={height}
                      fill={barColour(bin.maxMagnitude)}
                      opacity={isHovered || isSelected ? 1 : 0.78}
                      pointerEvents="none"
                      rx={barWidth > 4 ? 1 : 0}
                    />
                  )}
                </g>
              );
            })}

            {ticks.map((index) => {
              const bin = bins[index];
              if (!bin) return null;
              const x = index * barWidth;
              return (
                <text
                  key={`tick-${bin.startMs}`}
                  x={x}
                  y={HEIGHT + 12}
                  fill="var(--color-ink-faint)"
                  fontSize={10}
                  textAnchor={index === 0 ? "start" : "middle"}
                  className="tnum"
                >
                  {formatTick(bin.startMs, range)}
                </text>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
