"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/format";

/**
 * The mobile activity panel.
 *
 * Three snap points rather than open/closed: at `peek` the map owns the screen
 * and the sheet is a handle plus one line of context; `half` is the working
 * position; `full` is for reading through the feed. Dragging settles to the
 * nearest point, and the handle is also a button so the sheet can be cycled
 * without a drag — which is what keyboard and switch users need.
 */

export type SheetSnap = "peek" | "half" | "full";

/** Height of each snap point as a fraction of the viewport. */
const SNAP_FRACTION: Record<SheetSnap, number> = {
  peek: 0.2,
  half: 0.52,
  full: 0.88,
};

/**
 * Floor for the peek height, in pixels.
 *
 * At peek the sheet still shows the timeline, and a chart clipped halfway
 * through looks broken rather than collapsed. On a short phone the fraction
 * alone is not enough, so this keeps the whole chart on screen.
 */
const PEEK_MIN_PX = 172;

const ORDER: SheetSnap[] = ["peek", "half", "full"];

function snapHeight(snap: SheetSnap, viewportHeight: number): number {
  const height = viewportHeight * SNAP_FRACTION[snap];
  return snap === "peek" ? Math.max(height, Math.min(PEEK_MIN_PX, viewportHeight * 0.34)) : height;
}

export function BottomSheet({
  snap,
  onSnapChange,
  children,
  label,
}: {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  children: React.ReactNode;
  label: string;
}) {
  const [viewportHeight, setViewportHeight] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  /* Mirrors `dragStateRef` for rendering: the transition depends on it, and a
     ref read during render is not guaranteed to be up to date. */
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ startY: number; pointerId: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // visualViewport tracks the area left by mobile browser chrome, which
    // innerHeight does not; without it the sheet sits under the URL bar.
    const measure = () => setViewportHeight(window.visualViewport?.height ?? window.innerHeight);
    measure();
    window.visualViewport?.addEventListener("resize", measure);
    window.addEventListener("resize", measure);
    return () => {
      window.visualViewport?.removeEventListener("resize", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const height = snapHeight(snap, viewportHeight);

  const settle = useCallback(
    (targetHeight: number) => {
      let best: SheetSnap = "peek";
      let bestDistance = Infinity;
      for (const candidate of ORDER) {
        const distance = Math.abs(snapHeight(candidate, viewportHeight) - targetHeight);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
      onSnapChange(best);
    },
    [onSnapChange, viewportHeight],
  );

  const onPointerDown = (event: React.PointerEvent) => {
    dragStateRef.current = { startY: event.clientY, pointerId: event.pointerId };
    setDragging(true);
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    setDragOffset(state.startY - event.clientY);
  };

  const endDrag = (event: React.PointerEvent) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    settle(height + dragOffset);
    dragStateRef.current = null;
    setDragging(false);
    setDragOffset(0);
  };

  /** Cycles forward, wrapping at the top — the handle's keyboard behaviour. */
  const cycle = () => {
    const index = ORDER.indexOf(snap);
    onSnapChange(ORDER[(index + 1) % ORDER.length] as SheetSnap);
  };

  // A collapsed sheet should not hold a stale scroll position.
  useEffect(() => {
    if (snap === "peek") scrollRef.current?.scrollTo({ top: 0 });
  }, [snap]);

  const effectiveHeight = Math.max(
    snapHeight("peek", viewportHeight),
    Math.min(snapHeight("full", viewportHeight), height + dragOffset),
  );

  return (
    <div
      className="panel panel-solid absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-xl border-x-0 border-b-0"
      style={{
        height: viewportHeight > 0 ? effectiveHeight : undefined,
        transition: dragging ? "none" : "height 320ms var(--ease-out-soft)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      aria-label={label}
    >
      <div
        className="flex shrink-0 cursor-grab touch-none justify-center py-1.5 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <button
          type="button"
          onClick={cycle}
          aria-label={`${label}. Currently ${snap}. Select to change size.`}
          aria-expanded={snap !== "peek"}
          className="flex h-8 w-20 items-center justify-center"
        >
          <span aria-hidden="true" className="h-1 w-9 rounded-full bg-white/22" />
        </button>
      </div>

      <div
        ref={scrollRef}
        className={cn(
          "min-h-0 flex-1",
          snap === "peek" ? "overflow-hidden" : "overflow-y-auto overscroll-contain",
        )}
      >
        {children}
      </div>
    </div>
  );
}
