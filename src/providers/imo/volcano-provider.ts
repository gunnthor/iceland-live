import type { VolcanicSystem } from "@/domain/volcano";
import type { ProviderAttribution, ProviderResult, VolcanoProvider } from "@/providers/types";
import { imoFetchJson } from "./client";
import { normalizeVolcanoes } from "./volcano-normalize";

export const CATALOGUE_ATTRIBUTION: ProviderAttribution = {
  name: "Catalogue of Icelandic Volcanoes",
  url: "https://icelandicvolcanoes.is/",
  note: "Published via the IMO Volcanoes API. Individual features credit their originating institution.",
};

export class ImoVolcanoProvider implements VolcanoProvider {
  readonly id = "imo-volcanoes";
  readonly attribution = CATALOGUE_ATTRIBUTION;

  /**
   * Volcanic system geometry is effectively static and the aviation colour code
   * changes rarely, so this is cached far more aggressively than earthquakes.
   */
  private readonly revalidateSeconds: number;

  constructor(options: { revalidateSeconds?: number } = {}) {
    this.revalidateSeconds = options.revalidateSeconds ?? 3600;
  }

  async fetchVolcanicSystems(): Promise<ProviderResult<VolcanicSystem[]>> {
    const payload = await imoFetchJson<unknown>({
      service: "volcanoes",
      path: "/volcanoes",
      query: { include_geometry: "true" },
      revalidateSeconds: this.revalidateSeconds,
      timeoutMs: 20_000,
    });

    return {
      data: normalizeVolcanoes(payload),
      meta: {
        providerId: this.id,
        freshness: "live",
        fetchedAt: new Date().toISOString(),
        attribution: this.attribution,
      },
    };
  }
}
