'use client';
import { useCallback, useEffect, useState } from 'react';
import { macro, readActiveWorldId } from './_macro';

export function HooksPanel() {
  const [hooks, setHooks] = useState<Array<{ id: string; label: string; secret_id: string | null; evidence_id: string | null }>>([]);
  const refresh = useCallback(async () => {
    const r = await macro('hooks', 'list', { worldId: readActiveWorldId() });
    if (r?.ok) setHooks(r.hooks || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Satchel ({hooks.length})</h3>
      {hooks.length === 0 ? <p className="text-zinc-500 text-xs italic">Empty. Gather evidence on schemes; pick the hooks up off the ground.</p> : (
        <ul className="space-y-1">
          {hooks.map((h) => (
            <li key={h.id} className="text-xs bg-zinc-900/50 border border-zinc-800 rounded p-2 flex items-center gap-2">
              <span className="text-zinc-200 truncate flex-1">{h.label}</span>
              <button type="button" onClick={async () => { if (!window.confirm('Destroy hook?')) return; await macro('hooks', 'destroy', { hookId: h.id }); refresh(); }} aria-label="Destroy" className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/60 hover:bg-red-800 text-red-200">destroy</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
