'use client';

/**
 * CrystalsPanel — literary.crystallize discovery surface.
 * Extracted from literary/page.tsx consolidation.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { AlertTriangle, Gem, Loader2 } from 'lucide-react';
import {
  type Crystal, type CrystallizePayload, type ChunkDetail,
} from '@/components/literary/literary-shared';

export function CrystalsPanel() {
  const [crystals, setCrystals] = useState<Crystal[]>([]);
  const [crystalsLoading, setCrystalsLoading] = useState(true);
  const [crystalsError, setCrystalsError] = useState<string | null>(null);
  const [crystalOpenId, setCrystalOpenId] = useState<string | null>(null);
  const [crystalDetail, setCrystalDetail] = useState<ChunkDetail | null>(null);
  const [crystalDetailLoading, setCrystalDetailLoading] = useState(false);
  const [crystalDetailError, setCrystalDetailError] = useState<string | null>(null);

  const loadCrystals = useCallback(async () => {
    setCrystalsLoading(true);
    setCrystalsError(null);
    try {
      const r = await lensRun<CrystallizePayload>('literary', 'crystallize', { limit: 8 });
      if (r.data?.ok === false) { setCrystalsError(r.data?.error || 'unavailable'); return; }
      const payload = r.data?.result;
      if (payload?.ok === false) { setCrystalsError('unavailable'); return; }
      setCrystals(payload?.crystals || []);
    } catch {
      setCrystalsError('request_failed');
    } finally {
      setCrystalsLoading(false);
    }
  }, []);

  useEffect(() => { void loadCrystals(); }, [loadCrystals]);

  const loadCrystalDetail = useCallback(async (chunkId: string) => {
    setCrystalDetail(null);
    setCrystalDetailError(null);
    setCrystalDetailLoading(true);
    try {
      const r = await lensRun<ChunkDetail>('literary', 'detail', { chunkId });
      if (r.data?.ok === false || r.data?.result == null) { setCrystalDetailError(r.data?.error || 'unavailable'); return; }
      const out = r.data.result as ChunkDetail;
      if (out.ok === false) { setCrystalDetailError(out.reason || 'unavailable'); return; }
      setCrystalDetail(out);
    } catch {
      setCrystalDetailError('request_failed');
    } finally {
      setCrystalDetailLoading(false);
    }
  }, []);

  const toggleCrystalDetail = useCallback((chunkId: string) => {
    if (crystalOpenId === chunkId) { setCrystalOpenId(null); return; }
    setCrystalOpenId(chunkId);
    void loadCrystalDetail(chunkId);
  }, [crystalOpenId, loadCrystalDetail]);

  return (
    <section aria-label="Crystallization candidates" className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <h3 className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 text-sm font-semibold text-zinc-300">
        <Gem className="w-4 h-4 text-cyan-300" aria-hidden="true" /> Crystallization candidates
        <span className="text-[11px] text-zinc-500 font-normal">— passages bridging the most other domains, ranked by resonance salience</span>
      </h3>
      <div className="p-3 space-y-2">
        {crystalsLoading && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-zinc-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Ranking passages by resonance salience…
          </div>
        )}
        {!crystalsLoading && crystalsError && (
          <div role="alert" className="flex items-center justify-between gap-3 text-xs text-rose-300">
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" /> Couldn&apos;t rank passages ({crystalsError}).
            </span>
            <button type="button" onClick={() => void loadCrystals()} className="px-2 py-0.5 rounded bg-rose-700 hover:bg-rose-600 text-[11px] font-medium flex-shrink-0">
              Retry
            </button>
          </div>
        )}
        {!crystalsLoading && !crystalsError && crystals.length === 0 && (
          <p className="text-xs text-zinc-500">No cross-domain resonance edges yet — search a few passages to seed bridges, then candidates surface here.</p>
        )}
        {!crystalsLoading && !crystalsError && crystals.map((c, i) => (
          <div key={c.chunkId} className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
            <button
              type="button"
              onClick={() => toggleCrystalDetail(c.chunkId)}
              aria-expanded={crystalOpenId === c.chunkId}
              className="w-full text-left p-3 flex items-start gap-3 hover:bg-zinc-900/60 transition-colors"
            >
              <span className="text-[10px] font-mono text-cyan-400/80 w-5 flex-shrink-0 pt-0.5">#{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-100 truncate">{c.title}</span>
                  <span className="text-[10px] font-mono text-cyan-300 flex-shrink-0" title="Resonance salience — breadth × strength of cross-domain bridges">
                    {(c.salience * 100).toFixed(0)}%
                  </span>
                </div>
                {(c.author || c.heading) && (
                  <div className="text-xs text-zinc-400 truncate">
                    {c.author}{c.heading ? ` · ${c.heading}` : ''}
                  </div>
                )}
                <div className="mt-1.5 h-1 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-cyan-500/70" style={{ width: `${Math.round(Math.min(1, Math.max(0, c.salience)) * 100)}%` }} />
                </div>
                <div className="text-[10px] text-zinc-500 mt-1">
                  {c.edgeCount} bridge{c.edgeCount === 1 ? '' : 's'} · avg score {c.avgScore.toFixed(2)}
                </div>
              </div>
            </button>
            {crystalOpenId === c.chunkId && (
              <div className="border-t border-zinc-800 p-3 space-y-2" data-testid="crystal-detail">
                {crystalDetailLoading && (
                  <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-zinc-400">
                    <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Loading passage…
                  </div>
                )}
                {!crystalDetailLoading && crystalDetailError && (
                  <div role="alert" className="flex items-center justify-between gap-2 text-xs text-rose-300">
                    <span>Couldn&apos;t load the passage ({crystalDetailError}).</span>
                    <button type="button" onClick={() => void loadCrystalDetail(c.chunkId)} className="text-rose-200 underline flex-shrink-0">Retry</button>
                  </div>
                )}
                {!crystalDetailLoading && !crystalDetailError && crystalDetail?.chunk && (
                  <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">{crystalDetail.chunk.content}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
