import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import {
  createS3FrameBackend,
  parseKey,
  parseListing,
  s3ConfigFromEnv,
  type S3Config,
} from "./frame-backend-s3";
import { sha256Hex, signRequest } from "./aws-sigv4";

describe("parseKey", () => {
  it("reads the view and the capture time out of a key", () => {
    expect(parseKey("p/frames", "p/frames/1f02942065450070/1789857966000.jpg")).toEqual({
      view: "1f02942065450070",
      at: 1789857966000,
    });
  });

  it("refuses anything that is not a key this backend writes", () => {
    expect(parseKey("p/frames", "other/1f02942065450070/1.jpg")).toBeNull();
    expect(parseKey("p/frames", "p/frames/NOTHEX/1.jpg")).toBeNull();
    expect(parseKey("p/frames", "p/frames/1f02942065450070/notatime.jpg")).toBeNull();
    expect(parseKey("p/frames", "p/frames/1f02942065450070/1.png")).toBeNull();
  });
});

describe("parseListing", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Name>bucket</Name>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>p/frames/aaaaaaaaaaaaaaaa/100.jpg</Key><Size>2048</Size></Contents>
  <Contents><Key>p/frames/aaaaaaaaaaaaaaaa/200.jpg</Key><Size>4096</Size></Contents>
</ListBucketResult>`;

  it("reads keys and sizes", () => {
    expect(parseListing(xml).objects).toEqual([
      { key: "p/frames/aaaaaaaaaaaaaaaa/100.jpg", size: 2048 },
      { key: "p/frames/aaaaaaaaaaaaaaaa/200.jpg", size: 4096 },
    ]);
    expect(parseListing(xml).next).toBeNull();
  });

  it("follows a truncated listing", () => {
    const truncated = xml
      .replace("<IsTruncated>false</IsTruncated>", "<IsTruncated>true</IsTruncated>")
      .replace("</ListBucketResult>", "<NextContinuationToken>tok/en=</NextContinuationToken></ListBucketResult>");
    expect(parseListing(truncated).next).toBe("tok/en=");
  });

  it("ignores a token when the listing is not truncated", () => {
    const odd = xml.replace(
      "</ListBucketResult>",
      "<NextContinuationToken>stale</NextContinuationToken></ListBucketResult>",
    );
    expect(parseListing(odd).next).toBeNull();
  });

  it("returns nothing rather than throwing on an unexpected body", () => {
    // A store answering something unparseable degrades to "we hold nothing",
    // which the caller already handles, rather than to an exception.
    expect(parseListing("<Error><Code>AccessDenied</Code></Error>").objects).toEqual([]);
    expect(parseListing("").objects).toEqual([]);
  });
});

describe("s3ConfigFromEnv", () => {
  const keys = [
    "ICELAND_LIVE_S3_ENDPOINT",
    "ICELAND_LIVE_S3_BUCKET",
    "ICELAND_LIVE_S3_ACCESS_KEY_ID",
    "ICELAND_LIVE_S3_SECRET_ACCESS_KEY",
    "ICELAND_LIVE_S3_REGION",
    "ICELAND_LIVE_S3_PREFIX",
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterAll(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("is absent until every required part is set", () => {
    expect(s3ConfigFromEnv()).toBeNull();
    process.env.ICELAND_LIVE_S3_ENDPOINT = "https://example.com";
    process.env.ICELAND_LIVE_S3_BUCKET = "bucket";
    // Half-configured storage is worse than none: it would look enabled and
    // fail on every write.
    expect(s3ConfigFromEnv()).toBeNull();
    process.env.ICELAND_LIVE_S3_ACCESS_KEY_ID = "key";
    process.env.ICELAND_LIVE_S3_SECRET_ACCESS_KEY = "secret";
    expect(s3ConfigFromEnv()).not.toBeNull();
  });

  it("defaults the region and prefix, and trims stray slashes", () => {
    process.env.ICELAND_LIVE_S3_ENDPOINT = "https://example.com/";
    process.env.ICELAND_LIVE_S3_BUCKET = "bucket";
    process.env.ICELAND_LIVE_S3_ACCESS_KEY_ID = "key";
    process.env.ICELAND_LIVE_S3_SECRET_ACCESS_KEY = "secret";
    process.env.ICELAND_LIVE_S3_PREFIX = "/a/b/";
    expect(s3ConfigFromEnv()).toMatchObject({
      endpoint: "https://example.com",
      region: "auto",
      prefix: "a/b",
    });
  });
});

/**
 * A stand-in object store that checks every signature.
 *
 * It recomputes the signature from the request it actually received and
 * compares it with the one in the `Authorization` header, so a request whose
 * signed form and sent form disagree — the failure mode this whole module has
 * to get right — is rejected exactly as a real store would reject it.
 *
 * This is not the same as having run against a real bucket, which has not
 * been done; the signature itself is checked against AWS's published worked
 * example in `aws-sigv4.test.ts`.
 */
function startStore(config: Omit<S3Config, "endpoint">) {
  const objects = new Map<string, Buffer>();
  const rejected: string[] = [];

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

      const authorization = request.headers.authorization ?? "";
      const amzDate = String(request.headers["x-amz-date"] ?? "");
      const signedHeaders =
        /SignedHeaders=([^,]+)/.exec(authorization)?.[1]?.split(";") ?? [];

      const headers: Record<string, string> = {};
      for (const name of signedHeaders) {
        if (name === "x-amz-date" || name === "x-amz-content-sha256") continue;
        headers[name] = String(request.headers[name] ?? "");
      }

      const expected = signRequest({
        method: request.method ?? "GET",
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers,
        payloadHash: sha256Hex(body),
        region: config.region,
        service: "s3",
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        // Signed for the instant the client claimed, so the comparison is of
        // the request and not of two clocks.
        date: new Date(
          `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T` +
            `${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`,
        ),
      });

      if (expected.headers.authorization !== authorization) {
        rejected.push(`${request.method} ${url.pathname}${url.search}`);
        response.writeHead(403).end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
        return;
      }

      const key = decodeURIComponent(url.pathname.replace(`/${config.bucket}/`, ""));

      if (request.method === "PUT") {
        objects.set(key, body);
        response.writeHead(200).end();
        return;
      }
      if (request.method === "DELETE") {
        objects.delete(key);
        response.writeHead(204).end();
        return;
      }
      if (url.searchParams.get("list-type") === "2") {
        const prefix = url.searchParams.get("prefix") ?? "";
        const contents = [...objects.entries()]
          .filter(([name]) => name.startsWith(prefix))
          .map(([name, value]) => `<Contents><Key>${name}</Key><Size>${value.length}</Size></Contents>`)
          .join("");
        response
          .writeHead(200, { "content-type": "application/xml" })
          .end(`<ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
        return;
      }

      const object = objects.get(key);
      if (!object) {
        response.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>");
        return;
      }
      response.writeHead(200, { "content-type": "image/jpeg" }).end(object);
    });
  });

  return { server, objects, rejected };
}

