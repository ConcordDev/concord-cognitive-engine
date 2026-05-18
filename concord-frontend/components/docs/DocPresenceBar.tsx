'use client';

import { useState, useEffect, useCallback } from 'react';
import { callDocsMacro } from '@/lib/api/docs';
import { getSocket } from '@/lib/realtime/socket';

interface Presence {
  userId: string;
  cursorPos: number;
  color?: string | null;
  label?: string | null;
  lastSeen: number;
}

interface Props { documentId: string; }

const COLORS = ['#22d3ee', '#a78bfa', '#fb7185', '#fbbf24', '#34d399', '#fb923c', '#60a5fa'];

function hashToColor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function DocPresenceBar({ documentId }: Props) {
  const [users, setUsers] = useState<Presence[]>([]);

  const refresh = useCallback(async () => {
    try {
      const r = await callDocsMacro<{ presence?: Presence[] }>('presence_list', { documentId });
      if (r?.presence) setUsers(r.presence);
    } catch { /* silent */ }
  }, [documentId]);

  // Heartbeat presence every 15s
  useEffect(() => {
    let cancelled = false;
    const send = async () => {
      if (cancelled) return;
      try {
        await callDocsMacro('presence_update', { documentId, cursorPos: 0 });
      } catch { /* silent */ }
    };
    send();
    const id = setInterval(send, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [documentId]);

  // Socket join + listen
  useEffect(() => {
    refresh();
    let off: (() => void) | null = null;
    try {
      const sock = getSocket?.();
      if (sock) {
        const room = `doc:${documentId}`;
        sock.emit('room:join', { room });
        const onPresence = () => { refresh(); };
        sock.on('doc:presence', onPresence);
        off = () => { sock.off('doc:presence', onPresence); sock.emit('room:leave', { room }); };
      }
    } catch { /* silent */ }
    const poll = setInterval(refresh, 20_000);
    return () => { if (off) off(); clearInterval(poll); };
  }, [documentId, refresh]);

  if (users.length === 0) return null;

  return (
    <div className="flex -space-x-1">
      {users.slice(0, 5).map((u) => (
        <div
          key={u.userId}
          className="w-6 h-6 rounded-full border-2 border-black flex items-center justify-center text-[10px] font-bold text-white"
          style={{ backgroundColor: hashToColor(u.userId) }}
          title={u.label || u.userId}
        >
          {(u.label || u.userId).slice(0, 1).toUpperCase()}
        </div>
      ))}
      {users.length > 5 && (
        <div className="w-6 h-6 rounded-full border-2 border-black flex items-center justify-center text-[10px] font-bold text-white bg-white/20">
          +{users.length - 5}
        </div>
      )}
    </div>
  );
}
