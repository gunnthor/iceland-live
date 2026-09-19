/**
 * Thin HTTP client for the IMO public API gateway at https://api.vedur.is.
 *
 * Responsibilities: build URLs, pin the API version, apply a timeout, and turn
 * transport/HTTP problems into `ProviderError`s. It knows nothing about
 * earthquakes or volcanoes.
 */

import { ProviderError } from "@/providers/types";

export const IMO_BASE_URL = process.env.IMO_API_BASE_URL ?? "https://api.vedur.is";

/**
 * Pinned upstream API versions, sent as `x-vi-api-version`.
 *
 * IMO rejects unknown values outright (HTTP 400), which means a bad pin fails
 * loudly at deploy time instead of silently shifting schema under us.
 */
export const IMO_API_VERSIONS = {
  quakes: process.env.IMO_QUAKES_API_VERSION ?? "2026-08-06",
  volcanoes: process.env.IMO_VOLCANOES_API_VERSION ?? "2026-06-04",
  cap: process.env.IMO_CAP_API_VERSION ?? "2026-04-14",
  epos: process.env.IMO_EPOS_API_VERSION ?? "2026-02-05",
  /*
   * The dispersion service versions itself independently of EPOS and rejects
   * anything it does not recognise with HTTP 415 — including EPOS's own
   * version string, which is how this was found.
   */
  dispersion: process.env.IMO_DISPERSION_API_VERSION ?? "2025-08-13",
} as const;

export type ImoService = keyof typeof IMO_API_VERSIONS;

const DEFAULT_TIMEOUT_MS = 15_000;

export type ImoRequest = {
  service: ImoService;
  path: string;
  /** Repeated values are serialised as repeated query parameters. */
  query?: Record<string, string | number | boolean | readonly string[] | undefined>;
  timeoutMs?: number;
  /**
   * Next.js data-cache revalidation window in seconds. On Vercel this cache is
   * shared across instances, so a busy deployment still issues roughly one
   * upstream request per window rather than one per visitor.
   */
  revalidateSeconds?: number;
  signal?: AbortSignal;
};

export function buildImoUrl(request: ImoRequest): string {
  const url = new URL(`/${request.service}${request.path}`, IMO_BASE_URL);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function imoFetch(request: ImoRequest): Promise<Response> {
  const url = buildImoUrl(request);
  const timeout = AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = request.signal
    ? AbortSignal.any([request.signal, timeout])
    : timeout;

  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      headers: {
        "x-vi-api-version": IMO_API_VERSIONS[request.service],
        accept: "application/json, text/csv;q=0.9",
        "user-agent": "IcelandLive/0.1 (+https://live.gunnthor.is)",
      },
      next:
        request.revalidateSeconds === undefined
          ? undefined
          : { revalidate: request.revalidateSeconds },
    });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === "TimeoutError";
    throw new ProviderError(
      "network",
      aborted
        ? `IMO request timed out after ${request.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms: ${url}`
        : `Could not reach the IMO API: ${url}`,
      { cause },
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ProviderError(
      "http",
      `IMO API responded ${response.status} for ${url}${body ? ` — ${body.slice(0, 200)}` : ""}`,
      { status: response.status },
    );
  }

  return response;
}

export async function imoFetchText(request: ImoRequest): Promise<string> {
  const response = await imoFetch(request);
  try {
    return await response.text();
  } catch (cause) {
    throw new ProviderError("parse", `Could not read the IMO response body for ${buildImoUrl(request)}`, { cause });
  }
}

export async function imoFetchJson<T>(request: ImoRequest): Promise<T> {
  const text = await imoFetchText(request);
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new ProviderError("parse", `IMO returned a body that is not valid JSON for ${buildImoUrl(request)}`, { cause });
  }
}

/**
 * Like `imoFetchJson`, but treats an empty body as an explicit "nothing here".
 *
 * The CAP broker answers 204 No Content when no warnings are in force, which is
 * the ordinary state most of the time. That is a successful answer meaning
 * "none", not a malformed one, and parsing it as JSON would fail.
 */
export async function imoFetchJsonOrEmpty<T>(request: ImoRequest): Promise<T | null> {
  const text = (await imoFetchText(request)).trim();
  if (text === "") return null;
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new ProviderError("parse", `IMO returned a body that is not valid JSON for ${buildImoUrl(request)}`, { cause });
  }
}

/** ISO instant in the format the Quakes API documents: `yyyy-mm-ddTHH:MM:SS`. */
export function toImoTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, "");
}
