import { describe, expect, it } from "vitest";
import {
  latestPerScenario,
  mergeRun,
  normalizeCatalogue,
  normalizePointSeries,
  normalizeSimulation,
  runIdFromReference,
  hasRealSource,
  toIso,
  type CatalogueEntry,
} from "./dispersion-normalize";
import {
  defaultLayer,
  depthEquivalent,
  frameTimes,
  groundLayer,
  hasDepthEquivalent,
  legendFor,
  scaleFor,
  parseSeriesLayer,
  peakOf,
  toRasterTime,
  unitFor,
  withinBounds,
} from "@/domain/dispersion";

const UUID = "574685b2-b2b8-4f00-9423-d25bbdb57cc0";

/** Shaped exactly like one entry of the EPOS catalogue response. */
function catalogueEntry(overrides: Record<string, unknown> = {}) {
  return {
    name: "ashscenario",
    category: "web service",
    item_type: "raster",
    product_reference: `https://dispersion.vedur.is/map.html?run_uuid=${UUID}`,
    hazard: {
      type: "Tephra fallout",
      data_source: "Model output",
      model_name: "NAME",
      scenario_definition: "Deterministic",
      product_type: "Forecast",
      parameter: "Ash concentration",
      units: "µg/m^3",
    },
    geographical_location: {
      country: "Iceland",
      volcano: { name: "Bardarbunga", id: "BAR", lat: "64.633", long: "-17.516" },
    },
    dates: {
      "date_of_creation_(for_static_products)": "2026-09-19T19:22:25.589865",
      "range_of_validity_(for_forecast_products)": "48 hours",
      date_of_event: "2026-09-19T12:00:00",
    },
    ...overrides,
  };
}

/** Shaped like one `/dispersion/simulations/{uuid}` response. */
function simulation(overrides: Record<string, unknown> = {}) {
  return {
    run_uuid: UUID,
    run: "ashscenario",
    model_type: "NAME",
    failed: false,
    latitude: 64.633,
    longitude: -17.516,
    column_height: 10000,
    start_time: "2026-09-19T12:00:00",
    duration: 48,
    durationUnit: "h",
    bounds: [
      [72.95, -40.0],
      [60.0, -0.03],
    ],
    results: [
      { altitude: 0, altitude_unit: "m", dispersion_type: "Ash kg/m2" },
      { altitude: 5, altitude_unit: "m", dispersion_type: "Ash g/m3" },
      { altitude: 300, altitude_unit: "hPa", dispersion_type: "Ash g/m3" },
    ],
    ...overrides,
  };
}

describe("toIso", () => {
  it("reads a naive timestamp as UTC", () => {
    // IMO publishes in UTC, which is also Icelandic local time all year.
    expect(toIso("2026-09-19T12:00:00")).toBe("2026-09-19T12:00:00.000Z");
  });

  it("keeps an explicit zone rather than appending a second one", () => {
    expect(toIso("2026-09-19T12:00:00Z")).toBe("2026-09-19T12:00:00.000Z");
    expect(toIso("2026-09-19T14:00:00+02:00")).toBe("2026-09-19T12:00:00.000Z");
  });

  it("rejects nonsense", () => {
    expect(toIso("")).toBeNull();
    expect(toIso(null)).toBeNull();
    expect(toIso("not a date")).toBeNull();
  });
});

describe("runIdFromReference", () => {
  it("extracts the run UUID from the viewer link", () => {
    expect(runIdFromReference(`https://dispersion.vedur.is/map.html?run_uuid=${UUID}`)).toBe(UUID);
  });

  it("refuses anything that is not a UUID", () => {
    // The value ends up in an upstream request path, so "whatever follows the
    // equals sign" is not good enough.
    expect(runIdFromReference("https://dispersion.vedur.is/map.html?run_uuid=../../etc")).toBeNull();
    expect(runIdFromReference("https://dispersion.vedur.is/map.html")).toBeNull();
    expect(runIdFromReference(null)).toBeNull();
  });
});

