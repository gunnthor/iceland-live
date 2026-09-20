/**
 * Frames in an S3-compatible object store.
 *
 * Works against anything that speaks the S3 REST API — AWS S3, Cloudflare R2,
 * Backblaze B2, MinIO — which is what makes the frame store durable on
 * serverless, where the only writable path is per instance and temporary.
 *
 * ## No SDK
 *
 * Four operations are needed: PUT, GET, DELETE and LIST. All four are plain
 * HTTPS with a signature, and `src/server/aws-sigv4.ts` produces the
 * signature. Pulling in an SDK for this would multiply the dependency count of
 * the entire project several times over.
 *
 * ## Parsing the listing with a regular expression
 *
 * `ListObjectsV2` returns XML. A general-purpose XML parser is not needed to
 * read a flat list of `<Contents>` elements whose shape S3 specifies, and the
 * alternative is another dependency. If the parse finds nothing the store sees
 * an empty listing, which degrades to "we hold no frames" rather than to an
 * error.
 *
 * ## Honest status
 *
 * The signing is checked against the worked example in AWS's own
 * documentation, and the operations are exercised against a local server that
 * verifies each signature independently. Neither is the same as having run it
 * against a real bucket, which has not been done.
 */

import { sha256Hex, signRequest } from "./aws-sigv4";
import { warnOnce, type BackendFrame, type FrameBackend } from "./frame-backend";

export type S3Config = {
  /** e.g. `https://abc123.r2.cloudflarestorage.com` — scheme and host only. */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Key prefix inside the bucket. */
  prefix: string;
};

const REQUEST_TIMEOUT_MS = 20_000;

/** Present only when every part is configured; partial config is no config. */
export function s3ConfigFromEnv(): S3Config | null {
  const endpoint = process.env.ICELAND_LIVE_S3_ENDPOINT?.trim();
  const bucket = process.env.ICELAND_LIVE_S3_BUCKET?.trim();
  const accessKeyId = process.env.ICELAND_LIVE_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.ICELAND_LIVE_S3_SECRET_ACCESS_KEY?.trim();

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    bucket,
    // R2 and several others accept "auto"; AWS needs the real region.
    region: process.env.ICELAND_LIVE_S3_REGION?.trim() || "auto",
    accessKeyId,
    secretAccessKey,
    prefix: (process.env.ICELAND_LIVE_S3_PREFIX?.trim() || "iceland-live/frames").replace(
      /^\/+|\/+$/g,
      "",
    ),
  };
}

function keyFor(config: S3Config, view: string, at: number): string {
  return `${config.prefix}/${view}/${at}.jpg`;
}

/** `…/<view>/<capture ms>.jpg` -> the two parts, or null for anything else. */
export function parseKey(
  prefix: string,
  key: string,
): { view: string; at: number } | null {
  const tail = key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : null;
  if (!tail) return null;
  const match = /^([0-9a-f]{16})\/(\d+)\.jpg$/.exec(tail);
  if (!match?.[1] || !match[2]) return null;
  const at = Number(match[2]);
  return Number.isSafeInteger(at) ? { view: match[1], at } : null;
}

/**
 * Reads `<Contents>` out of a ListObjectsV2 response.
 *
 * Exported so the parse can be tested against a captured response rather than
 * only through the network path.
 */
export function parseListing(
  xml: string,
): { objects: Array<{ key: string; size: number }>; next: string | null } {
  const objects: Array<{ key: string; size: number }> = [];

  for (const block of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const body = block[1] ?? "";
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(body)?.[1];
    const size = Number(/<Size>(\d+)<\/Size>/.exec(body)?.[1] ?? NaN);
    if (key && Number.isFinite(size)) objects.push({ key, size });
  }

  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];

  return { objects, next: truncated && token ? token : null };
}

async function send(
  config: S3Config,
  method: string,
  key: string,
  options: { query?: Record<string, string>; body?: Uint8Array } = {},
): Promise<Response> {
  const url = new URL(`${config.endpoint}/${config.bucket}/${key}`);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(name, value);
  }

  const { headers } = signRequest({
    method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: { host: url.host },
    payloadHash: sha256Hex(options.body ?? ""),
    region: config.region,
    service: "s3",
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    date: new Date(),
  });

  return fetch(url, {
    method,
    headers: options.body ? { ...headers, "content-type": "image/jpeg" } : headers,
    body: options.body as BodyInit | undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
}

export function createS3FrameBackend(config: S3Config): FrameBackend {
  async function listPrefix(prefix: string): Promise<Array<{ key: string; size: number }>> {
    const objects: Array<{ key: string; size: number }> = [];
    let token: string | null = null;

    // Bounded: the store's own caps keep the object count in the hundreds, so
    // this is a guard against a runaway loop rather than real pagination depth.
    for (let page = 0; page < 20; page += 1) {
      const query: Record<string, string> = { "list-type": "2", prefix };
      if (token) query["continuation-token"] = token;

      const response: Response = await send(config, "GET", "", { query });
      if (!response.ok) {
        warnOnce(`list ${response.status}`, await response.text().catch(() => ""));
        return objects;
      }

      const page_ = parseListing(await response.text());
      objects.push(...page_.objects);
      token = page_.next;
      if (!token) break;
    }

    return objects;
  }

  return {
    name: "s3",

    async put(view, at, body) {
      const response = await send(config, "PUT", keyFor(config, view, at), { body });
      if (!response.ok) {
        throw new Error(`object store refused PUT (${response.status})`);
      }
    },

    async get(view, at) {
      let response: Response;
      try {
        response = await send(config, "GET", keyFor(config, view, at));
      } catch (error) {
        warnOnce("get", error);
        return null;
      }
      // A frame trimmed for budget is legitimately gone; not worth a warning.
      if (response.status === 404) return null;
      if (!response.ok) {
        warnOnce(`get ${response.status}`, await response.text().catch(() => ""));
        return null;
      }
      return Buffer.from(await response.arrayBuffer());
    },

    async remove(view, at) {
      try {
        await send(config, "DELETE", keyFor(config, view, at));
      } catch (error) {
        warnOnce("delete", error);
      }
    },

    async list(view) {
      try {
        const frames: BackendFrame[] = [];
        for (const object of await listPrefix(`${config.prefix}/${view}/`)) {
          // Key and size are paired here rather than after a filter: mapping
          // then filtering then indexing back into the original array pairs
          // each surviving key with the wrong object's size.
          const parsed = parseKey(config.prefix, object.key);
          if (parsed) frames.push({ at: parsed.at, bytes: object.size });
        }
        return frames;
      } catch (error) {
        warnOnce(`list ${view}`, error);
        return [];
      }
    },

    async listAll() {
      const all = new Map<string, BackendFrame[]>();
      let objects: Array<{ key: string; size: number }>;
      try {
        objects = await listPrefix(`${config.prefix}/`);
      } catch (error) {
        warnOnce("list all", error);
        return all;
      }

      for (const object of objects) {
        const parsed = parseKey(config.prefix, object.key);
        if (!parsed) continue;
        const frames = all.get(parsed.view) ?? [];
        frames.push({ at: parsed.at, bytes: object.size });
        all.set(parsed.view, frames);
      }
      return all;
    },
  };
}
