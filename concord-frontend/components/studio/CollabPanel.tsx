'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Users, Loader2, Play, LogIn, LogOut } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Collaborator {
  userId: string;
  displayName: string;
  role: string;
  colour: string;
  cursorBeats: number;
  selectionTrackId: string | null;
}
interface EditEntry { seq: number; userId: string; op: string; target: string | null; at: string }
interface Session {
  id: string;
  projectId: string;
  projectName: string;
  hostUserId: string;
  collaborators: Collaborator[];
  editLog: EditEntry[];
  startedAt: string;
}

export function CollabPanel({ projectId }: { projectId?: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [entries, setEntries] = useState<EditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [joined, setJoined] = useState(false);
  const sinceSeqRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSession = useCallback(async () => {
    if (!projectId) { setSession(null); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await lensRun('studio', 'collab-session-get', { projectId });
      const s = (res.data?.result?.session || null) as Session | null;
      setSession(s);
      if (s) { setCollaborators(s.collaborators); setEntries(s.editLog); sinceSeqRef.current = s.editLog.length; }
    } catch (e) { console.error('[Collab] session', e); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void loadSession(); }, [loadSession]);

  // Poll for new edits + presence while joined.
  useEffect(() => {
    if (!joined || !projectId) return;
    const poll = async () => {
      try {
        await lensRun('studio', 'collab-presence', { projectId });
        const res = await lensRun('studio', 'collab-since', { projectId, sinceSeq: sinceSeqRef.current });
        const r = res.data?.result as { entries?: EditEntry[]; latestSeq?: number; collaborators?: Collaborator[] } | undefined;
        if (r) {
          if (r.entries && r.entries.length > 0) {
            setEntries((prev) => [...prev, ...r.entries!].slice(-200));
            sinceSeqRef.current = r.latestSeq ?? sinceSeqRef.current;
          }
          if (r.collaborators) setCollaborators(r.collaborators);
        }
      } catch (e) { console.error('[Collab] poll', e); }
    };
    pollRef.current = setInterval(poll, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [joined, projectId]);

  async function startSession() {
    if (!projectId) return;
    try {
      const res = await lensRun('studio', 'collab-session-start', { projectId, displayName: displayName || undefined });
      if (res.data?.ok) { setSession(res.data.result.session as Session); setJoined(true); }
    } catch (e) { console.error('[Collab] start', e); }
  }

  async function joinSession() {
    if (!projectId) return;
    try {
      const res = await lensRun('studio', 'collab-join', { projectId, displayName: displayName || undefined });
      if (res.data?.ok) {
        const s = res.data.result.session as Session;
        setSession(s); setCollaborators(s.collaborators); sinceSeqRef.current = s.editLog.length;
        setJoined(true);
      }
    } catch (e) { console.error('[Collab] join', e); }
  }

  async function leaveSession() {
    if (!projectId) return;
    try {
      await lensRun('studio', 'collab-leave', { projectId });
      setJoined(false);
      await loadSession();
    } catch (e) { console.error('[Collab] leave', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Users className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Real-time collaboration</span>
        {joined && <span className="ml-auto text-[10px] text-emerald-400">Live</span>}
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : !projectId ? (
        <div className="px-3 py-10 text-center text-xs text-gray-500">Open a project to start a collaboration session.</div>
      ) : (
        <div className="p-3 space-y-3">
          {!joined && (
            <div className="space-y-2">
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your display name" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <div className="grid grid-cols-2 gap-2">
                <button onClick={startSession} className="px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold inline-flex items-center justify-center gap-1"><Play className="w-3 h-3" />Start session</button>
                <button onClick={joinSession} disabled={!session} className="px-3 py-1.5 text-xs rounded bg-white/[0.06] disabled:opacity-40 text-gray-200 inline-flex items-center justify-center gap-1"><LogIn className="w-3 h-3" />Join session</button>
              </div>
              {!session && <div className="text-[10px] text-gray-500">No active session — start one to invite collaborators.</div>}
            </div>
          )}

          {session && (
            <>
              <div>
                <div className="text-[10px] uppercase text-violet-300 font-semibold mb-1">Collaborators ({collaborators.length})</div>
                <ul className="space-y-1">
                  {collaborators.map((c) => (
                    <li key={c.userId} className="flex items-center gap-2 text-[11px] text-gray-300">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.colour }} />
                      <span className="text-white">{c.displayName}</span>
                      <span className="text-[9px] text-gray-500 uppercase">{c.role}</span>
                      <span className="ml-auto text-[9px] text-gray-500">@ beat {c.cursorBeats}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-[10px] uppercase text-violet-300 font-semibold mb-1">Edit log ({entries.length})</div>
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {entries.length === 0 ? (
                    <div className="text-[10px] text-gray-500">No edits yet.</div>
                  ) : entries.slice().reverse().map((e) => (
                    <div key={e.seq} className="text-[10px] text-gray-400 font-mono">
                      #{e.seq} <span className="text-violet-300">{e.userId}</span> {e.op}{e.target ? ` ${e.target}` : ''}
                    </div>
                  ))}
                </div>
              </div>
              {joined && (
                <button onClick={leaveSession} className="w-full px-3 py-1.5 text-xs rounded bg-rose-500/20 text-rose-300 inline-flex items-center justify-center gap-1"><LogOut className="w-3 h-3" />Leave session</button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default CollabPanel;
