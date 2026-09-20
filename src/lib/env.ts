/**
 * Reading configuration out of the environment.
 *
 * ## Why this is a module and not `??`
 *
 * `process.env.X ?? fallback` falls back on `undefined`, and on nothing else.
 * A variable that exists and is blank passes straight through — and hosting
 * dashboards produce exactly that. Adding a key to a Vercel project without
 * filling it in, or scaffolding a project from a template that lists the keys
 * it expects, leaves `X=""` in the environment of every deployment.
 *
 * That has already taken this site down once. `IMO_API_BASE_URL` was present
 * and empty in production, so `IMO_BASE_URL` became `""`, and every call to
 * `new URL("/quakes/events", "")` threw `ERR_INVALID_URL` before a request was
 * ever made. Earthquakes, warnings, volcanic status, deformation and
 * dispersion all failed at once, in under half a second, with `code: internal`
 * — the one error shape that means "this is our bug", which it was.
 *
 * A blank variable is not a configured value. It is the absence of one written
 * down, and it has to be read as absence, which is what this does.
 */

/**
 * The value, or the fallback when it is missing or blank.
 *
 * Takes the value rather than the name so that `process.env.SOMETHING` is
 * still written literally at the call site: bundlers rewrite that form, and
 * `process.env[name]` would defeat them.
 *
 * Surrounding whitespace is stripped. A value pasted from a dashboard with a
 * trailing newline is the same value, and " " is as empty as "".
 */
export function envOr(value: string | undefined | null, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/** The value, or `null` when it is missing or blank. */
export function envOrNull(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
