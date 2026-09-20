/**
 * Where recorded camera frames are actually kept.
 *
 * ## Why this is an interface
 *
 * The local filesystem is right for a VPS with a mounted volume and wrong for
 * serverless, where only `os.tmpdir()` is writable, it is per instance, and it
 * does not survive. A camera frame is the one thing this codebase holds that
 * is not re-fetchable: once Vegagerðin publishes the next picture the previous
 * one is gone upstream forever. So the store needs somewhere durable to go,
 * and the rest of the code should not know which.
 *
 * ## No index object
 *
 * State is derived from a listing rather than kept in a file beside the
 * frames. With one process an index is simply faster; with several sharing a
 * bucket it is a correctness bug — two instances that each loaded the index,
 * recorded, and wrote it back would silently drop each other's frames. A
 * listing has no such race, and object stores are built to be listed.
 *
 * That is why the capture time is in the key. Two instances handed the same
 * picture derive the same `Last-Modified`, so they write the same key, and the
 * worst case is one harmless overwrite of identical bytes.
 */

/** One stored frame, as the backend knows it. */
export type BackendFrame = {
  /** Capture time, from the camera's own `Last-Modified`. */
  at: number;
  bytes: number;
};

export type FrameBackend = {
  /** For logs and diagnostics. */
  readonly name: string;
  put(view: string, at: number, body: Uint8Array): Promise<void>;
  get(view: string, at: number): Promise<Buffer | null>;
  remove(view: string, at: number): Promise<void>;
  /** Frames held for one view, in any order. */
  list(view: string): Promise<BackendFrame[]>;
  /** Everything held, grouped by view. Used to enforce the global budget. */
  listAll(): Promise<Map<string, BackendFrame[]>>;
};

/** Logged once per scope, so an unwritable store does not fill the log. */
const warned = new Set<string>();

export function warnOnce(scope: string, error: unknown): void {
  if (warned.has(scope)) return;
  warned.add(scope);
  console.warn(`[frame-store] ${scope}: ${String(error)} (continuing without it)`);
}

/** Test seam. */
export function resetBackendWarnings(): void {
  warned.clear();
}
