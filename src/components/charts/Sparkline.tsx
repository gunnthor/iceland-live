"use client";

import { cn } from "@/lib/format";

/**
 * A 24-hour trace for one air quality series.
 *
 * Small enough to sit beside a number and say the one thing the number cannot:
 * whether it is on the way up or clearing. The y-axis starts at zero and runs
 * to the series maximum, so the shape is the shape of the concentration and not
 * of a cropped window.
 *
 * Gaps in monitoring are gaps in the line rather than a drop to zero — an hour
 * with no sample is not an hour with no gas.
 */

const DEFAULT_WIDTH = 72;
const DEFAULT_HEIGHT = 20;

export function Sparkline({
  points,
  className,
  tone = "currentColor",
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  /**
   * An instant to mark with a hairline, if it falls inside the series.
   *
   * Used where a series runs past the present — a dispersal run forecasts
   * two days ahead — and "which of this has happened" is the first thing a
   * reader needs to know about the shape.
   */
  markerMs,
}: {
  points: ReadonlyArray<{ at: string; value: number }>;
  className?: string;
  tone?: string;
  width?: number;
  height?: number;
  markerMs?: number;
}) {
  if (points.length < 2) return null;

  const WIDTH = width;
  const HEIGHT = height;

  const times = points.map((point) => Date.parse(point.at));
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const span = maxTime - minTime || 1;

  const peak = Math.max(...points.map((point) => point.value), 0);
  // A flat series at zero would otherwise divide by zero and draw nothing.
  const scale = peak > 0 ? peak : 1;

  /*
   * Breaks the line where the series skips an hour.
   *
   * The source omits hours it has no sample for, so consecutive array entries
   * are not necessarily consecutive hours. Joining across a gap would draw a
   * straight line through time nobody measured.
   */
  const gapThreshold = 2.5 * 3_600_000;
  const segments: string[] = [];
  let current: string[] = [];

  points.forEach((point, index) => {
    const x = ((Date.parse(point.at) - minTime) / span) * WIDTH;
    const y = HEIGHT - (point.value / scale) * (HEIGHT - 2) - 1;
    const previous = index > 0 ? Date.parse(points[index - 1]!.at) : null;

    if (previous !== null && Date.parse(point.at) - previous > gapThreshold) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
    }
    current.push(`${current.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(" "));

  const last = points[points.length - 1] as { at: string; value: number };
  const lastX = ((Date.parse(last.at) - minTime) / span) * WIDTH;
  const lastY = HEIGHT - (last.value / scale) * (HEIGHT - 2) - 1;

  const markerX =
    markerMs !== undefined && markerMs >= minTime && markerMs <= maxTime
      ? ((markerMs - minTime) / span) * WIDTH
      : null;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      className={cn("overflow-visible", className)}
      aria-hidden="true"
    >
      {markerX !== null && (
        <line
          x1={markerX}
          y1={0}
          x2={markerX}
          y2={HEIGHT}
          stroke="var(--color-ink-faint)"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
      {segments.map((d) => (
        <path key={d} d={d} fill="none" stroke={tone} strokeWidth={1} strokeOpacity={0.7} />
      ))}
      <circle cx={lastX} cy={lastY} r={1.6} fill={tone} />
    </svg>
  );
}
