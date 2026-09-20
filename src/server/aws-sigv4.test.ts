import { describe, expect, it } from "vitest";
import { canonicalQuery, canonicalUri, sha256Hex, signRequest, uriEncode } from "./aws-sigv4";

/** SHA-256 of the empty string, which S3 sends for a bodyless request. */
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/*
 * The worked example from AWS's own Signature Version 4 documentation
 * ("Example: GET Object"). The canonical request, the string to sign and the
 * final signature below are AWS's published values, not ones derived here —
 * which is what makes this a check against the specification rather than a
 * check that the code agrees with itself.
 */
describe("the AWS worked example", () => {
  const signed = signRequest({
    method: "GET",
    path: "/test.txt",
    headers: { host: "examplebucket.s3.amazonaws.com", range: "bytes=0-9" },
    payloadHash: EMPTY,
    region: "us-east-1",
    service: "s3",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    date: new Date("2013-05-24T00:00:00Z"),
  });

  it("assembles AWS's canonical request", () => {
    expect(signed.canonicalRequest).toBe(
      [
        "GET",
        "/test.txt",
        "",
        "host:examplebucket.s3.amazonaws.com",
        "range:bytes=0-9",
        `x-amz-content-sha256:${EMPTY}`,
        "x-amz-date:20130524T000000Z",
        "",
        "host;range;x-amz-content-sha256;x-amz-date",
        EMPTY,
      ].join("\n"),
    );
  });

  it("assembles AWS's string to sign", () => {
    expect(signed.stringToSign).toBe(
      [
        "AWS4-HMAC-SHA256",
        "20130524T000000Z",
        "20130524/us-east-1/s3/aws4_request",
        "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972",
      ].join("\n"),
    );
  });

  it("derives AWS's signature", () => {
    expect(signed.signature).toBe(
      "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("puts the credential scope and signed headers in the authorization header", () => {
    expect(signed.headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });
});

describe("uriEncode", () => {
  it("encodes the characters encodeURIComponent leaves alone", () => {
    // A path with an apostrophe would otherwise sign one way and be sent
    // another, which surfaces as an unexplained 403.
    expect(uriEncode("a!b'c(d)e*f")).toBe("a%21b%27c%28d%29e%2Af");
  });

  it("leaves the unreserved set alone", () => {
    expect(uriEncode("aZ09-_.~")).toBe("aZ09-_.~");
  });

  it("encodes a slash, so a segment cannot escape its position", () => {
    expect(uriEncode("a/b")).toBe("a%2Fb");
  });
});

describe("canonicalUri", () => {
  it("encodes each segment and keeps the separators", () => {
    expect(canonicalUri("/bucket/some key/frame.jpg")).toBe("/bucket/some%20key/frame.jpg");
  });

  it("maps an empty path to a single slash", () => {
    expect(canonicalUri("")).toBe("/");
  });
});

describe("canonicalQuery", () => {
  it("sorts by encoded name", () => {
    expect(canonicalQuery({ prefix: "a/", "list-type": "2" })).toBe("list-type=2&prefix=a%2F");
  });

  it("encodes both sides", () => {
    expect(canonicalQuery({ "continuation-token": "a+b/c=" })).toBe(
      "continuation-token=a%2Bb%2Fc%3D",
    );
  });

  it("is empty when there is no query", () => {
    expect(canonicalQuery({})).toBe("");
  });
});

describe("signing details that fail silently when wrong", () => {
  const base = {
    method: "PUT" as const,
    path: "/bucket/frames/abc/1.jpg",
    headers: { host: "example.com" },
    region: "auto",
    service: "s3",
    accessKeyId: "key",
    secretAccessKey: "secret",
    date: new Date("2026-09-20T06:30:00Z"),
  };

  it("signs the payload hash the caller gives it", () => {
    const body = new TextEncoder().encode("frame bytes");
    const signed = signRequest({ ...base, payloadHash: sha256Hex(body) });
    expect(signed.canonicalRequest.endsWith(sha256Hex(body))).toBe(true);
    expect(signed.headers["x-amz-content-sha256"]).toBe(sha256Hex(body));
  });

  it("lowercases and sorts header names", () => {
    const signed = signRequest({
      ...base,
      headers: { Host: "example.com", "Content-Type": "image/jpeg" },
      payloadHash: EMPTY,
    });
    expect(signed.canonicalRequest).toContain(
      "content-type:image/jpeg\nhost:example.com\nx-amz-content-sha256:",
    );
    expect(signed.headers.authorization).toContain(
      "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date",
    );
  });

  it("collapses whitespace inside a header value", () => {
    const signed = signRequest({
      ...base,
      headers: { host: "example.com", "x-thing": "  a   b  " },
      payloadHash: EMPTY,
    });
    expect(signed.canonicalRequest).toContain("x-thing:a b\n");
  });

  it("changes the signature when the date changes", () => {
    const a = signRequest({ ...base, payloadHash: EMPTY });
    const b = signRequest({ ...base, payloadHash: EMPTY, date: new Date("2026-09-21T06:30:00Z") });
    expect(a.signature).not.toBe(b.signature);
  });
});
