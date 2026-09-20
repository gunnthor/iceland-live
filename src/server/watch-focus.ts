/**
 * Where the camera recorder should be pointed.
 *
 * ## Why this is not just "the busiest region"
 *
 * Earthquake count is a proxy for "where is something happening", and it is
 * often the wrong one. A hundred small events on the Reykjanes Ridge is an
 * ordinary Tuesday; a landslide warning over Seyðisfjörður with no seismicity
 * at all is the thing anyone would actually want to look at. Official status
 * says more about where to look than a count does, so it is asked first.
 *
 * ## The ladder
 *
 * Deliberately a precedence ladder rather than a weighted score. A score that
 * blends warnings, colour codes and event counts has to answer "why is it
 * looking there" with arithmetic nobody can check; a ladder answers it with a
 * sentence, and the recorder reports which rung fired.
 *
 *  1. **A geological warning in force**, most serious first.
 *  2. **A volcano at orange or red** on IMO's aviation scale.
 *  3. **The busiest seismic region**, which is where this started.
 *  4. **The default map view**, when there is nothing at all to point at.
 *
 * ## Two deliberate exclusions
 *
 * **Weather warnings.** Iceland has them most weeks over large parts of the
 * country, and a wind warning covering the south would hold the recorder there
 * indefinitely. They matter for driving and are shown in the interface; they
 * are not a reason to stop watching a volcano.
 *
 * **Yellow aviation codes.** Yellow means "signs of elevated unrest", and
 * Icelandic systems sit at yellow for months or years at a time. Treating it
 * as a trigger would pin the recorder to whichever system has been restless
 * longest and never release it. Orange and red are exceptional, which is what
 * makes them useful here.
 *
 * Nothing on this ladder is a hazard judgement of ours. Each rung relays
 * somebody else's published status, or counts events.
 */

import type { RegionTally } from "@/analytics/stats";
import { isGeological, sortAlerts, preferEnglish, type OfficialAlert } from "@/domain/alert";
import { aviationRank, type VolcanicSystem } from "@/domain/volcano";
import { DEFAULT_FOCUS } from "@/lib/geo";

/** Which rung of the ladder chose the point. */
export type FocusReason = "official-warning" | "aviation-code" | "seismicity" | "default";

export type WatchFocus = {
  latitude: number;
  longitude: number;
  reason: FocusReason;
  /** What the rung matched, for the log and the report. */
  label: string | null;
};

/**
 * The mean of a polygon's vertices.
 *
 * Not an area centroid, and not claimed to be one — IMO's warning areas are
 * large forecast regions and this only has to answer "roughly where". Named
 * for what it is so nobody later mistakes it for a centroid computation.
 */
function vertexMean(polygon: GeoJSON.Polygon): { latitude: number; longitude: number } | null {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length === 0) return null;

  let latitude = 0;
  let longitude = 0;
  let count = 0;
  for (const position of ring) {
    const [lon, lat] = position as [number, number];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    latitude += lat;
    longitude += lon;
    count += 1;
  }
  if (count === 0) return null;
  return { latitude: latitude / count, longitude: longitude / count };
}

function defaultFocus(): WatchFocus {
  const { bounds } = DEFAULT_FOCUS;
  return {
    latitude: (bounds.north + bounds.south) / 2,
    longitude: (bounds.east + bounds.west) / 2,
    reason: "default",
    label: null,
  };
}

export type FocusInput = {
  alerts: readonly OfficialAlert[];
  systems: readonly VolcanicSystem[];
  /** Busiest first, as `tallyByRegion` returns them. */
  regions: readonly RegionTally[];
};

export function chooseFocus({ alerts, systems, regions }: FocusInput): WatchFocus {
  // 1. A geological warning, most serious first. Only one with a drawn area is
  //    usable: a warning we cannot place is not a place to point a camera.
  for (const alert of sortAlerts(alerts.filter(isGeological))) {
    for (const area of alert.areas) {
      if (!area.geometry) continue;
      const point = vertexMean(area.geometry);
      if (!point) continue;
      const event = preferEnglish(alert.event) ?? alert.alertType ?? "Geological warning";
      const where = preferEnglish(area.description);
      return {
        ...point,
        reason: "official-warning",
        label: where ? `${event} — ${where}` : event,
      };
    }
  }

  // 2. Orange or red on IMO's aviation scale, most serious first.
  const elevated = systems
    .filter(
      (system) =>
        system.latitude !== null &&
        system.longitude !== null &&
        aviationRank(system.aviation?.colour) >= aviationRank("ORANGE"),
    )
    .sort((a, b) => aviationRank(b.aviation?.colour) - aviationRank(a.aviation?.colour));

  const volcano = elevated[0];
  if (volcano) {
    return {
      latitude: volcano.latitude as number,
      longitude: volcano.longitude as number,
      reason: "aviation-code",
      label: `${volcano.name} — aviation ${volcano.aviation?.colour.toLowerCase() ?? "elevated"}`,
    };
  }

  // 3. The busiest region with a position.
  const busiest = regions.find((region) => region.centre !== null);
  if (busiest?.centre) {
    return { ...busiest.centre, reason: "seismicity", label: busiest.region };
  }

  // 4. Nothing to point at. "No earthquakes anywhere" is not a reason to stop
  //    watching the peninsula with the eruptions on it.
  return defaultFocus();
}
