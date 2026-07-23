'use client';

/**
 * SharedWorkspaceRoom — MU2 (V1.1 R6 multi-user collaboration).
 *
 * A small, named room where multiple users co-work on a shared list of
 * DTU references in real time. Built entirely on EXISTING infrastructure,
 * not a new sync system:
 *
 *   - Document sync: `useYjsDoc` (lib/hooks/useYjsDoc.ts) under the new
 *     'workspace:room' scope (server/lib/yjs-realtime.js#KNOWN_SCOPES).
 *     The doc holds one `Y.Array` (key "dtuRefs") of plain DTU-reference
 *     objects. `attachYjsSync` on the server relays opaque Y.Doc update
 *     bytes regardless of what shared type produced them, so a Y.Array
 *     converges through the exact same yjs:sync-request / yjs:update
 *     relay a Y.Text document does — see server/tests/yjs-shared-workspace
 *     .test.js for the proof that NO new server sync logic was required.
 *   - Presence: `useYjsAwareness` (MU1, hooks/useYjsAwareness.ts) —
 *     unmodified, riding the same (scope, docId) pair as the doc.
 *   - DTU rendering: the existing `DTUEmbed` component (compact mode) —
 *     no bespoke DTU card was built.
 *   - Adding a DTU: pulled from the user's own cross-lens Workspace Bus
 *     (`useWorkspaceBus`), not invented here.
 *   - Privacy: reuses the exact Yjs-native "hidden" affordance MU1 already
 *     built into `useYjsAwareness` (`awareness.setLocalState(null)` — the
 *     same intent as `city-presence.js`'s `setUserVisibility`/
 *     `getUserVisibility` "hidden excludes you from what others see,
 *     never changes what you see", applied to this subsystem instead of
 *     importing city-presence, which keys an unrelated 3D-world table).
 *     There is no parallel room-membership ACL here — a room is
 *     reachable by anyone who has its id, same trust model as a Live
 *     Share / Collab doc link today.
 *
 * HONESTY: `dtuRefs` only ever reflects the real Y.Array content of the
 * doc (observed via `Y.Array#observe`); `collaborators` only ever
 * reflects real Awareness protocol state (via `useYjsAwareness`). There
 * is no synthetic "X added Y" toast and no fabricated participant —
 * every list mutation is a real `.push()`/`.delete()` CRDT operation on
 * the shared doc, and every presence entry is a real remote Awareness
 * state.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, EyeOff, Eye, X, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useYjsDoc } from '@/lib/hooks/useYjsDoc';
import { useYjsAwareness } from '@/hooks/useYjsAwareness';
import { useWorkspaceBus, type WorkspaceBusDTU } from '@/components/workspace-bus';
import { DTUEmbed, type DTUEmbedRecord } from '@/components/dtu/DTUEmbed';

/** Scope for every Shared Workspace Room doc — mirrors
 *  server/lib/yjs-realtime.js#KNOWN_SCOPES.SHARED_WORKSPACE. Not imported
 *  directly (frontend/backend are separate packages, same convention
 *  every other scope string in this app already follows — see
 *  'code:liveshare' / 'collab:doc' / 'law:contract' call sites). */
export const SHARED_WORKSPACE_SCOPE = 'workspace:room';

/** The single Y.Array this feature stores on the room's Y.Doc. */
export const SHARED_WORKSPACE_ARRAY_KEY = 'dtuRefs';

/**
 * A plain-object entry in the shared Y.Array. Deliberately NOT a nested
 * Y.Map — the thing that needs CRDT conflict resolution is list
 * MEMBERSHIP/ORDER (who added/removed what, concurrently), which
 * `Y.Array` already gives us; the DTU's own descriptive fields don't need
 * field-level merge, so a plain JSON-serializable object per entry is the
 * simplest real CRDT shape, per the task's own framing.
 */
export interface SharedWorkspaceDtuRef {
  id: string;
  title: string;
  kind: string;
  domain?: string;
  summary?: string;
  addedBy: string;
  addedByName: string;
  addedAt: number;
}

export function dtuRefToEmbedRecord(ref: SharedWorkspaceDtuRef): DTUEmbedRecord {
  return {
    id: ref.id,
    title: ref.title,
    summary: ref.summary,
    domain: ref.domain,
    tier: ref.kind,
    createdAt: new Date(ref.addedAt).toISOString(),
    creator: { id: ref.addedBy, displayName: ref.addedByName },
  };
}

export interface SharedWorkspaceRoomProps {
  /** Room id — anyone holding it can join, same trust model as an
   *  existing Live Share / Collab doc link. */
  roomId: string;
  userId: string;
  displayName: string;
  className?: string;
}

