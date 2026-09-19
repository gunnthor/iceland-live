/** Geographic helpers. All distances are in kilometres. */

const EARTH_RADIUS_KM = 6371.0088;
const DEG_TO_RAD = Math.PI / 180;

export type LatLon = { latitude: number; longitude: number };

export type BoundingBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/**
 * Great-circle distance via the haversine formula.
 *
 * Accurate to well under a percent at Icelandic scales, which is far finer than
 * the location uncertainty IMO reports for individual events.
 */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = (b.latitude - a.latitude) * DEG_TO_RAD;
  const dLon = (b.longitude - a.longitude) * DEG_TO_RAD;
  const lat1 = a.latitude * DEG_TO_RAD;
  const lat2 = b.latitude * DEG_TO_RAD;

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Mean position of a set of points. Adequate for the small extents we cluster over. */
export function centroid(points: readonly LatLon[]): LatLon | null {
  if (points.length === 0) return null;
  let lat = 0;
  let lon = 0;
  for (const p of points) {
    lat += p.latitude;
    lon += p.longitude;
  }
  return { latitude: lat / points.length, longitude: lon / points.length };
}

/** Degrees of longitude spanning one kilometre at a given latitude. */
export function lonDegreesPerKm(latitude: number): number {
  const scale = Math.cos(latitude * DEG_TO_RAD);
  // Guard against the poles; irrelevant for Iceland but keeps the maths total.
  return 1 / (111.32 * Math.max(scale, 1e-6));
}

/** Degrees of latitude spanning one kilometre. Constant to the precision we need. */
export const LAT_DEGREES_PER_KM = 1 / 110.574;

/** Expands a bounding box by a margin in kilometres. */
export function padBounds(box: BoundingBox, marginKm: number): BoundingBox {
  const midLat = (box.north + box.south) / 2;
  const dLat = marginKm * LAT_DEGREES_PER_KM;
  const dLon = marginKm * lonDegreesPerKm(midLat);
  return {
    west: box.west - dLon,
    south: box.south - dLat,
    east: box.east + dLon,
    north: box.north + dLat,
  };
}

/** Named map viewpoints used by the quick-focus controls. */
export type MapFocus = {
  id: string;
  label: string;
  /** Short line explaining what the viewpoint shows. */
  description: string;
  bounds: BoundingBox;
};

/**
 * Quick-focus viewpoints.
 *
 * These are framing hints for the camera only — they carry no scientific
 * meaning and are not used in any statistic. Adding Svartsengi, Sundhnúkur or
 * Grindavík later is a matter of appending entries here.
 */
export const MAP_FOCUSES: readonly MapFocus[] = [
  {
    id: "iceland",
    label: "Iceland",
    description: "The whole monitored area",
    bounds: { west: -24.9, south: 63.15, east: -13.3, north: 66.8 },
  },
  {
    id: "reykjanes",
    label: "Reykjanes",
    description: "Reykjanes peninsula and ridge",
    bounds: { west: -23.2, south: 63.72, east: -21.2, north: 64.16 },
  },
];

export const DEFAULT_FOCUS = MAP_FOCUSES[0] as MapFocus;
