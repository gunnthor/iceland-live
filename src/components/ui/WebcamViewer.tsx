"use client";

import { useEffect, useState } from "react";
import type { WebcamSite, WebcamView } from "@/domain/webcam";
import { cn } from "@/lib/format";
import { formatClock, formatRelative } from "@/lib/time";

/**
 * A camera site, at a size worth looking at.
 *
 * ## These are stills, not video
 *
 * Vegagerðin publishes periodically refreshed JPEGs and exposes no video
 * stream. Calling this live footage would be a small lie a reader would notice
 * the moment they watched it, so the viewer refreshes on a timer, says plainly
 * what it is, and lets the reader step back through earlier frames.
 *
 * ## Where the earlier frames come from
 *
 * The server keeps what it has already fetched (`src/server/frame-store.ts`),
 * so opening a camera can show the stretch before you arrived rather than a
 * single picture. It holds only what someone was watching, though, so a short
 * reel means nobody had this camera open — not that the camera was down. The
 * panel says which.
 */

/**
 * How often to ask for a new frame.
 *
 * Cadence varies by camera: a busy urban view was measured publishing every
 * minute, a rural one had not moved in seven. Two minutes sits between them —
 * fast enough to keep up with the frequent cameras without asking the slow
 * ones for a picture they have already given us four times over. The repeats
 * that do occur are recognised server-side and discarded rather than stored.
 */
const REFRESH_MS = 120_000;

type StoredFrame = { at: string; url: string };

type ReelResponse = { ok: true; view: string; frames: StoredFrame[] } | { ok: false };

/**
 * The frames the server holds for this view, refreshed alongside the picture.
 *
 * The live request carries `record=1`, which is what files the current frame
 * away; the reel fetch that follows a couple of minutes later then picks it
 * up. So watching a camera is what builds its history, and the next person to
 * open it inherits the result.
 */
function useReel(view: WebcamView): { stored: StoredFrame[]; liveKey: number } {
  const [stored, setStored] = useState<StoredFrame[]>([]);
  const [liveKey, setLiveKey] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch(view.reelUrl, {
          signal: controller.signal,
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        const body = (await response.json()) as ReelResponse;
        if (controller.signal.aborted || !body.ok) return;
        setStored(body.frames);
      } catch {
        // No reel is an ordinary outcome; the live picture is unaffected.
      }
    };

    void load();

    const timer = setInterval(() => {
      if (document.hidden) return;
      setLiveKey(Date.now());
      void load();
    }, REFRESH_MS);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [view.reelUrl]);

  return { stored, liveKey };
}

function ViewPlayer({ view }: { view: WebcamView }) {
  const { stored, liveKey } = useReel(view);
  const [index, setIndex] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  /*
   * The reel is the stored frames with the live picture on the end. The last
   * stored frame is often the same photograph as the live one — the camera
   * has not published since — and that is left visible rather than guessed
   * away: the two carry different labels, and "the last two frames look the
   * same" is a true thing to be able to see.
   */
  const total = stored.length + 1;
  const shown = index === null ? total - 1 : Math.min(index, total - 1);
  const live = shown === total - 1;
  const frame = live ? null : stored[shown];

  return (
    <figure className="m-0">
      <div className="relative">
        {failed && live ? (
          <div className="flex aspect-[4/3] w-full items-center justify-center rounded border border-[var(--color-line)] bg-white/[0.02]">
            <span className="text-[11px] text-[var(--color-ink-faint)]">Image unavailable</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={
              live
                ? `${view.imageUrl}&record=1&t=${liveKey}`
                : (frame?.url ?? view.imageUrl)
            }
            alt={view.description}
            onError={() => setFailed(true)}
            onLoad={() => setFailed(false)}
            className="aspect-[4/3] w-full rounded border border-[var(--color-line)] bg-black object-cover"
          />
        )}

        <span
          className={cn(
            "tnum absolute left-2 top-2 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide",
            live
              ? "bg-[var(--color-alert-green)]/20 text-[var(--color-alert-green)]"
              : "bg-black/70 text-[var(--color-ink-muted)]",
          )}
        >
          {live ? "Latest" : formatClock(frame?.at ?? 0)}
        </span>
      </div>

      <figcaption className="mt-1 flex items-center justify-between gap-2">
        <span className="truncate text-[10px] leading-tight text-[var(--color-ink-faint)]">
          {view.description}
        </span>
        {total > 1 && (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setIndex(Math.max(0, shown - 1))}
              disabled={shown === 0}
              aria-label="Earlier frame"
              className="rounded px-1.5 py-1 text-[11px] text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-30"
            >
              &larr;
            </button>
            <span className="tnum text-[10px] text-[var(--color-ink-faint)]">
              {shown + 1}/{total}
            </span>
            <button
              type="button"
              onClick={() => setIndex(shown + 1 >= total - 1 ? null : shown + 1)}
              disabled={live}
              aria-label="Later frame"
              className="rounded px-1.5 py-1 text-[11px] text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-30"
            >
              &rarr;
            </button>
          </span>
        )}
      </figcaption>

      {stored.length > 0 && (
        <p className="tnum mt-0.5 text-[10px] leading-tight text-[var(--color-ink-faint)]">
          {stored.length} earlier {stored.length === 1 ? "frame" : "frames"} held, back to{" "}
          {formatRelative(stored[0]?.at ?? 0)}
        </p>
      )}
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
            <ViewPlayer key={view.imageUrl} view={view} />
          ))}
        </div>

        <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
          These are still images, not video: the cameras publish a new frame every
          minute or few, and there is no stream to watch. Earlier frames are the
          ones this server has already fetched, so the reel reaches back only as
          far as somebody was watching &mdash; a short reel means nobody had this
          camera open, not that the camera was down. Based on information provided
          by the Icelandic Road and Coastal Administration (IRCA). Iceland Live is
          not affiliated with IRCA.
        </p>
      </div>
    </section>
  );
}
