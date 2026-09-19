/**
 * Live road webcams from Vegagerðin (Icelandic Road and Coastal Administration).
 *
 * Endpoint: GET https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1
 * Docs:     https://www.vegagerdin.is/vegagerdin/gagnasafn/vefthjonustur/vefmyndavelar
 * Terms:    https://www.vegagerdin.is/vegagerdin/gagnasafn/vefthjonustur/terms-and-conditions
 *
 * Returns ~497 camera views across ~165 sites. Field names are Icelandic:
 * `Breidd` is latitude and `Lengd` is longitude — worth stating, because
 * "breidd" also means width and reading them the wrong way round puts every
 * camera somewhere it is not.
 */

import type { WebcamSite, WebcamView } from "@/domain/webcam";
import {
  ProviderError,
  type ProviderAttribution,
  type ProviderResult,
} from "@/providers/types";

const ENDPOINT = "https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1";

/** Host serving the images. Only this may be proxied. */
export const IRCA_IMAGE_HOST = "www.vegagerdin.is";

export const IRCA_PROVIDER_ATTRIBUTION: ProviderAttribution = {
  name: "Icelandic Road and Coastal Administration (Vegagerðin)",
  url: "https://www.vegagerdin.is/",
  note: "Live road webcams, republished under IRCA's open data terms.",
};

export function toWebcamProxyUrl(publishedUrl: string): string {
  return `/api/webcams/image?src=${encodeURIComponent(publishedUrl)}`;
}

export function toWebcamReelUrl(publishedUrl: string): string {
  return `/api/webcams/reel?src=${encodeURIComponent(publishedUrl)}`;
}

type RawCamera = {
  Maelist_nr?: unknown;
  Myndavel?: unknown;
  Vegheiti?: unknown;
  NrVegur?: unknown;
  Skyring?: unknown;
  Slod?: unknown;
  Breidd?: unknown;
  Lengd?: unknown;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeWebcams(payload: unknown): WebcamSite[] {
  if (!Array.isArray(payload)) return [];

  const sites = new Map<number, WebcamSite>();

  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as RawCamera;

    const id = num(raw.Maelist_nr);
    const name = str(raw.Myndavel);
    const latitude = num(raw.Breidd);
    const longitude = num(raw.Lengd);
    const image = str(raw.Slod);

    if (id === null || !name || latitude === null || longitude === null || !image) continue;
    // Iceland, generously. Guards against swapped coordinates upstream.
    if (latitude < 62 || latitude > 68 || longitude < -26 || longitude > -12) continue;

    let site = sites.get(id);
    if (!site) {
      site = {
        id,
        name,
        latitude,
        longitude,
        road: str(raw.Vegheiti),
        roadNumber: str(raw.NrVegur),
        views: [],
      };
      sites.set(id, site);
    }

    const view: WebcamView = {
      id: `${id}-${image.split("/").pop() ?? site.views.length}`,
      description: str(raw.Skyring) ?? name,
      imageUrl: toWebcamProxyUrl(image),
      reelUrl: toWebcamReelUrl(image),
    };

    // The feed occasionally repeats a row; keep one of each image.
    if (!site.views.some((existing) => existing.id === view.id)) site.views.push(view);
  }

  return [...sites.values()].sort((a, b) => a.name.localeCompare(b.name, "is"));
}

export class VegagerdinWebcamProvider {
  readonly id = "vegagerdin-webcams";
  readonly attribution = IRCA_PROVIDER_ATTRIBUTION;

  async fetchSites(): Promise<ProviderResult<WebcamSite[]>> {
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        signal: AbortSignal.timeout(20_000),
        headers: {
          accept: "application/json",
          "user-agent": "IcelandLive/0.1 (+https://live.gunnthor.is)",
        },
        // The catalogue of sites changes rarely; the images are what move.
        next: { revalidate: 6 * 60 * 60 },
      });
    } catch (cause) {
      throw new ProviderError("network", "Could not reach the Vegagerðin webcam service.", {
        cause,
      });
    }

    if (!response.ok) {
      throw new ProviderError(
        "http",
        `Vegagerðin responded ${response.status} for the webcam catalogue.`,
        { status: response.status },
      );
    }

    const payload = (await response.json()) as unknown;

    return {
      data: normalizeWebcams(payload),
      meta: {
        providerId: this.id,
        freshness: "live",
        fetchedAt: new Date().toISOString(),
        attribution: this.attribution,
      },
    };
  }
}
