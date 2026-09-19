"use client";

import { useEffect, useMemo, useState } from "react";
import { sitesNearest, type WebcamSite } from "@/domain/webcam";
import { cn } from "@/lib/format";

/**
 * Live road cameras near the activity.
 *
 * The full network is 165 sites nationwide, which is not a useful list. What is
 * useful is "what does it look like near the thing I am reading about", so the
 * list is ordered by distance from wherever the current activity is centred and
 * cut short.
 *
 * Images refresh on a timer by changing a cache-busting key on the `<img>` —
 * the upstream cameras update several times an hour and the proxy caches for a
 * minute, so anything faster would just re-fetch the same bytes.
 */

/** Matches the measured publication rate; see `WebcamViewer`. */
const REFRESH_MS = 120_000;
const NEAREST = 6;

function ViewImage({
  src,
  alt,
  refreshKey,
}: {
  src: string;
  alt: string;
  refreshKey: number;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded border border-[var(--color-line)] bg-white/[0.02]">
        <span className="text-[11px] text-[var(--color-ink-faint)]">Image unavailable</span>
      </div>
    );
  }

  return (
    /*
      A plain img, not next/image: these are third-party, change every minute,
      and must not be run through an optimiser that would cache a road camera.
    */
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${src}&t=${refreshKey}`}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="aspect-[4/3] w-full rounded border border-[var(--color-line)] bg-black object-cover"
    />
  );
}

function SiteRow({
  site,
  expanded,
  onToggle,
  refreshKey,
}: {
  site: WebcamSite;
  expanded: boolean;
  onToggle: () => void;
  refreshKey: number;
}) {
  const views = expanded ? site.views : site.views.slice(0, 1);

  return (
    <li className="border-t border-[var(--color-line)] first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="row-button flex items-baseline gap-2 px-4 py-2.5"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-tight text-[var(--color-ink)]">
            {site.name}
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-[var(--color-ink-dim)]">
            {site.road ?? "—"}
            {site.views.length > 1 && (
              <>
                <span className="px-1.5 text-[var(--color-ink-faint)]">·</span>
                {site.views.length} views
              </>
            )}
          </span>
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--color-ink-faint)]">
          {expanded ? "Less" : "All"}
        </span>
      </button>

      <div className={cn("grid gap-1.5 px-4 pb-3", expanded && site.views.length > 1 && "grid-cols-2")}>
        {views.map((view) => (
          <figure key={view.id} className="m-0">
            <ViewImage src={view.imageUrl} alt={view.description} refreshKey={refreshKey} />
            <figcaption className="mt-1 truncate text-[10px] leading-tight text-[var(--color-ink-faint)]">
              {view.description}
            </figcaption>
          </figure>
        ))}
      </div>
    </li>
  );
}

export function WebcamPanel({
  sites,
  focus,
  attribution,
  loading,
  unavailable,
  onSelectSite,
}: {
  sites: readonly WebcamSite[];
  /** Where the current activity is; the list is ordered by distance from it. */
  focus: { latitude: number; longitude: number } | null;
  attribution: string | null;
  loading: boolean;
  unavailable: boolean;
  onSelectSite: (site: WebcamSite) => void;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setRefreshKey(Date.now()), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const nearest = useMemo(() => {
    if (sites.length === 0) return [];
    if (!focus) return [...sites].slice(0, NEAREST);
    return sitesNearest(sites, focus, NEAREST);
  }, [sites, focus]);

  return (
    <section aria-label="Road cameras" className="border-t border-[var(--color-line)]">
      <div className="flex items-baseline justify-between gap-2 px-4 pb-1 pt-3">
        <h2 className="label">Road cameras</h2>
        <span className="text-[10px] text-[var(--color-ink-faint)]">
          {focus ? "nearest the activity" : "Vegagerðin"}
        </span>
      </div>

      {loading && (
        <p className="px-4 pb-3 text-[11px] text-[var(--color-ink-dim)]">Loading cameras&hellip;</p>
      )}

      {unavailable && (
        <p className="px-4 pb-3 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
          Road cameras could not be loaded. Check{" "}
          <a
            href="https://umferdin.is/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-[var(--color-ink)]"
          >
            umferdin.is
          </a>{" "}
          directly.
        </p>
      )}

      {nearest.length > 0 && (
        <ul className="border-t border-[var(--color-line)]">
          {nearest.map((site) => (
            <SiteRow
              key={site.id}
              site={site}
              expanded={expandedId === site.id}
              refreshKey={refreshKey}
              onToggle={() => {
                const next = expandedId === site.id ? null : site.id;
                setExpandedId(next);
                if (next !== null) onSelectSite(site);
              }}
            />
          ))}
        </ul>
      )}

      {attribution && (
        <p className="border-t border-[var(--color-line)] px-4 py-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
          {attribution}. Still images, refreshed about every two minutes, showing road
          conditions rather than volcanic activity. Select one to watch it. Iceland
          Live is not affiliated with IRCA.
        </p>
      )}
    </section>
  );
}
