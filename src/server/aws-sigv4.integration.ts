/**
 * Does real AWS S3 accept the shape of our signed requests?
 *
 * Run it deliberately:  npm run test:live -- aws-sigv4
 *
 * ## What this can check without credentials
 *
 * S3 parses and validates the `Authorization` header *before* it checks the
 * signature: the credential scope, the signed-headers list, `x-amz-date` and
 * `x-amz-content-sha256` all have to be well-formed for it to get as far as
 * looking a key up. So signing with the example key pair from AWS's own
 * documentation — which is not a real account — and receiving
 * `InvalidAccessKeyId` means every structural part of the request was
 * acceptable to the real service, and only the key was wrong.
 *
 * The negative control is what makes that a signal rather than a default: a
 * deliberately malformed header gets a different error, so the codes are being
 * earned rather than always returned.
 *
 * ## What it cannot check
 *
 * That a bucket accepts a PUT, returns the object on GET, and pages a listing.
 * Those need credentials, and this has still never been run against a real
 * bucket. `frame-backend-s3.test.ts` exercises them against a local server,
 * and `aws-sigv4.test.ts` reproduces AWS's published worked example.
 *
 * It sends one anonymous request that is certain to be refused, to a bucket
 * name that does not exist, and reads nothing.
 */

import { describe, expect, it } from "vitest";
import { sha256Hex, signRequest } from "@/server/aws-sigv4";

/** From AWS's own SigV4 documentation. Not a real account. */
const EXAMPLE_KEY = "AKIAIOSFODNN7EXAMPLE";
const EXAMPLE_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

const BUCKET = "iceland-live-signing-check-does-not-exist";
const KEY = "iceland-live/frames/1f02942065450070/1789857966000.jpg";

function errorCode(body: string): string | null {
  return /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? null;
}

describe("AWS S3 accepts our request shape", () => {
  const url = new URL(`https://s3.amazonaws.com/${BUCKET}/${KEY}`);

  it("gets as far as the key lookup, which means the header parsed", async () => {
    const { headers } = signRequest({
      method: "GET",
      path: url.pathname,
      headers: { host: url.host },
      payloadHash: sha256Hex(""),
      region: "us-east-1",
      service: "s3",
      accessKeyId: EXAMPLE_KEY,
      secretAccessKey: EXAMPLE_SECRET,
      date: new Date(),
    });

    const response = await fetch(url, { headers });
    const code = errorCode(await response.text());
    console.log(`\nsigned request -> ${response.status} ${code}`);

    expect(response.status).toBe(403);
    /*
     * The structural rejections. Any of these would mean the request never
     * reached the signature check:
     *   AuthorizationHeaderMalformed — scope or header list wrong
     *   InvalidArgument / InvalidRequest — a required header missing or bad
     *   AccessDenied — sent unsigned
     */
    expect(code).toBe("InvalidAccessKeyId");
  });

  it("gives a different error for a malformed header, so the above is a signal", async () => {
    /*
     * Everything valid except the credential scope, and signed for *now* — so
     * the difference in response is about the header's structure and not
     * about a stale clock, which S3 rejects first with RequestTimeTooSkewed.
     */
    const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");

    const response = await fetch(url, {
      headers: {
        authorization:
          "AWS4-HMAC-SHA256 Credential=nonsense, " +
          "SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=nope",
        "x-amz-date": amzDate,
        "x-amz-content-sha256": sha256Hex(""),
      },
    });
    const code = errorCode(await response.text());
    console.log(`malformed scope -> ${response.status} ${code}`);

    // S3 objects to the header itself rather than looking a key up.
    expect(code).toBe("AuthorizationHeaderMalformed");
  });
});
