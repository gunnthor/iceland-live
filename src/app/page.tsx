import { Suspense } from "react";
import { detectObservations } from "@/analytics/clusters";
import { buildHistogram } from "@/analytics/histogram";
import { computeStats, filterByRange } from "@/analytics/stats";
import { buildSummary } from "@/analytics/summary";
import { AppShell } from "@/components/AppShell";
import type { EarthquakesResponse } from "@/domain/api";
import { parseTimeRange, resolveWindow } from "@/domain/time-range";
import { getEarthquakeSnapshot } from "@/server/earthquakes";

/**
 * The homepage is the application.
 *
 * The first payload is assembled on the server so the map, the statistics and
 * the summary are present in the initial HTML rather than appearing after a
 * client round-trip. The client takes over from there and polls for updates.
 *
 * A failure here is not fatal: we render the shell with `initialData = null` and
 * the client retries, which keeps a transient IMO hiccup from turning into a
 * blank page.
 */
export const dynamic = "force-dynamic";

type InitialPayload = {
  data: EarthquakesResponse | null;
  /** The server's clock at load time; seeds the client's ticking clock. */
  serverNowMs: number;
};

async function loadInitialData(range: string | undefined): Promise<InitialPayload> {
  const resolved = parseTimeRange(range);
  const now = new Date();

  try {
    const snapshot = await getEarthquakeSnapshot();
    const { from, to } = resolveWindow(resolved, now);

    const quakes = filterByRange(snapshot.quakes, from, to);
    const stats = computeStats(quakes, { from, to });
    const observations = detectObservations({ quakes, from, to, catalogue: snapshot.quakes });

    const data: EarthquakesResponse = {
      ok: true,
      range: resolved,
      window: { from: from.toISOString(), to: to.toISOString() },
      generatedAt: now.toISOString(),
      quakes,
      stats,
      summary: buildSummary(quakes, stats, resolved),
      observations: observations.observations,
      observationWindow: {
        from: observations.window.from,
        to: observations.window.to,
        capped: observations.windowCapped,
      },
      histogram: buildHistogram(quakes, resolved, to),
      meta: snapshot.meta,
    };

    return { data, serverNowMs: now.getTime() };
  } catch (error) {
    console.warn("[page] initial earthquake load failed; the client will retry", error);
    return { data: null, serverNowMs: now.getTime() };
  }
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rangeParam = Array.isArray(params.range) ? params.range[0] : params.range;
  const { data, serverNowMs } = await loadInitialData(rangeParam);

  return (
    // useSearchParams inside AppShell needs a Suspense boundary above it.
    <Suspense fallback={<div className="h-[100dvh] w-full bg-[var(--color-base)]" />}>
      <AppShell initialData={data} serverNowMs={serverNowMs} />
    </Suspense>
  );
}
