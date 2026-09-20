/**
 * AWS Signature Version 4, for S3-compatible object stores.
 *
 * ## Why this is written out rather than installed
 *
 * The AWS SDK is tens of megabytes and this codebase has four runtime
 * dependencies on purpose. What is actually needed is four HMACs and a
 * carefully assembled string, all of which `node:crypto` already provides.
 *
 * The spec is unforgiving about details that look cosmetic — header ordering,
 * which characters are encoded, whether the payload hash is of the body or the
 * literal string `UNSIGNED-PAYLOAD` — and every one of them turns into an
 * opaque 403. Each is called out below, and the whole thing is checked against
 * the worked example in AWS's own documentation in the tests.
 */

import { createHash, createHmac } from "node:crypto";

export const ALGORITHM = "AWS4-HMAC-SHA256";

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

/**
 * RFC 3986 percent-encoding.
 *
 * `encodeURIComponent` leaves `!'()*` alone, and AWS does not. A path
 * containing an apostrophe would sign one way and be sent another, which
 * fails as a signature mismatch and looks like a credentials problem.
 */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Each path segment encoded, the separators left alone. */
export function canonicalUri(path: string): string {
  if (path === "") return "/";
  return path
    .split("/")
    .map((segment) => uriEncode(segment))
    .join("/");
}

/** Sorted by encoded name, then by encoded value. */
export function canonicalQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([name, value]) => [uriEncode(name), uriEncode(value)] as const)
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

export type SignInput = {
  method: string;
  /** Path only, beginning with `/`. Not encoded yet. */
  path: string;
  query?: Record<string, string>;
  /** Header names in any case; they are lowercased here. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the body, or `UNSIGNED-PAYLOAD`. */
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** The instant to sign for. Injected so the tests can pin it. */
  date: Date;
};

export type SignedRequest = {
  /** Headers to send, including the ones signing added. */
  headers: Record<string, string>;
  /** Exposed for the tests and for debugging a rejection. */
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
};

/**
 * Signs a request, returning the headers to send.
 *
 * The caller supplies `host` in `headers`; everything else the signature needs
 * — `x-amz-date`, `x-amz-content-sha256`, `authorization` — is added here, so
 * there is no way to sign a set of headers and then send a different one.
 */
export function signRequest(input: SignInput): SignedRequest {
  const amzDate = input.date.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    ...input.headers,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": input.payloadHash,
  };

  /*
   * Canonical headers: lowercase names, values with surrounding whitespace
   * trimmed and internal runs collapsed, sorted by name, each on its own line
   * with a trailing newline — including the last.
   */
  const normalised = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalHeaders = normalised.map(([name, value]) => `${name}:${value}\n`).join("");
  const signedHeaders = normalised.map(([name]) => name).join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(input.path),
    canonicalQuery(input.query ?? {}),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  // The signing key is derived down the scope, one HMAC per component.
  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return {
    headers: {
      ...headers,
      authorization:
        `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    canonicalRequest,
    stringToSign,
    signature,
  };
}
