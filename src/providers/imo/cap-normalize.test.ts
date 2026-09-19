import { describe, expect, it } from "vitest";
import { alertRank, isGeological, sortAlerts, type OfficialAlert } from "@/domain/alert";
import { capPolygonToGeoJson, dropExpired, normalizeCapMessage } from "./cap-normalize";

/**
 * A verbatim CAP message from IMO's broker, trimmed only in polygon length.
 * Both language variants are present, as they are in live data.
 */
const REAL_MESSAGE = {
  alert: {
    "@xmlns": "urn:oasis:names:tc:emergency:cap:1.2",
    identifier: "is-IMO-bd4a3341-5bde-4b21-afad-3a5caffcad56",
    info: [
      {
        area: {
          areaDesc: "Suðausturland",
          geocode: { value: "Suðausturland", valueName: "Spásvæði" },
          polygon: "63.9,-22.1 64.0,-22.3 63.8,-22.5 63.9,-22.1",
        },
        category: "Met",
        certainty: "Likely",
        contact: "forecaster@vedur.is",
        description:
          "Norðan 15-20 m/s og vindhviður staðbundið yfir 30 m/s.",
        event: "Veðurviðvörun: Vindur",
        eventCode: { value: "Wind", valueName: "alertType" },
        expires: "2026-09-07T16:00:00-00:00",
        headline: "Norðan hvassviðri og snarpar vindhviður",
        language: "is-IS",
        onset: "2026-09-06T21:00:00-00:00",
        parameter: { value: "Yellow", valueName: "Color" },
        responseType: "AllClear",
        senderName: "IMO - Meteorologist on duty",
        severity: "Moderate",
        urgency: "Future",
        web: "http://www.vedur.is/#spasvaedi=sa",
      },
      {
        area: {
          areaDesc: "Southeast Iceland",
          geocode: { value: "Southeast Iceland", valueName: "Forecast Region" },
          polygon: "63.9,-22.1 64.0,-22.3 63.8,-22.5 63.9,-22.1",
        },
        category: "Met",
        certainty: "Likely",
        contact: "forecaster@vedur.is",
        description: "Northerly gale (15-20 m/s) and gust locally over 30 m/s.",
        event: "Weather Warning: Wind",
        eventCode: { value: "Wind", valueName: "alertType" },
        expires: "2026-09-07T16:00:00-00:00",
        headline: "North gale and strong windgust",
        language: "en-US",
        onset: "2026-09-06T21:00:00-00:00",
        parameter: { value: "Yellow", valueName: "Color" },
        responseType: "AllClear",
        senderName: "IMO - Meteorologist on duty",
        severity: "Moderate",
        urgency: "Future",
        web: "http://en.vedur.is/#forec_area=sa",
      },
    ],
    msgType: "Alert",
    scope: "Public",
    sender: "IMO-Icelandic_Met_Office",
    sent: "2026-09-06T09:46:38-00:00",
    status: "Actual",
  },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("capPolygonToGeoJson", () => {
  it("swaps CAP's lat,lon order into GeoJSON's [lon, lat]", () => {
    // Read the wrong way round this Icelandic warning lands in the Indian Ocean.
    const polygon = capPolygonToGeoJson("66.5,-22.9 66.6,-22.4 66.1,-21.0 66.5,-22.9");
    const ring = polygon?.coordinates[0] as Array<[number, number]>;

    expect(ring[0]).toEqual([-22.9, 66.5]);
    expect(ring[0]?.[0]).toBeLessThan(0); // longitude, west of Greenwich
    expect(ring[0]?.[1]).toBeGreaterThan(60); // latitude, Icelandic
  });

  it("closes an unclosed ring", () => {
    const polygon = capPolygonToGeoJson("63.9,-22.1 64.0,-22.3 63.8,-22.5");
    const ring = polygon?.coordinates[0] as Array<[number, number]>;
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);
  });

  it("leaves an already-closed ring alone", () => {
    const polygon = capPolygonToGeoJson("63.9,-22.1 64.0,-22.3 63.8,-22.5 63.9,-22.1");
    expect(polygon?.coordinates[0]).toHaveLength(4);
  });

  it("skips malformed and out-of-range points", () => {
    const polygon = capPolygonToGeoJson("63.9,-22.1 garbage 999,-22.3 64.0,-22.3 63.8,-22.5");
    const ring = polygon?.coordinates[0] as Array<[number, number]>;
    expect(ring).toHaveLength(4);
    expect(ring.every(([lon, lat]) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180)).toBe(true);
  });

  it("returns null when there are too few usable points", () => {
    expect(capPolygonToGeoJson("63.9,-22.1 64.0,-22.3")).toBeNull();
    expect(capPolygonToGeoJson("")).toBeNull();
    expect(capPolygonToGeoJson(null)).toBeNull();
  });
});

