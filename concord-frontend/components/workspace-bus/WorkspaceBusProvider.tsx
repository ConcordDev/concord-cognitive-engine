'use client';

/**
 * Workspace Bus — a system-level, DTU-native clipboard for cross-lens data
 * movement (Frontend Rebuild Program, Phase 1 item 3).
 *
 * How this relates to `components/panel-polish/PipingProvider.tsx`:
 *   - PipingProvider is PAGE-scoped — every lens page mounts its own
 *     `<PipingProvider>` instance, so a `pipe.publish(...)` never survives a
 *     navigation to a different lens, and the payload is an arbitrary macro
 *     result shape keyed by a dot-namespaced string.
 *   - The Workspace Bus is mounted ONCE at the shell root (see
 *     `components/Providers.tsx`) so it survives lens-to-lens navigation,
 *     and every entry is normalized to a DTU-native shape (id / kind /
 *     title / citation metadata) — "copy a DTU here, paste it wherever you
 *     land next."
 * The two are complementary, not competing. Existing `usePipe()` call
 * sites (80 of them at last grep) are untouched by this file — this is a
 * new, additive module, not a replacement.
 *
 * Extension model:
 *   - Any lens can `publish(dtu)` a DTU onto the bus (typically from a
 *     "Send to Workspace Bus" button — see `WorkspaceBusCopyButton`).
 *   - `Cmd/Ctrl+Shift+V` opens a picker over the bus's last MAX_HISTORY
 *     entries, previewed with the existing `DTUEmbed` component.
 *   - Selecting an entry calls `ingestDTU(dtu, targetLensId)`. If the
 *     target lens registered a handler via `registerIngestHandler(lensId,
 *     handler)`, that handler decides what "paste" means for that lens's
 *     domain (e.g. insert a ledger line item, drop a marker on a map).
 *     Handler registration is intentionally left to individual lenses —
 *     this file only ships the bus + the honest default path below.
 *   - With no registered handler (the common case today), the DEFAULT
 *     ingest copies a plain-text DTU reference to the OS clipboard (so it
 *     can be pasted into literally any input/textarea/contenteditable) and
 *     emits a `workspace-bus:ingest` event on the frontend event bus so any
 *     mounted component can opportunistically react without a formal
 *     handler registration. Clipboard failure is reported honestly (a
 *     warning toast), never silently swallowed or reported as success.
 */

import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
} from 'react';
import dynamic from 'next/dynamic';

import type { DTU } from '@/lib/api/generated-types';
import { useUIStore } from '@/store/ui';
import { useShortcut } from '@/lib/keyboard';
import { emitEvent } from '@/lib/realtime/event-bus';

// The picker renders `DTUEmbed`, which pulls in ReactionBar / CommentThread /
// ShareButton / BookmarkButton / FederationBadge etc. — real weight. It's
// only fetched once the user actually opens the bus (Cmd/Ctrl+Shift+V),
// never on initial shell load, so this provider stays cheap to mount
// unconditionally for every lens (see the shell-diet note in Providers.tsx).
const WorkspaceBusPicker = dynamic(
  () => import('./WorkspaceBusPicker').then((m) => m.WorkspaceBusPicker),
  { ssr: false }
);

export const WORKSPACE_BUS_MAX_HISTORY = 10;

/**
 * Minimal DTU-native shape the bus carries. Deliberately smaller than the
 * full `DTU` type from generated-types — just enough to (a) render a
 * `DTUEmbed` preview without a re-fetch and (b) carry citation metadata
 * forward so a paste target can decide whether it can cite/reference the
 * DTU without a network round trip.
 */
export interface WorkspaceBusDTU {
  id: string;
  /** DTU tier ('regular'|'mega'|'hyper'|'shadow'|'archive') or a domain-specific kind string. */
  kind: string;
  title: string;
  summary?: string;
  domain?: string;
  tags?: string[];
  ownerId?: string;
  creator?: { id?: string; displayName?: string; avatarUrl?: string };
  createdAt?: string;
  citation: {
    allowCitation?: boolean;
    visibility?: string;
    licensePriceCc?: number;
    hasPurchasedLicense?: boolean;
  };
}

export interface WorkspaceBusEntry {
  /** Local id for this clipboard slot (not the DTU id — the same DTU can be copied more than once, though `publish` collapses repeats of the same id to the top). */
  entryId: string;
  copiedAt: number;
  /** Lens the DTU was copied FROM, when known. */
  sourceLensId?: string;
  dtu: WorkspaceBusDTU;
}

