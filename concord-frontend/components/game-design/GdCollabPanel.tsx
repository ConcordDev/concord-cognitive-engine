'use client';

/**
 * GdCollabPanel — collaborative real-time level editing. Opens a shared
 * session on a level, polls the op log since a cursor, and lets the
 * owner / participants push edit ops that converge across clients.
 * Real participant ids only — no synthetic users.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Users, Radio, Send, DoorOpen, DoorClosed, Copy, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface LevelMeta { id: string; name: string }
interface Participant { id: string; joinedAt: string; lastSeen: string }
interface Op { seq: number; kind: string; authorId: string; payload: Record<string, unknown>; at: string }

const OP_KINDS = ['paint', 'object', 'layer', 'resize', 'note'];

export function GdCollabPanel({ gameId, onChange }: { gameId: string; onChange: () => void }) {
  const [levels, setLevels] = useState<LevelMeta[]>([]);
  const [levelId, setLevelId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [joinId, setJoinId] = useState('');
  const [open, setOpen] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [ops, setOps] = useState<Op[]>([]);
  const [copied, setCopied] = useState(false);
  const [opDraft, setOpDraft] = useState({ kind: 'note', note: '' });
  const cursorRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('game-design', 'level-list', { gameId });
    const list: LevelMeta[] = r.data?.result?.levels || [];
    setLevels(list);
    setLevelId((prev) => (list.some((l) => l.id === prev) ? prev : list[0]?.id || ''));
    setLoading(false);
    onChange();
  }, [gameId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const poll = useCallback(async (sid: string) => {
    const r = await lensRun('game-design', 'collab-poll', { sessionId: sid, since: cursorRef.current });
    if (r.data?.ok === false) return;
    const res = r.data?.result;
    if (!res) return;
    setOpen(!!res.open);
    setParticipants(res.participants || []);
    setActiveCount(res.activeParticipants || 0);
    if (Array.isArray(res.ops) && res.ops.length > 0) {
      setOps((prev) => [...prev, ...res.ops].slice(-200));
      cursorRef.current = res.cursor;
    } else if (typeof res.cursor === 'number') {
      cursorRef.current = res.cursor;
    }
  }, []);

  // Poll loop while a session is active.
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (!sessionId || !open) return;
    pollRef.current = setInterval(() => { void poll(sessionId); }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [sessionId, open, poll]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const openSession = async () => {
    if (!levelId) return;
    const r = await lensRun('game-design', 'collab-open', { levelId });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    const res = r.data?.result;
    setSessionId(res?.sessionId || '');
    setParticipants(res?.participants || []);
    cursorRef.current = res?.cursor || 0;
    setOps([]);
    setOpen(true);
    setError(null);
  };

  const joinSession = async () => {
    if (!joinId.trim()) { setError('Paste a session id to join.'); return; }
    const r = await lensRun('game-design', 'collab-join', { sessionId: joinId.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    const res = r.data?.result;
    setSessionId(res?.sessionId || '');
    setParticipants(res?.participants || []);
    cursorRef.current = res?.cursor || 0;
    setOps([]);
    setOpen(true);
    setJoinId('');
    setError(null);
  };

  const closeSession = async () => {
    if (!sessionId) return;
    const r = await lensRun('game-design', 'collab-close', { sessionId });
    if (r.data?.ok === false) { setError(r.data?.error || 'Only the owner can close'); return; }
    setOpen(false);
    setError(null);
  };

  const pushOp = async () => {
    if (!sessionId || !opDraft.note.trim()) return;
    const r = await lensRun('game-design', 'collab-push-op', {
      sessionId, kind: opDraft.kind, payload: { note: opDraft.note.trim() },
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setOpDraft({ kind: 'note', note: '' });
    setError(null);
    await poll(sessionId);
  };

  const copyId = async () => {
    if (!sessionId) return;
    try { await navigator.clipboard.writeText(sessionId); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard unavailable */ }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (levels.length === 0) {
    return <p className="text-[11px] text-zinc-400 italic py-6 text-center">Create a level in the Levels tab to share it.</p>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {!sessionId ? (
        <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <select value={levelId} onChange={(e) => setLevelId(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <button type="button" onClick={openSession}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-lime-600 hover:bg-lime-500 text-white rounded-lg">
              <DoorOpen className="w-3.5 h-3.5" /> Open session
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input placeholder="Paste a session id to join" value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={joinSession}
              className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Join</button>
          </div>
        </section>
      ) : (
        <>
          <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Radio className={cn('w-3.5 h-3.5', open ? 'text-lime-400' : 'text-zinc-600')} />
              <span className="text-[11px] font-semibold text-zinc-200">{open ? 'Session live' : 'Session closed'}</span>
              <div className="flex-1" />
              {open && (
                <button type="button" onClick={closeSession}
                  className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-rose-400">
                  <DoorClosed className="w-3.5 h-3.5" /> close
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[10px] text-zinc-400 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 truncate">{sessionId}</code>
              <button type="button" onClick={copyId}
                className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded">
                {copied ? <Check className="w-3 h-3 text-lime-400" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy id'}
              </button>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-zinc-400">
              <Users className="w-3.5 h-3.5 text-sky-400" />
              <span>{participants.length} participant{participants.length === 1 ? '' : 's'} · {activeCount} active now</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {participants.map((p) => {
                const isActive = Date.now() - new Date(p.lastSeen).getTime() < 60_000;
                return (
                  <span key={p.id} className={cn('text-[10px] px-2 py-0.5 rounded',
                    isActive ? 'bg-lime-950/50 text-lime-300' : 'bg-zinc-800 text-zinc-400')}>
                    {p.id}
                  </span>
                );
              })}
            </div>
          </section>

          {open && (
            <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <select value={opDraft.kind} onChange={(e) => setOpDraft({ ...opDraft, kind: e.target.value })}
                  className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100 capitalize">
                  {OP_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <input placeholder="edit note shared with the session" value={opDraft.note}
                  onChange={(e) => setOpDraft({ ...opDraft, note: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') void pushOp(); }}
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                <button type="button" onClick={pushOp}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-lime-600 hover:bg-lime-500 text-white rounded-lg">
                  <Send className="w-3 h-3" /> Push
                </button>
              </div>
            </section>
          )}

          <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-1.5">
            <p className="text-[10px] text-zinc-400 uppercase">Op log</p>
            {ops.length === 0 ? (
              <p className="text-[11px] text-zinc-400 italic py-3 text-center">No edit ops yet.</p>
            ) : (
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {ops.slice().reverse().map((o) => (
                  <li key={o.seq} className="flex items-center gap-2 text-[11px] bg-zinc-950/60 border border-zinc-800 rounded-lg px-2 py-1">
                    <span className="text-zinc-600 font-mono w-8">#{o.seq}</span>
                    <span className="px-1.5 rounded bg-zinc-800 text-zinc-300 uppercase text-[9px]">{o.kind}</span>
                    <span className="flex-1 text-zinc-300 truncate">
                      {typeof o.payload?.note === 'string' ? o.payload.note : JSON.stringify(o.payload)}
                    </span>
                    <span className="text-zinc-600 truncate max-w-[80px]">{o.authorId}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
