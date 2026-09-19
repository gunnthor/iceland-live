"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  HEADLINE_POLLUTANTS,
  trendOf,
  type AirQualityStation,
  type Reading,
} from "@/domain/air-quality";
import { cn } from "@/lib/format";
import { formatClock } from "@/lib/time";

/**
 * An air quality trace on the earthquake timeline's own clock.
 *
 * ## Why this is worth the pixels
 *
 * A gas episode and the seismicity around it are the same story told twice,
 * and until now they sat in different panels with different axes, which left
 * the reader to align two charts by eye. Drawn under the histogram on exactly
 * the same x-domain, "the SO₂ rose while the swarm was going" becomes a thing
 * you can see rather than a thing you have to reconstruct.
 *
 * ## What it is not
 *
 * Two measurements sharing an axis, and nothing more. No correlation is
 * computed, none is implied, and the caption does not suggest one caused the
 * other. Volcanic gas and earthquakes at the same place often do share a
 * cause, and often do not — a still day over a busy road moves these numbers
 * too, which is why the station's name and classification stay on screen.
 *
 * ## Coverage
 *
 * The network publishes about 24 hours of hourly averages. For a window wider
 * than that, a trace would be a sliver pinned to the right-hand edge with the
 * rest of the chart silently empty, implying no gas rather than no data. Past
 * that point the panel says what it has instead of drawing it.
 */

const HEIGHT = 26;

/** Hours the source may skip before the line is broken rather than joined. */
const GAP_MS = 2.5 * 3_600_000;

/** Below this many samples inside the window there is no shape to show. */
const MIN_VISIBLE_POINTS = 2;

/**
 * The widest window this trace will draw across.
 *
 * The network publishes about 24 hours. Over a week the same 24 hours becomes
 * a sliver against the right-hand edge with six days of blank chart beside
 * it, which reads as six quiet days rather than as six days we were not told
 * about — the one misreading a chart like this must not invite.
 *
 * Tested against the window rather than against how much of it the data
 * happens to cover, so a station that has published only the last six hours
 * still gets a six-hour line inside a 24-hour window instead of being
 * suppressed for being sparse.
 */
const MAX_WINDOW_MS = 26 * 3_600_000;

export type TraceChoice = { stationId: string; pollutant: string };

/** A station and one of its pollutants, as one selectable thing. */
export type TraceOption = {
  key: string;
  stationId: string;
  pollutant: string;
  label: string;
  station: AirQualityStation;
  reading: Reading;
};

/**
 * Every station/pollutant pair with enough series to draw, best first.
 *
 * Ordered by how much of the headline pollutant is in the air right now,
 * within pollutant priority — so the default selection is the most
 * consequential thing the network is currently measuring rather than
 * whichever station sorts first alphabetically.
 */
export function traceOptions(stations: readonly AirQualityStation[]): TraceOption[] {
  const options: TraceOption[] = [];

  for (const station of stations) {
    for (const reading of station.latest) {
      if (!HEADLINE_POLLUTANTS.includes(reading.pollutant)) continue;
      if (!reading.series || reading.series.length < MIN_VISIBLE_POINTS) continue;
      options.push({
        key: `${station.id}:${reading.pollutant}`,
        stationId: station.id,
        pollutant: reading.pollutant,
        label: `${station.name} · ${reading.pollutant}`,
        station,
        reading,
      });
    }
  }

  const priority = (pollutant: string) => {
    const index = HEADLINE_POLLUTANTS.indexOf(pollutant);
    return index < 0 ? HEADLINE_POLLUTANTS.length : index;
  };

  return options.sort((a, b) => {
    const byPollutant = priority(a.pollutant) - priority(b.pollutant);
    if (byPollutant !== 0) return byPollutant;
    return b.reading.value - a.reading.value;
  });
}

/** Pretty form of a pollutant code: `SO2` reads better as `SO₂`. */
function formatPollutant(pollutant: string): string {
  return pollutant.replace(/2$/, "₂").replace(/^PM2\.5$/, "PM2.5");
}

