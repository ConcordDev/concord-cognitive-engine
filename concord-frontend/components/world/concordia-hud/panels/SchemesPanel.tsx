'use client';
import { useCallback, useEffect, useState } from 'react';
import { macro } from './_macro';

export function SchemesPanel() {
  const [mine, setMine] = useState<Array<{ id: string; kind: string; phase: string; target_id: string }>>([]);
  const [against, setAgainst] = useState<Array<{ id: string; kind: string; plotter_id: string; phase: string }>>([]);
  const refresh = useCallback(async () => {
    const [m, a] = await Promise.all([macro('schemes', 'list_for_user'), macro('schemes', 'list_against_user')]);
    if (m?.ok) setMine(m.schemes || []);
    if (a?.ok) setAgainst(a.schemes || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">My schemes ({mine.length})</h3>
      {mine.length === 0 ? <p className="text-zinc-400 text-xs italic mb-3">Nothing in motion.</p> : (
        <ul className="space-y-1 mb-3">
          {mine.map((s) => (
            <li key={s.id} className="text-xs bg-zinc-900/50 border border-zinc-800 rounded p-2 flex items-center gap-2">
              <span className="text-zinc-200">{s.kind}</span><span className="text-zinc-400">→ {s.target_id}</span>
              <span className="ml-auto text-amber-300/80">{s.phase}</span>
              <button type="button" onClick={async () => { await macro('schemes', 'discover_evidence', { schemeId: s.id }); refresh(); }} aria-label="Investigate" className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-800 hover:bg-emerald-700 text-emerald-100">advance</button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">Against you ({against.length})</h3>
      {against.length === 0 ? <p className="text-zinc-400 text-xs italic">None detected.</p> : (
        <ul className="space-y-1">
          {against.map((s) => (
            <li key={s.id} className="text-xs bg-zinc-900/50 border border-red-900/40 rounded p-2">
              <span className="text-red-300">{s.plotter_id}</span> plots <span className="text-zinc-200">{s.kind}</span>
              <span className="ml-2 text-red-300/80">{s.phase}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
