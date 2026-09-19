import { describe, expect, it } from "vitest";
import { bandsFor, describeBands } from "./ObservationBands";
import type { ActivityObservation } from "@/analytics/clusters";

function observation(
  id: string,
  from: string,
  to: string,
  headline = "Elevated earthquake activity",
): ActivityObservation {
  return {
    id,
    kind: "dense-cluster",
    headline,
    detail: "",
    method: "",
    span: { from, to },
    eventIds: [],
  };
}

const FROM = Date.parse("2026-09-19T00:00:00.000Z");
const TO = Date.parse("2026-09-20T00:00:00.000Z");

describe("bandsFor", () => {
  it("projects a span inside the window", () => {
    const [band] = bandsFor(
      [observation("a", "2026-09-19T06:00:00.000Z", "2026-09-19T12:00:00.000Z")],
      FROM,
      TO,
    );
    expect(band).toEqual({
      id: "a",
      fromMs: Date.parse("2026-09-19T06:00:00.000Z"),
      toMs: Date.parse("2026-09-19T12:00:00.000Z"),
      label: "Elevated earthquake activity",
    });
  });

  it("clips a span that starts before the window rather than dropping it", () => {
    // It still ran during part of what is on screen, and showing that part is
    // honest in a way that showing nothing is not.
    const [band] = bandsFor(
      [observation("a", "2026-09-18T20:00:00.000Z", "2026-09-19T04:00:00.000Z")],
      FROM,
      TO,
    );
    expect(band?.fromMs).toBe(FROM);
    expect(band?.toMs).toBe(Date.parse("2026-09-19T04:00:00.000Z"));
  });

  it("clips a span that runs past the end", () => {
    const [band] = bandsFor(
      [observation("a", "2026-09-19T22:00:00.000Z", "2026-09-20T06:00:00.000Z")],
      FROM,
      TO,
    );
    expect(band?.fromMs).toBe(Date.parse("2026-09-19T22:00:00.000Z"));
    expect(band?.toMs).toBe(TO);
  });

  it("drops a span with no overlap at all", () => {
    expect(
      bandsFor(
        [observation("a", "2026-09-17T00:00:00.000Z", "2026-09-18T00:00:00.000Z")],
        FROM,
        TO,
      ),
    ).toEqual([]);
  });

  it("drops a zero-length or inverted span", () => {
    expect(
      bandsFor([observation("a", "2026-09-19T06:00:00.000Z", "2026-09-19T06:00:00.000Z")], FROM, TO),
    ).toEqual([]);
    expect(
      bandsFor([observation("a", "2026-09-19T12:00:00.000Z", "2026-09-19T06:00:00.000Z")], FROM, TO),
    ).toEqual([]);
  });

  it("ignores an unparseable span instead of projecting NaN", () => {
    expect(bandsFor([observation("a", "not a date", "also not")], FROM, TO)).toEqual([]);
  });

  it("keeps several bands, in the order given", () => {
    const bands = bandsFor(
      [
        observation("a", "2026-09-19T02:00:00.000Z", "2026-09-19T05:00:00.000Z"),
        observation("b", "2026-09-19T16:00:00.000Z", "2026-09-19T20:00:00.000Z", "Increased frequency"),
      ],
      FROM,
      TO,
    );
    expect(bands.map((band) => band.id)).toEqual(["a", "b"]);
  });
});

describe("describeBands", () => {
  it("says in words what the shading says visually", () => {
    // The bands would otherwise be a purely visual layer, in a product whose
    // claim is that the text and the picture say the same thing.
    const bands = bandsFor(
      [observation("a", "2026-09-19T06:00:00.000Z", "2026-09-19T12:00:00.000Z")],
      FROM,
      TO,
    );
    const text = describeBands(bands, (ms) => new Date(ms).toISOString().slice(11, 16));
    expect(text).toBe(
      " Periods described by the observations: Elevated earthquake activity, 06:00 to 12:00.",
    );
  });

  it("says nothing when there is nothing to say", () => {
    expect(describeBands([], () => "")).toBe("");
  });
});

describe("bands that would mark nothing", () => {
  it("drops a band covering the whole window", () => {
    // "Repeated M2.0+ events" is counted over the window, so its span is the
    // window. A wash across every bar distinguishes nothing and only dims the
    // data underneath.
    expect(
      bandsFor(
        [observation("a", "2026-09-19T00:00:00.000Z", "2026-09-20T00:00:00.000Z")],
        FROM,
        TO,
      ),
    ).toEqual([]);
  });

  it("drops one that covers the window after clipping", () => {
    expect(
      bandsFor(
        [observation("a", "2026-09-17T00:00:00.000Z", "2026-09-21T00:00:00.000Z")],
        FROM,
        TO,
      ),
    ).toEqual([]);
  });

  it("keeps one that covers most but not all of it", () => {
    // Nine tenths still says "not the first two hours", which is information.
    const [band] = bandsFor(
      [observation("a", "2026-09-19T02:24:00.000Z", "2026-09-20T00:00:00.000Z")],
      FROM,
      TO,
    );
    expect(band?.id).toBe("a");
  });
});
