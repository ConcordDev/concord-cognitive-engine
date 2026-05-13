'use client';
import { useCallback, useEffect, useState } from 'react';
import { macro } from './_macro';

export function MarriagePanel() {
  const [mar, setMar] = useState<Array<{ id: string; partner_a_id: string; partner_b_id: string }>>([]);
  const [pid, setPid] = useState('');
  const refresh = useCallback(async () => {
    const r = await macro('marriage', 'list_mine');
    if (r?.ok) setMar(r.marriages || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Active unions</h3>
      {mar.length === 0 ? <p className="text-zinc-500 text-xs italic mb-3">No marriages.</p> : (
        <ul className="space-y-1 mb-3">
          {mar.map((m) => (
            <li key={m.id} className="text-xs bg-zinc-900/50 border border-zinc-800 rounded p-2 flex items-center gap-2">
              <span className="text-zinc-200 truncate flex-1">{m.partner_a_id} ⨯ {m.partner_b_id}</span>
              <button type="button" onClick={async () => { if (!window.confirm('Dissolve?')) return; await macro('marriage', 'dissolve', { marriageId: m.id, reason: 'divorced' }); refresh(); }} aria-label="Divorce" className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/60 hover:bg-red-800 text-red-200">divorce</button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Propose to NPC</h3>
      <div className="flex gap-2">
        <input value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Partner NPC id" placeholder="npc_id…" className="bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1 text-xs flex-1" />
        <button type="button" onClick={async () => { if (!pid.trim()) return; await macro('marriage', 'marry', { partnerKind: 'npc', partnerId: pid.trim() }); setPid(''); refresh(); }} aria-label="Propose" className="text-[10px] px-1.5 py-0.5 rounded bg-amber-700 hover:bg-amber-600 text-white">propose</button>
      </div>
    </div>
  );
}
