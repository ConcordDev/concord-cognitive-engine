'use client';

/**
 * AstroCoObservePanel — live multi-observer co-observing surface for a
 * SHARED astronomy session (server/domains/astronomy.js `session-share` /
 * `session-join` / `session-leave` / `session-observers` /
 * `session-target-set` / `session-target-get` / `session-log-*`).
 *
 * Entering this view IS joining, mirroring the collab lens's own live
 * session rooms (app/lenses/collab/page.tsx): the effect below joins on
 * mount and leaves on unmount, so the roster always reflects who is
 * genuinely present — never a fabricated "N watching" count.
 *
 * Two socket rooms are joined: `collab:${roomId}` for the real live
 * roster (astronomy REUSES collab's own sessionJoin/sessionLeave/
 * sessionRoster substrate server-side rather than inventing a parallel
 * one — see server/domains/astronomy.js's "Shared co-observing sessions"
 * section) and `astronomy:session:${roomId}` for the astronomy-specific
 * shared "current target" + observation-log broadcasts, kept on a
 * distinct room so the two event streams never collide.
 *
 * HONESTY INVARIANT: the shared target is one RA/Dec everyone points at,
 * but each observer's rendered altitude/azimuth is computed FRESH from
 * THEIR OWN submitted lat/long via the real Meeus transform
 * (`session-target-get`) — never a mirrored copy of one observer's sky.
 * The UI says so explicitly below, on purpose.
 */

import { useCallback, useEffect, useState } from 'react';
import { Users, Radio, Send, MapPin } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Participant { userId: string; name: string; joinedAt: number }
interface SharedTarget {
  name: string; ra: number; dec: number; kind: string;
  constellation: string | null; magnitude: number | null;
  setBy: string; setByName: string; setAt: string;
}
interface MineAltAz {
  altitude: number; azimuth: number; visible: boolean;
  observer: { latitude: number; longitude: number }; when: string;
}
interface LogEntry {
  id: string; kind: string; userId: string; userName: string;
  message: string; targetName: string | null; createdAt: string;
}

const OBSERVER_KEY = 'astronomy:observer';

