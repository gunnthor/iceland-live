/** Presentation helpers. Formatting only — no derivation of new facts. */

/** `M 3.1`. Magnitudes below zero are shown signed, e.g. `M −0.4`. */
export function formatMagnitude(magnitude: number | null): string {
  if (magnitude === null || !Number.isFinite(magnitude)) return "M —";
  // U+2212 minus sign reads better than a hyphen at small sizes.
  const value = magnitude.toFixed(1).replace("-", "−");
  return `M ${value}`;
}

/** Bare magnitude number, for tight contexts such as map labels. */
export function formatMagnitudeValue(magnitude: number | null): string {
  if (magnitude === null || !Number.isFinite(magnitude)) return "—";
  return magnitude.toFixed(1).replace("-", "−");
}

/** `5.2 km`. */
export function formatDepth(depthKm: number | null): string {
  if (depthKm === null || !Number.isFinite(depthKm)) return "—";
  return `${depthKm.toFixed(1)} km`;
}

/** `63.851° N, 21.450° W` — the convention IMO uses. */
export function formatCoordinates(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(3)}° ${latitude >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(longitude).toFixed(3)}° ${longitude >= 0 ? "E" : "W"}`;
  return `${lat}, ${lon}`;
}

/** Thousands-separated integer. */
export function formatCount(value: number): string {
  return value.toLocaleString("en-GB");
}

/** Human label for IMO's magnitude scale codes. */
export function formatMagnitudeType(type: string | null): string | null {
  if (!type) return null;
  if (type === "ML_SIL") return "ML (local)";
  if (type.startsWith("Mpgv")) return `${type} (peak ground velocity)`;
  return type;
}

/** Joins class names, skipping falsy values. */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
