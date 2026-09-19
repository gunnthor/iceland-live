"use client";

import type { ProviderMeta } from "@/providers/types";
import { cn } from "@/lib/format";
import { formatExact, formatRelative } from "@/lib/time";

export type StatusTone = "live" | "stale" | "error" | "fixture";

function toneStyles(tone: StatusTone): { dot: string; text: string } {
  switch (tone) {
    case "live":
      return { dot: "bg-[var(--color-alert-green)]", text: "text-[var(--color-ink-muted)]" };
    case "stale":
      return { dot: "bg-[var(--color-alert-yellow)]", text: "text-[var(--color-alert-yellow)]" };
    case "fixture":
      return { dot: "bg-[var(--color-alert-orange)]", text: "text-[var(--color-alert-orange)]" };
    case "error":
      return { dot: "bg-[var(--color-alert-red)]", text: "text-[var(--color-alert-red)]" };
  }
}

/**
 * Data provenance, always visible.
 *
 * This is how the interface keeps its promise never to pass off cached,
 * unavailable or sample data as live. The dot is never green unless the payload
 * genuinely came from IMO within the cache window.
 */
export function StatusPill({
  meta,
  error,
  refreshing,
  nowMs,
  onRetry,
  className,
}: {
  meta: ProviderMeta | null;
  error: { code: string; message: string } | null;
  refreshing: boolean;
  nowMs: number;
  onRetry: () => void;
  className?: string;
}) {
  let tone: StatusTone = "live";
  let label = "Live";
  let detail: string | null = null;

  if (error) {
    tone = "error";
    label = "Unavailable";
    detail = error.message;
  } else if (!meta) {
    tone = "error";
    label = "No data";
  } else if (meta.freshness === "fixture") {
    tone = "fixture";
    label = "Sample data";
    detail = "Development fixture — not current observations.";
  } else if (meta.freshness === "stale") {
    tone = "stale";
    label = "Last known";
    detail = `IMO is not reachable. Showing data from ${formatRelative(meta.fetchedAt, nowMs)}.`;
  } else {
    label = `Updated ${formatRelative(meta.fetchedAt, nowMs)}`;
    detail = `Retrieved ${formatExact(meta.fetchedAt)}`;
  }

  const styles = toneStyles(tone);
  const actionable = tone === "error" || tone === "stale";

  return (
    <button
      type="button"
      onClick={onRetry}
      title={detail ?? undefined}
      aria-label={detail ? `${label}. ${detail} Select to refresh.` : `${label}. Select to refresh.`}
      className={cn(
        "group flex min-h-11 shrink-0 items-center gap-2 rounded-md px-2 transition-colors duration-150 hover:bg-white/[0.05] lg:min-h-8",
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            styles.dot,
            refreshing && "animate-breathe",
          )}
        />
        {actionable && (
          <span
            className={cn("absolute inset-0 rounded-full opacity-40", styles.dot, "animate-breathe")}
          />
        )}
      </span>
      <span className={cn("whitespace-nowrap text-[11px] font-medium", styles.text)}>{label}</span>
    </button>
  );
}