describe("normalizeCatalogue", () => {
  it("reads a published run", () => {
    const [entry] = normalizeCatalogue([catalogueEntry()]);
    expect(entry).toMatchObject({
      runId: UUID,
      scenario: "ashscenario",
      volcano: "Bardarbunga",
      model: "NAME",
      hazard: "ash",
      createdAt: "2026-09-19T19:22:25.589Z",
    });
  });

  it("maps gas runs to the gas hazard", () => {
    const [entry] = normalizeCatalogue([
      catalogueEntry({ hazard: { type: "Gas", model_name: "CALPUFF" } }),
    ]);
    expect(entry?.hazard).toBe("gas");
    expect(entry?.model).toBe("CALPUFF");
  });

  it("drops an entry with an unrecognised hazard rather than guessing", () => {
    // A wrong hazard would put an ash legend on a gas forecast.
    expect(
      normalizeCatalogue([catalogueEntry({ hazard: { type: "Lahar", model_name: "NAME" } })]),
    ).toHaveLength(0);
  });

  it("drops an entry with no volcano, no model, or no run id", () => {
    expect(normalizeCatalogue([catalogueEntry({ geographical_location: {} })])).toHaveLength(0);
    expect(
      normalizeCatalogue([
        catalogueEntry({ hazard: { type: "Tephra fallout", model_name: "WRF" } }),
      ]),
    ).toHaveLength(0);
    expect(normalizeCatalogue([catalogueEntry({ product_reference: "" })])).toHaveLength(0);
  });

  it("survives a payload that is not a list", () => {
    expect(normalizeCatalogue(null)).toEqual([]);
    expect(normalizeCatalogue({ message: "Not Found" })).toEqual([]);
    expect(normalizeCatalogue([null, 3, "x"])).toEqual([]);
  });
});

describe("normalizeSimulation", () => {
  it("reads the grid and the output layers", () => {
    const record = normalizeSimulation(simulation());
    expect(record).toMatchObject({
      runId: UUID,
      model: "NAME",
      columnHeightM: 10000,
      startsAt: "2026-09-19T12:00:00.000Z",
      durationHours: 48,
    });
    expect(record?.layers).toHaveLength(3);
  });

  it("reorders bounds from latitude-first, north-first", () => {
    // Upstream sends [[north, west], [south, east]] — neither convention this
    // codebase uses anywhere else.
    expect(normalizeSimulation(simulation())?.bounds).toEqual({
      north: 72.95,
      west: -40,
      south: 60,
      east: -0.03,
    });
  });

  it("rejects inverted or malformed bounds", () => {
    expect(
      normalizeSimulation(simulation({ bounds: [[60, -40], [72.95, -0.03]] })),
    ).toBeNull();
    expect(normalizeSimulation(simulation({ bounds: null }))).toBeNull();
    expect(normalizeSimulation(simulation({ bounds: [[1, 2]] }))).toBeNull();
  });

  it("rejects a failed run", () => {
    expect(normalizeSimulation(simulation({ failed: true }))).toBeNull();
  });

  it("rejects a run with no output layers", () => {
    expect(normalizeSimulation(simulation({ results: [] }))).toBeNull();
    expect(normalizeSimulation(simulation({ results: null }))).toBeNull();
  });

  it("rejects a duration in units other than hours", () => {
    // `duration` is timed in hours everywhere in this service; a different
    // unit would silently mis-time every frame rather than fail.
    expect(normalizeSimulation(simulation({ durationUnit: "d" }))).toBeNull();
    expect(normalizeSimulation(simulation({ duration: 0 }))).toBeNull();
    expect(normalizeSimulation(simulation({ duration: 500 }))).toBeNull();
  });

  it("drops a placeholder column height", () => {
    // Older gas runs carry `column_height: 1`, which is not a plume height.
    expect(normalizeSimulation(simulation({ column_height: 1 }))?.columnHeightM).toBeNull();
  });

  it("keeps unusable altitudes out of the layer list", () => {
    const record = normalizeSimulation(
      simulation({
        results: [
          { altitude: 5, altitude_unit: "m", dispersion_type: "Ash g/m3" },
          { altitude: 5, altitude_unit: "furlongs", dispersion_type: "Ash g/m3" },
          { altitude: null, altitude_unit: "m", dispersion_type: "Ash g/m3" },
        ],
      }),
    );
    expect(record?.layers).toEqual([
      { dispersionType: "Ash g/m3", altitude: 5, altitudeUnit: "m" },
    ]);
  });
});