describe("normalizeCapMessage", () => {
  it("normalizes a real bilingual IMO warning", () => {
    const alert = normalizeCapMessage(REAL_MESSAGE) as OfficialAlert;

    expect(alert.id).toBe("is-IMO-bd4a3341-5bde-4b21-afad-3a5caffcad56");
    expect(alert.sender).toBe("IMO-Icelandic_Met_Office");
    expect(alert.senderName).toBe("IMO - Meteorologist on duty");
    expect(alert.messageType).toBe("Alert");
    expect(alert.category).toBe("Met");
    expect(alert.alertType).toBe("Wind");
    expect(alert.severity).toBe("Moderate");
    expect(alert.urgency).toBe("Future");
    expect(alert.certainty).toBe("Likely");
    expect(alert.colour).toBe("Yellow");
  });

  it("keeps both languages rather than discarding the Icelandic", () => {
    const alert = normalizeCapMessage(REAL_MESSAGE) as OfficialAlert;
    expect(alert.event.en).toBe("Weather Warning: Wind");
    expect(alert.event.is).toBe("Veðurviðvörun: Vindur");
    expect(alert.headline.en).toBe("North gale and strong windgust");
    expect(alert.headline.is).toBe("Norðan hvassviðri og snarpar vindhviður");
  });

  it("prefers the English variant for the primary fields", () => {
    const alert = normalizeCapMessage(REAL_MESSAGE) as OfficialAlert;
    expect(alert.url).toBe("http://en.vedur.is/#forec_area=sa");
    expect(alert.areas[0]?.description.en).toBe("Southeast Iceland");
  });

  it("normalizes timestamps to ISO instants", () => {
    const alert = normalizeCapMessage(REAL_MESSAGE) as OfficialAlert;
    expect(alert.sentAt).toBe("2026-09-06T09:46:38.000Z");
    expect(alert.onsetAt).toBe("2026-09-06T21:00:00.000Z");
    expect(alert.expiresAt).toBe("2026-09-07T16:00:00.000Z");
  });

  it("converts the area polygon", () => {
    const alert = normalizeCapMessage(REAL_MESSAGE) as OfficialAlert;
    expect(alert.areas).toHaveLength(1);
    expect(alert.areas[0]?.geometry?.type).toBe("Polygon");
  });

  // --- The XML-to-JSON collapse ---

  it("handles a single-language message where `info` is an object", () => {
    const single = clone(REAL_MESSAGE) as unknown as { alert: { info: unknown } };
    single.alert.info = clone(REAL_MESSAGE.alert.info[1]);

    const alert = normalizeCapMessage(single) as OfficialAlert;
    expect(alert.event.en).toBe("Weather Warning: Wind");
    expect(alert.event.is).toBeNull();
    expect(alert.colour).toBe("Yellow");
  });

  it("handles multiple areas arriving as an array", () => {
    const multi = clone(REAL_MESSAGE);
    (multi.alert.info[1] as { area: unknown }).area = [
      { areaDesc: "Region A", polygon: "63.9,-22.1 64.0,-22.3 63.8,-22.5 63.9,-22.1" },
      { areaDesc: "Region B", polygon: "65.1,-19.0 65.2,-19.3 65.0,-19.5 65.1,-19.0" },
    ];

    const alert = normalizeCapMessage(multi) as OfficialAlert;
    expect(alert.areas).toHaveLength(2);
    expect(alert.areas.map((a) => a.description.en)).toEqual(["Region A", "Region B"]);
  });

  it("finds a named parameter when several are present", () => {
    const multi = clone(REAL_MESSAGE);
    (multi.alert.info[1] as { parameter: unknown }).parameter = [
      { value: "something", valueName: "Other" },
      { value: "Orange", valueName: "Color" },
    ];
    expect((normalizeCapMessage(multi) as OfficialAlert).colour).toBe("Orange");
  });

  it("accepts a message with no wrapping `alert` key", () => {
    const alert = normalizeCapMessage(REAL_MESSAGE.alert) as OfficialAlert;
    expect(alert.id).toBe("is-IMO-bd4a3341-5bde-4b21-afad-3a5caffcad56");
  });

  // --- Refusals ---

  it("refuses anything that is not a live public warning", () => {
    for (const status of ["Test", "Exercise", "Draft", "System"]) {
      const drill = clone(REAL_MESSAGE);
      drill.alert.status = status;
      expect(normalizeCapMessage(drill)).toBeNull();
    }
  });

  it("refuses a message with no identifier, no timestamp or no info", () => {
    const noId = clone(REAL_MESSAGE);
    (noId.alert as { identifier?: unknown }).identifier = "";
    expect(normalizeCapMessage(noId)).toBeNull();

    const noSent = clone(REAL_MESSAGE);
    (noSent.alert as { sent?: unknown }).sent = "not a date";
    expect(normalizeCapMessage(noSent)).toBeNull();

    const noInfo = clone(REAL_MESSAGE) as unknown as { alert: { info: unknown } };
    noInfo.alert.info = [];
    expect(normalizeCapMessage(noInfo)).toBeNull();
  });

  it("refuses junk", () => {
    expect(normalizeCapMessage(null)).toBeNull();
    expect(normalizeCapMessage("nope")).toBeNull();
    expect(normalizeCapMessage({})).toBeNull();
  });

  it("falls back to safe values for unrecognised enum members", () => {
    const odd = clone(REAL_MESSAGE);
    const info = odd.alert.info[1] as Record<string, unknown>;
    info.severity = "Catastrophic";
    info.urgency = "Soonish";
    info.parameter = { value: "Purple", valueName: "Color" };

    const alert = normalizeCapMessage(odd) as OfficialAlert;
    expect(alert.severity).toBe("Unknown");
    expect(alert.urgency).toBe("Unknown");
    expect(alert.colour).toBeNull();
  });
});

