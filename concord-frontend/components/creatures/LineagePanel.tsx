'use client';

import { useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { GitBranch } from 'lucide-react';
import { useLensCommand } from '@/hooks/useLensCommand';
import type { LineageRow } from './types';

export function LineagePanel() {
  const [lineageId, setLineageId] = useState('');
  const [lineage, setLineage] = useState<LineageRow[]>([]);
  const [lineageSearched, setLineageSearched] = useState(false);
  const [lineageError, setLineageError] = useState<string | null>(null);
  const lineageInputRef = useRef<HTMLInputElement>(null);

  useLensCommand(
    [{ id: 'focus-lineage', keys: 'l', description: 'Focus lineage browser', category: 'navigation', action: () => lineageInputRef.current?.focus() }],
    { lensId: 'creatures' },
  );

  const fetchLineage = async () => {
    if (!lineageId) return;
    setLineageSearched(true);
    setLineageError(null);
    try {
      const r = await lensRun('creatures', 'lineage', { creatureId: lineageId });
      const result = r?.data?.result as { ok?: boolean; lineage?: { self?: LineageRow | null; descendants?: LineageRow[] } } | null;
      if (r?.data?.ok && result?.ok !== false && result?.lineage) {
        const rows: LineageRow[] = [];
        if (result.lineage.self) rows.push(result.lineage.self);
        for (const d of result.lineage.descendants || []) rows.push(d);
        setLineage(rows);
      } else {
        setLineage([]);
        setLineageError(r?.data?.error || 'Lineage lookup failed');
      }
    } catch (e) {
      setLineage([]);
      setLineageError(e instanceof Error ? e.message : 'Lineage lookup failed');
    }
  };

  return (
    <section aria-label="Lineage browser" className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
      <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold text-zinc-200">
        <GitBranch size={14} aria-hidden /> Lineage browser
      </h3>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="creature-lineage-id">Creature id</label>
        <input id="creature-lineage-id" ref={lineageInputRef} value={lineageId}
          onChange={(e) => { setLineageId(e.target.value); setLineageSearched(false); setLineageError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') fetchLineage(); }}
          placeholder="creature id  ·  L focuses"
          className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100" />
        <button onClick={fetchLineage} className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-700">View</button>
      </div>
      {lineage.length > 0 ? (
        <div className="mt-2 space-y-1">
          {lineage.map((l) => (
            <div key={l.child_id} className="rounded bg-zinc-950 p-2 text-[10px] font-mono text-zinc-300">
              gen {l.generation} · {l.child_id} ← [{l.parent_a || '?'}, {l.parent_b || '?'}]
              {typeof l.stability === 'number' && <span className="text-emerald-400/70"> · {Math.round(l.stability * 100)}%</span>}
            </div>
          ))}
        </div>
      ) : lineageError ? (
        <p className="mt-2 text-[11px] text-red-300" role="alert">× {lineageError}</p>
      ) : lineageSearched ? (
        <p className="mt-2 text-[11px] text-zinc-500">No lineage record for &ldquo;{lineageId}&rdquo; — it may not be a bred creature, or the id doesn&rsquo;t exist.</p>
      ) : null}
    </section>
  );
}
