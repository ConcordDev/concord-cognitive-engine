'use client';
import { useCallback, useEffect, useState } from 'react';
import { macro, readActiveWorldId } from './_macro';

export function UnderwaterPanel() {
  const [feats, setFeats] = useState<Array<{ id: string; kind: string; name: string; depth_min_m: number; depth_max_m: number; aggression: number }>>([]);
  const refresh = useCallback(async () => {
    const r = await macro('underwater', 'list_features', { worldId: readActiveWorldId() });
    if (r?.ok) setFeats(r.features || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">POIs in this world</h3>
      {feats.length === 0 ? <p className="text-zinc-500 text-xs italic">No authored underwater features.</p> : (
        <ul className="space-y-1">
          {feats.map((f) => (
            <li key={f.id} className={`text-xs border rounded p-2 ${f.aggression >= 2 ? 'bg-red-950/30 border-red-900/60' : f.aggression >= 1 ? 'bg-amber-950/30 border-amber-900/60' : 'bg-zinc-900/50 border-zinc-800'}`}>
              <span className="text-zinc-200">{f.name}</span>
              <span className="ml-2 text-zinc-500">{f.kind}</span>
              <span className="ml-2 text-[10px] text-zinc-600">depth {f.depth_min_m}–{f.depth_max_m}m</span>
              {f.aggression > 0 && <span className="ml-2 text-red-400">★ {f.aggression}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
