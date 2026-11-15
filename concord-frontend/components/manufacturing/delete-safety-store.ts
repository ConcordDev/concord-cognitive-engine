'use client';

/**
 * Delete safety for the Manufacturing lens (S4 — Review 5 finding F2,
 * `absent-exit-path` at whole-lens scale): no object type in this lens
 * had a delete. The exits now exist server-side (one delete verb per
 * object type); this registry is the undo window over them, mirroring
 * the Docs/Worldmodel store (the fleet's #1905 shape) with the same
 * semantics. A confirmed delete does NOT call its macro immediately:
 * it registers here, the caller hides the item at once (the pending key
 * drives the lists' filters), and the real commit runs only when the
 * window (DELETE_UNDO_WINDOW_MS) lapses. Undo inside the window cancels
 * the commit outright — the item was never deleted server-side, so
 * "recoverable" is literal. The receipt state drives the toast
 * (DeleteSafety.tsx): pending (with Undo), done (announced), or error
 * (the macro's refusal, verbatim, with the item restored).
 *
 * The registry is module-level, so its timers survive component
 * unmounts and tab switches inside the lens. Leaving is a commit, not
 * a cancel (FIX-manufacturing-008): the lists and counts already show
 * the item gone the moment the delete is confirmed, so a reload or
 * navigation inside the window must not silently resurrect it. When
 * the page is hidden or unloaded (visibilitychange / pagehide) every
 * pending commit flushes immediately — the undo window is a grace
 * period while you stay, never a delay you have to outwait.
 */

export const DELETE_UNDO_WINDOW_MS = 8000;

export type DeleteReceipt =
  | { phase: 'pending'; key: string; label: string }
  | { phase: 'done'; key: string; label: string }
  | { phase: 'error'; key: string; label: string; message: string };

export interface DeleteSafetySnapshot {
  pendingKeys: readonly string[];
  receipt: DeleteReceipt | null;
}

interface PendingEntry {
  key: string;
  label: string;
  commit: () => Promise<void>;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingEntry>();
let receipt: DeleteReceipt | null = null;
let receiptTimer: ReturnType<typeof setTimeout> | null = null;
let snapshot: DeleteSafetySnapshot = { pendingKeys: [], receipt: null };
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = { pendingKeys: [...pending.keys()], receipt };
  for (const l of listeners) l();
}

function setReceipt(next: DeleteReceipt | null, ttlMs: number | null): void {
  receipt = next;
  if (receiptTimer) { clearTimeout(receiptTimer); receiptTimer = null; }
  if (next && ttlMs) {
    receiptTimer = setTimeout(() => { receipt = null; emit(); }, ttlMs);
  }
}

/**
 * Commit every pending delete now. Fired when the page is being hidden
 * or unloaded, so leaving inside the undo window completes the deletes
 * the UI has already presented as happening (FIX-manufacturing-008).
 */
export function flushPendingDeletes(): void {
  for (const key of [...pending.keys()]) {
    const entry = pending.get(key);
    if (!entry) continue;
    clearTimeout(entry.timer);
    void commitPending(key);
  }
}

let flushHooksInstalled = false;
function installFlushHooks(): void {
  if (flushHooksInstalled || typeof window === 'undefined' || typeof document === 'undefined') return;
  flushHooksInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingDeletes();
  });
  window.addEventListener('pagehide', flushPendingDeletes);
}

/** Register a confirmed delete. The commit runs after the undo window. */
export function requestDelete(input: { key: string; label: string; commit: () => Promise<void> }): void {
  installFlushHooks();
  const existing = pending.get(input.key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => { void commitPending(input.key); }, DELETE_UNDO_WINDOW_MS);
  pending.set(input.key, { ...input, timer });
  setReceipt({ phase: 'pending', key: input.key, label: input.label }, null);
  emit();
}

/** Cancel a pending delete inside its window. The item was never deleted. */
export function undoDelete(key: string): void {
  const entry = pending.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(key);
  if (receipt?.key === key) setReceipt(null, null);
  emit();
}

async function commitPending(key: string): Promise<void> {
  const entry = pending.get(key);
  if (!entry) return;
  try {
    await entry.commit();
    pending.delete(key);
    setReceipt({ phase: 'done', key, label: entry.label }, 4000);
  } catch (err) {
    pending.delete(key);
    setReceipt({
      phase: 'error', key, label: entry.label,
      message: err instanceof Error ? err.message : String(err),
    }, 6000);
  }
  emit();
}

export function isDeletePending(key: string): boolean {
  return pending.has(key);
}

export function subscribeDeleteSafety(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getDeleteSafetySnapshot(): DeleteSafetySnapshot {
  return snapshot;
}

/** Test-only: clear every pending commit and the receipt. */
export function resetDeleteSafetyForTests(): void {
  for (const e of pending.values()) clearTimeout(e.timer);
  pending.clear();
  if (receiptTimer) { clearTimeout(receiptTimer); receiptTimer = null; }
  receipt = null;
  emit();
}
