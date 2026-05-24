'use client';
import { useCallback, useEffect, useState } from 'react';
import { macro, readActiveWorldId } from './_macro';

export function StaminaPanel() {
  const [s, setS] = useState<{ value: number; max_value: number; state: string } | null>(null);
  const refresh = useCallback(async () => {
    const r = await macro('stamina', 'get', { worldId: readActiveWorldId() });
    if (r?.ok) setS(r.stamina);
  }, []);
  useEffect(() => { void refresh(); const id = window.setInterval(refresh, 4000); return () => window.clearInterval(id); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">Current</h3>
      {!s ? <p className="text-zinc-400 text-xs italic">Loading…</p> : (
        <>
          <p className="text-xs text-zinc-300 mb-2">{Math.round(s.value)} / {s.max_value} · <span className="text-amber-300">{s.state}</span></p>
          <div className="flex gap-1 flex-wrap">
            {['rest', 'climbing', 'sprinting', 'swimming'].map((st) => (
              <button key={st} type="button" onClick={async () => { await macro('stamina', st === 'rest' ? 'release' : `start_${st === 'climbing' ? 'climb' : st === 'sprinting' ? 'sprint' : 'swim'}`, { worldId: readActiveWorldId() }); refresh(); }} aria-label={`Set ${st}`} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">{st}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
