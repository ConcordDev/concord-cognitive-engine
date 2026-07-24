'use client';

/**
 * WorkspaceRoomsPanel — V1.2 Wave A (Society & Presence), capability 3:
 * shared DTU spaces.
 *
 * The real thing already existed and is untouched here: MU2's
 * `workspace:room` Yjs CRDT room (server/lib/yjs-realtime.js) rendered by
 * `SharedWorkspaceRoom.tsx` — a real shared `Y.Array` of DTU references
 * with live Awareness presence. What was missing was purely discovery: no
 * page mounted it, no create flow, no room list, no way for a second user
 * to learn a room's id except out-of-band. This panel is that missing
 * piece, wired to the three `workspace.*` macros
 * (server/domains/workspace-rooms.js, server/lib/workspace-rooms.js) —
 * a thin metadata layer that tracks "a room with this id exists, here's
 * its name/owner/anchor" so rooms can be created and browsed. The Yjs
 * doc remains the sole content authority; this panel never reads or
 * writes it directly — it only picks a room id and hands it to the real
 * <SharedWorkspaceRoom> component unmodified.
 *
 * Self-contained: every prop is optional, so this mounts directly as a
 * floating world-lens panel (its "in the Hub" framing) and would also
 * satisfy lib/panel-registry.ts's cross-mount eligibility rule (no
 * required lens-specific prop) if a future pass wants it addressable
 * from other lenses too.
 */

import { useCallback, useEffect, useState } from 'react';
import { Share2, Plus, Users, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { SharedWorkspaceRoom } from './SharedWorkspaceRoom';

export interface WorkspaceRoomSummary {
  id: string;
  name: string;
  owner_id: string;
  world_id: string;
  district_id: string | null;
  created_at: number;
}

export interface WorkspaceRoomsPanelProps {
  /** World this panel creates/browses rooms in. Defaults to the shared
   *  hub — the same coarse world-as-district convention city-presence /
   *  ambient-chat already use elsewhere in the world lens. */
  worldId?: string;
  /** Default district anchor for the browse list + create form's
   *  pre-filled district field. Purely a starting value — the create
   *  form lets the anchor be changed or cleared per room. */
  districtId?: string;
  className?: string;
}

export function WorkspaceRoomsPanel({
  worldId = 'concordia-hub',
  districtId = 'concordia-hub',
  className,
}: WorkspaceRoomsPanelProps) {
  const { user } = useAuth();
  const [tab, setTab] = useState<'nearby' | 'mine'>('nearby');
  const [nearby, setNearby] = useState<WorkspaceRoomSummary[]>([]);
  const [mine, setMine] = useState<WorkspaceRoomSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newDistrict, setNewDistrict] = useState(districtId);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nearbyRes, mineRes] = await Promise.all([
        lensRun<{ ok: boolean; rooms?: WorkspaceRoomSummary[] }>('workspace', 'list-in-district', {
          worldId,
          districtId,
        }),
        lensRun<{ ok: boolean; rooms?: WorkspaceRoomSummary[] }>('workspace', 'list-mine', {}),
      ]);
      setNearby(nearbyRes.data?.result?.rooms || []);
      setMine(mineRes.data?.result?.rooms || []);
    } catch {
      setError('Could not load rooms.');
    } finally {
      setLoading(false);
    }
  }, [worldId, districtId]);

  useEffect(() => {
    if (!activeRoomId) refresh();
  }, [refresh, activeRoomId]);

  const createRoom = useCallback(async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await lensRun<{ ok: boolean; room?: WorkspaceRoomSummary }>('workspace', 'create-room', {
        name,
        worldId,
        districtId: newDistrict.trim() || null,
      });
      const room = res.data?.result?.room;
      if (room?.id) {
        setNewName('');
        await refresh();
        setActiveRoomId(room.id);
      } else {
        setError(res.data?.error || 'Could not create room.');
      }
    } finally {
      setCreating(false);
    }
  }, [newName, newDistrict, worldId, creating, refresh]);

  if (activeRoomId) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => setActiveRoomId(null)}
          className="mb-2 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back to rooms
        </button>
        <SharedWorkspaceRoom
          roomId={activeRoomId}
          userId={user?.id || 'anonymous'}
          displayName={user?.username || 'Anonymous'}
        />
      </div>
    );
  }

  const list = tab === 'nearby' ? nearby : mine;

  return (
    <div className={cn('rounded-lg border border-lattice-border/60 bg-lattice-surface/20', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-lattice-border/60">
        <Share2 className="w-4 h-4 text-neon-cyan shrink-0" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-white">Shared Workspace Rooms</h3>
      </header>

      <div className="px-3 pt-2 pb-3 space-y-2 border-b border-lattice-border/60">
        <p className="text-[11px] text-gray-500">
          Create a small room to co-work a shared DTU list in real time with anyone who has its link.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Room name"
            aria-label="New room name"
            className="flex-1 min-w-[8rem] text-xs px-2 py-1.5 rounded border border-lattice-border/60 bg-black/30 text-white placeholder:text-gray-600"
            maxLength={80}
          />
          <input
            type="text"
            value={newDistrict}
            onChange={(e) => setNewDistrict(e.target.value)}
            placeholder="District (optional)"
            aria-label="District anchor (optional)"
            className="w-36 text-xs px-2 py-1.5 rounded border border-lattice-border/60 bg-black/30 text-white placeholder:text-gray-600"
            maxLength={60}
          />
          <button
            type="button"
            onClick={createRoom}
            disabled={!newName.trim() || creating}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Create
          </button>
        </div>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </div>

      <div className="flex items-center gap-1 px-3 pt-2">
        <button
          type="button"
          onClick={() => setTab('nearby')}
          className={cn(
            'text-xs px-2 py-1 rounded-t border-b-2',
            tab === 'nearby' ? 'text-white border-neon-cyan' : 'text-gray-500 border-transparent hover:text-gray-300',
          )}
        >
          In this district
        </button>
        <button
          type="button"
          onClick={() => setTab('mine')}
          className={cn(
            'text-xs px-2 py-1 rounded-t border-b-2',
            tab === 'mine' ? 'text-white border-neon-cyan' : 'text-gray-500 border-transparent hover:text-gray-300',
          )}
        >
          My rooms
        </button>
      </div>

      <div className="p-3 space-y-1.5 max-h-64 overflow-y-auto">
        {loading ? (
          <p className="text-[11px] text-gray-500 text-center py-4">Loading…</p>
        ) : list.length === 0 ? (
          <p className="text-[11px] text-gray-500 text-center py-4">
            {tab === 'nearby' ? 'No rooms in this district yet — create one above.' : "You haven't created a room yet."}
          </p>
        ) : (
          list.map((room) => (
            <button
              key={room.id}
              type="button"
              onClick={() => setActiveRoomId(room.id)}
              className="w-full flex items-center justify-between gap-2 text-left px-2 py-1.5 rounded border border-lattice-border/40 hover:border-neon-cyan/50 hover:bg-lattice-surface/40"
            >
              <span className="min-w-0">
                <span className="block text-xs text-gray-200 truncate">{room.name}</span>
                <span className="block text-[10px] text-gray-500">
                  {room.district_id ? `#${room.district_id}` : 'no district anchor'}
                </span>
              </span>
              <Users className="w-3.5 h-3.5 text-gray-500 shrink-0" aria-hidden="true" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default WorkspaceRoomsPanel;
