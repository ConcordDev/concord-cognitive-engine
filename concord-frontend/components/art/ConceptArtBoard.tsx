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
  public: 'text-[color:var(--at-good)] border-[color:var(--at-good)] bg-[var(--at-good-soft)]',
  marketplace: 'text-[color:var(--at-accent-text)] border-[color:var(--at-accent)] bg-[var(--at-accent-soft)]',
  internal: 'text-[color:var(--at-blue)] border-[color:var(--at-blue)] bg-[var(--at-blue-soft)]',
  private: 'text-[color:var(--at-muted)] border-[color:var(--at-rule)] bg-[var(--at-gesso)]',
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
      // lensRun() already unwraps the POST /api/lens/run { ok, result }
      // envelope (single or double wrap — see lib/api/client.ts) before
      // this call resolves, so the macro's own success/failure lands at
      // r.data.ok / r.data.error, never nested under r.data.result. The
      // art.concept-art-list macro itself returns { ok, result: { conceptArt,
      // count } } on success — after lensRun's double-unwrap that leaves
      // r.data.result as the flat { conceptArt, count } payload with no
      // .ok/.error fields on it at all, so the old `r.data.result.ok`/
      // `r.data.result.error` reads were structurally always undefined:
      // a real "db unavailable"/query failure never surfaced, it silently
      // rendered an empty board instead.
      if (r.data?.ok === false) {
        setError(r.data.error || 'failed to load concept board');
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
          <Library className="w-4 h-4 text-[color:var(--at-accent-text)]" />
          <h3 className="text-xs font-semibold text-[color:var(--at-ink)]">My concept art</h3>
          <span className="text-[11px] text-[color:var(--at-muted)]">persisted DTUs · citable as asset lineage</span>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="flex items-center gap-1 text-[11px] text-[color:var(--at-muted)] hover:text-[color:var(--at-ink)] disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} /> Refresh
        </button>
      </div>

      <p className="text-[11px] text-[color:var(--at-muted)] leading-tight">
        Artworks you published with <span className="text-[color:var(--at-ink-2)]">Publish as concept art</span> become
        real <span className="font-mono text-[color:var(--at-muted)]">dtus</span> rows — they survive a reload and can be
        cited as the origin of a building or other asset.
      </p>

      {error && (
        <div className="text-xs text-[color:var(--at-bad)] bg-[var(--at-bad-soft)] border border-[color:var(--at-bad)] rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-[color:var(--at-muted)]">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-[11px] text-[color:var(--at-muted)] italic py-8 text-center">
          Your concept board is empty. Open an artwork in the Studio and choose{' '}
          <span className="text-[color:var(--at-ink-2)]">Publish as concept art</span> to save it here permanently.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {entries.map((c) => (
            <div key={c.dtuId} className="bg-[var(--at-gesso)] border border-[color:var(--at-rule)] rounded-xl overflow-hidden">
              <div
                className="aspect-[4/3] overflow-hidden"
                style={{ background: c.background || '#18181b' }}
              >
                {c.thumbnail ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={c.thumbnail} alt={c.title} className="w-full h-full object-contain" />
                ) : (
                  <span className="flex items-center justify-center h-full text-[10px] text-[color:var(--at-muted)]">No preview</span>
                )}
              </div>
              <div className="px-2.5 py-1.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-[color:var(--at-ink)] truncate">{c.title}</p>
                  <span className={cn('shrink-0 text-[9px] uppercase tracking-wide border rounded px-1 py-0.5', VIS_STYLE[c.visibility] || VIS_STYLE.private)}>
                    {c.visibility}
                  </span>
                </div>
                <p className="text-[10px] text-[color:var(--at-muted)]">
                  {c.width != null && c.height != null ? `${c.width}×${c.height} · ` : ''}
                  {c.layerCount} layer{c.layerCount === 1 ? '' : 's'} · {c.strokeCount} stroke{c.strokeCount === 1 ? '' : 's'}
                </p>
                <p className="text-[9px] text-[color:var(--at-faint)]">{fmtDate(c.createdAt)}</p>
                <p className="text-[9px] font-mono text-[color:var(--at-faint)] truncate" title={c.dtuId}>{c.dtuId}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
