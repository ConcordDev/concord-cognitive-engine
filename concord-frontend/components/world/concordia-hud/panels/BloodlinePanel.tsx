'use client';
import { useCallback, useEffect, useState } from 'react';
import { BloodlineBadge } from '@/components/concordia/BloodlineBadge';
import { macro } from './_macro';

export function BloodlinePanel() {
  const [ancestry, setAncestry] = useState<{ primary_bloodline: string; dilution: number } | null>(null);
  const [known, setKnown] = useState<Array<{ id: string; elements: string[]; description: string }>>([]);
  const refresh = useCallback(async () => {
    const [a, k] = await Promise.all([macro('bloodline', 'get_ancestry'), macro('bloodline', 'list_known')]);
    if (a?.ok) setAncestry(a.ancestry);
    if (k?.ok) setKnown(k.bloodlines || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">Current ancestry</h3>
      {ancestry ? (
        <div className="flex items-center gap-2 mb-3"><BloodlineBadge bloodline={ancestry.primary_bloodline} dilution={ancestry.dilution} /><span className="text-xs text-zinc-400">dilution {ancestry.dilution.toFixed(2)}</span></div>
      ) : (<p className="text-zinc-400 text-xs italic mb-3">No ancestry chosen. Choose one — it modulates elemental combat damage.</p>)}
      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">Bloodlines</h3>
      <ul className="space-y-1">
        {known.map((b) => (
          <li key={b.id} className="flex items-start justify-between gap-2 bg-zinc-900/50 border border-zinc-800 rounded p-2">
            <div className="flex-1 min-w-0"><BloodlineBadge bloodline={b.id} dilution={0.1} compact /><p className="mt-0.5 text-[10px] text-zinc-400 truncate">{b.description}</p></div>
            <button type="button" onClick={async () => { await macro('bloodline', 'choose', { bloodline: b.id, dilution: 0.2 }); refresh(); }} aria-label={`Choose ${b.id}`} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-700 hover:bg-amber-600 text-white shrink-0">choose</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
