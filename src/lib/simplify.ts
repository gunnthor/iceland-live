/**
 * Geometry simplification, for datasets mapped at survey precision.
 *
 * The Reykjanes lava outlines are published with a vertex roughly every ten
 * metres — 5.5 MB of GeoJSON for twelve polygons. At the zoom levels where
 * they are visible that detail is well below one pixel, so it is bandwidth
 * spent on nothing. Simplifying to a 20 m tolerance keeps the shapes visually
 * identical and cuts the payload to about 2% of the original.
 *
 * Ramer–Douglas–Peucker, run on raw lon/lat. Over a single Icelandic lava
 * field the distortion from not projecting first is far smaller than the
 * tolerance itself.
 */

type Position = GeoJSON.Position;

/** Degrees of latitude per metre; close enough for a tolerance parameter. */
const DEGREES_PER_METRE = 1 / 111_320;

function perpendicularDistance(point: Position, start: Position, end: Position): number {
  const [px, py] = point as [number, number];
  const [sx, sy] = start as [number, number];
  const [ex, ey] = end as [number, number];

  const dx = ex - sx;
  const dy = ey - sy;

  if (dx === 0 && dy === 0) return Math.hypot(px - sx, py - sy);

  const t = ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (sx + clamped * dx), py - (sy + clamped * dy));
}

/**
 * Iterative Douglas–Peucker.
 *
 * Iterative rather than recursive on purpose: one published outline has
 * 226,776 vertices, and the recursive form blows the stack on a degenerate
 * split long before it finishes.
 */
function douglasPeucker(points: Position[], tolerance: number): Position[] {
  if (points.length < 3) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const segment = stack.pop();
    if (!segment) break;
    const [first, last] = segment;
    if (last <= first + 1) continue;

    let maxDistance = 0;
    let index = first;
    const start = points[first] as Position;
    const end = points[last] as Position;

    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicularDistance(points[i] as Position, start, end);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }

    if (maxDistance > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i] === 1);
}

function roundPosition(position: Position, decimals: number): Position {
  const factor = 10 ** decimals;
  return [
    Math.round((position[0] as number) * factor) / factor,
    Math.round((position[1] as number) * factor) / factor,
  ];
}

/**
 * Simplifies a closed ring, keeping it closed and valid.
 *
 * Returns `null` when simplification would collapse the ring below the four
 * positions a GeoJSON linear ring requires — a sliver small enough to vanish
 * at this tolerance is better dropped than emitted as invalid geometry.
 */
function simplifyRing(ring: Position[], tolerance: number, decimals: number): Position[] | null {
  const simplified = douglasPeucker(ring, tolerance).map((p) => roundPosition(p, decimals));
  if (simplified.length < 4) return null;

  const first = simplified[0] as Position;
  const last = simplified[simplified.length - 1] as Position;
  if (first[0] !== last[0] || first[1] !== last[1]) simplified.push(first);

  return simplified.length >= 4 ? simplified : null;
}

function simplifyLine(line: Position[], tolerance: number, decimals: number): Position[] | null {
  const simplified = douglasPeucker(line, tolerance).map((p) => roundPosition(p, decimals));
  return simplified.length >= 2 ? simplified : null;
}

export type SimplifyOptions = {
  /** Tolerance in metres. */
  toleranceM?: number;
  /** Coordinate decimal places to keep. 5 dp is about one metre. */
  decimals?: number;
};

/** Simplifies any geometry, leaving point geometries untouched. */
export function simplifyGeometry(
  geometry: GeoJSON.Geometry,
  { toleranceM = 20, decimals = 5 }: SimplifyOptions = {},
): GeoJSON.Geometry | null {
  const tolerance = toleranceM * DEGREES_PER_METRE;

  switch (geometry.type) {
    case "Point":
    case "MultiPoint":
      return geometry;

    case "LineString": {
      const line = simplifyLine(geometry.coordinates, tolerance, decimals);
      return line ? { type: "LineString", coordinates: line } : null;
    }

    case "MultiLineString": {
      const lines = geometry.coordinates
        .map((line) => simplifyLine(line, tolerance, decimals))
        .filter((line): line is Position[] => line !== null);
      return lines.length > 0 ? { type: "MultiLineString", coordinates: lines } : null;
    }

    case "Polygon": {
      const rings = geometry.coordinates
        .map((ring) => simplifyRing(ring, tolerance, decimals))
        .filter((ring): ring is Position[] => ring !== null);
      return rings.length > 0 ? { type: "Polygon", coordinates: rings } : null;
    }

    case "MultiPolygon": {
      const polygons = geometry.coordinates
        .map((polygon) =>
          polygon
            .map((ring) => simplifyRing(ring, tolerance, decimals))
            .filter((ring): ring is Position[] => ring !== null),
        )
        .filter((polygon) => polygon.length > 0);
      return polygons.length > 0 ? { type: "MultiPolygon", coordinates: polygons } : null;
    }

    default:
      return geometry;
  }
}

/** Simplifies every feature in a collection, dropping any that collapse. */
export function simplifyFeatureCollection<P extends GeoJSON.GeoJsonProperties>(
  collection: GeoJSON.FeatureCollection<GeoJSON.Geometry, P>,
  options: SimplifyOptions = {},
): GeoJSON.FeatureCollection<GeoJSON.Geometry, P> {
  const features: Array<GeoJSON.Feature<GeoJSON.Geometry, P>> = [];

  for (const feature of collection.features) {
    if (!feature.geometry) continue;
    const geometry = simplifyGeometry(feature.geometry, options);
    if (geometry) features.push({ ...feature, geometry });
  }

  return { type: "FeatureCollection", features };
}