export type IngestHandler = (dtu: WorkspaceBusDTU, entry: WorkspaceBusEntry) => boolean | Promise<boolean>;

export interface WorkspaceBusApi {
  history: WorkspaceBusEntry[];
  /** Copy a DTU (or an already-normalized WorkspaceBusDTU) onto the bus. */
  publish: (dtu: DTU | WorkspaceBusDTU, opts?: { sourceLensId?: string }) => WorkspaceBusEntry;
  clear: () => void;
  removeEntry: (entryId: string) => void;
  /**
   * Register a lens-specific ingest handler. Returns an unregister
   * function — call it on unmount (mirrors `usePipe().subscribe`'s
   * cleanup-function contract). The most recently registered handler for a
   * given lensId wins; registering again for the same id replaces it.
   */
  registerIngestHandler: (lensId: string, handler: IngestHandler) => () => void;
  /**
   * Route a DTU into `targetLensId` (defaults to the currently active
   * lens). Uses that lens's registered handler when present; falls back to
   * the default clipboard+event path otherwise, or if the handler itself
   * throws or returns false. Returns true only when a registered handler
   * actually claimed the ingest.
   */
  ingestDTU: (dtu: WorkspaceBusDTU, targetLensId?: string) => Promise<boolean>;
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const WorkspaceBusCtx = createContext<WorkspaceBusApi | null>(null);

function isWorkspaceBusDTU(v: DTU | WorkspaceBusDTU): v is WorkspaceBusDTU {
  return typeof (v as WorkspaceBusDTU).kind === 'string' && typeof (v as WorkspaceBusDTU).citation === 'object';
}

/** Mirrors the meta-field reading convention in CitePicker.tsx (`DTUMetaShape`). */
interface DTUMetaShape {
  allowCitation?: boolean;
  licensePriceCc?: number;
  hasPurchasedLicense?: boolean;
  ownerName?: string;
  ownerAvatar?: string;
}

function toWorkspaceBusDTU(dtu: DTU): WorkspaceBusDTU {
  const meta = (dtu.meta || {}) as DTUMetaShape;
  const visibility = (dtu as unknown as { visibility?: string }).visibility;
  return {
    id: dtu.id,
    kind: dtu.tier || 'regular',
    title: dtu.title || dtu.id.slice(0, 16),
    summary: dtu.summary || dtu.human?.summary || dtu.human?.tldr,
    domain: dtu.domain,
    tags: dtu.tags,
    ownerId: dtu.ownerId,
    creator: (meta.ownerName || meta.ownerAvatar)
      ? { id: dtu.ownerId, displayName: meta.ownerName, avatarUrl: meta.ownerAvatar }
      : undefined,
    createdAt: dtu.timestamp,
    citation: {
      allowCitation: meta.allowCitation,
      visibility,
      licensePriceCc: meta.licensePriceCc,
      hasPurchasedLicense: meta.hasPurchasedLicense,
    },
  };
}

/**
 * Honest default ingest: write a plain-text DTU reference to the OS
 * clipboard (works as a real "paste" in any input/textarea/contenteditable
 * across the whole app, not just Concord lenses) and broadcast an event for
 * any mounted component that wants to react opportunistically. Never
 * fabricates a success toast when the clipboard write actually failed.
 */
async function defaultIngest(dtu: WorkspaceBusDTU, targetLensId: string | undefined): Promise<void> {
  const reference = `${dtu.title}\nconcord://dtu/${dtu.id}`;
  let copied = false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(reference);
      copied = true;
    } catch {
      copied = false;
    }
  }

  emitEvent('workspace-bus:ingest', { dtu, targetLensId });

  const addToast = useUIStore.getState().addToast;
  if (copied) {
    addToast({
      type: 'success',
      message: targetLensId
        ? `"${targetLensId}" has no custom paste handler yet — copied a reference to "${dtu.title}" to your clipboard instead. Paste it anywhere.`
        : `Copied a reference to "${dtu.title}" to your clipboard.`,
    });
  } else {
    addToast({
      type: 'warning',
      message: `Couldn't reach the clipboard for "${dtu.title}" (blocked by the browser). Its id is ${dtu.id.slice(0, 12)}…`,
    });
  }
}

