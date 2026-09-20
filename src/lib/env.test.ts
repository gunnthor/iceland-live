import { describe, expect, it } from "vitest";

import { envOr, envOrNull } from "./env";

describe("envOr", () => {
  it("takes a configured value", () => {
    expect(envOr("https://example.test", "https://fallback.test")).toBe("https://example.test");
  });

  it("falls back when the key is absent", () => {
    expect(envOr(undefined, "https://fallback.test")).toBe("https://fallback.test");
    expect(envOr(null, "https://fallback.test")).toBe("https://fallback.test");
  });

  it("falls back when the key is present and blank", () => {
    /*
     * The case `??` does not cover, and the one that actually happens: a key
     * added to a hosting dashboard and never filled in is `""`, not absent.
     */
    expect(envOr("", "https://fallback.test")).toBe("https://fallback.test");
    expect(envOr("   ", "https://fallback.test")).toBe("https://fallback.test");
    expect(envOr("\n", "https://fallback.test")).toBe("https://fallback.test");
  });

  it("strips the whitespace a paste leaves behind", () => {
    expect(envOr("  https://example.test\n", "https://fallback.test")).toBe(
      "https://example.test",
    );
  });

  it("keeps a value that is falsy but configured", () => {
    // "0" and "false" are things somebody meant to set.
    expect(envOr("0", "1")).toBe("0");
    expect(envOr("false", "true")).toBe("false");
  });
});

describe("envOrNull", () => {
  it("reports a blank key as absent", () => {
    expect(envOrNull("")).toBeNull();
    expect(envOrNull("  ")).toBeNull();
    expect(envOrNull(undefined)).toBeNull();
  });

  it("returns a configured value, trimmed", () => {
    expect(envOrNull(" value ")).toBe("value");
  });
});

describe("the IMO client against a blank environment", () => {
  /*
   * A regression test for an outage rather than for a function.
   *
   * `IMO_API_BASE_URL` was present and empty in production. `IMO_BASE_URL`
   * became "", every `new URL(path, "")` threw ERR_INVALID_URL, and
   * earthquakes, warnings, volcanic status, deformation and dispersion all
   * failed together before a single request left the server. This asserts the
   * shape of that failure can no longer occur.
   */
  it("builds a usable URL from a base that is blank", async () => {
    const original = process.env.IMO_API_BASE_URL;
    process.env.IMO_API_BASE_URL = "";
    try {
      // Imported after the variable is set: the module reads it at load.
      const { IMO_BASE_URL } = await import("@/providers/imo/client");
      expect(() => new URL("/quakes/events", IMO_BASE_URL)).not.toThrow();
      expect(new URL("/quakes/events", IMO_BASE_URL).toString()).toBe(
        "https://api.vedur.is/quakes/events",
      );
    } finally {
      if (original === undefined) delete process.env.IMO_API_BASE_URL;
      else process.env.IMO_API_BASE_URL = original;
    }
  });

  it("never sends a blank version pin, which IMO answers with a 400", async () => {
    const { IMO_API_VERSIONS } = await import("@/providers/imo/client");
    for (const [service, version] of Object.entries(IMO_API_VERSIONS)) {
      expect(version, service).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
