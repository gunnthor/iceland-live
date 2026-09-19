import { describe, expect, it } from "vitest";
import { WATCH_SITES, WATCH_VIEWS, watchList } from "./camera-recorder";
import type { WebcamSite } from "@/domain/webcam";

function site(
  id: number,
  name: string,
  latitude: number,
  longitude: number,
  views = 1,
): WebcamSite {
  return {
    id,
    name,
    latitude,
    longitude,
    road: null,
    roadNumber: null,
    views: Array.from({ length: views }, (_, index) => ({
      id: `${id}-${index}`,
      description: `${name} ${index}`,
      sourceUrl: `https://www.vegagerdin.is/vgdata/vefmyndavelar/${id}_${index}.jpg`,
      imageUrl: `/api/webcams/image?src=${id}_${index}`,
      reelUrl: `/api/webcams/reel?src=${id}_${index}`,
    })),
  };
}

/** Roughly Grindavík, Reykjavík, Akureyri, Egilsstaðir, Ísafjörður. */
const GRINDAVIK = { latitude: 63.84, longitude: -22.43 };
const NETWORK = [
  site(1, "Grindavikurvegur", 63.86, -22.42),
  site(2, "Sudurstrandarvegur", 63.85, -22.2),
  site(3, "Reykjavik", 64.13, -21.9),
  site(4, "Akureyri", 65.68, -18.09),
  site(5, "Egilsstadir", 65.27, -14.4),
  site(6, "Isafjordur", 66.07, -23.13),
];

describe("watchList", () => {
  it("watches the cameras nearest the activity, nearest first", () => {
    const list = watchList(NETWORK, GRINDAVIK);
    // Grindavíkurvegur, then Suðurstrandarvegur, then Reykjavík. Ísafjörður
    // beats Akureyri from here, which is easy to get wrong by eye: it is 40 km
    // closer once the longitude difference is scaled for latitude.
    expect(list.slice(0, 3).map((view) => view.id)).toEqual(["1-0", "2-0", "3-0"]);
    expect(list).toHaveLength(WATCH_SITES);
  });

  it("follows the activity when it moves", () => {
    // The whole point of deriving the list rather than fixing it: a swarm in
    // the north must put northern cameras on the list with nothing to edit,
    // and must drop the Reykjanes ones.
    const list = watchList(NETWORK, { latitude: 65.7, longitude: -18.1 });
    const ids = list.map((view) => view.id);
    expect(ids[0]).toBe("4-0");
    expect(ids).not.toContain("1-0");
    expect(ids).not.toContain("2-0");
  });

  it("takes every view of a watched site", () => {
    // A site's other angles are as much a record as its first.
    const list = watchList([site(1, "Artunsbrekka", 63.85, -22.43, 4)], GRINDAVIK);
    expect(list).toHaveLength(4);
  });

  it("caps the views however camera-dense the nearest sites are", () => {
    const dense = Array.from({ length: WATCH_SITES }, (_, index) =>
      site(index + 1, `Site ${index}`, 63.84 + index * 0.01, -22.43, 6),
    );
    // Four sites × six views would be 24 requests per tick at Vegagerðin.
    expect(watchList(dense, GRINDAVIK)).toHaveLength(WATCH_VIEWS);
  });

  it("returns nothing when the catalogue is empty", () => {
    expect(watchList([], GRINDAVIK)).toEqual([]);
  });

  it("copes with fewer sites than it would like to watch", () => {
    expect(watchList(NETWORK.slice(0, 2), GRINDAVIK)).toHaveLength(2);
  });
});