export function WorkspaceBusProvider({ children }: { children: React.ReactNode }) {
  const [history, setHistory] = useState<WorkspaceBusEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const handlersRef = useRef<Map<string, IngestHandler>>(new Map());

  const publish = useCallback<WorkspaceBusApi['publish']>((dtuLike, opts) => {
    const normalized = isWorkspaceBusDTU(dtuLike) ? dtuLike : toWorkspaceBusDTU(dtuLike);
    const entry: WorkspaceBusEntry = {
      entryId: `wb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      copiedAt: Date.now(),
      sourceLensId: opts?.sourceLensId ?? useUIStore.getState().activeLens,
      dtu: normalized,
    };
    setHistory((prev) => [entry, ...prev.filter((e) => e.dtu.id !== normalized.id)].slice(0, WORKSPACE_BUS_MAX_HISTORY));
    return entry;
  }, []);

  const clear = useCallback(() => setHistory([]), []);

  const removeEntry = useCallback((entryId: string) => {
    setHistory((prev) => prev.filter((e) => e.entryId !== entryId));
  }, []);

  const registerIngestHandler = useCallback((lensId: string, handler: IngestHandler) => {
    handlersRef.current.set(lensId, handler);
    return () => {
      if (handlersRef.current.get(lensId) === handler) handlersRef.current.delete(lensId);
    };
  }, []);

  const ingestDTU = useCallback(async (dtu: WorkspaceBusDTU, targetLensId?: string): Promise<boolean> => {
    const lensId = targetLensId ?? useUIStore.getState().activeLens;
    const handler = lensId ? handlersRef.current.get(lensId) : undefined;
    if (handler) {
      const existingEntry = history.find((e) => e.dtu.id === dtu.id);
      const entry: WorkspaceBusEntry = existingEntry ?? {
        entryId: `wb-ephemeral-${dtu.id}`,
        copiedAt: Date.now(),
        dtu,
      };
      try {
        const handled = await handler(dtu, entry);
        if (handled) {
          useUIStore.getState().addToast({
            type: 'success',
            message: `Sent "${dtu.title}" into ${lensId}.`,
          });
          return true;
        }
      } catch (err) {
        // Honest failure: the handler threw. Don't fabricate success — log
        // and fall through to the default path so the user still gets a
        // usable outcome (a clipboard reference) instead of silence.
        console.error(`[WorkspaceBus] ingest handler for "${lensId}" threw`, err);
      }
    }
    await defaultIngest(dtu, lensId);
    return false;
  }, [history]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Global shortcut: opens the bus picker from anywhere. `global: true`
  // matches the existing 'quick-capture' (mod+shift+n) convention in
  // lib/keyboard.tsx's DEFAULT_SHORTCUTS — it fires even while a text
  // input has focus, same reasoning as quick-capture (a clipboard-style
  // action a user reaches for mid-typing). No existing shortcut in the
  // codebase binds mod+shift+v (verified by grep against lib/keyboard.tsx,
  // hooks/useLensCommand.ts consumers, and all useShortcut() call sites).
  useShortcut('workspace-bus:open-picker', 'mod+shift+v', open, {
    description: 'Open Workspace Bus — DTU clipboard history',
    category: 'actions',
    global: true,
  });

  const api = useMemo<WorkspaceBusApi>(() => ({
    history, publish, clear, removeEntry, registerIngestHandler, ingestDTU, isOpen, open, close,
  }), [history, publish, clear, removeEntry, registerIngestHandler, ingestDTU, isOpen, open, close]);

  return (
    <WorkspaceBusCtx.Provider value={api}>
      {children}
      {isOpen && <WorkspaceBusPicker />}
    </WorkspaceBusCtx.Provider>
  );
}

export function useWorkspaceBus(): WorkspaceBusApi {
  const api = useContext(WorkspaceBusCtx);
  if (!api) {
    // No-op fallback (mirrors usePipe()'s out-of-provider fallback) so a
    // component that renders in isolation (e.g. a unit test, or a lens
    // that hasn't been re-parented under the shell yet) doesn't crash.
    return {
      history: [],
      publish: (dtu) => ({
        entryId: 'wb-noop',
        copiedAt: Date.now(),
        dtu: isWorkspaceBusDTU(dtu) ? dtu : toWorkspaceBusDTU(dtu),
      }),
      clear: () => {},
      removeEntry: () => {},
      registerIngestHandler: () => () => {},
      ingestDTU: async () => false,
      isOpen: false,
      open: () => {},
      close: () => {},
    };
  }
  return api;
}

export { toWorkspaceBusDTU };
