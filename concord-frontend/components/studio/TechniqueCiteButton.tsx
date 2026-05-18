'use client';

// TechniqueCiteButton — Sprint B Item #12.
//
// Surfaces on any track action: "Cite a producer's technique you used
// here." Opens a small modal that lists the user's own techniques
// AND the global pool, and on confirm calls `studio.cite_technique`
// to route the royalty cascade.

import { useState, useEffect, useCallback } from 'react';
import { Link2, Search, X, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Technique {
  id: string;
  title: string;
  creator_id: string;
  meta?: { description?: string; tags?: string[] };
}

interface TechniqueCiteButtonProps {
  trackDtuId: string;
  trackTitle?: string;
  onCited?: (techniqueId: string) => void;
}

export default function TechniqueCiteButton({ trackDtuId, trackTitle, onCited }: TechniqueCiteButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1 bg-neon-cyan/10 text-neon-cyan rounded text-[11px] font-medium hover:bg-neon-cyan/20 transition-colors"
      >
        <Link2 className="w-3 h-3" /> Cite technique
      </button>
      {open && (
        <TechniqueCiteModal
          trackDtuId={trackDtuId}
          trackTitle={trackTitle}
          onClose={() => setOpen(false)}
          onCited={(techId) => { onCited?.(techId); setOpen(false); }}
        />
      )}
    </>
  );
}

function TechniqueCiteModal({
  trackDtuId, trackTitle,
  onClose, onCited,
}: {
  trackDtuId: string;
  trackTitle?: string;
  onClose: () => void;
  onCited: (techniqueId: string) => void;
}) {
  const [scope, setScope] = useState<'mine' | 'all'>('all');
  const [techniques, setTechniques] = useState<Technique[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [citing, setCiting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ domain: 'studio', name: 'list_techniques', input: { scope } }),
      });
      const json = await r.json();
      const result = json?.result || json;
      if (result?.ok) setTechniques(result.techniques || []);
      else setError(result?.reason || 'load_failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request_failed');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { refresh(); }, [refresh]);

  const cite = useCallback(async (techniqueId: string) => {
    setCiting(techniqueId);
    setError(null);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          domain: 'studio', name: 'cite_technique',
          input: { track_dtuId: trackDtuId, technique_dtuId: techniqueId },
        }),
      });
      const json = await r.json();
      const result = json?.result || json;
      if (result?.ok) {
        onCited(techniqueId);
      } else {
        setError(result?.error || result?.reason || 'cite_failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request_failed');
    } finally {
      setCiting(null);
    }
  }, [trackDtuId, onCited]);

  const filtered = techniques.filter(t => {
    if (!filter.trim()) return true;
    const f = filter.toLowerCase();
    return t.title.toLowerCase().includes(f)
      || (t.meta?.tags || []).some(tag => tag.toLowerCase().includes(f));
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-black border border-white/10 rounded-xl p-4 max-w-lg w-full max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-neon-cyan" />
            <h3 className="text-sm font-bold">Cite a Production Technique</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          Crediting a technique you used on
          {trackTitle ? <strong className="text-white"> "{trackTitle}" </strong> : ' this track '}
          pays the technique's author every time your track sells or gets cited downstream.
        </p>

        <div className="flex gap-2 mb-2">
          <button
            onClick={() => setScope('all')}
            className={cn(
              'flex-1 px-2 py-1 rounded text-xs',
              scope === 'all' ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/5 text-gray-400 hover:text-white',
            )}
          >
            All
          </button>
          <button
            onClick={() => setScope('mine')}
            className={cn(
              'flex-1 px-2 py-1 rounded text-xs',
              scope === 'mine' ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/5 text-gray-400 hover:text-white',
            )}
          >
            Mine
          </button>
        </div>

        <div className="relative mb-3">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text" value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by title or tag…"
            className="w-full bg-black/40 border border-white/10 rounded pl-7 pr-2 py-1 text-xs text-white"
          />
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded p-2 text-[11px] text-red-300 mb-2">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-1.5">
          {loading && (
            <div className="text-center text-xs text-gray-500 py-6">Loading…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="text-center text-xs text-gray-500 py-6 italic">
              No techniques match. Try widening the scope or clearing the filter.
            </div>
          )}
          {filtered.map(t => (
            <div
              key={t.id}
              className="flex items-start gap-2 p-2 bg-white/5 border border-white/10 rounded"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">{t.title}</div>
                {t.meta?.description && (
                  <div className="text-[10px] text-gray-500 truncate">{t.meta.description}</div>
                )}
                {(t.meta?.tags?.length || 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {t.meta!.tags!.slice(0, 4).map(tag => (
                      <span key={tag} className="text-[9px] bg-neon-cyan/10 text-neon-cyan px-1.5 py-0.5 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => cite(t.id)}
                disabled={citing === t.id}
                className="px-2 py-1 bg-neon-green/20 text-neon-green rounded text-[10px] font-medium hover:bg-neon-green/30 disabled:opacity-50 flex-shrink-0"
              >
                {citing === t.id ? 'Citing…' : 'Cite'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
