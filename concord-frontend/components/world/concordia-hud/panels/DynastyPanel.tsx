'use client';
import { useCallback, useEffect, useState } from 'react';
import { macro } from './_macro';

export function DynastyPanel() {
  const [dyn, setDyn] = useState<{ id: string; house_name: string; renown: number; generations: number; current_head_user_id: string } | null>(null);
  const [log, setLog] = useState<Array<{ id: number; predecessor_user_id: string; heir_user_id: string; cause: string | null }>>([]);
  const [houseName, setHouseName] = useState('');
  const refresh = useCallback(async () => {
    const r = await macro('dynasty', 'mine');
    if (r?.ok && r.dynasty) {
      setDyn(r.dynasty);
      const lg = await macro('dynasty', 'log', { dynastyId: r.dynasty.id });
      if (lg?.ok) setLog(lg.takeovers || []);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  if (!dyn) return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Found a house</h3>
      <p className="text-xs text-zinc-400 mb-2">Your dynasty survives individual avatars. Pick a name.</p>
      <input value={houseName} onChange={(e) => setHouseName(e.target.value)} aria-label="House name" placeholder="House name…" className="bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1 text-xs w-full mb-2" />
      <button type="button" onClick={async () => { if (!houseName.trim()) return; await macro('dynasty', 'found', { houseName: houseName.trim() }); refresh(); }} aria-label="Found house" className="text-xs px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white">Found</button>
    </div>
  );
  return (
    <div className="text-sm">
      <h3 className="text-base font-bold text-zinc-100 mb-2">{dyn.house_name}</h3>
      <dl className="grid grid-cols-2 gap-1 text-xs mb-3">
        <dt className="text-zinc-500">Head</dt><dd className="text-zinc-200 font-mono truncate">{dyn.current_head_user_id}</dd>
        <dt className="text-zinc-500">Renown</dt><dd className="text-amber-300">{dyn.renown} / 1000</dd>
        <dt className="text-zinc-500">Generation</dt><dd className="text-zinc-200">{dyn.generations}</dd>
      </dl>
      {log.length > 0 && (
        <>
          <h4 className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Succession</h4>
          <ul className="space-y-1">
            {log.map((t) => (
              <li key={t.id} className="text-[10px] text-zinc-300 bg-zinc-900/50 border border-zinc-800 rounded p-1.5">
                <span className="font-mono truncate">{t.predecessor_user_id}</span> → <span className="font-mono text-emerald-300 truncate">{t.heir_user_id}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
