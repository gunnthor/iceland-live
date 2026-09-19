"use client";

import { cn } from "@/lib/format";

/** Shimmer-free loading placeholder. Movement here would fight the map. */
export function LoadingState({ label = "Loading earthquake data" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
    >
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-white/30 animate-breathe"
            style={{ animationDelay: `${i * 200}ms` }}
          />
        ))}
      </div>
      <p className="text-[12px] text-[var(--color-ink-dim)]">{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-[13px] text-[var(--color-ink)]">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[34ch] text-[12px] leading-relaxed text-[var(--color-ink-dim)]">
        {body}
      </p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 rounded-md border border-[var(--color-line-strong)] px-3 py-1.5 text-[12px] text-[var(--color-ink-muted)] transition-colors duration-150 hover:bg-white/[0.05] hover:text-[var(--color-ink)]"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * A banner over content that is still usable.
 *
 * Used when a refresh fails but we still hold real data: the map keeps working,
 * and this says plainly that what is on screen is not current.
 */
export function ErrorBanner({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2.5 border-b border-[var(--color-line)] bg-[var(--color-alert-red)]/[0.08] px-4 py-2.5",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-alert-red)]"
      />
      <p className="flex-1 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--color-ink-dim)] underline-offset-2 transition-colors hover:text-[var(--color-ink)] hover:underline"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/** Full-panel failure, when there is nothing real to show at all. */
export function UnavailableState({
  message,
  onRetry,
  offline,
}: {
  message: string;
  onRetry: () => void;
  offline: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div
        aria-hidden="true"
        className="mb-4 h-8 w-8 rounded-full border border-[var(--color-alert-red)]/40"
      />
      <h2 className="text-[13px] font-medium text-[var(--color-ink)]">
        {offline ? "You are offline" : "Data unavailable"}
      </h2>
      <p className="mx-auto mt-2 max-w-[36ch] text-[12px] leading-relaxed text-[var(--color-ink-dim)]">
        {offline
          ? "Iceland Live needs a connection to fetch earthquake data from the Icelandic Meteorological Office."
          : message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 rounded-md border border-[var(--color-line-strong)] px-3.5 py-2 text-[12px] text-[var(--color-ink-muted)] transition-colors duration-150 hover:bg-white/[0.05] hover:text-[var(--color-ink)]"
      >
        Try again
      </button>
    </div>
  );
}
