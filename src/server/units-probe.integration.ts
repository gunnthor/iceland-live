/**
 * Are IMO's per-location figures in the units they claim?
 *
 * This is the check behind `isQuotable` in `src/domain/dispersion.ts`. It puts
 * the per-location endpoint's value at a coordinate next to the colour IMO's
 * own raster paints that same coordinate, and reports the band their published
 * legend assigns that colour. Agreement means the figure can be printed;
 * disagreement by orders of magnitude means it cannot.
 *
 * Run it deliberately:  npm run test:live -- units-probe
 *
 * Findings as of September 2026: airborne concentration agrees; ground deposit
 * comes back about a thousand times its own label.
 *
 * Decoding the full RGBA here is for diagnosis. The product itself reads only
 * the alpha channel — "is anything here" — and never translates a colour into
 * a concentration.
 */

import { describe, it } from "vitest";
import { inflateSync } from "node:zlib";
import { frameTimes, toRasterTime, type DispersionRun } from "@/domain/dispersion";
import { IMO_API_VERSIONS, IMO_BASE_URL } from "@/providers/imo/client";
import { getDispersionPoint, getDispersionRuns } from "@/server/dispersion";

type Rgba = { width: number; height: number; rgba: Uint8Array };

/** Minimal 8-bit RGBA PNG decode, enough to read a pixel. */
function decodeRgba(bytes: Uint8Array): Rgba {
  const buffer = Buffer.from(bytes);
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];

  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "IHDR") {
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
    } else if (type === "IDAT") {
      idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    } else if (type === "IEND") break;
    offset += 8 + length + 4;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  let cursor = 0;

  for (let row = 0; row < height; row += 1) {
    const filter = raw[cursor]!;
    cursor += 1;
    const line = new Uint8Array(raw.subarray(cursor, cursor + stride));
    cursor += stride;

    for (let i = 0; i < stride; i += 1) {
      const left = i >= 4 ? line[i - 4]! : 0;
      const up = previous[i]!;
      const upLeft = i >= 4 ? previous[i - 4]! : 0;
      if (filter === 1) line[i] = (line[i]! + left) & 255;
      else if (filter === 2) line[i] = (line[i]! + up) & 255;
      else if (filter === 3) line[i] = (line[i]! + ((left + up) >> 1)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        line[i] = (line[i]! + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
      }
    }

    rgba.set(line, row * stride);
    previous = line;
  }

  return { width, height, rgba };
}

type Legend = ReadonlyArray<{ label: string; rgb: readonly [number, number, number] }>;

/** IMO's own published scales, transcribed from their dispersion viewer. */
const DEPOSIT: Legend = [
  { label: "1000 kg/m2", rgb: [24, 23, 23] },
  { label: "100 kg/m2", rgb: [59, 56, 56] },
  { label: "10 kg/m2", rgb: [89, 89, 89] },
  { label: "1 kg/m2", rgb: [127, 127, 127] },
  { label: "0.1 kg/m2", rgb: [166, 166, 166] },
  { label: "0.01 kg/m2", rgb: [217, 217, 217] },
];

const AIRBORNE: Legend = [
  { label: "1 g/m3", rgb: [255, 0, 0] },
  { label: "0.1 g/m3", rgb: [96, 71, 251] },
  { label: "0.01 g/m3", rgb: [255, 192, 0] },
  { label: "0.004 g/m3", rgb: [255, 255, 0] },
  { label: "0.002 g/m3", rgb: [112, 173, 71] },
  { label: "0.0002 g/m3", rgb: [41, 201, 223] },
];

