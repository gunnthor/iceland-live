"use client";

import { useEffect, useState } from "react";
import type { WebcamSite } from "@/domain/webcam";
import { cn } from "@/lib/format";

/**
 * A camera site, at a size worth looking at.
 *
 * ## These are stills, not video
 *
 * Vegagerðin publishes periodically refreshed JPEGs — measured at a few minutes
 * between updates — and exposes no video stream. Calling this live footage would
 * be a small lie that a reader would notice the moment they watched it, so the
 * viewer refreshes on a timer, shows how old the picture is, and says plainly
 * what it is.
 *
 * Frames fetched during the session are kept so they can be stepped through.
 * That is the nearest honest thing to footage: it is genuinely what the camera
 * saw, just assembled here rather than streamed.
 */

/**
 * How often to ask for a new frame.
 *
 * Measured against a live camera, the published image changes roughly every two
 * minutes. Polling faster than the source updates just collects duplicate
 * frames and asks Vegagerðin for bytes nobody needs.
 */
const REFRESH_MS = 120_000;
/** Frames kept per view — half an hour at the rate above. */
const MAX_FRAMES = 15;

type Frame = { key: number; url: string };

/**
 * Collects frames for one camera view.
 *
 * The component is keyed by its image URL, so switching camera remounts it and
 * the reel starts fresh from the state initialiser. That is why there is no
 * effect here resetting state when the prop changes — remounting does it, and
 * does it without an extra render.
 */
function useFrames(imageUrl: string, active: boolean): Frame[] {
  const [frames, setFrames] = useState<Frame[]>(() => [
    { key: Date.now(), url: `${imageUrl}&t=${Date.now()}` },
  ]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      const key = Date.now();
      setFrames((existing) =>
        [...existing, { key, url: `${imageUrl}&t=${key}` }].slice(-MAX_FRAMES),
      );
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [imageUrl, active]);

  return frames;
}

function ViewPlayer({ imageUrl, alt }: { imageUrl: string; alt: string }) {
  const frames = useFrames(imageUrl, true);
  const [index, setIndex] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  // Following the live edge unless the reader has stepped back.
  const shown = index === null ? frames.length - 1 : Math.min(index, frames.length - 1);
  const frame = frames[shown];
  const live = shown === frames.length - 1;

  return (
    <figure className="m-0">
      <div className="relative">
        {failed ? (
          <div className="flex aspect-[4/3] w-full items-center justify-center rounded border border-[var(--color-line)] bg-white/[0.02]">
            <span className="text-[11px] text-[var(--color-ink-faint)]">Image unavailable</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={frame?.url}
            alt={alt}
            onError={() => setFailed(true)}
            className="aspect-[4/3] w-full rounded border border-[var(--color-line)] bg-black object-cover"
          />
        )}

        <span
          className={cn(
            "absolute left-2 top-2 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide",
            live
              ? "bg-[var(--color-alert-green)]/20 text-[var(--color-alert-green)]"
              : "bg-black/60 text-[var(--color-ink-muted)]",
          )}
        >
          {live ? "Latest" : `${frames.length - shown - 1} back`}
        </span>
      </div>

      <figcaption className="mt-1 flex items-center justify-between gap-2">
        <span className="truncate text-[10px] leading-tight text-[var(--color-ink-faint)]">
          {alt}
        </span>
        {frames.length > 1 && (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setIndex(Math.max(0, shown - 1))}
              disabled={shown === 0}
              aria-label="Previous frame"
              className="rounded px-1.5 py-1 text-[11px] text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-30"
            >
              &larr;
            </button>
            <span className="tnum text-[10px] text-[var(--color-ink-faint)]">
              {shown + 1}/{frames.length}
            </span>
            <button
              type="button"
              onClick={() => setIndex(shown + 1 >= frames.length - 1 ? null : shown + 1)}
              disabled={live}
              aria-label="Next frame"
              className="rounded px-1.5 py-1 text-[11px] text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-30"
            >
              &rarr;
            </button>
          </span>
        )}
      </figcaption>
    </figure>
  );
}

export function WebcamViewer({
  site,
  onClose,
  onLocate,
}: {
  site: WebcamSite;
  onClose: () => void;
  onLocate: () => void;
}) {
  return (
    <section aria-label={`Camera: ${site.name}`} className="animate-fade-rise">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--color-line)] bg-[rgb(9_12_17/0.92)] px-4 py-2.5 backdrop-blur-sm">
        <button
          type="button"
          onClick={onClose}
          className="-ml-1.5 flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-[var(--color-ink-dim)] transition-colors duration-150 hover:bg-white/[0.05] hover:text-[var(--color-ink)]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M7.5 2.5 4 6l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back
        </button>
        <button
          type="button"
          onClick={onLocate}
          className="rounded px-2 py-1 text-[11px] text-[var(--color-ink-dim)] transition-colors duration-150 hover:bg-white/[0.05] hover:text-[var(--color-ink)]"
        >
          Centre on map
        </button>
      </header>

      <div className="px-4 pb-4 pt-3">
        <h2 className="text-[15px] font-medium leading-tight text-[var(--color-ink)]">
          {site.name}
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--color-ink-dim)]">
          {site.road ?? "—"}
          {site.roadNumber && <> &middot; road {site.roadNumber}</>}
          <span className="px-1.5 text-[var(--color-ink-faint)]">&middot;</span>
          {site.views.length} {site.views.length === 1 ? "view" : "views"}
        </p>

        <div className="mt-3 space-y-3">
          {site.views.map((view) => (
            /* Keyed by URL so switching camera remounts with a fresh reel. */
            <ViewPlayer
              key={view.imageUrl}
              imageUrl={view.imageUrl}
              alt={view.description}
            />
          ))}
        </div>

        <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
          These are still images, not video: the cameras publish a new frame about
          every two minutes and there is no stream to watch. This page collects the
          frames while it is open, so you can step back through what the camera
          actually saw. Based on information provided by the
          Icelandic Road and Coastal Administration (IRCA). Iceland Live is not
          affiliated with IRCA.
        </p>
      </div>
    </section>
  );
}