describe("the S3 backend against a signature-checking store", () => {
  const base = {
    bucket: "frames-bucket",
    region: "auto",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "s3cr3t/key+value",
    prefix: "iceland-live/frames",
  };

  let store: ReturnType<typeof startStore>;
  let server: Server;
  let backend: ReturnType<typeof createS3FrameBackend>;
  const VIEW = "1f02942065450070";

  beforeAll(async () => {
    store = startStore(base);
    server = store.server;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    backend = createS3FrameBackend({ ...base, endpoint: `http://127.0.0.1:${port}` });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("round-trips a frame", async () => {
    const body = new Uint8Array([1, 2, 3, 4, 5]);
    await backend.put(VIEW, 1000, body);
    expect(store.objects.has(`${base.prefix}/${VIEW}/1000.jpg`)).toBe(true);

    const read = await backend.get(VIEW, 1000);
    expect(read && [...read]).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns null for a frame it does not hold, rather than throwing", async () => {
    expect(await backend.get(VIEW, 999_999)).toBeNull();
  });

  it("lists a view with sizes", async () => {
    await backend.put(VIEW, 2000, new Uint8Array(10));
    const frames = await backend.list(VIEW);
    expect(frames.sort((a, b) => a.at - b.at)).toEqual([
      { at: 1000, bytes: 5 },
      { at: 2000, bytes: 10 },
    ]);
  });

  it("lists everything grouped by view", async () => {
    const other = "abcdef0123456789";
    await backend.put(other, 3000, new Uint8Array(7));
    const all = await backend.listAll();
    expect(all.get(VIEW)).toHaveLength(2);
    expect(all.get(other)).toEqual([{ at: 3000, bytes: 7 }]);
  });

  it("removes a frame", async () => {
    await backend.remove(VIEW, 1000);
    expect(await backend.get(VIEW, 1000)).toBeNull();
    expect((await backend.list(VIEW)).map((frame) => frame.at)).toEqual([2000]);
  });

  it("throws on a refused write, so the store can report it", async () => {
    // A silent failure here would mean frames disappearing with nothing said.
    const wrong = createS3FrameBackend({
      ...base,
      endpoint: (backend as unknown as { endpoint?: string }).endpoint ??
        `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      secretAccessKey: "the wrong secret",
    });
    await expect(wrong.put(VIEW, 4000, new Uint8Array(3))).rejects.toThrow(/refused PUT/);
  });

  it("signed every request it made correctly", () => {
    // One entry here would mean a request was signed in one form and sent in
    // another — the failure this module exists to avoid.
    expect(store.rejected).toEqual(["PUT /frames-bucket/iceland-live/frames/1f02942065450070/4000.jpg"]);
  });
});
