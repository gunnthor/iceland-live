import { describe, expect, it } from "vitest";

import { formatPlace, parsePlace, readUrlState } from "./useUrlState";

/** Grindavík, to three decimals — the precision the URL carries. */
const GRINDAVIK = { latitude: 63.842, longitude: -22.438 };

describe("a place in the URL", () => {
  describe("parsing", () => {
    it("reads a coordinate written latitude first", () => {
      expect(parsePlace("63.842,-22.438")).toEqual(GRINDAVIK);
    });

    it("round-trips what it writes", () => {
      expect(parsePlace(formatPlace(GRINDAVIK))).toEqual(GRINDAVIK);
    });

    it("rounds a hand-widened link to the same question we would have asked", () => {
      // Three decimals is what the server rounds to before caching a probe,
      // so a longer coordinate must not miss that entry twice.
      expect(parsePlace("63.8421234,-22.4384999")).toEqual(GRINDAVIK);
    });

    it("tolerates the space a query string can leave behind a comma", () => {
      expect(parsePlace("63.842, -22.438")).toEqual(GRINDAVIK);
    });

    it("refuses a coordinate that is not a pair", () => {
      expect(parsePlace("63.842")).toBeNull();
      expect(parsePlace("63.842,-22.438,120")).toBeNull();
      expect(parsePlace(",")).toBeNull();
      expect(parsePlace("63.842,")).toBeNull();
      expect(parsePlace("")).toBeNull();
      expect(parsePlace(null)).toBeNull();
    });

    it("refuses a coordinate off the globe", () => {
      expect(parsePlace("91,-22.438")).toBeNull();
      expect(parsePlace("-91,-22.438")).toBeNull();
      expect(parsePlace("63.842,181")).toBeNull();
      expect(parsePlace("63.842,-181")).toBeNull();
    });

    it("refuses anything a person did not type as a number", () => {
      /*
       * `Number` would take all of these. A link is something anyone can hand
       * you, and the value reaches an upstream request path.
       */
      expect(parsePlace("0x3f,-22.438")).toBeNull();
      expect(parsePlace("6.3842e1,-22.438")).toBeNull();
      expect(parsePlace("Infinity,-22.438")).toBeNull();
      expect(parsePlace("  ,  ")).toBeNull();
      expect(parsePlace("north,west")).toBeNull();
    });

    it("keeps the poles and the meridian, which are real places", () => {
      expect(parsePlace("90,180")).toEqual({ latitude: 90, longitude: 180 });
      expect(parsePlace("0,0")).toEqual({ latitude: 0, longitude: 0 });
    });
  });

  describe("reading the whole query string", () => {
    it("carries a place beside a run", () => {
      const state = readUrlState(
        new URLSearchParams(
          "plume=1&run=0189c0de-1a2b-4c3d-8e4f-5a6b7c8d9e0f&place=63.842,-22.438",
        ),
      );
      expect(state.pickedPlace).toEqual(GRINDAVIK);
      expect(state.dispersionRunId).toBe("0189c0de-1a2b-4c3d-8e4f-5a6b7c8d9e0f");
    });

    it("survives the encoding a real link puts the comma through", () => {
      /*
       * `URLSearchParams` writes the separator as %2C. That is the whole
       * journey a shared place makes — written into the query string here,
       * read back out of somebody else's address bar — so it is worth
       * asserting rather than assuming.
       */
      const params = new URLSearchParams();
      params.set("place", formatPlace(GRINDAVIK));
      expect(params.toString()).toBe("place=63.842%2C-22.438");

      expect(readUrlState(new URLSearchParams(params.toString())).pickedPlace).toEqual(
        GRINDAVIK,
      );
    });

    it("falls back to no place rather than to an unchecked one", () => {
      expect(readUrlState(new URLSearchParams("place=over+by+the+farm")).pickedPlace).toBeNull();
      expect(readUrlState(new URLSearchParams()).pickedPlace).toBeNull();
    });
  });
});
