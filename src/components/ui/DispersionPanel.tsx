"use client";

import { useEffect, useMemo, useState } from "react";
import {
  describeLayer,
  frameTimes,
  layerKey,
  legendFor,
  rasterUrl,
  type DispersionLayer,
  type DispersionRun,
} from "@/domain/dispersion";
import { cn } from "@/lib/format";
import { formatDayClock, formatRelative } from "@/lib/time";

/**
 * IMO's dispersal simulations.
 *
 * ## The sentence this panel exists to prevent
 *
 * "Ash is heading for Reykjavík." Every run here is a model of an eruption at
 * a preset volcano with a preset column height, produced on a schedule so the
 * answer is ready if one ever starts. IMO runs them whether or not anything is
 * happening, and on an ordinary day — which is almost every day — none of the
 * eruptions being modelled exists.
 *
 * Nothing in the published record marks a contingency run apart from one
 * produced for a real event: same fields, same model, same `product_type`.
 * So this panel states what a run *is* (a scenario, with its assumptions on
 * the row) and never states what it *means*, and it points at IMO's own
 * aviation colour codes for whether anything is actually under way.
 *
 * ## The pictures are IMO's
 *
 * The rasters are IMO's model output, rendered by IMO, with IMO's colour
 * scale. Nothing is recoloured, resampled or measured here.
 */

/** How long each frame is held when playing. Slow enough to read the clock. */
const FRAME_MS = 700;

/** Frames fetched ahead of the one on screen, so playback does not stutter. */
const PRELOAD_AHEAD = 4;

/** "10 km column" reads better than "10000 m". */
function formatColumn(metres: number | null): string | null {
  if (metres === null) return null;
  return metres >= 1000 ? `${Math.round(metres / 100) / 10} km column` : `${metres} m column`;
}

/**
 * The frame to open on: the one nearest now, clamped into the run's window.
 *
 * A run that started this morning is most useful at the current hour, and one
 * that starts tonight can only open at its first frame.
 */
