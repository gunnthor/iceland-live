import { describe, expect, it } from "vitest";
import { horizontalUncertaintyKm, isFixedDepth } from "@/domain/earthquake-detail";
import { ProviderError } from "@/providers/types";
import { normalizeEarthquakeDetail } from "./detail-normalize";

/** A verbatim response for a reviewed M2.8 on the Reykjanes Ridge. */
const REVIEWED = {
  description: { text: "Reykjaneshryggur", type: "region name" },
  magnitude: {
    mag: { value: "2.846847599961043", uncertainty: "0.17447322202634588" },
    type: "ML_SIL",
  },
  origin: {
    time: {
      value: "2026-09-19T12:32:30.314487Z",
      uncertainty: "0.08866921551047467",
      confidenceLevel: "89.99999761581421",
    },
    longitude: {
      value: "-23.883007049560547",
      uncertainty: "0.7769999906560017",
      confidenceLevel: "89.99999761581421",
    },
    latitude: {
      value: "63.49097442626953",
      uncertainty: "1.1814539380458426",
      confidenceLevel: "89.99999761581421",
    },
    depthType: "operator assigned",
    evaluationMode: "manual",
    depth: { value: "10.0", uncertainty: "0", confidenceLevel: "89.99999761581421" },
  },
  type: "earthquake",
};

/** A verbatim response for an unreviewed automatic solution. */
const AUTOMATIC = {
  description: { text: "Kleifarvatn", type: "region name" },
  magnitude: {
    mag: { value: "0.20705319767219044", uncertainty: "0.2973172531284061" },
    type: "ML_SIL",
  },
  origin: {
    time: { value: "2026-09-19T15:21:56.279269Z", uncertainty: "0.7469718248855911", confidenceLevel: "89.99999761581421" },
    longitude: { value: "-21.80459213256836", uncertainty: "1.8854117846066183", confidenceLevel: "89.99999761581421" },
    latitude: { value: "64.1183853149414", uncertainty: "3.760826925941304", confidenceLevel: "89.99999761581421" },
    depthType: "from location",
    evaluationMode: "automatic",
    depth: { value: "9.749305725097656", uncertainty: "10.523990420631922", confidenceLevel: "89.99999761581421" },
  },
};

describe("normalizeEarthquakeDetail", () => {
  it("parses the string-encoded numbers a real response carries", () => {
    const detail = normalizeEarthquakeDetail("IMO2026smblhr", REVIEWED);

    expect(detail.magnitude?.value).toBeCloseTo(2.8468, 4);
    expect(detail.magnitude?.uncertainty).toBeCloseTo(0.1745, 4);
    expect(detail.latitude?.value).toBeCloseTo(63.491, 3);
    expect(detail.longitude?.uncertainty).toBeCloseTo(0.777, 3);
    expect(detail.depthKm?.value).toBe(10);
  });

  it("rounds IMO's floating-point confidence level to a readable 90", () => {
    const detail = normalizeEarthquakeDetail("x", REVIEWED);
    expect(detail.magnitude?.confidenceLevel ?? detail.latitude?.confidenceLevel).toBe(90);
    expect(detail.originTime?.confidenceLevel).toBe(90);
  });

  it("keeps origin time as an ISO instant", () => {
    const detail = normalizeEarthquakeDetail("x", REVIEWED);
    expect(detail.originTime?.iso).toBe("2026-09-19T12:32:30.314Z");
    expect(detail.originTime?.uncertaintySeconds).toBeCloseTo(0.0887, 4);
  });

  it("carries through the region, scale, mode and type", () => {
    const detail = normalizeEarthquakeDetail("x", REVIEWED);
    expect(detail.regionText).toBe("Reykjaneshryggur");
    expect(detail.magnitudeType).toBe("ML_SIL");
    expect(detail.evaluationMode).toBe("manual");
    expect(detail.depthType).toBe("operator assigned");
    expect(detail.eventType).toBe("earthquake");
  });

  it("handles an automatic solution with no event type", () => {
    const detail = normalizeEarthquakeDetail("x", AUTOMATIC);
    expect(detail.evaluationMode).toBe("automatic");
    expect(detail.eventType).toBeNull();
    expect(detail.depthType).toBe("from location");
  });

  it("distinguishes a missing uncertainty from a zero one", () => {
    const detail = normalizeEarthquakeDetail("x", {
      origin: { depth: { value: "5" }, latitude: { value: "64", uncertainty: "0" } },
    });
    expect(detail.depthKm?.uncertainty).toBeNull();
    expect(detail.latitude?.uncertainty).toBe(0);
  });

  it("returns nulls rather than guesses for a sparse payload", () => {
    const detail = normalizeEarthquakeDetail("IMO-x", {});
    expect(detail).toMatchObject({
      id: "IMO-x",
      regionText: null,
      magnitude: null,
      originTime: null,
      latitude: null,
      depthKm: null,
      depthType: null,
      evaluationMode: null,
    });
  });

  it("rejects a non-object payload", () => {
    expect(() => normalizeEarthquakeDetail("x", null)).toThrow(ProviderError);
    expect(() => normalizeEarthquakeDetail("x", "nope")).toThrow(ProviderError);
  });
});

describe("isFixedDepth", () => {
  it("recognises an operator-assigned depth as fixed, not perfectly known", () => {
    // 10.0 km with an uncertainty of exactly 0 means the depth was not
    // determined at all — presenting it as "10.0 ± 0.0 km" would invert that.
    const detail = normalizeEarthquakeDetail("x", REVIEWED);
    expect(detail.depthKm?.uncertainty).toBe(0);
    expect(isFixedDepth(detail)).toBe(true);
  });

  it("does not flag a depth solved for from the data", () => {
    expect(isFixedDepth(normalizeEarthquakeDetail("x", AUTOMATIC))).toBe(false);
  });

  it("does not flag an operator-assigned depth that still carries an error", () => {
    const detail = normalizeEarthquakeDetail("x", {
      origin: { depthType: "operator assigned", depth: { value: "8", uncertainty: "1.5" } },
    });
    expect(isFixedDepth(detail)).toBe(false);
  });
});

describe("horizontalUncertaintyKm", () => {
  it("combines the latitude and longitude errors in quadrature", () => {
    const detail = normalizeEarthquakeDetail("x", REVIEWED);
    // sqrt(1.1815² + 0.7770²) ≈ 1.414
    expect(horizontalUncertaintyKm(detail)).toBeCloseTo(1.414, 3);
  });

  it("is null when either component is missing", () => {
    const detail = normalizeEarthquakeDetail("x", { origin: { latitude: { value: "64" } } });
    expect(horizontalUncertaintyKm(detail)).toBeNull();
  });
});
