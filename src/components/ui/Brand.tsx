import { cn } from "@/lib/format";

/**
 * The wordmark.
 *
 * Drawn rather than set in an image so it stays crisp and costs nothing: a
 * hairline ring standing in for the island, with the name beside it.
 */
export function Brand({
  className,
  markOnly = false,
}: {
  className?: string;
  /** Drops the wordmark, for narrow bars where the stats need the width. */
  markOnly?: boolean;
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2.5", className)}>
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" />
        <circle cx="10" cy="10" r="4" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1" />
        <circle cx="10" cy="10" r="1.6" fill="var(--color-quake-now)" />
      </svg>
      {markOnly ? (
        <span className="sr-only">Iceland Live</span>
      ) : (
        <span className="whitespace-nowrap text-[13px] font-semibold tracking-tight text-[var(--color-ink)]">
          Iceland <span className="font-normal text-[var(--color-ink-muted)]">Live</span>
        </span>
      )}
    </div>
  );
}