describe("hasRealSource", () => {
  it("rejects the 1,1 placeholder older gas runs carry", () => {
    const record = normalizeSimulation(simulation({ latitude: 1, longitude: 1 }));
    expect(record).not.toBeNull();
    // A source marker in the Gulf of Guinea is worse than no marker.
    expect(hasRealSource(record!)).toBe(false);
  });

  it("accepts a source inside Iceland", () => {
    expect(hasRealSource(normalizeSimulation(simulation())!)).toBe(true);
  });
});

describe("mergeRun", () => {
  it("joins a catalogue entry to its simulation", () => {
    const [entry] = normalizeCatalogue([catalogueEntry()]);
    const record = normalizeSimulation(simulation());
    const run = mergeRun(entry!, record!);

    expect(run).toMatchObject({
      id: UUID,
      volcano: "Bardarbunga",
      scenario: "ashscenario",
      hazard: "ash",
      model: "NAME",
      columnHeightM: 10000,
      durationHours: 48,
    });
    // The volcano name comes from the catalogue; the grid from the simulation.
    expect(run?.bounds.north).toBe(72.95);
    expect(run?.viewerUrl).toContain(UUID);
  });

  it("refuses to join records that are not the same run", () => {
    const [entry] = normalizeCatalogue([catalogueEntry()]);
    const other = normalizeSimulation(
      simulation({ run_uuid: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(mergeRun(entry!, other!)).toBeNull();
  });
});

describe("latestPerScenario", () => {
  const entry = (
    scenario: string,
    volcano: string,
    createdAt: string,
    runId: string,
  ): CatalogueEntry => ({
    runId,
    scenario,
    volcano,
    model: "NAME",
    hazard: "ash",
    createdAt,
    viewerUrl: `https://dispersion.vedur.is/map.html?run_uuid=${runId}`,
  });

  it("keeps only the newest run of each scenario", () => {
    const result = latestPerScenario([
      entry("ashscenario", "Bardarbunga", "2026-09-18T06:00:00.000Z", "a"),
      entry("ashscenario", "Bardarbunga", "2026-09-19T19:00:00.000Z", "b"),
      entry("ashscenario", "Bardarbunga", "2026-09-19T06:00:00.000Z", "c"),
    ]);
    expect(result.map((item) => item.runId)).toEqual(["b"]);
  });

  it("treats the same scenario name at different volcanoes as different runs", () => {
    const result = latestPerScenario([
      entry("ashscenario", "Bardarbunga", "2026-09-19T19:00:00.000Z", "a"),
      entry("ashscenario", "Askja", "2026-09-19T18:00:00.000Z", "b"),
    ]);
    expect(result.map((item) => item.runId)).toEqual(["a", "b"]);
  });

  it("returns newest first", () => {
    const result = latestPerScenario([
      entry("one", "Askja", "2026-09-19T06:00:00.000Z", "a"),
      entry("two", "Askja", "2026-09-19T19:00:00.000Z", "b"),
    ]);
    expect(result.map((item) => item.runId)).toEqual(["b", "a"]);
  });
});

describe("frame times", () => {
  const run = mergeRun(
    normalizeCatalogue([catalogueEntry()])[0]!,
    normalizeSimulation(simulation())!,
  )!;

  it("runs hourly from one hour after the start to the end of the window", () => {
    // Verified against the service: the start instant itself answers 404,
    // because nothing has dispersed yet.
    const frames = frameTimes(run);
    expect(frames).toHaveLength(48);
    expect(new Date(frames[0]!).toISOString()).toBe("2026-09-19T13:00:00.000Z");
    expect(new Date(frames.at(-1)!).toISOString()).toBe("2026-09-21T12:00:00.000Z");
  });

  it("formats a frame time the way the raster endpoint accepts", () => {
    // A trailing `Z` makes the endpoint answer 500.
    expect(toRasterTime(Date.parse("2026-09-19T18:00:00Z"))).toBe("2026-09-19T18:00:00");
  });
});

describe("layer choice and legends", () => {
  const run = mergeRun(
    normalizeCatalogue([catalogueEntry()])[0]!,
    normalizeSimulation(simulation())!,
  )!;

  it("leads with near-surface concentration, not the deposit total", () => {
    expect(defaultLayer(run)).toEqual({
      dispersionType: "Ash g/m3",
      altitude: 5,
      altitudeUnit: "m",
    });
  });

  it("uses IMO's deposit scale for deposit and their air scale for concentration", () => {
    const deposit = run.layers.find((layer) => layer.dispersionType === "Ash kg/m2")!;
    const air = run.layers.find((layer) => layer.dispersionType === "Ash g/m3")!;
    expect(legendFor(run, deposit)[0]?.label).toContain("kg/m²");
    expect(legendFor(run, air)[0]?.label).toContain("g/m³");
  });

  it("uses the CALPUFF scale for a gas run", () => {
    const gas = { ...run, model: "CALPUFF" as const, hazard: "gas" as const };
    expect(legendFor(gas, gas.layers[0]!)[0]?.label).toContain("µg/m³");
  });
});

describe("parseSeriesLayer", () => {
  it("reads the two shapes IMO publishes", () => {
    expect(parseSeriesLayer("5m Ash g/m3")).toEqual({
      dispersionType: "Ash g/m3",
      altitude: 5,
      altitudeUnit: "m",
    });
    expect(parseSeriesLayer("300hPa Ash g/m3")).toEqual({
      dispersionType: "Ash g/m3",
      altitude: 300,
      altitudeUnit: "hPa",
    });
    expect(parseSeriesLayer("0m SO2")).toEqual({
      dispersionType: "SO2",
      altitude: 0,
      altitudeUnit: "m",
    });
  });

  it("returns null rather than guessing at an unfamiliar name", () => {
    // Parsed rather than reconstructed and compared, so a change in IMO's
    // format loses one series instead of mislabelling all of them.
    expect(parseSeriesLayer("Ash g/m3")).toBeNull();
    expect(parseSeriesLayer("5km Ash g/m3")).toBeNull();
    expect(parseSeriesLayer("")).toBeNull();
  });
});

describe("scaleFor", () => {
  /*
   * These factors are IMO's own. Their dispersion viewer applies exactly
   * these to the same payload before plotting it: deposit divided by 1e3,
   * the gas species multiplied by 1e6 and relabelled µg/m³, airborne ash
   * left alone.
   */
  it("divides deposit by a thousand, as their viewer does", () => {
    expect(scaleFor("Ash kg/m2")).toEqual({ factor: 1 / 1000, unit: "kg/m\u00b2" });
  });

  it("leaves airborne ash alone", () => {
    expect(scaleFor("Ash g/m3")).toEqual({ factor: 1, unit: "g/m\u00b3" });
  });

  it("converts the gas species from g/m3 to µg/m3", () => {
    expect(scaleFor("SO2")).toEqual({ factor: 1e6, unit: "\u00b5g/m\u00b3" });
    expect(scaleFor("SO4")).toEqual({ factor: 1e6, unit: "\u00b5g/m\u00b3" });
  });

  it("reports the unit a series is in after scaling", () => {
    expect(unitFor("Ash kg/m2")).toBe("kg/m\u00b2");
    expect(unitFor("SO2")).toBe("\u00b5g/m\u00b3");
  });
});

describe("withinBounds", () => {
  const bounds = { west: -40, south: 60, east: -0.03, north: 72.95 };

  it("accepts a point inside the grid", () => {
    expect(withinBounds(bounds, { latitude: 64.1, longitude: -21.9 })).toBe(true);
  });

  it("rejects a point outside it", () => {
    // Outside the grid the service answers 200 with zeros, so "not modelled"
    // would otherwise arrive looking like "nothing will reach here".
    expect(withinBounds(bounds, { latitude: -33.9, longitude: 151.2 })).toBe(false);
    expect(withinBounds(bounds, { latitude: 59.9, longitude: -21.9 })).toBe(false);
  });
});

describe("normalizePointSeries", () => {
  const payload = [
    {
      name: "5m Ash g/m3",
      x: ["2026-09-19T13:00:00", "2026-09-19T14:00:00", "2026-09-19T15:00:00"],
      y: [0, 1.5, 2.25],
    },
    {
      name: "0m Ash kg/m2",
      x: ["2026-09-19T13:00:00", "2026-09-19T14:00:00"],
      y: [0.1, 0.2],
    },
  ];

  it("zips the parallel arrays into points", () => {
    const series = normalizePointSeries(payload);
    expect(series).toHaveLength(2);
    expect(series[0]?.points).toEqual([
      { at: "2026-09-19T13:00:00.000Z", value: 0 },
      { at: "2026-09-19T14:00:00.000Z", value: 1.5 },
      { at: "2026-09-19T15:00:00.000Z", value: 2.25 },
    ]);
    expect(series[0]?.unit).toBe("g/m\u00b3");
    expect(series[0]?.layer.altitude).toBe(5);
  });

  it("scales each series into the unit it is actually in", () => {
    /*
     * The endpoint's deposit values are grams under a name saying kilograms.
     * Left unscaled, a real run reads 55,000 kg/m² at Grindavík — fifty metres
     * of ash — which is how this was noticed.
     */
    const deposit = normalizePointSeries([
      {
        name: "0m Ash kg/m2",
        x: ["2026-09-19T13:00:00", "2026-09-19T14:00:00"],
        y: [15094.7, 41205.2],
      },
    ]);
    expect(deposit[0]?.unit).toBe("kg/m\u00b2");
    // Compared loosely: 1/1000 is not exactly representable, so the product
    // lands a femtogram away. That matters to `toEqual` and to nothing else.
    expect(deposit[0]?.points[0]?.value).toBeCloseTo(15.0947, 6);
    expect(deposit[0]?.points[1]?.value).toBeCloseTo(41.2052, 6);

    const gas = normalizePointSeries([
      { name: "0m SO2", x: ["2025-09-18T00:00:00", "2025-09-18T01:00:00"], y: [0.0008, 0.0012] },
    ]);
    expect(gas[0]?.unit).toBe("\u00b5g/m\u00b3");
    expect(gas[0]?.points[0]?.value).toBeCloseTo(800, 6);
    expect(gas[0]?.points[1]?.value).toBeCloseTo(1200, 6);

    // Airborne ash is the one their viewer does not touch.
    const airborne = normalizePointSeries([
      { name: "5m Ash g/m3", x: ["2026-09-19T13:00:00", "2026-09-19T14:00:00"], y: [1.07, 3.09] },
    ]);
    expect(airborne[0]?.points.map((point) => point.value)).toEqual([1.07, 3.09]);
  });

  it("keeps zeros and drops nulls", () => {
    // Inside the grid, "nothing here at this hour" is a result; a null is a
    // hole in the output and is not a result.
    const series = normalizePointSeries([
      { name: "5m Ash g/m3", x: ["2026-09-19T13:00:00", "2026-09-19T14:00:00"], y: [0, null] },
    ]);
    expect(series[0]?.points).toEqual([{ at: "2026-09-19T13:00:00.000Z", value: 0 }]);
  });

  it("drops the trailing mismatch when the arrays disagree in length", () => {
    // Past the shorter array the values would be attached to the wrong hours.
    const series = normalizePointSeries([
      {
        name: "5m Ash g/m3",
        x: ["2026-09-19T13:00:00", "2026-09-19T14:00:00", "2026-09-19T15:00:00"],
        y: [1, 2],
      },
    ]);
    expect(series[0]?.points).toHaveLength(2);
  });

  it("uses the times as given rather than reconstructing them", () => {
    // A 24-hour tephra run starts an hour after its start_time while a
    // 72-hour gas run starts at it, so there is no rule to reconstruct from.
    const gas = normalizePointSeries([
      { name: "0m SO2", x: ["2025-09-18T00:00:00", "2025-09-18T01:00:00"], y: [0.5, 0.7] },
    ]);
    expect(gas[0]?.points[0]?.at).toBe("2025-09-18T00:00:00.000Z");
    expect(gas[0]?.unit).toBe("\u00b5g/m\u00b3");
  });

  it("skips a series whose name it cannot place", () => {
    expect(normalizePointSeries([{ name: "mystery", x: ["a"], y: [1] }])).toEqual([]);
  });

  it("survives a payload that is not a list of series", () => {
    expect(normalizePointSeries(null)).toEqual([]);
    expect(normalizePointSeries({ detail: "No graph data found" })).toEqual([]);
    expect(normalizePointSeries([{ name: "5m Ash g/m3" }])).toEqual([]);
  });
});

describe("peakOf", () => {
  const series = normalizePointSeries([
    {
      name: "5m Ash g/m3",
      x: ["2026-09-19T13:00:00", "2026-09-19T14:00:00", "2026-09-19T15:00:00"],
      y: [0, 2.25, 1.5],
    },
  ])[0]!;

  it("finds the highest value and when it happens", () => {
    expect(peakOf(series)).toEqual({ at: "2026-09-19T14:00:00.000Z", value: 2.25 });
  });

  it("returns null when the model puts nothing here", () => {
    // Inside the grid that is a real answer, and "peak 0 at 13:00" would not be.
    const flat = normalizePointSeries([
      { name: "5m Ash g/m3", x: ["2026-09-19T13:00:00", "2026-09-19T14:00:00"], y: [0, 0] },
    ])[0]!;
    expect(peakOf(flat)).toBeNull();
  });
});

describe("groundLayer", () => {
  const run = mergeRun(
    normalizeCatalogue([catalogueEntry()])[0]!,
    normalizeSimulation(simulation())!,
  )!;

  it("uses deposit for tephra, since fallout is what settles on a road", () => {
    expect(groundLayer(run)?.dispersionType).toBe("Ash kg/m2");
  });

  it("falls to the lowest near-surface layer when there is no deposit", () => {
    // Gas runs produce no deposit; the same question asked of a substance
    // that does not settle is its concentration at the ground.
    const gas = {
      ...run,
      layers: [
        { dispersionType: "SO2", altitude: 0, altitudeUnit: "m" as const },
        { dispersionType: "SO4", altitude: 10, altitudeUnit: "m" as const },
      ],
    };
    expect(groundLayer(gas)).toEqual({
      dispersionType: "SO2",
      altitude: 0,
      altitudeUnit: "m",
    });
  });

  it("returns null for a run with no layers at all", () => {
    expect(groundLayer({ ...run, layers: [] })).toBeNull();
  });
});

describe("depthEquivalent", () => {
  /*
   * IMO's own legend pairs each band with a depth: 1000 kg/m² with ~1 m,
   * 100 with ~10 cm, 1 with ~1 mm. The equivalence is theirs; this only
   * reproduces it.
   */
  it("matches the pairings on IMO's published legend", () => {
    expect(depthEquivalent(1000)).toBe("~1 m");
    expect(depthEquivalent(100)).toBe("~10 cm");
    expect(depthEquivalent(10)).toBe("~1 cm");
    expect(depthEquivalent(1)).toBe("~1 mm");
  });

  it("gives a real figure the unit a reader can picture", () => {
    expect(depthEquivalent(43.2)).toBe("~4 cm");
    expect(depthEquivalent(2742)).toBe("~2.7 m");
  });

  it("does not round a fraction of a millimetre down to nothing", () => {
    expect(depthEquivalent(0.4)).toBe("under 1 mm");
    expect(depthEquivalent(0.01)).toBe("a trace");
  });

  it("has nothing to say about zero or nonsense", () => {
    expect(depthEquivalent(0)).toBeNull();
    expect(depthEquivalent(-1)).toBeNull();
    expect(depthEquivalent(Number.NaN)).toBeNull();
  });
});

describe("hasDepthEquivalent", () => {
  it("applies to deposit and not to a concentration", () => {
    // Ash suspended in air has no depth.
    expect(
      hasDepthEquivalent({ dispersionType: "Ash kg/m2", altitude: 0, altitudeUnit: "m" }),
    ).toBe(true);
    expect(
      hasDepthEquivalent({ dispersionType: "Ash g/m3", altitude: 5, altitudeUnit: "m" }),
    ).toBe(false);
    expect(hasDepthEquivalent({ dispersionType: "SO2", altitude: 0, altitudeUnit: "m" })).toBe(
      false,
    );
  });
});
