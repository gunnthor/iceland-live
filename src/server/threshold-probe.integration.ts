import { it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { changedFraction, decodeLuma, lumaDifference } from "@/server/jpeg-dc";

/**
 * Measures real frame-to-frame differences, which is where the frame store's
 * change threshold comes from.
 *
 * Point `FRAME_DIR` at a directory of camera frames named
 * `<camera>_<epoch seconds>.jpg` — collect them by polling a few cameras and
 * saving each new `Last-Modified` — then:
 *
 *   FRAME_DIR=/tmp/frames npm run test:live -- threshold-probe
 *
 * The figures in the README's table came from a run of this.
 */
it("measures consecutive frames from live cameras", () => {
  const dir = process.env.FRAME_DIR;
  if (!dir || !existsSync(dir)) {
    console.log("\nSet FRAME_DIR to a directory of camera frames to run this.");
    return;
  }

  const files = readdirSync(dir).filter((name) => name.endsWith(".jpg"));

  const byCamera = new Map<string, string[]>();
  for (const file of files) {
    const camera = file.replace(/_\d+\.jpg$/, "");
    const list = byCamera.get(camera) ?? [];
    list.push(file);
    byCamera.set(camera, list);
  }

  for (const [camera, list] of byCamera) {
    list.sort();
    const lumas = list.map((file) => ({
      file,
      luma: decodeLuma(new Uint8Array(readFileSync(`${dir}/${file}`))),
    }));

    console.log(`\n${camera}: ${list.length} distinct frames`);
    const diffs: number[] = [];
    for (let i = 1; i < lumas.length; i += 1) {
      const a = lumas[i - 1]?.luma;
      const b = lumas[i]?.luma;
      if (!a || !b) {
        console.log(`  ${lumas[i]?.file}: undecodable`);
        continue;
      }
      const d = lumaDifference(a, b);
      const f = changedFraction(a, b);
      if (d === null || f === null) continue;
      diffs.push(f);
      const gap =
        Number(lumas[i]!.file.match(/_(\d+)\.jpg$/)?.[1] ?? 0) -
        Number(lumas[i - 1]!.file.match(/_(\d+)\.jpg$/)?.[1] ?? 0);
      console.log(
        `  +${String(gap).padStart(4)}s  mean ${d.toFixed(3)}  changed ${(f * 100).toFixed(2)}%`,
      );
    }
    if (diffs.length > 0) {
      diffs.sort((x, y) => x - y);
      console.log(
        `  changed%: min ${(diffs[0]! * 100).toFixed(2)}  median ${(diffs[Math.floor(diffs.length / 2)]! * 100).toFixed(2)}  max ${(diffs.at(-1)! * 100).toFixed(2)}`,
      );
    }
  }

  /* An upper bound: two different cameras should be nothing alike. */
  const cameras = [...byCamera.entries()];
  if (cameras.length >= 2) {
    const first = decodeLuma(new Uint8Array(readFileSync(`${dir}/${cameras[0]![1][0]}`)));
    const second = decodeLuma(new Uint8Array(readFileSync(`${dir}/${cameras[1]![1][0]}`)));
    if (first && second) {
      console.log(
        `\ndifferent cameras: mean ${lumaDifference(first, second)?.toFixed(3)} changed ${((changedFraction(first, second) ?? 0) * 100).toFixed(2)}%`,
      );
    }
  }
});
