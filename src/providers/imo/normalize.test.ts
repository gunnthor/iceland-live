import { describe, expect, it } from "vitest";
import { ProviderError } from "@/providers/types";
import { normalizeQuakesCsv, parseCsv, toIsoInstant } from "./normalize";

const HEADER =
  "event_id,time,latitude,longitude,depth,magnitude,magnitude_type,status,evaluation_mode,type,region,update_time";

/** A row in the exact shape IMO returns. */
function row(overrides: Partial<Record<string, string>> = {}): string {
  const base: Record<string, string> = {
    event_id: "IMO2026sklvqn",
    time: "2026-09-18T15:36:16.255055Z",
    latitude: "63.851048",
    longitude: "-21.450094",
    depth: "0.201645",
    magnitude: "0.438902",
    magnitude_type: "ML_SIL",
    status: "reviewed",
    evaluation_mode: "manual",
    type: "earthquake",
    region: "Ölfus",
    update_time: "2026-09-19T10:11:34.621621Z",
  };
  const merged = { ...base, ...overrides };
  return HEADER.split(",")
    .map((column) => merged[column] ?? "")
    .join(",");
}

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("parseCsv", () => {
  it("reads plain rows", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('a,b\n"Reykjanes, south",2')).toEqual([
      ["a", "b"],
      ["Reykjanes, south", "2"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([["a"], ['say "hi"']]);
  });

  it("preserves empty trailing fields", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });
});

describe("toIsoInstant", () => {
  it("truncates microsecond precision to milliseconds", () => {
    expect(toIsoInstant("2026-09-18T15:36:16.255055Z")).toBe("2026-09-18T15:36:16.255Z");
  });

  it("treats a missing zone designator as UTC, per the Quakes API docs", () => {
    expect(toIsoInstant("2026-09-18T15:36:16")).toBe("2026-09-18T15:36:16.000Z");
  });

  it("respects an explicit offset", () => {
    expect(toIsoInstant("2026-09-18T15:36:16+02:00")).toBe("2026-09-18T13:36:16.000Z");
  });

  it("returns null for junk", () => {
    expect(toIsoInstant("not a date")).toBeNull();
    expect(toIsoInstant(null)).toBeNull();
  });
});

describe("normalizeQuakesCsv", () => {
  it("normalizes a full row into the domain model", () => {
    const { quakes, skipped } = normalizeQuakesCsv(csv(row()));

    expect(skipped).toBe(0);
    expect(quakes).toHaveLength(1);
    expect(quakes[0]).toEqual({
      id: "IMO2026sklvqn",
      occurredAt: "2026-09-18T15:36:16.255Z",
      updatedAt: "2026-09-19T10:11:34.621Z",
      latitude: 63.851048,
      longitude: -21.450094,
      depthKm: 0.201645,
      magnitude: 0.438902,
      magnitudeType: "ML_SIL",
      region: "Ölfus",
      eventType: "earthquake",
      reviewStatus: "reviewed",
      evaluationMode: "manual",
      source: "IMO",
    });
  });

  it("resolves columns by name, not position", () => {
    // Same data, columns reordered — a positional parser would scramble this.
    const reordered = ["region,latitude,event_id,longitude,time", "Hengill,64.1,IMO-X,-21.2,2026-09-18T12:00:00Z"].join("\n");
    const { quakes } = normalizeQuakesCsv(reordered);

    expect(quakes[0]).toMatchObject({
      id: "IMO-X",
      region: "Hengill",
      latitude: 64.1,
      longitude: -21.2,
    });
  });

  it("maps IMO status 'confirmed' to an automatic review state", () => {
    const { quakes } = normalizeQuakesCsv(
      csv(row({ status: "confirmed", evaluation_mode: "automatic", type: "" })),
    );
    expect(quakes[0]?.reviewStatus).toBe("automatic");
    expect(quakes[0]?.evaluationMode).toBe("automatic");
  });

  it("falls back to evaluation_mode when status is absent", () => {
    const { quakes } = normalizeQuakesCsv(csv(row({ status: "", evaluation_mode: "manual" })));
    expect(quakes[0]?.reviewStatus).toBe("reviewed");
  });

  it("reports an unknown review state when neither field is usable", () => {
    const { quakes } = normalizeQuakesCsv(csv(row({ status: "", evaluation_mode: "" })));
    expect(quakes[0]?.reviewStatus).toBe("unknown");
    expect(quakes[0]?.evaluationMode).toBeNull();
  });

  it("represents an unclassified event type as null rather than a guess", () => {
    const { quakes } = normalizeQuakesCsv(csv(row({ type: "" })));
    expect(quakes[0]?.eventType).toBeNull();
  });

  it("keeps event types that are absent from the documented enum", () => {
    const { quakes } = normalizeQuakesCsv(csv(row({ type: "ice quake" })));
    expect(quakes[0]?.eventType).toBe("ice quake");
  });

  it("keeps negative magnitudes, which are ordinary in Iceland", () => {
    const { quakes } = normalizeQuakesCsv(csv(row({ magnitude: "-1.341" })));
    expect(quakes[0]?.magnitude).toBeCloseTo(-1.341);
  });

  it("represents a missing magnitude or depth as null, not zero", () => {
    const { quakes } = normalizeQuakesCsv(csv(row({ magnitude: "", depth: "" })));
    expect(quakes[0]?.magnitude).toBeNull();
    expect(quakes[0]?.depthKm).toBeNull();
  });

  it("keeps a genuine zero depth distinct from a missing one", () => {
    const { quakes } = normalizeQuakesCsv(csv(row({ depth: "0" })));
    expect(quakes[0]?.depthKm).toBe(0);
  });

  it("skips rows that cannot be placed on a map", () => {
    const { quakes, skipped } = normalizeQuakesCsv(
      csv(row(), row({ event_id: "IMO-B", latitude: "" }), row({ event_id: "IMO-C", longitude: "junk" })),
    );
    expect(quakes).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it("skips rows with out-of-range coordinates", () => {
    const { quakes, skipped } = normalizeQuakesCsv(csv(row({ latitude: "191.2" })));
    expect(quakes).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("skips rows without a usable timestamp", () => {
    const { skipped } = normalizeQuakesCsv(csv(row({ time: "yesterday" })));
    expect(skipped).toBe(1);
  });

  it("sorts newest first", () => {
    const { quakes } = normalizeQuakesCsv(
      csv(
        row({ event_id: "old", time: "2026-09-18T10:00:00Z" }),
        row({ event_id: "new", time: "2026-09-18T18:00:00Z" }),
        row({ event_id: "mid", time: "2026-09-18T14:00:00Z" }),
      ),
    );
    expect(quakes.map((quake) => quake.id)).toEqual(["new", "mid", "old"]);
  });

  it("tolerates a trailing newline", () => {
    const { quakes, skipped } = normalizeQuakesCsv(`${csv(row())}\n`);
    expect(quakes).toHaveLength(1);
    expect(skipped).toBe(0);
  });

  it("rejects an empty body", () => {
    expect(() => normalizeQuakesCsv("")).toThrow(ProviderError);
  });

  it("rejects a payload missing required columns, naming what was missing", () => {
    expect(() => normalizeQuakesCsv("event_id,time\nIMO-A,2026-09-18T10:00:00Z")).toThrow(
      /latitude, longitude/,
    );
  });
});
