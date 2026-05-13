'use client';
import { useCallback, useEffect, useState } from 'react';
import { macro } from './_macro';

export function CouncilPanel() {
  const [sessions, setSessions] = useState<Array<{ id: string; realm_id: string; season_id: number; year: number }>>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [petitions, setPetitions] = useState<Array<{ id: string; topic: string; resolution: string | null }>>([]);
  const [topic, setTopic] = useState('');
  const refresh = useCallback(async () => {
    const r = await macro('realm_council', 'open_sessions');
    if (r?.ok) setSessions(r.sessions || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!activeSession) return;
    void (async () => {
      const r = await macro('realm_council', 'list_petitions', { sessionId: activeSession });
      if (r?.ok) setPetitions(r.petitions || []);
    })();
  }, [activeSession]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Open sessions</h3>
      {sessions.length === 0 ? <p className="text-zinc-500 text-xs italic">No councils in session.</p> : (
        <ul className="space-y-1 mb-3">
          {sessions.map((s) => (
            <li key={s.id} className={`text-xs border rounded p-2 cursor-pointer ${activeSession === s.id ? 'bg-amber-950/50 border-amber-700' : 'bg-zinc-900/50 border-zinc-800'}`} onClick={() => setActiveSession(s.id)}>
              <span className="text-zinc-200">{s.realm_id}</span>
              <span className="ml-2 text-zinc-500">season {s.season_id} · year {s.year}</span>
            </li>
          ))}
        </ul>
      )}
      {activeSession && (
        <>
          <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Petitions ({petitions.length})</h3>
          {petitions.length === 0 ? <p className="text-zinc-500 text-xs italic mb-2">None yet.</p> : (
            <ul className="space-y-1 mb-3">
              {petitions.map((p) => (
                <li key={p.id} className="text-xs bg-zinc-900/50 border border-zinc-800 rounded p-2">
                  <span className="text-zinc-200">{p.topic}</span>
                  {p.resolution && <span className="ml-2 text-amber-300/80">{p.resolution}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Petition topic" placeholder="petition topic…" className="bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1 text-xs flex-1" />
            <button type="button" onClick={async () => { if (!topic.trim()) return; await macro('realm_council', 'submit_petition', { sessionId: activeSession, topic: topic.trim() }); setTopic(''); const r = await macro('realm_council', 'list_petitions', { sessionId: activeSession }); if (r?.ok) setPetitions(r.petitions || []); }} aria-label="Submit petition" className="text-[10px] px-1.5 py-0.5 rounded bg-amber-700 hover:bg-amber-600 text-white">submit</button>
          </div>
        </>
      )}
    </div>
  );
}
