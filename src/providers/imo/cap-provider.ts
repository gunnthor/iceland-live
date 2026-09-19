/**
 * Official warnings from IMO's CAP broker.
 *
 * Endpoints:
 *   GET /cap/capbroker/active/category/{category}   -> [{ identifier, sender, sent }]
 *   GET /cap/capbroker/sender/{s}/identifier/{i}/sent/{t}/json -> a CAP 1.2 message
 *
 * ## Why two steps rather than /active/detailed/all
 *
 * The broker also offers a flattened, pre-digested listing. We use the two-step
 * route because it returns canonical CAP 1.2, which is a published standard we
 * can normalize against with confidence — and, more practically, because it is
 * the shape we could verify against real messages. Iceland usually has no more
 * than a handful of warnings in force, the detail fetches run concurrently, and
 * the whole thing is cached server-side, so the extra requests cost little.
 *
 * ## No active warnings
 *
 * The broker answers 204 with an empty body when nothing is in force. That is
 * the normal state and resolves to an empty list, never an error.
 */

import { sortAlerts, type OfficialAlert } from "@/domain/alert";
import {
  ProviderError,
  type ProviderAttribution,
  type ProviderResult,
} from "@/providers/types";
import { imoFetchJsonOrEmpty } from "./client";
import { dropExpired, normalizeCapMessage } from "./cap-normalize";

export const CAP_ATTRIBUTION: ProviderAttribution = {
  name: "Icelandic Meteorological Office (Veðurstofa Íslands)",
  url: "https://en.vedur.is/weather/warnings/",
  note: "Official warnings issued under the Common Alerting Protocol. Relayed unaltered.",
};

/** One entry in the broker's active listing. */
type MessageIdentifier = { identifier?: unknown; sender?: unknown; sent?: unknown };

export interface AlertProvider {
  readonly id: string;
  readonly attribution: ProviderAttribution;
  fetchActiveAlerts(): Promise<ProviderResult<OfficialAlert[]>>;
}

export class ImoCapProvider implements AlertProvider {
  readonly id = "imo-cap";
  readonly attribution = CAP_ATTRIBUTION;

  private readonly revalidateSeconds: number;

  constructor(options: { revalidateSeconds?: number } = {}) {
    // Warnings change on the order of hours, but during an event the onset can
    // matter, so this is tighter than the volcano layer and looser than quakes.
    this.revalidateSeconds = options.revalidateSeconds ?? 180;
  }

  async fetchActiveAlerts(): Promise<ProviderResult<OfficialAlert[]>> {
    const listing = await imoFetchJsonOrEmpty<MessageIdentifier[]>({
      service: "cap",
      path: "/capbroker/active/category/all",
      revalidateSeconds: this.revalidateSeconds,
    });

    const meta = {
      providerId: this.id,
      freshness: "live" as const,
      fetchedAt: new Date().toISOString(),
      attribution: this.attribution,
    };

    if (!Array.isArray(listing) || listing.length === 0) {
      return { data: [], meta };
    }

    const messages = await Promise.all(
      listing.map((entry) => this.fetchMessage(entry).catch((error: unknown) => {
        // One unreadable message must not blank the whole warnings panel.
        console.warn(
          `[imo-cap] skipping a message we could not read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      })),
    );

    const alerts = messages.filter((alert): alert is OfficialAlert => alert !== null);
    return { data: sortAlerts(dropExpired(alerts)), meta };
  }

  private async fetchMessage(entry: MessageIdentifier): Promise<OfficialAlert | null> {
    const identifier = typeof entry.identifier === "string" ? entry.identifier : null;
    const sender = typeof entry.sender === "string" ? entry.sender : null;
    const sent = typeof entry.sent === "string" ? entry.sent : null;

    if (!identifier || !sender || !sent) {
      throw new ProviderError("parse", "CAP listing entry was missing identifier, sender or sent.");
    }

    const payload = await imoFetchJsonOrEmpty<unknown>({
      service: "cap",
      // Each segment is encoded: `sent` is a timestamp containing ':' and '+'.
      path:
        `/capbroker/sender/${encodeURIComponent(sender)}` +
        `/identifier/${encodeURIComponent(identifier)}` +
        `/sent/${encodeURIComponent(sent)}/json`,
      revalidateSeconds: this.revalidateSeconds,
    });

    return payload === null ? null : normalizeCapMessage(payload);
  }
}