export function SharedWorkspaceRoom({ roomId, userId, displayName, className }: SharedWorkspaceRoomProps) {
  const { doc, synced } = useYjsDoc({ scope: SHARED_WORKSPACE_SCOPE, docId: roomId, enabled: !!roomId });
  const [appearOffline, setAppearOffline] = useState(false);

  const { collaborators } = useYjsAwareness({
    scope: SHARED_WORKSPACE_SCOPE,
    docId: roomId,
    doc,
    userId,
    displayName,
    hidden: appearOffline,
    enabled: !!roomId,
  });

  const [dtuRefs, setDtuRefs] = useState<SharedWorkspaceDtuRef[]>([]);

  // Mirror the real Y.Array into React state. This is a pure read-side
  // projection — every mutation still goes through the array itself
  // (push/delete below), never through setDtuRefs directly.
  useEffect(() => {
    if (!doc) { setDtuRefs([]); return; }
    const arr = doc.getArray<SharedWorkspaceDtuRef>(SHARED_WORKSPACE_ARRAY_KEY);
    const sync = () => setDtuRefs(arr.toArray());
    sync();
    arr.observe(sync);
    return () => arr.unobserve(sync);
  }, [doc]);

  const addDtu = useCallback((dtu: WorkspaceBusDTU) => {
    if (!doc) return;
    const arr = doc.getArray<SharedWorkspaceDtuRef>(SHARED_WORKSPACE_ARRAY_KEY);
    // Prevent the obvious same-click double-add. Two different members
    // adding the same DTU concurrently can still both land (a real,
    // honest CRDT race) — we don't paper over that with a fake merge.
    if (arr.toArray().some((r) => r.id === dtu.id)) return;
    const ref: SharedWorkspaceDtuRef = {
      id: dtu.id,
      title: dtu.title,
      kind: dtu.kind,
      domain: dtu.domain,
      summary: dtu.summary,
      addedBy: userId,
      addedByName: displayName,
      addedAt: Date.now(),
    };
    arr.push([ref]);
  }, [doc, userId, displayName]);

  const removeDtu = useCallback((target: SharedWorkspaceDtuRef) => {
    if (!doc) return;
    const arr = doc.getArray<SharedWorkspaceDtuRef>(SHARED_WORKSPACE_ARRAY_KEY);
    const current = arr.toArray();
    // Match on (id, addedAt) rather than just id — the same DTU id can
    // legitimately appear twice (concurrent add race above), and we only
    // want to delete the specific entry the user clicked, not "the first
    // one with this id".
    const idx = current.findIndex((r) => r.id === target.id && r.addedAt === target.addedAt);
    if (idx === -1) return;
    arr.delete(idx, 1);
  }, [doc]);

  const bus = useWorkspaceBus();
  const addableFromBus = useMemo(
    () => bus.history.filter((e) => !dtuRefs.some((r) => r.id === e.dtu.id)),
    [bus.history, dtuRefs]
  );

  return (
    <div className={cn('rounded-lg border border-lattice-border/60 bg-lattice-surface/20', className)}>
      <header className="flex items-center justify-between gap-3 px-3 py-2 border-b border-lattice-border/60">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">Shared Workspace — {roomId}</h3>
          <p className="text-[11px] text-gray-400">
            {synced ? `${dtuRefs.length} DTU${dtuRefs.length === 1 ? '' : 's'} shared here` : 'Syncing…'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAppearOffline((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border shrink-0',
            appearOffline
              ? 'border-amber-500/50 text-amber-300 hover:text-amber-200'
              : 'border-lattice-border/60 text-gray-300 hover:text-white hover:border-neon-cyan/50'
          )}
          title="Toggle whether other room members can see you're here"
          aria-pressed={appearOffline}
        >
          {appearOffline ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {appearOffline ? 'Appearing offline' : 'Visible in room'}
        </button>
      </header>

      <div className="flex items-center gap-2 px-3 py-2 border-b border-lattice-border/60">
        <Users className="w-3.5 h-3.5 text-gray-500 shrink-0" aria-hidden="true" />
        {collaborators.length === 0 ? (
          <span className="text-[11px] text-gray-500">Only you here right now.</span>
        ) : (
          <ul className="flex flex-wrap items-center gap-1.5" aria-label="Collaborators currently in this room">
            {collaborators.map((c) => (
              <li
                key={c.userId}
                className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-lattice-surface/50 border border-lattice-border/50"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: c.color }}
                  aria-hidden="true"
                />
                <span className="text-gray-200">{c.displayName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="p-3 space-y-2">
        {dtuRefs.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-6">
            No DTUs shared here yet. Add one from your Workspace Bus below.
          </p>
        ) : (
          dtuRefs.map((ref) => (
            <div key={`${ref.id}-${ref.addedAt}`} className="flex items-center gap-2">
              <DTUEmbed dtu={dtuRefToEmbedRecord(ref)} mode="compact" className="flex-1 min-w-0" />
              <span className="text-[10px] text-gray-500 shrink-0">added by {ref.addedByName}</span>
              <button
                type="button"
                onClick={() => removeDtu(ref)}
                className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-lattice-surface shrink-0"
                aria-label={`Remove ${ref.title} from this room`}
                title="Remove from room"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="px-3 pb-3 pt-1 border-t border-lattice-border/60">
        <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Add from your Workspace Bus</p>
        {bus.history.length === 0 ? (
          <p className="text-[11px] text-gray-500">
            Your Workspace Bus is empty — copy a DTU from any lens first (its &ldquo;Send to Workspace Bus&rdquo; action).
          </p>
        ) : addableFromBus.length === 0 ? (
          <p className="text-[11px] text-gray-500">Everything on your bus is already shared here.</p>
        ) : (
          <ul className="space-y-1">
            {addableFromBus.map((entry) => (
              <li key={entry.entryId} className="flex items-center gap-2">
                <span className="text-[11px] text-gray-300 truncate flex-1 min-w-0">{entry.dtu.title}</span>
                <button
                  type="button"
                  onClick={() => addDtu(entry.dtu)}
                  className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-lattice-border/60 text-gray-300 hover:text-white hover:border-neon-cyan/50 shrink-0"
                >
                  <Plus className="w-3 h-3" />
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default SharedWorkspaceRoom;