export function AstroCoObservePanel({ roomId }: { roomId: string }) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [target, setTarget] = useState<SharedTarget | null>(null);
  const [mine, setMine] = useState<MineAltAz | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [bodyInput, setBodyInput] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [observer, setObserver] = useState<{ latitude: number; longitude: number } | null>(null);

  // Reuse whatever observer location the Sky Chart Workbench already has —
  // co-observing shouldn't ask a returning user to re-enter coordinates.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(OBSERVER_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { latitude: number; longitude: number };
        if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) setObserver(p);
      }
    } catch { /* no stored location */ }
  }, []);

  const refreshTarget = useCallback(async () => {
    if (!observer) return;
    const r = await lensRun<{ target: SharedTarget | null; mine: MineAltAz | null }>(
      'astronomy', 'session-target-get',
      { roomId, latitude: observer.latitude, longitude: observer.longitude },
    );
    if (r.data?.ok) {
      setTarget(r.data.result?.target ?? null);
      setMine(r.data.result?.mine ?? null);
    }
  }, [roomId, observer]);

  const refreshLog = useCallback(async () => {
    const r = await lensRun<{ log: LogEntry[] }>('astronomy', 'session-log-list', { roomId });
    if (r.data?.ok) setLog(r.data.result?.log || []);
  }, [roomId]);

  useEffect(() => { void refreshTarget(); }, [refreshTarget]);
  useEffect(() => { void refreshLog(); }, [refreshLog]);

  // Join on mount, leave on unmount — real join/leave, real roster.
  useEffect(() => {
    let cancelled = false;
    let socket: ReturnType<typeof import('@/lib/realtime/socket').getSocket> | null = null;

    lensRun<{ participants: Participant[] }>('astronomy', 'session-join', { roomId })
      .then((r) => { if (!cancelled && r.data?.ok) setParticipants(r.data.result?.participants || []); })
      .catch((err) => console.error('[Astronomy] session-join failed:', err));

    import('@/lib/realtime/socket').then(({ getSocket }) => {
      if (cancelled) return;
      socket = getSocket();
      socket.emit('room:join', { room: `collab:${roomId}` });
      socket.emit('room:join', { room: `astronomy:session:${roomId}` });

      socket.on('collab:participant-joined', (evt: { sessionId: string; userId: string; name: string; joinedAt: number }) => {
        if (evt.sessionId !== roomId) return;
        setParticipants((prev) => (prev.some((p) => p.userId === evt.userId)
          ? prev
          : [...prev, { userId: evt.userId, name: evt.name, joinedAt: evt.joinedAt }]));
      });
      socket.on('collab:participant-left', (evt: { sessionId: string; userId: string }) => {
        if (evt.sessionId !== roomId) return;
        setParticipants((prev) => prev.filter((p) => p.userId !== evt.userId));
      });
      socket.on('astronomy:session-target', (evt: { roomId: string; target: SharedTarget }) => {
        if (evt.roomId !== roomId) return;
        setTarget(evt.target);
        void refreshTarget(); // pull OUR OWN alt/az for the newly-shared target
      });
      socket.on('astronomy:session-log', (evt: { roomId: string; entry: LogEntry }) => {
        if (evt.roomId !== roomId) return;
        setLog((prev) => [evt.entry, ...prev]);
      });
    });

    return () => {
      cancelled = true;
      socket?.off('collab:participant-joined');
      socket?.off('collab:participant-left');
      socket?.off('astronomy:session-target');
      socket?.off('astronomy:session-log');
      // Best-effort — this can outlive the component (navigation); a failed
      // leave call just means the roster self-corrects via the same
      // in-memory presence pattern collab's own doc rooms use.
      lensRun('astronomy', 'session-leave', { roomId }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const setSharedTarget = useCallback(async () => {
    if (!bodyInput.trim()) return;
    setBusy(true); setError(null);
    const r = await lensRun('astronomy', 'session-target-set', { roomId, body: bodyInput.trim() });
    if (r.data?.ok === false) setError(r.data?.error || 'Failed to set target.');
    else setBodyInput('');
    setBusy(false);
  }, [roomId, bodyInput]);

  const postLog = useCallback(async () => {
    if (!message.trim()) return;
    const r = await lensRun('astronomy', 'session-log-post', { roomId, message: message.trim() });
    if (r.data?.ok === false) setError(r.data?.error || 'Failed to post.');
    else setMessage('');
  }, [roomId, message]);

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-indigo-900/50 bg-indigo-950/20 p-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-300">
          <Radio className="w-3.5 h-3.5" /> Co-observing — live
        </h4>
        <span className="flex items-center gap-1 text-[10px] text-zinc-400">
          <Users className="w-3 h-3" /> {participants.length} observer{participants.length === 1 ? '' : 's'}
        </span>
      </div>

      {participants.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {participants.map((p) => (
            <li key={p.userId} className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">{p.name}</li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5">
        <div className="flex gap-1.5">
          <input
            value={bodyInput} onChange={(e) => setBodyInput(e.target.value)}
            placeholder="Point everyone at… (e.g. Jupiter, Vega, M31)"
            onKeyDown={(e) => { if (e.key === 'Enter') void setSharedTarget(); }}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
          />
          <button type="button" onClick={setSharedTarget} disabled={busy || !bodyInput.trim()}
            className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            Set target
          </button>
        </div>

        {target ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs">
            <p className="text-zinc-100">
              Current target: <span className="font-semibold text-indigo-300">{target.name}</span>
              {target.constellation && <span className="text-zinc-500"> · {target.constellation}</span>}
              <span className="text-zinc-500"> · set by {target.setByName}</span>
            </p>
            {mine ? (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-300">
                <MapPin className="w-3 h-3" /> In YOUR sky: {mine.altitude.toFixed(1)}° alt / {mine.azimuth.toFixed(1)}° az
                {mine.visible ? ' (above your horizon)' : ' (below your horizon right now)'}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-amber-400">
                Set your observer location on the Sky Chart tab to see this target&rsquo;s real altitude/azimuth from where YOU are.
              </p>
            )}
            <p className="mt-1 text-[10px] italic text-zinc-500">
              Everyone in this session shares the same target, but every observer&rsquo;s altitude/azimuth above is computed live from
              their own location — this is not a mirrored copy of anyone else&rsquo;s sky.
            </p>
          </div>
        ) : (
          <p className="text-[11px] italic text-zinc-500">No shared target set yet — point everyone at something above.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex gap-1.5">
          <input
            value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="Share what you're seeing…"
            onKeyDown={(e) => { if (e.key === 'Enter') void postLog(); }}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
          />
          <button type="button" onClick={postLog} disabled={!message.trim()}
            className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50">
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        {log.length > 0 && (
          <ul className="max-h-32 space-y-1 overflow-y-auto">
            {log.map((e) => (
              <li key={e.id} className="text-[11px] text-zinc-300">
                <span className="text-indigo-300">{e.userName}</span>{' '}
                {e.kind === 'target' ? <span className="italic text-zinc-500">{e.message}</span> : e.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-[11px] text-rose-400">{error}</p>}
    </div>
  );
}
