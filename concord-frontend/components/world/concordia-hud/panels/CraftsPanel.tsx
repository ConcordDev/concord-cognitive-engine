'use client';
import { useCallback, useEffect, useState } from 'react';
import { macro, readActiveWorldId } from './_macro';

export function CraftsPanel() {
  const [chains, setChains] = useState<Array<{ id: string; name: string; steps: unknown[] }>>([]);
  const [my, setMy] = useState<Array<{ id: string; chain_id: string; current_step: number; status: string }>>([]);
  const refresh = useCallback(async () => {
    const [c, m] = await Promise.all([macro('craft_chains', 'list', { worldId: readActiveWorldId() }), macro('craft_chains', 'my_jobs', { worldId: readActiveWorldId() })]);
    if (c?.ok) setChains(c.chains || []);
    if (m?.ok) setMy(m.jobs || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">In progress</h3>
      {my.length === 0 ? <p className="text-zinc-400 text-xs italic mb-3">Nothing in motion.</p> : (
        <ul className="space-y-1 mb-3">
          {my.map((j) => (
            <li key={j.id} className="text-xs bg-zinc-900/50 border border-zinc-800 rounded p-2">
              <span className="text-zinc-200">{j.chain_id}</span>
              <span className="ml-2 text-amber-300/80">step {j.current_step}</span>
              <span className="ml-2 text-zinc-400">{j.status}</span>
              <button type="button" onClick={async () => { await macro('craft_chains', 'advance', { jobId: j.id }); refresh(); }} aria-label="Advance step" className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-800 hover:bg-emerald-700 text-emerald-100">+step</button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">Available chains</h3>
      <ul className="space-y-1">
        {chains.map((c) => (
          <li key={c.id} className="text-xs bg-zinc-900/50 border border-zinc-800 rounded p-2 flex items-center gap-2">
            <span className="text-zinc-200">{c.name}</span><span className="text-zinc-400">({c.steps.length} steps)</span>
            <button type="button" onClick={async () => { await macro('craft_chains', 'start', { chainId: c.id, worldId: readActiveWorldId() }); refresh(); }} aria-label={`Start ${c.name}`} className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-amber-700 hover:bg-amber-600 text-white">start</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
