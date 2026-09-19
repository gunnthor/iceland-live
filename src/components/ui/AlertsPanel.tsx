"use client";

import { useState } from "react";
import {
  isGeological,
  preferEnglish,
  type AlertColour,
  type OfficialAlert,
} from "@/domain/alert";
import { cn } from "@/lib/format";
import { formatDayClock, formatRelative } from "@/lib/time";

/**
 * Official warnings from IMO.
 *
 * This block is styled unlike anything else in the interface on purpose. Our
 * own analytics are monochrome with a single amber accent; these carry IMO's
 * published warning colours and say "Official" in the heading, so there is no
 * reading of the screen in which one could be mistaken for the other.
 *
 * Nothing here is computed. Severity, colour, timing and wording are all IMO's,
 * relayed as issued.
 */

const COLOUR_VAR: Record<AlertColour, string> = {
  Yellow: "var(--color-alert-yellow)",
  Orange: "var(--color-alert-orange)",
  Red: "var(--color-alert-red)",
};

function alertColour(alert: OfficialAlert): string {
  return alert.colour ? COLOUR_VAR[alert.colour] : "var(--color-ink-dim)";
}

/** "In force until 16:00" / "From 21:00 tomorrow" / "Issued 2 h ago". */
function timing(alert: OfficialAlert, nowMs: number): string {
  const onset = alert.onsetAt ? Date.parse(alert.onsetAt) : null;
  const expires = alert.expiresAt ? Date.parse(alert.expiresAt) : null;

  if (onset !== null && onset > nowMs) {
    return `From ${formatDayClock(onset)}${expires !== null ? ` until ${formatDayClock(expires)}` : ""}`;
  }
  if (expires !== null) return `In force until ${formatDayClock(expires)}`;
  return `Issued ${formatRelative(alert.sentAt, nowMs)}`;
}

function AlertRow({
  alert,
  nowMs,
  onShowArea,
}: {
  alert: OfficialAlert;
  nowMs: number;
  onShowArea: (alert: OfficialAlert) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const colour = alertColour(alert);
  const headline = preferEnglish(alert.headline);
  const event = preferEnglish(alert.event);
  const description = preferEnglish(alert.description);
  const areas = alert.areas
    .map((area) => preferEnglish(area.description))
    .filter((name): name is string => name !== null);
  const hasGeometry = alert.areas.some((area) => area.geometry !== null);

  return (
    <li className="border-t border-[var(--color-line)] first:border-t-0">
      <div className="flex gap-3 px-4 py-3">
        <span
          aria-hidden="true"
          className="mt-0.5 w-[3px] shrink-0 rounded-full"
          style={{ backgroundColor: colour }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-[12px] font-medium leading-tight text-[var(--color-ink)]">
              {event ?? alert.alertType ?? "Warning"}
            </h3>
            {alert.colour && (
              <span
                className="shrink-0 text-[10px] font-medium uppercase tracking-wide"
                style={{ color: colour }}
              >
                {alert.colour}
              </span>
            )}
            {isGeological(alert) && (
              <span className="shrink-0 rounded bg-white/[0.07] px-1.5 py-px text-[9px] uppercase tracking-wide text-[var(--color-ink-dim)]">
                Geological
              </span>
            )}
          </div>

          {areas.length > 0 && (
            <p className="mt-1 truncate text-[11px] text-[var(--color-ink-muted)]">
              {areas.join(" · ")}
            </p>
          )}

          <p className="tnum mt-1 text-[11px] text-[var(--color-ink-dim)]">
            {timing(alert, nowMs)}
          </p>

          {headline && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
              {headline}
            </p>
          )}

          {expanded && description && (
            <p className="animate-fade-rise mt-2 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
              {description}
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-1">
            {description && description !== headline && (
              <button
                type="button"
                onClick={() => setExpanded((open) => !open)}
                aria-expanded={expanded}
                className="-ml-1.5 rounded px-1.5 py-2 text-[11px] text-[var(--color-ink-dim)] underline-offset-2 transition-colors duration-150 hover:text-[var(--color-ink)] hover:underline"
              >
                {expanded ? "Less" : "More detail"}
              </button>
            )}
            {hasGeometry && (
              <button
                type="button"
                onClick={() => onShowArea(alert)}
                className="rounded px-1.5 py-2 text-[11px] text-[var(--color-ink-dim)] underline-offset-2 transition-colors duration-150 hover:text-[var(--color-ink)] hover:underline"
              >
                Show area on map
              </button>
            )}
            {alert.url && (
              <a
                href={alert.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded px-1.5 py-2 text-[11px] text-[var(--color-ink-dim)] underline-offset-2 transition-colors duration-150 hover:text-[var(--color-ink)] hover:underline"
              >
                IMO page
              </a>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

export function AlertsPanel({
  alerts,
  nowMs,
  onShowArea,
  unavailable,
}: {
  alerts: readonly OfficialAlert[];
  nowMs: number;
  onShowArea: (alert: OfficialAlert) => void;
  /** True when the broker could not be reached. */
  unavailable: boolean;
}) {
  // Nothing in force is the normal state, and an empty panel saying so would be
  // clutter. Silence here means "no warnings", which is what the footnote in
  // the summary block already tells the reader.
  if (alerts.length === 0 && !unavailable) return null;

  const worst = alerts[0];
  const accent = worst ? alertColour(worst) : "var(--color-ink-dim)";

  return (
    <section
      aria-label="Official warnings"
      className="border-b border-[var(--color-line)]"
      style={{ backgroundColor: "rgb(255 255 255 / 0.015)" }}
    >
      <div className="flex items-center gap-2 px-4 pb-1 pt-3">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <h2 className="label" style={{ color: accent }}>
          Official warnings
        </h2>
        <span className="text-[10px] text-[var(--color-ink-faint)]">
          Icelandic Met Office
        </span>
      </div>

      {unavailable ? (
        <p className="px-4 pb-3 pt-1 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
          Official warnings could not be loaded. Check{" "}
          <a
            href="https://en.vedur.is/weather/warnings/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-[var(--color-ink)]"
          >
            vedur.is
          </a>{" "}
          directly.
        </p>
      ) : (
        <ul className={cn("mt-1")}>
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} nowMs={nowMs} onShowArea={onShowArea} />
          ))}
        </ul>
      )}
    </section>
  );
}