export function initialFrame(frames: readonly number[], nowMs: number): number {
  if (frames.length === 0) return 0;
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < frames.length; index += 1) {
    const distance = Math.abs((frames[index] as number) - nowMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function RunRow({
  run,
  selected,
  onSelect,
  nowMs,
}: {
  run: DispersionRun;
  selected: boolean;
  onSelect: (run: DispersionRun) => void;
  nowMs: number;
}) {
  const column = formatColumn(run.columnHeightM);

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(run)}
        aria-pressed={selected}
        aria-current={selected}
        className="row-button flex items-center gap-3 px-4 py-2.5"
      >
        <span
          aria-hidden="true"
          className={cn(
            "h-7 w-[2px] shrink-0 rounded-full",
            selected ? "bg-[#d09a6a]" : "bg-white/12",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-tight text-[var(--color-ink)]">
            {run.volcano}
            {column && (
              <>
                <span className="px-1.5 text-[var(--color-ink-faint)]">&middot;</span>
                <span className="text-[var(--color-ink-muted)]">{column}</span>
              </>
            )}
          </span>
          <span className="tnum mt-0.5 block text-[11px] leading-tight text-[var(--color-ink-dim)]">
            {run.durationHours} h from {formatDayClock(run.startsAt)}
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-[var(--color-ink-faint)]">
            {run.model}
            <span className="px-1.5">&middot;</span>
            {run.hazard === "gas" ? "volcanic SO₂" : "tephra"}
            <span className="px-1.5">&middot;</span>
            run {formatRelative(run.createdAt, nowMs)}
          </span>
        </span>
        {selected && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-[#d09a6a]">
            On map
          </span>
        )}
      </button>
    </li>
  );
}

function LayerPill({
  layer,
  label,
  title,
  active,
  onSelect,
}: {
  layer: DispersionLayer;
  label: string;
  title?: string;
  active: boolean;
  onSelect: (layer: DispersionLayer) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(layer)}
      aria-pressed={active}
      // Flight-level pills show a bare number, so the full wording has to
      // survive somewhere a screen reader and a hover will both find it.
      title={title}
      aria-label={title}
      className={cn(
        "tnum rounded px-2 py-1 text-[10px] leading-none transition-colors duration-150",
        active
          ? "bg-white/[0.1] text-[var(--color-ink)]"
          : "text-[var(--color-ink-dim)] hover:bg-white/[0.05] hover:text-[var(--color-ink)]",
      )}
    >
      {label}
    </button>
  );
}

/**
 * Layer picker, clock and legend for the run on the map.
 *
 * Keyed by run id where it is used, so switching scenario remounts it and the
 * frame index starts from the new run's own window rather than carrying an
 * index that means something different.
 */
function RunControls({
  run,
  layer,
  onLayerChange,
  frameIndex,
  onFrameChange,
  nowMs,
}: {
  run: DispersionRun;
  layer: DispersionLayer;
  onLayerChange: (layer: DispersionLayer) => void;
  frameIndex: number;
  onFrameChange: (index: number) => void;
  nowMs: number;
}) {
  const frames = useMemo(() => frameTimes(run), [run]);
  const [playing, setPlaying] = useState(false);

  const frameAt = frames[frameIndex] ?? frames[0] ?? Date.parse(run.startsAt);
  const legend = legendFor(run, layer);

  /*
   * Split rather than listed flat.
   *
   * A run publishes fifteen layers, twelve of them pressure levels. As one
   * list of "Airborne at 850 hPa" pills that is eight rows of near-identical
   * text before the reader reaches the clock — so the two layers most people
   * want sit on their own row, and the flight levels become a strip of bare
   * numbers under a heading that says what they are.
   */
  const grouped = useMemo(() => {
    const ground = run.layers.filter(
      (item) => item.altitudeUnit === "m" && !item.dispersionType.endsWith("kg/m2"),
    );
    const deposit = run.layers.filter((item) => item.dispersionType.endsWith("kg/m2"));
    const flight = run.layers
      .filter((item) => item.altitudeUnit === "hPa")
      // Pressure falls with height, so descending hPa is ascending altitude.
      .sort((a, b) => b.altitude - a.altitude);
    return { primary: [...ground, ...deposit], flight };
  }, [run]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      onFrameChange((frameIndex + 1) % Math.max(frames.length, 1));
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [playing, frameIndex, frames.length, onFrameChange]);

  /*
   * Warms the next few frames in the browser cache. Each is a few kilobytes
   * and immutable, so this costs almost nothing and is the difference between
   * playback and a slideshow of loading gaps.
   */
  useEffect(() => {
    for (let ahead = 1; ahead <= PRELOAD_AHEAD; ahead += 1) {
      const next = frames[frameIndex + ahead];
      if (next === undefined) break;
      const image = new Image();
      image.src = rasterUrl(run, layer, next);
    }
  }, [run, layer, frames, frameIndex]);

  return (
    <div className="border-t border-[var(--color-line)] bg-white/[0.015] px-4 py-3">
      <div className="flex flex-wrap gap-1">
        {grouped.primary.map((item) => (
          <LayerPill
            key={layerKey(item)}
            layer={item}
            label={describeLayer(item)}
            active={layerKey(item) === layerKey(layer)}
            onSelect={onLayerChange}
          />
        ))}
      </div>

      {grouped.flight.length > 0 && (
        <div className="mt-2">
          <p className="label">Airborne, by pressure level (hPa)</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {grouped.flight.map((item) => (
              <LayerPill
                key={layerKey(item)}
                layer={item}
                label={String(item.altitude)}
                title={describeLayer(item)}
                active={layerKey(item) === layerKey(layer)}
                onSelect={onLayerChange}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          aria-label={playing ? "Pause" : "Play forecast hours"}
          className="shrink-0 rounded px-1.5 py-1 text-[var(--color-ink-dim)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-ink)]"
        >
          {playing ? (
            <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
              <rect x="1.5" y="1" width="3" height="9" fill="currentColor" rx="0.5" />
              <rect x="6.5" y="1" width="3" height="9" fill="currentColor" rx="0.5" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
              <path d="M2 1l8 4.5L2 10z" fill="currentColor" />
            </svg>
          )}
        </button>

        <input
          type="range"
          min={0}
          max={Math.max(frames.length - 1, 0)}
          step={1}
          value={frameIndex}
          onChange={(event) => {
            setPlaying(false);
            onFrameChange(Number(event.currentTarget.value));
          }}
          aria-label="Forecast hour"
          aria-valuetext={`${formatDayClock(frameAt)}, ${frameIndex + 1} of ${frames.length}`}
          className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/12 accent-[#d09a6a]"
        />

        <span className="tnum shrink-0 text-[11px] text-[var(--color-ink)]">
          {formatDayClock(frameAt)}
        </span>
      </div>

      <p className="tnum mt-1 text-[10px] text-[var(--color-ink-faint)]">
        Hour {frameIndex + 1} of {frames.length}
        <span className="px-1.5">&middot;</span>
        {frameAt > nowMs
          ? `${Math.round((frameAt - nowMs) / 3_600_000)} h ahead of now`
          : `${Math.round((nowMs - frameAt) / 3_600_000)} h behind now`}
      </p>

      <div className="mt-3">
        <p className="label">{describeLayer(layer)}</p>
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {legend.map((step) => (
            <li key={step.label} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-[2px] ring-1 ring-white/15"
                style={{ backgroundColor: step.colour }}
              />
              <span className="tnum text-[10px] leading-none text-[var(--color-ink-muted)]">
                {step.label}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
          IMO&rsquo;s own scale, as published with the model output.{" "}
          <a
            href={run.viewerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 transition-colors hover:text-[var(--color-ink-muted)]"
          >
            Open this run in IMO&rsquo;s viewer
          </a>
          .
        </p>
      </div>
    </div>
  );
}

export function DispersionPanel({
  runs,
  selectedId,
  layer,
  onSelectRun,
  onLayerChange,
  frameIndex,
  onFrameChange,
  onClear,
  nowMs,
  loading,
  unavailable,
}: {
  runs: readonly DispersionRun[];
  selectedId: string | null;
  layer: DispersionLayer | null;
  onSelectRun: (run: DispersionRun) => void;
  onLayerChange: (layer: DispersionLayer) => void;
  frameIndex: number;
  onFrameChange: (index: number) => void;
  onClear: () => void;
  nowMs: number;
  loading: boolean;
  unavailable: boolean;
}) {
  const selected = runs.find((run) => run.id === selectedId) ?? null;

  return (
    <section aria-label="Dispersal simulations" className="border-t border-[var(--color-line)]">
      <div className="flex items-baseline justify-between gap-2 px-4 pb-1 pt-3">
        <h2 className="label">Dispersal simulations</h2>
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

      {/*
        First, before any run is listed. A reader who takes one glance at this
        panel and leaves must still have read what these are.
      */}
      <p className="px-4 pb-2.5 text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
        IMO models an eruption at each of these volcanoes several times a day,
        whether or not one is happening, so the answer is ready if one ever
        starts.{" "}
        <strong className="font-medium text-[var(--color-ink)]">
          These are &ldquo;what if&rdquo; runs, not a forecast that an eruption
          will occur
        </strong>{" "}
        &mdash; and the plume height on each row is an assumption the model was
        given, not an observation.
      </p>

      {loading && (
        <p className="px-4 pb-3 text-[11px] text-[var(--color-ink-dim)]">
          Loading simulations&hellip;
        </p>
      )}

      {unavailable && (
        <p className="px-4 pb-3 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
          IMO&rsquo;s dispersal service could not be reached, so we cannot say what
          it is currently running.
        </p>
      )}

      {!loading && !unavailable && runs.length === 0 && (
        <p className="px-4 pb-3 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
          IMO has no simulations whose forecast period is still running.
        </p>
      )}

      {runs.length > 0 && (
        <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              selected={run.id === selectedId}
              onSelect={onSelectRun}
              nowMs={nowMs}
            />
          ))}
        </ul>
      )}

      {selected && layer && (
        <RunControls
          key={selected.id}
          run={selected}
          layer={layer}
          onLayerChange={onLayerChange}
          frameIndex={frameIndex}
          onFrameChange={onFrameChange}
          nowMs={nowMs}
        />
      )}

      <p className="border-t border-[var(--color-line)] px-4 py-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
        Model output from the Icelandic Meteorological Office &mdash; NAME for
        tephra, CALPUFF for volcanic SO&#8322; &mdash; driven by ECMWF weather
        forecasts. During a real eruption IMO also publishes runs for the actual
        event, and nothing in the published record marks which is which, so this
        panel never claims either way. For whether a volcano is actually restless,
        see IMO&rsquo;s aviation colour codes on the volcanic systems layer and any
        official warnings above.
      </p>
    </section>
  );
}