function nearestBand(legend: Legend, r: number, g: number, b: number) {
  let best = legend[0]!;
  let bestDistance = Infinity;
  for (const entry of legend) {
    const [er, eg, eb] = entry.rgb;
    const distance = (r - er) ** 2 + (g - eg) ** 2 + (b - eb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return { label: best.label, distance: Math.sqrt(bestDistance) };
}

async function fetchRaster(
  run: DispersionRun,
  dispersionType: string,
  altitude: number,
  at: number,
): Promise<Rgba> {
  const url = new URL("/dispersion/raster", IMO_BASE_URL);
  url.searchParams.set("uuid", run.id);
  url.searchParams.set("model_type", run.model);
  url.searchParams.set("dispersion_type", dispersionType);
  url.searchParams.set("altitude", String(altitude));
  url.searchParams.set("altitude_unit", "m");
  url.searchParams.set("time", toRasterTime(at));
  url.searchParams.set("srid", "4326");
  url.searchParams.set("filetype", "png");

  const response = await fetch(url, {
    headers: { "x-vi-api-version": IMO_API_VERSIONS.dispersion },
  });
  return decodeRgba(new Uint8Array(await response.arrayBuffer()));
}

/**
 * Sample points, derived from the run rather than written down.
 *
 * A fixed list of coordinates only works for the scenario it was chosen for;
 * whichever run happens to be current has its plume somewhere else. A ring of
 * offsets around the source at growing radii finds the plume wherever it went.
 */
function samplesAround(run: DispersionRun): Array<[number, number, string]> {
  const points: Array<[number, number, string]> = [];
  for (const radius of [0.05, 0.15, 0.4, 0.9]) {
    for (const [bearing, name] of [
      [0, "N"],
      [90, "E"],
      [180, "S"],
      [270, "W"],
      [45, "NE"],
      [135, "SE"],
      [225, "SW"],
      [315, "NW"],
    ] as const) {
      const radians = (bearing * Math.PI) / 180;
      points.push([
        run.latitude + radius * Math.cos(radians),
        run.longitude +
          (radius * Math.sin(radians)) / Math.cos((run.latitude * Math.PI) / 180),
        `${name} ${radius}\u00b0`,
      ]);
    }
  }
  return points;
}

describe("per-location units against IMO's own scale", () => {
  it("reports both layers at the raster's own instant", async () => {
    const { runs } = await getDispersionRuns();
    const run = runs.find((item) => item.hazard === "ash");
    if (!run) return;

    const frames = frameTimes(run);
    const last = frames[frames.length - 1]!;
    const { west, east, south, north } = run.bounds;

    console.log(`\nrun=${run.volcano} ${run.scenario} at ${toRasterTime(last)}`);

    /*
     * Deposit accumulates, so its last frame is its maximum and is always
     * worth comparing. Concentration comes and goes: by the last frame the
     * plume has usually left the neighbourhood of the source, so that layer is
     * compared at the hour it actually peaks there instead.
     */
    const nearSource = { latitude: run.latitude + 0.05, longitude: run.longitude };
    const probe = await getDispersionPoint(run.id, nearSource.latitude, nearSource.longitude);
    const airborne = probe.ok
      ? probe.series.find((item) => item.name === "5m Ash g/m3")
      : null;
    const busiest =
      airborne?.points.reduce((best, point) => (point.value > best.value ? point : best))?.at;
    const airborneAt = busiest ? Date.parse(busiest) : last;

    for (const layer of [
      { dispersionType: "Ash kg/m2", altitude: 0, series: "0m Ash kg/m2", legend: DEPOSIT, at: last },
      {
        dispersionType: "Ash g/m3",
        altitude: 5,
        series: "5m Ash g/m3",
        legend: AIRBORNE,
        at: airborneAt,
      },
    ]) {
      const image = await fetchRaster(run, layer.dispersionType, layer.altitude, layer.at);
      console.log(`\n### ${layer.series} at ${toRasterTime(layer.at)}`);

      for (const [latitude, longitude, label] of samplesAround(run)) {
        const x = Math.floor(((longitude - west) / (east - west)) * image.width);
        const y = Math.floor(((north - latitude) / (north - south)) * image.height);
        const i = (y * image.width + x) * 4;
        const [r, g, b, a] = [
          image.rgba[i]!,
          image.rgba[i + 1]!,
          image.rgba[i + 2]!,
          image.rgba[i + 3]!,
        ];

        const lookup = await getDispersionPoint(run.id, latitude, longitude);
        const series = lookup.ok
          ? lookup.series.find((item) => item.name === layer.series)
          : null;

        /*
         * Read at the raster's instant, not at the series peak. Deposit
         * accumulates, so its last frame is its maximum; concentration comes
         * and goes, and comparing a final frame against an earlier peak makes
         * the airborne layer look wrong when it is the comparison that is.
         */
        const value = series?.points.find((point) => Date.parse(point.at) === layer.at)?.value;
        const band = a > 0 ? nearestBand(layer.legend, r, g, b) : null;

        // Only where there is something to compare. A page of "transparent,
        // zero" agrees but says nothing.
        if (!band && !value) continue;

        console.log(
          `  ${label.padEnd(10)} band=${(band ? band.label : "transparent").padEnd(12)} ` +
            `point=${value === undefined ? "n/a" : value.toPrecision(6)}`,
        );
      }
    }
  });
});
