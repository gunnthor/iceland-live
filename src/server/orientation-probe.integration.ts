import { describe, expect, it } from "vitest";
import { decodeAlpha } from "@/server/png-alpha";
import { getDispersionRuns, getDispersionPoint } from "@/server/dispersion";
import { frameTimes, toRasterTime } from "@/domain/dispersion";
import { IMO_API_VERSIONS, IMO_BASE_URL } from "@/providers/imo/client";

/** Which way up is the raster? Answered against IMO's own point endpoint. */
describe("deposit raster orientation", () => {
  it("agrees with the per-location model at sampled coordinates", async () => {
    const { runs } = await getDispersionRuns();
    const run = runs.find((item) => item.hazard === "ash");
    expect(run).toBeDefined();
    if (!run) return;

    const frames = frameTimes(run);
    const last = frames[frames.length - 1]!;

    const url = new URL("/dispersion/raster", IMO_BASE_URL);
    url.searchParams.set("uuid", run.id);
    url.searchParams.set("model_type", run.model);
    url.searchParams.set("dispersion_type", "Ash kg/m2");
    url.searchParams.set("altitude", "0");
    url.searchParams.set("altitude_unit", "m");
    url.searchParams.set("time", toRasterTime(last));
    url.searchParams.set("srid", "4326");
    url.searchParams.set("filetype", "png");

    const response = await fetch(url, {
      headers: { "x-vi-api-version": IMO_API_VERSIONS.dispersion },
    });
    expect(response.ok).toBe(true);

    const mask = decodeAlpha(new Uint8Array(await response.arrayBuffer()));
    expect(mask).not.toBeNull();
    if (!mask) return;

    const { west, east, south, north } = run.bounds;
    console.log(`\nrun=${run.volcano} ${run.scenario} mask=${mask.width}x${mask.height}`);
    console.log(`bounds N${north} S${south} W${west} E${east}`);

    const covered = (latitude: number, longitude: number, flipped: boolean) => {
      const x = Math.floor(((longitude - west) / (east - west)) * mask.width);
      const fraction = flipped
        ? (latitude - south) / (north - south)
        : (north - latitude) / (north - south);
      const y = Math.floor(fraction * mask.height);
      if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
      return (mask.alpha[y * mask.width + x] ?? 0) > 0;
    };

    /* A scatter of points across Iceland, each checked against the model. */
    const samples = [
      [64.146, -21.942],
      [63.84, -22.43],
      [63.7, -21.5],
      [65.68, -18.09],
      [64.633, -17.516],
      [63.42, -19.1],
      [66.07, -23.13],
      [64.0, -16.0],
      [65.0, -20.0],
      [63.9, -20.0],
      [64.5, -21.0],
      [65.3, -19.5],
    ] as const;

    let topDown = 0;
    let bottomUp = 0;
    let checked = 0;

    for (const [latitude, longitude] of samples) {
      const lookup = await getDispersionPoint(run.id, latitude, longitude);
      if (!lookup.ok) continue;
      const deposit = lookup.series.find((item) => item.name === "0m Ash kg/m2");
      if (!deposit) continue;

      const truth = deposit.points.some((point) => point.value > 0);
      checked += 1;
      if (covered(latitude, longitude, false) === truth) topDown += 1;
      if (covered(latitude, longitude, true) === truth) bottomUp += 1;
      console.log(
        `  ${latitude},${longitude}  model=${truth ? "deposit" : "none"}  ` +
          `top-down=${covered(latitude, longitude, false)}  bottom-up=${covered(latitude, longitude, true)}`,
      );
    }

    console.log(`\nagreement: top-down ${topDown}/${checked}, bottom-up ${bottomUp}/${checked}`);
    expect(checked).toBeGreaterThan(4);
    // Row 0 is expected to be the northern edge, as rendered maps are.
    expect(topDown).toBeGreaterThan(bottomUp);
  });
});
