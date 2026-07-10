'use client';

/**
 * Lens UI state persistence — small get/set utility so a lens page can
 * restore incidental UI state (scroll position, which panel was open,
 * active filters) when the user navigates back to it, without wiring a
 * server-side substrate for what is genuinely presentation-only state.
 *
 * Follows this codebase's established localStorage-persistence convention
 * (see `lib/world-lens/quality-preset.ts`): every storage access is wrapped
 * so a throw (Safari private mode, "block all cookies", locked-down
 * WebViews — see `lib/safe-storage.ts`'s header) degrades to "nothing
 * restored" rather than crashing the caller.
 *
 * All state for every lens lives under ONE storage key as a small JSON map,
 * capped at `MAX_LENSES` entries (oldest `savedAt` evicted first) so a user
 * who visits many lenses over a session doesn't grow this unboundedly. This
 * is UI convenience state only — never gameplay/economy state, and never a
 * substitute for a real backend persistence path.
 */

import { useCallback } from 'react';
import { safeGetItem, safeSetItem } from './safe-storage';

const STORAGE_KEY = 'concord-lens-ui-state';
/** Cap on distinct lenses tracked at once — oldest (by `savedAt`) evicted first. */
const MAX_LENSES = 20;

interface LensStateEntry {
  state: Record<string, unknown>;
  savedAt: number;
}

type LensStateStore = Record<string, LensStateEntry>;

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function readStore(): LensStateStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = safeGetItem(window.localStorage, STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed)) return {};
    // Defensive re-validation of each entry's shape — a corrupted/foreign
    // value under this key must never propagate as a fabricated state object.
    const out: LensStateStore = {};
    for (const [lensId, entry] of Object.entries(parsed)) {
      if (
        isPlainRecord(entry) &&
        isPlainRecord((entry as { state?: unknown }).state) &&
        typeof (entry as { savedAt?: unknown }).savedAt === 'number'
      ) {
        out[lensId] = entry as unknown as LensStateEntry;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(store: LensStateStore): void {
  if (typeof window === 'undefined') return;
  try {
    safeSetItem(window.localStorage, STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* best-effort persistence — a write failure just means state isn't restored next visit */
  }
}

/** Evict oldest entries (by `savedAt`) beyond `MAX_LENSES`. Pure — returns a new object. */
function capStore(store: LensStateStore): LensStateStore {
  const ids = Object.keys(store);
  if (ids.length <= MAX_LENSES) return store;
  const oldestFirst = [...ids].sort((a, b) => store[a].savedAt - store[b].savedAt);
  const toEvict = oldestFirst.slice(0, ids.length - MAX_LENSES);
  const next: LensStateStore = { ...store };
  for (const id of toEvict) delete next[id];
  return next;
}

/** Read the last-persisted UI state for a lens, or null if none/unreadable. */
export function getLensState(lensId: string): Record<string, unknown> | null {
  if (!lensId) return null;
  const entry = readStore()[lensId];
  return entry ? entry.state : null;
}

/**
 * Persist a lens's UI state, stamped with the current time so the eviction
 * cap can find the oldest entry. Overwrites any prior state for this lens id.
 */
export function setLensState(lensId: string, state: Record<string, unknown>): void {
  if (!lensId || !isPlainRecord(state)) return;
  const store = readStore();
  store[lensId] = { state, savedAt: Date.now() };
  writeStore(capStore(store));
}

/** Drop a lens's persisted state (e.g. an explicit "reset view" action). */
export function clearLensState(lensId: string): void {
  if (!lensId) return;
  const store = readStore();
  if (!(lensId in store)) return;
  delete store[lensId];
  writeStore(store);
}

/** How many lenses currently have persisted state. Exposed for tests/diagnostics. */
export function lensStateCount(): number {
  return Object.keys(readStore()).length;
}

export interface UseLensStatePersistenceReturn {
  /** Read this lens's last-persisted UI state (e.g. on mount, to restore scroll/panels). */
  restore: () => Record<string, unknown> | null;
  /** Persist this lens's current UI state (e.g. on scroll/panel-change, or on unmount). */
  persist: (state: Record<string, unknown>) => void;
  /** Drop this lens's persisted state. */
  clear: () => void;
}

/**
 * Hook wrapper a lens page opts into for scroll/panel restore on return-visit.
 *
 * Deliberately does NOT auto-persist on every render or auto-restore on
 * mount — a lens decides WHEN its state is meaningful to snapshot (e.g. on
 * scroll-stop, on panel toggle, on unmount) and WHEN to apply a restore
 * (e.g. once, after its data has loaded). Auto-wiring either direction here
 * would risk restoring state into a lens that isn't ready for it yet, or
 * persisting a mid-load transient state as if it were the user's real choice.
 */
export function useLensStatePersistence(lensId: string): UseLensStatePersistenceReturn {
  const restore = useCallback(() => getLensState(lensId), [lensId]);
  const persist = useCallback((state: Record<string, unknown>) => setLensState(lensId, state), [lensId]);
  const clear = useCallback(() => clearLensState(lensId), [lensId]);
  return { restore, persist, clear };
}