describe("dropExpired", () => {
  const base = normalizeCapMessage(REAL_MESSAGE) as OfficialAlert;

  it("removes an alert whose expiry has passed", () => {
    const now = new Date("2026-09-08T00:00:00Z");
    expect(dropExpired([base], now)).toEqual([]);
  });

  it("keeps an alert that is still in force", () => {
    const now = new Date("2026-09-07T00:00:00Z");
    expect(dropExpired([base], now)).toHaveLength(1);
  });

  it("keeps an alert with no stated expiry", () => {
    expect(dropExpired([{ ...base, expiresAt: null }], new Date("2030-01-01T00:00:00Z"))).toHaveLength(1);
  });
});

describe("ordering", () => {
  const base = normalizeCapMessage(REAL_MESSAGE) as OfficialAlert;
  const make = (over: Partial<OfficialAlert>): OfficialAlert => ({ ...base, ...over });

  it("ranks red above orange above yellow", () => {
    expect(alertRank(make({ colour: "Red" }))).toBeGreaterThan(alertRank(make({ colour: "Orange" })));
    expect(alertRank(make({ colour: "Orange" }))).toBeGreaterThan(alertRank(make({ colour: "Yellow" })));
  });

  it("sorts most serious first", () => {
    const sorted = sortAlerts([
      make({ id: "y", colour: "Yellow" }),
      make({ id: "r", colour: "Red" }),
      make({ id: "o", colour: "Orange" }),
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["r", "o", "y"]);
  });

  it("identifies geological alerts", () => {
    expect(isGeological(make({ category: "Geo" }))).toBe(true);
    expect(isGeological(make({ category: "Met" }))).toBe(false);
  });
});