function TraceLine({
  points,
  fromMs,
  toMs,
  width,
}: {
  points: ReadonlyArray<{ at: string; value: number }>;
  fromMs: number;
  toMs: number;
  width: number;
}) {
  const span = toMs - fromMs || 1;
  const peak = Math.max(...points.map((point) => point.value), 0);
  // A series that is flat at zero would otherwise divide by zero.
  const scale = peak > 0 ? peak : 1;

  const segments: string[] = [];
  let current: string[] = [];
  let previousAt: number | null = null;

  for (const point of points) {
    const at = Date.parse(point.at);
    const x = ((at - fromMs) / span) * width;
    const y = HEIGHT - (point.value / scale) * (HEIGHT - 3) - 1.5;

    // The source omits hours it has no sample for, so consecutive entries are
    // not necessarily consecutive hours; joining across one would draw a line
    // through time nobody measured.
    if (previousAt !== null && at - previousAt > GAP_MS) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
    }
    current.push(`${current.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
    previousAt = at;
  }
  if (current.length > 1) segments.push(current.join(" "));

  const last = points[points.length - 1];
  const lastAt = last ? Date.parse(last.at) : fromMs;
  const lastX = ((lastAt - fromMs) / span) * width;
  const lastY = last ? HEIGHT - (last.value / scale) * (HEIGHT - 3) - 1.5 : HEIGHT;

  return (
    <>
      {segments.map((d) => (
        <path key={d} d={d} fill="none" stroke="#5ec8b8" strokeWidth={1.2} strokeOpacity={0.85} />
      ))}
      {last && <circle cx={lastX} cy={lastY} r={1.8} fill="#5ec8b8" />}
    </>
  );
}

export function AirTrace({
  stations,
  fromMs,
  toMs,
  selected,
  onSelect,
  className,
}: {
  stations: readonly AirQualityStation[];
  /** The timeline's window, so both charts share one x-axis exactly. */
  fromMs: number;
  toMs: number;
  selected: TraceChoice | null;
  onSelect: (choice: TraceChoice) => void;
  className?: string;
}) {
  const options = useMemo(() => traceOptions(stations), [stations]);

  /*
   * Measured here rather than passed down. Both charts sit in the same
   * container with the same padding, so measuring independently gives the
   * same number — and a width threaded through the shell would be one more
   * thing to keep in step every time that layout changes.
   */
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const chosen =
    options.find(
      (option) =>
        option.stationId === selected?.stationId && option.pollutant === selected.pollutant,
    ) ??
    options[0] ??
    null;

  const visible = useMemo(() => {
    if (!chosen?.reading.series) return [];
    return chosen.reading.series.filter((point) => {
      const at = Date.parse(point.at);
      return at >= fromMs && at <= toMs;
    });
  }, [chosen, fromMs, toMs]);

  if (options.length === 0 || !chosen) return null;

  const trend = trendOf(chosen.reading);
  /*
   * Whether there is a shape to draw, judged on the data alone. Deliberately
   * independent of the measured width: on the first paint the width is still
   * zero, and folding it in here would flash "nothing to draw across this
   * window" for a frame at every range the chart handles perfectly well.
   */
  const enough = visible.length >= MIN_VISIBLE_POINTS && toMs - fromMs <= MAX_WINDOW_MS;
  const peak = enough ? Math.max(...visible.map((point) => point.value)) : null;

  return (
    <div className={cn("select-none", className)}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label className="flex min-w-0 items-baseline gap-1.5">
          <span className="label shrink-0">Air</span>
          {/*
            One control rather than two. Station and pollutant are not
            independent — most stations report only some of these — so a pair
            of pickers would spend half its combinations on nothing.
          */}
          <select
            value={chosen.key}
            onChange={(event) => {
              const next = options.find((option) => option.key === event.currentTarget.value);
              if (next) onSelect({ stationId: next.stationId, pollutant: next.pollutant });
            }}
            aria-label="Air quality station and pollutant"
            className="min-w-0 max-w-[190px] truncate rounded border-0 bg-transparent py-0 text-[11px] text-[var(--color-ink-muted)] outline-none transition-colors hover:text-[var(--color-ink)] focus-visible:ring-1 focus-visible:ring-[var(--color-line-strong)]"
          >
            {options.map((option) => (
              <option
                key={option.key}
                value={option.key}
                className="bg-[var(--color-surface-raised)] text-[var(--color-ink)]"
              >
                {option.station.name} &middot; {formatPollutant(option.pollutant)}
              </option>
            ))}
          </select>
        </label>

        <p className="tnum shrink-0 text-[11px] text-[var(--color-ink-dim)]">
          <span className="text-[var(--color-ink)]">
            {chosen.reading.value.toLocaleString("en-GB", { maximumFractionDigits: 1 })}
          </span>{" "}
          {chosen.reading.unit}
          {trend !== "unknown" && trend !== "steady" && (
            <>
              <span className="px-1.5 text-[var(--color-ink-faint)]">&middot;</span>
              {trend}
            </>
          )}
          <span className="px-1.5 text-[var(--color-ink-faint)]">&middot;</span>
          {formatClock(chosen.reading.observedAt)}
        </p>
      </div>

      <div ref={containerRef} className="w-full">
        {enough ? (
          width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${formatPollutant(chosen.pollutant)} at ${chosen.station.name} over the same period, on a scale from zero to ${peak} ${chosen.reading.unit}. Latest ${chosen.reading.value} ${chosen.reading.unit}, ${trend}.`}
          className="overflow-visible"
        >
          <line
            x1={0}
            y1={HEIGHT}
            x2={width}
            y2={HEIGHT}
            stroke="var(--color-line)"
            strokeWidth={1}
          />
          <TraceLine points={visible} fromMs={fromMs} toMs={toMs} width={width} />
        </svg>
          )
        ) : (
          <p className="text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
            The air network publishes about the last 24 hours, so there is nothing
            to draw across this window. Switch to 24h or shorter.
          </p>
        )}
      </div>

      <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
        {enough && peak !== null && (
          <>
            Scaled from zero to {peak.toLocaleString("en-GB", { maximumFractionDigits: 1 })}{" "}
            {chosen.reading.unit}, the peak in this window.{" "}
          </>
        )}
        {chosen.station.classification && (
          <>
            {chosen.station.classification[0]?.toUpperCase()}
            {chosen.station.classification.slice(1)} station.{" "}
          </>
        )}
        Hourly averages from the Environment and Energy Agency, on the same clock
        as the chart above. Shown together, not compared: nothing here measures
        whether one relates to the other.
      </p>
    </div>
  );
}
