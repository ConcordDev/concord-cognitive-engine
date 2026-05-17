'use client';

/**
 * RoomList — live audio rooms roster.
 *
 * Phase 11 (Item 7). Read-only listing surface that drops into any
 * page (most naturally `/lenses/social` as a "Live" tab).
 *
 * No fake "trending" rooms — list comes from `spaces.list_active`
 * macro. Listener counts come from the DB rows + Socket.io presence.
 * Empty state says "No live rooms right now."
 *
 * WebRTC peer connection is a separate concern handled when the user
 * actually joins — this component only shows the roster + the
 * honest TURN-server caveat.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Radio, Mic, Users, Plus, Loader2, AlertTriangle, Lock } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { UserLink } from '@/components/social/UserLink';
import { useState } from 'react';

interface Speaker { user_id: string; role: string; joined_at: number; }
interface Room {
  id: string;
  hostUserId: string;
  title: string;
  description?: string | null;
  startedAt: number;
  endedAt: number | null;
  speakers: Speaker[];
  listenerCount: number;
  handsRaised: { user_id: string }[];
  isRecording: boolean;
}

interface ListResponse { ok: boolean; rooms?: Room[]; }

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try { const r = await api.post('/api/lens/run', { domain, name, input }); return r?.data as T; }
  catch { return null; }
}

export interface RoomListProps {
  className?: string;
  currentUserId?: string | null;
  /**
   * Optional — when set, clicking Join calls join_listener AND notifies
   * the caller with the roomId so it can mount the WebRTC RoomStage.
   * Without this callback, Join only marks the user as a listener in
   * the DB (silent listener — no audio).
   */
  onJoin?: (roomId: string) => void;
}

export function RoomList({ className, currentUserId, onJoin }: RoomListProps) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');

  const { data, isLoading, refetch: _refetch } = useQuery<ListResponse | null>({
    queryKey: ['spaces-active'],
    queryFn: async () => runMacro<ListResponse>('spaces', 'list_active', { limit: 50 }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const rooms = data?.rooms ?? [];

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await runMacro<{ ok: boolean; roomId?: string }>('spaces', 'create', { title: title.trim() });
      return res;
    },
    onSuccess: (res) => {
      setTitle('');
      setCreating(false);
      qc.invalidateQueries({ queryKey: ['spaces-active'] });
      // The host auto-enters the stage they just opened.
      if (res?.ok && res.roomId && onJoin) onJoin(res.roomId);
    },
  });

  const joinMut = useMutation({
    mutationFn: async (roomId: string) => {
      const res = await runMacro<{ ok: boolean }>('spaces', 'join_listener', { roomId });
      return { res, roomId };
    },
    onSuccess: ({ res, roomId }) => {
      qc.invalidateQueries({ queryKey: ['spaces-active'] });
      if (res?.ok && onJoin) onJoin(roomId);
    },
  });

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Radio className="w-4 h-4 text-rose-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Spaces · live now</h3>
        <span className="text-[10px] text-zinc-500 font-mono">{rooms.length}</span>
        {currentUserId && (
          <button
            type="button"
            onClick={() => setCreating(c => !c)}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-zinc-700 text-zinc-200 hover:border-rose-500 hover:text-rose-300"
          >
            <Plus className="w-3 h-3" /> Start
          </button>
        )}
      </header>

      {creating && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (title.trim().length > 0) createMut.mutate(); }}
          className="px-3 py-2 border-b border-zinc-800/40 flex gap-2 bg-rose-500/5"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Room title…"
            maxLength={200}
            className="flex-1 text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-rose-500/40"
          />
          <button
            type="submit"
            disabled={createMut.isPending || title.trim().length === 0}
            className="text-xs px-2 py-1 rounded bg-rose-700/40 hover:bg-rose-700/60 text-rose-100 border border-rose-600/60 disabled:opacity-40"
          >
            {createMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Go live'}
          </button>
        </form>
      )}

      {isLoading && (
        <div className="px-3 py-6 text-center text-zinc-500">
          <Loader2 className="w-4 h-4 animate-spin mx-auto" />
        </div>
      )}

      {!isLoading && rooms.length === 0 && (
        <div className="px-3 py-6 text-center text-xs text-zinc-400">
          <Radio className="w-5 h-5 mx-auto mb-1 text-zinc-600" />
          <div className="font-medium text-zinc-200">No live rooms right now</div>
          <div>Start one yourself to begin.</div>
        </div>
      )}

      <ul className="divide-y divide-zinc-800/60">
        {rooms.map(room => {
          const isHosting = currentUserId === room.hostUserId;
          return (
            <li key={room.id} className="px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium text-zinc-100 truncate">{room.title}</h4>
                    {room.isRecording && (
                      <span className="text-[10px] inline-flex items-center gap-0.5 text-rose-300" title="Recording"><Lock className="w-2.5 h-2.5" /> REC</span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500 flex items-center gap-2 mt-0.5">
                    <span>Host:</span>
                    <UserLink userId={room.hostUserId} prefix="@" className="text-[10px]" />
                  </div>
                  <div className="text-[10px] text-zinc-500 flex items-center gap-3 mt-1">
                    <span className="inline-flex items-center gap-0.5"><Mic className="w-2.5 h-2.5" /> {room.speakers?.length || 0}</span>
                    <span className="inline-flex items-center gap-0.5"><Users className="w-2.5 h-2.5" /> {room.listenerCount}</span>
                    {room.handsRaised?.length > 0 && <span className="text-amber-300">✋ {room.handsRaised.length}</span>}
                  </div>
                  {room.description && <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2">{room.description}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => currentUserId && joinMut.mutate(room.id)}
                  disabled={joinMut.isPending || isHosting || !currentUserId}
                  className={cn(
                    'text-xs px-2 py-1 rounded border font-medium transition-colors',
                    isHosting
                      ? 'border-zinc-700 text-zinc-500 cursor-default'
                      : 'border-rose-500/40 text-rose-200 bg-rose-700/30 hover:bg-rose-700/50',
                    'disabled:opacity-40',
                  )}
                >
                  {isHosting ? 'Hosting' : joinMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Join'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40 flex items-start gap-1">
        <AlertTriangle className="w-3 h-3 mt-0.5 text-amber-400/80 flex-shrink-0" />
        <span>WebRTC is peer-to-peer. Strict-NAT clients need a TURN server (set CONCORD_TURN_URL).</span>
      </footer>
    </section>
  );
}

export default RoomList;
