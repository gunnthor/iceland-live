"use client";

import { useMemo, useState } from "react";
import {
  HEADLINE_POLLUTANTS,
  readingFor,
  trendOf,
  type AirQualityStation,
  type Pollutant,
  type Reading,
} from "@/domain/air-quality";
import { Sparkline } from "@/components/charts/Sparkline";
import type { RoadCondition, RoadWeatherStation } from "@/domain/roads";
import { cn } from "@/lib/format";
import { formatRelative } from "@/lib/time";

/**
 * Air quality and road conditions.
 *
 * ## On not grading the air
 *
 * The readings are shown with their value, unit and time, and nothing else. The
 * Environment and Energy Agency publishes a health scale for these pollutants
 * and is the place to read one; a colour band invented here would be a health
 * judgement this project has no standing to make. The link goes to them.
 *
 * Everything served in real time is unverified, which is stated once rather
 * than repeated on each row.
 */

const NEAREST = 5;

function distanceSort<T extends { latitude: number; longitude: number }>(
  items: readonly T[],
  focus: { latitude: number; longitude: number } | null,
  limit: number,
): T[] {
  if (!focus) return items.slice(0, limit);
  const scale = Math.cos((focus.latitude * Math.PI) / 180) ** 2;
  return [...items]
    .sort(
      (a, b) =>
        (a.latitude - focus.latitude) ** 2 + (a.longitude - focus.longitude) ** 2 * scale -
        ((b.latitude - focus.latitude) ** 2 + (b.longitude - focus.longitude) ** 2 * scale),
    )
    .slice(0, limit);
}

/**
 * Direction of travel over the last few hours.
 *
 * An arrow and a word, not a colour: "rising" is a description of the series,
 * and colouring it would edge into saying whether that is bad.
 */
function TrendMark({ reading }: { reading: Reading }) {
  const trend = trendOf(reading);
  if (trend === "unknown" || trend === "steady") return null;
  return (
    <span
      className="shrink-0 text-[10px] text-[var(--color-ink-dim)]"
      title={`Mean of the last third of the 24-hour series against the rest: ${trend}`}
    >
      {trend === "rising" ? "\u2197" : "\u2198"} {trend}
    </span>
  );
}

function AirRow({ station, nowMs }: { station: AirQualityStation; nowMs: number }) {
  const shown = HEADLINE_POLLUTANTS.map((pollutant) => ({
    pollutant,
    reading: readingFor(station, pollutant as Pollutant),
  })).filter((entry) => entry.reading !== null);

  if (shown.length === 0) return null;
  const observedAt = shown[0]?.reading?.observedAt;

  return (
    <li className="border-t border-[var(--color-line)] px-4 py-2.5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[13px] leading-tight text-[var(--color-ink)]">
          {station.name}
        </span>
        <span className="tnum shrink-0 text-[10px] text-[var(--color-ink-faint)]">
          {observedAt ? formatRelative(observedAt, nowMs) : "—"}
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
        {shown.map(({ pollutant, reading }) => (
          <div key={pollutant} className="flex items-center gap-2">
            <span className="tnum w-[104px] shrink-0 text-[11px] text-[var(--color-ink-dim)]">
              <span className="text-[var(--color-ink-muted)]">{pollutant}</span>{" "}
              {reading?.value.toFixed(1)}
              <span className="pl-0.5 text-[var(--color-ink-faint)]">{reading?.unit}</span>
            </span>
            {reading?.series && reading.series.length > 1 && (
              <Sparkline
                points={reading.series}
                tone="var(--color-ink-dim)"
                className="shrink-0"
              />
            )}
            {reading && <TrendMark reading={reading} />}
          </div>
        ))}
      </div>
    </li>
  );
}

function WindRow({ station, nowMs }: { station: RoadWeatherStation; nowMs: number }) {
  return (
    <li className="border-t border-[var(--color-line)] px-4 py-2.5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[13px] leading-tight text-[var(--color-ink)]">
          {station.name}
        </span>
        <span className="tnum shrink-0 text-[10px] text-[var(--color-ink-faint)]">
          {station.observedAt ? formatRelative(station.observedAt, nowMs) : "—"}
        </span>
      </div>
      <div className="tnum mt-1 text-[11px] text-[var(--color-ink-dim)]">
        {/*
          Speed and gust as a range — "8–11 m/s" — rather than two separate
          figures. It is how wind is normally reported, and it keeps the unit
          from having to appear twice in a line this narrow.
        */}
        {station.windSpeedMs !== null ? (
          <>
            {station.windSpeedMs.toFixed(0)}
            {station.windGustMs !== null && station.windGustMs > station.windSpeedMs && (
              <>&ndash;{station.windGustMs.toFixed(0)}</>
            )}{" "}
            m/s
            {station.windDirectionLabel && <> from {station.windDirectionLabel.trim()}</>}
          </>
        ) : (
          "no wind reading"
        )}
        {station.airTempC !== null && (
          <>
            <span className="px-1.5 text-[var(--color-ink-faint)]">&middot;</span>
            {station.airTempC.toFixed(0)}&deg;C
          </>
        )}
        {station.roadTempC !== null && (
          <>
            <span className="px-1.5 text-[var(--color-ink-faint)]">&middot;</span>
            road {station.roadTempC.toFixed(0)}&deg;C
          </>
        )}
      </div>
    </li>
  );
}

