'use client';

/**
 * CurtainDossier — the Curtain's classification surface, rendered as a dossier.
 * Reads secrets.world_catalog: every secret held in the world, its body REDACTED
 * until the player has done the investigative work to declassify it. The point of
 * the satire as mechanic — almost nothing is actually hidden; it is on the record,
 * just classified, dull, and out of reach until you look. Toggled with the K key
 * (or `concordia:open-curtain`); no-op outside fiction worlds with no secrets.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface Entry {
  id: string;
  holderNpcId: string;
  subjectKind: string;
  subjectId: string;
  kind: string;
  difficulty: number;
  discovered: boolean;
  body: string | null;
}
interface Catalog { ok?: boolean; total?: number; declassified?: number; entries?: Entry[]; }

export default function CurtainDossier({ worldId }: { worldId?: string }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<Catalog | null>(null);

  const load = useCallback(async () => {
    if (!worldId) return;
    try {
      const r = await lensRun('secrets', 'world_catalog', { worldId });
      setCat((r?.data ?? null) as Catalog | null);
    } catch { /* no catalog */ }
  }, [worldId]);

  useEffect(() => {
    const onOpen = () => { setOpen((v) => !v); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && !e.metaKey && !e.ctrlKey && (e.target as HTMLElement)?.tagName !== 'INPUT') {
        setOpen((v) => !v);
      }
    };
    window.addEventListener('concordia:open-curtain', onOpen);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('concordia:open-curtain', onOpen); window.removeEventListener('keydown', onKey); };
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  if (!open) return null;
  const entries = cat?.entries ?? [];
  // Only a Curtain world has a catalog; render nothing for worlds with no secrets.
  if (cat && entries.length === 0) return null;

  return (
    <div data-testid="curtain-dossier" className="fixed right-4 top-16 z-[40] w-96 max-h-[70vh] overflow-y-auto rounded-lg border border-zinc-600/40 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">The Curtain — Classified Record</h2>
        <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-200" aria-label="Close">✕</button>
      </div>
      <p className="mb-3 text-xs text-zinc-400">
        {cat?.declassified ?? 0} of {cat?.total ?? entries.length} files declassified. Everything else is on the record — you simply have not read it whole yet.
      </p>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.id} className={`rounded border p-2 text-xs ${e.discovered ? 'border-emerald-600/40 bg-emerald-500/5' : 'border-zinc-700/50 bg-zinc-900/40'}`}>
            <div className="flex items-center justify-between">
              <span className="text-zinc-300">{e.holderNpcId} · <span className="text-zinc-500">{e.kind}</span></span>
              <span className="text-[10px] uppercase tracking-wider text-zinc-400">cls-{e.difficulty}</span>
            </div>
            {e.discovered ? (
              <div className="mt-1 text-emerald-200/90">{e.body}</div>
            ) : (
              <div className="mt-1 select-none font-mono text-zinc-600">[ REDACTED — classified by the Curtain ]</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
