'use client';

/**
 * ConceptArtBoard — the "My concept art" board (Asset Engine Increment 3).
 *
 * This is the READ side of the concept-art pipeline. Where
 * PublishAsConceptDialog mints a real, permanent `dtus` row from an artwork
 * (art.artwork-publish-as-concept), this board lists those persisted rows
 * back — reading the REAL `dtus` table via art.concept-art-list, scoped to
 * the authenticated creator. Unlike the Studio gallery (which shows the
 * ephemeral, wiped-on-restart STATE.artLens.artworks Map), everything here
 * survives a reload because it IS a database row.
 *
 * Honest by construction:
 *  - Thumbnails render only when a real data-URL thumbnail was saved on the
 *    DTU; otherwise an explicit "No preview" placeholder — never a
 *    fabricated raster.
 *  - An empty board shows an honest empty state, not filler cards.
 *  - Every field displayed (dtuId, visibility, dimensions, stroke counts)
 *    comes straight from the persisted row.
 */

import { useCallback, useEffect, useState } from 'react';
import { Library, Loader2, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ConceptArtEntry {
  dtuId: string;
  title: string;
  visibility: 'public' | 'marketplace' | 'internal' | 'private' | string;
  artworkId: string | null;
  width: number | null;
  height: number | null;
  background: string | null;
  layerCount: number;
  strokeCount: number;
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
}

const VIS_STYLE: Record<string, string> = {
  public: 'text-emerald-300 border-emerald-900/60 bg-emerald-950/30',
  marketplace: 'text-violet-300 border-violet-900/60 bg-violet-950/30',
  internal: 'text-sky-300 border-sky-900/60 bg-sky-950/30',
  private: 'text-zinc-400 border-zinc-800 bg-zinc-900/60',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export function ConceptArtBoard() {
  const [entries, setEntries] = useState<ConceptArtEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await lensRun('art', 'concept-art-list', {});
      if (r.data?.result?.ok === false) {
        setError(r.data.result.error || 'failed to load concept board');
        setEntries([]);
      } else {
        setError(null);
        setEntries((r.data?.result?.conceptArt as ConceptArtEntry[]) || []);
      }
    } catch (e) {
      setError(String((e as Error)?.message || e));
      setEntries([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Library className="w-4 h-4 text-violet-400" />
          <h3 className="text-xs font-semibold text-zinc-200">My concept art</h3>
          <span className="text-[11px] text-zinc-500">persisted DTUs · citable as asset lineage</span>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} /> Refresh
        </button>
      </div>

      <p className="text-[11px] text-zinc-500 leading-tight">
        Artworks you published with <span className="text-zinc-300">Publish as concept art</span> become
        real <span className="font-mono text-zinc-400">dtus</span> rows — they survive a reload and can be
        cited as the origin of a building or other asset.
      </p>

      {error && (
        <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-8 text-center">
          Your concept board is empty. Open an artwork in the Studio and choose{' '}
          <span className="text-zinc-300">Publish as concept art</span> to save it here permanently.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {entries.map((c) => (
            <div key={c.dtuId} className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
              <div
                className="aspect-[4/3] overflow-hidden"
                style={{ background: c.background || '#18181b' }}
              >
                {c.thumbnail ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={c.thumbnail} alt={c.title} className="w-full h-full object-contain" />
                ) : (
                  <span className="flex items-center justify-center h-full text-[10px] text-zinc-500">No preview</span>
                )}
              </div>
              <div className="px-2.5 py-1.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-zinc-100 truncate">{c.title}</p>
                  <span className={cn('shrink-0 text-[9px] uppercase tracking-wide border rounded px-1 py-0.5', VIS_STYLE[c.visibility] || VIS_STYLE.private)}>
                    {c.visibility}
                  </span>
                </div>
                <p className="text-[10px] text-zinc-500">
                  {c.width != null && c.height != null ? `${c.width}×${c.height} · ` : ''}
                  {c.layerCount} layer{c.layerCount === 1 ? '' : 's'} · {c.strokeCount} stroke{c.strokeCount === 1 ? '' : 's'}
                </p>
                <p className="text-[9px] text-zinc-600">{fmtDate(c.createdAt)}</p>
                <p className="text-[9px] font-mono text-zinc-600 truncate" title={c.dtuId}>{c.dtuId}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