export function EnvironmentPanel({
  air,
  airError,
  roadWeather,
  roadConditions,
  roadConditionsTotal,
  roadsError,
  roadAttribution,
  focus,
  nowMs,
  loading,
  unavailable,
}: {
  air: readonly AirQualityStation[];
  airError: string | null;
  roadWeather: readonly RoadWeatherStation[];
  roadConditions: readonly RoadCondition[];
  roadConditionsTotal: number;
  roadsError: string | null;
  roadAttribution: string | null;
  /** Where the activity is; both lists are ordered by distance from it. */
  focus: { latitude: number; longitude: number } | null;
  nowMs: number;
  loading: boolean;
  unavailable: boolean;
}) {
  const [tab, setTab] = useState<"air" | "roads">("air");

  const nearestAir = useMemo(() => distanceSort(air, focus, NEAREST), [air, focus]);
  const nearestWind = useMemo(
    () => distanceSort(roadWeather, focus, NEAREST),
    [roadWeather, focus],
  );

  return (
    <section aria-label="Air and roads" className="border-t border-[var(--color-line)]">
      <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3">
        <h2 className="label">Air &amp; roads</h2>
        <div role="radiogroup" aria-label="Show" className="flex items-center gap-0.5">
          {(["air", "roads"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={tab === option}
              onClick={() => setTab(option)}
              className={cn(
                "flex min-h-9 items-center rounded px-2.5 text-[11px] capitalize transition-colors duration-150 lg:min-h-7 lg:px-2",
                tab === option
                  ? "bg-white/[0.1] text-[var(--color-ink)]"
                  : "text-[var(--color-ink-dim)] hover:bg-white/[0.05] hover:text-[var(--color-ink-muted)]",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <p className="px-4 pb-3 text-[11px] text-[var(--color-ink-dim)]">Loading&hellip;</p>
      )}

      {unavailable && (
        <p className="px-4 pb-3 text-[11px] text-[var(--color-ink-dim)]">
          Air and road information could not be loaded.
        </p>
      )}

      {tab === "air" && !loading && (
        <>
          {airError ? (
            <p className="px-4 pb-3 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
              Air quality readings are not available right now.
            </p>
          ) : (
            <ul className="border-t border-[var(--color-line)]">
              {nearestAir.map((station) => (
                <AirRow key={station.id} station={station} nowMs={nowMs} />
              ))}
            </ul>
          )}
          <p className="border-t border-[var(--color-line)] px-4 py-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
            Hourly averages from the Environment and Energy Agency, nearest the activity,
            with the last 24 hours beside each. Gaps in a trace are hours with no sample.
            These are real-time values and have not been verified by the agency. We report
            the measurements and do not grade them — for a health scale see{" "}
            <a
              href="https://ust.is/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-[var(--color-ink-dim)]"
            >
              ust.is
            </a>
            .
          </p>
        </>
      )}

      {tab === "roads" && !loading && (
        <>
          {roadsError ? (
            <p className="px-4 pb-3 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
              Road information is not available right now.
            </p>
          ) : (
            <>
              <p className="px-4 pb-1 pt-1 text-[10px] uppercase tracking-wide text-[var(--color-ink-faint)]">
                Wind
              </p>
              <ul className="border-t border-[var(--color-line)]">
                {nearestWind.map((station) => (
                  <WindRow key={station.id} station={station} nowMs={nowMs} />
                ))}
              </ul>

              <p className="px-4 pb-1 pt-3 text-[10px] uppercase tracking-wide text-[var(--color-ink-faint)]">
                Not clear &middot; {roadConditions.length} of {roadConditionsTotal} segments
              </p>
              <ul className="border-t border-[var(--color-line)]">
                {roadConditions.slice(0, 8).map((condition) => (
                  <li
                    key={`${condition.id}-${condition.name}`}
                    className="flex items-baseline gap-2 border-t border-[var(--color-line)] px-4 py-2 first:border-t-0"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: condition.colour ?? "#8C8A88" }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] leading-tight text-[var(--color-ink-muted)]">
                        {condition.name}
                      </span>
                      <span className="block truncate text-[11px] leading-tight text-[var(--color-ink-dim)]">
                        {condition.status}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {roadAttribution && (
            <p className="border-t border-[var(--color-line)] px-4 py-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
              {roadAttribution}. Segments reading &ldquo;Greiðfært&rdquo; are omitted. Iceland
              Live is not affiliated with IRCA.
            </p>
          )}
        </>
      )}
    </section>
  );
}
