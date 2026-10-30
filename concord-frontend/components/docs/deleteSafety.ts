'use client';

/**
 * Delete safety for the Docs lens (S1, Review 2 finding F1 — the
 * `unconfirmed-destructive` class): every Docs delete used to execute
 * instantly — no confirmation, no undo, no receipt.
 *
 * This registry is the undo window. A confirmed delete does NOT call
 * its macro immediately: it registers here, the caller hides the item
 * at once (the pending key drives the lists' filters), and the real
 * commit runs only when the window (DELETE_UNDO_WINDOW_MS) lapses.
 * Undo inside the window cancels the commit outright — the item was
 * never deleted server-side, so "recoverable" is literal, not a
 * restore-from-backup promise. The receipt state drives the toast
 * (DeleteSafety.tsx): pending (with Undo), done (announced), or
 * error (the macro's refusal, verbatim, with the item restored).
 *
 * The registry is module-level (the docsSession pattern), so its
 * timers survive component unmounts and tab switches inside the
 * lens. A hard page reload inside the window drops the pending
 * commit — the item survives. That failure direction is deliberate:
 * a delete may silently NOT happen; it may never silently happen.
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

/** Register a confirmed delete. The commit runs after the undo window. */
export function requestDelete(input: { key: string; label: string; commit: () => Promise<void> }): void {
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
