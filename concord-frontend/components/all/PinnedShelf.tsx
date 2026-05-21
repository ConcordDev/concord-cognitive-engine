'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Star, Loader2, ArrowLeft, ArrowRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { getLensById } from '@/lib/lens-registry';

interface PinListResult { pins: string[]; count: number; max: number }
interface PinReorderResult { pins: string[]; count: number }

/**
 * PinnedShelf — the launcher's top shelf of favorite lenses.
 * Reads `all.pin-list`, supports reorder via `all.pin-reorder`, and
 * exposes a refresh handle so the page can sync after a pin toggle.
 */
export function PinnedShelf({ refreshKey, onChange }: { refreshKey: number; onChange?: () => void }) {
  const [pins, setPins] = useState<string[]>([]);
  const [max, setMax] = useState(24);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<PinListResult>('all', 'pin-list', {});
    if (r.data?.ok && r.data.result) {
      setPins(r.data.result.pins || []);
      setMax(r.data.result.max || 24);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const move = useCallback(async (idx: number, dir: -1 | 1) => {
    const next = [...pins];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setPins(next);
    setBusy(true);
    const r = await lensRun<PinReorderResult>('all', 'pin-reorder', { pins: next });
    if (r.data?.ok && r.data.result) setPins(r.data.result.pins || next);
    setBusy(false);
    onChange?.();
  }, [pins, onChange]);

  const unpin = useCallback(async (lensId: string) => {
    setBusy(true);
    const r = await lensRun<{ pins: string[] }>('all', 'pin-toggle', { lensId });
    if (r.data?.ok && r.data.result) setPins(r.data.result.pins || []);
    setBusy(false);
    onChange?.();
  }, [onChange]);

  if (loading) {
    return (
      <div className="panel p-4 flex items-center gap-2 text-xs text-gray-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading pinned lenses…
      </div>
    );
  }

  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm uppercase tracking-wider text-amber-400 flex items-center gap-2">
          <Star className="w-4 h-4" /> Pinned
        </h2>
        <span className="text-[10px] text-gray-500">{pins.length} / {max}</span>
      </div>
      {pins.length === 0 ? (
        <p className="text-xs text-gray-500">No pinned lenses yet. Click the star on any lens card below to pin it here.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {pins.map((id, idx) => {
            const lens = getLensById(id);
            const Icon = lens?.icon;
            return (
              <div key={id} className="group flex items-center gap-2 bg-lattice-void border border-amber-500/25 rounded-lg p-2.5">
                <Link href={lens?.path || `/lenses/${id}`} className="flex items-center gap-2 min-w-0 flex-1 text-white text-sm hover:text-amber-300">
                  {Icon ? <Icon className="w-4 h-4 text-amber-400 shrink-0" /> : <Star className="w-4 h-4 text-amber-400 shrink-0" />}
                  <span className="truncate">{lens?.name || id}</span>
                </Link>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button type="button" disabled={busy || idx === 0} onClick={() => move(idx, -1)} aria-label={`Move ${lens?.name || id} earlier`} className="p-1 text-gray-500 hover:text-white disabled:opacity-30">
                    <ArrowLeft className="w-3 h-3" />
                  </button>
                  <button type="button" disabled={busy || idx === pins.length - 1} onClick={() => move(idx, 1)} aria-label={`Move ${lens?.name || id} later`} className="p-1 text-gray-500 hover:text-white disabled:opacity-30">
                    <ArrowRight className="w-3 h-3" />
                  </button>
                  <button type="button" disabled={busy} onClick={() => unpin(id)} aria-label={`Unpin ${lens?.name || id}`} className="p-1 text-amber-400 hover:text-amber-200 disabled:opacity-30">
                    <Star className="w-3.5 h-3.5 fill-current" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
