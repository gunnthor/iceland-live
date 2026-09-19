/**
 * Live integration check against the real IMO API.
 *
 * Excluded from `npm test` on purpose: it needs network access and asserts
 * against a catalogue that changes by the minute, so it would make the unit
 * suite flaky and slow. Run it deliberately when you want to confirm the
 * upstream contract still holds:
 *
 *   npm run test:live
 *
 * It is the check to reach for after an IMO API version bump, or when output
 * looks wrong and you need to know whether the problem is ours or upstream's.
 */

import { describe, expect, it } from "vitest";
import { detectObservations } from "@/analytics/clusters";
import { buildHistogram } from "@/analytics/histogram";
import { computeStats, filterByRange, tallyByRegion } from "@/analytics/stats";
import { buildSummary } from "@/analytics/summary";
import { TIME_RANGE_IDS, resolveWindow } from "@/domain/time-range";
import { getEarthquakeSnapshot } from "@/server/earthquakes";
import { getVolcanicSystems } from "@/server/volcanoes";

describe("live IMO integration", () => {
  it("pulls a real catalogue and computes every derived view", async () => {
    const snapshot = await getEarthquakeSnapshot();
    console.log(`\nprovider=${snapshot.meta.providerId} freshness=${snapshot.meta.freshness}`);
    console.log(`30-day catalogue: ${snapshot.quakes.length} events`);
    expect(snapshot.quakes.length).toBeGreaterThan(0);

    const now = new Date();
    for (const range of TIME_RANGE_IDS) {
      const { from, to } = resolveWindow(range, now);
      const quakes = filterByRange(snapshot.quakes, from, to);
      const stats = computeStats(quakes, { from, to });
      const summary = buildSummary(quakes, stats, range);
      const { observations, windowCapped } = detectObservations({ quakes, from, to });
      const histogram = buildHistogram(quakes, range, to);

      console.log(
        `\n[${range}] n=${stats.count} largest=${stats.largest?.magnitude?.toFixed(2) ?? "-"} ` +
          `deepest=${stats.deepest?.depthKm?.toFixed(1) ?? "-"}km reviewed=${stats.reviewedCount} ` +
          `bins=${histogram.bins.length} peak=${histogram.peakCount} obs=${observations.length}${windowCapped ? ' (capped 48h)' : ''}`,
      );
      console.log(`  summary: ${summary.text}`);
      for (const o of observations) console.log(`  · ${o.headline}: ${o.detail}`);

      expect(histogram.bins.length).toBeGreaterThan(0);
      expect(stats.count).toBe(quakes.length);
    }

    const top = tallyByRegion(filterByRange(snapshot.quakes, ...Object.values(resolveWindow("7d", now)) as [Date, Date]));
    console.log(`\ntop regions (7d): ${top.slice(0, 5).map((r) => `${r.region}=${r.count}`).join(", ")}`);
  }, 60_000);

  it("pulls real volcanic systems with official alert status", async () => {
    const { systems, meta } = await getVolcanicSystems();
    console.log(`\nvolcanic systems: ${systems.length} (provider=${meta.providerId})`);
    expect(systems.length).toBeGreaterThan(20);

    const withGeometry = systems.filter((s) => s.features.length > 0);
    console.log(`with geometry: ${withGeometry.length}`);
    const elevated = systems.filter(
      (s) => (s.aviation && s.aviation.colour !== "GREEN") || (s.alertLevel?.level ?? 0) > 0,
    );
    for (const s of elevated) {
      console.log(
        `  ${s.name}: aviation=${s.aviation?.colour} alert=${s.alertLevel?.code}(${s.alertLevel?.level})`,
      );
    }
    const rey = systems.find((s) => s.code === "REY");
    console.log(`  Reykjanes features: ${rey?.features.map((f) => f.featureType).join(", ")}`);
    expect(withGeometry.length).toBeGreaterThan(20);
  }, 60_000);
});
