'use client';

/**
 * ResearchBibliographyPanel — the reading queue plus a bibliography
 * builder across the whole library or a chosen collection.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, BookOpen, Quote, Copy } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Reference { id: string; title: string; authors: string | null; year: number | null; status: string }
interface Collection { id: string; name: string }

const STYLES = ['apa', 'mla', 'chicago', 'bibtex'];

export function ResearchBibliographyPanel({ onChange }: { onChange: () => void }) {
  const [queue, setQueue] = useState<Reference[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [style, setStyle] = useState('apa');
  const [scope, setScope] = useState('');
  const [bibliography, setBibliography] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [q, c] = await Promise.all([
      lensRun('research', 'reading-queue', {}),
      lensRun('research', 'collection-list', {}),
    ]);
    setQueue(q.data?.result?.queue || []);
    setCollections(c.data?.result?.collections || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const build = useCallback(async () => {
    const params: Record<string, unknown> = { style };
    if (scope) params.collectionId = scope;
    const r = await lensRun('research', 'bibliography-build', params);
    setBibliography(r.data?.ok === false ? [] : (r.data?.result?.entries || []));
  }, [style, scope]);

  useEffect(() => { void build(); }, [build]);

  const advance = async (ref: Reference) => {
    const next = ref.status === 'to_read' ? 'reading' : 'read';
    await lensRun('research', 'reference-set-status', { id: ref.id, status: next });
    await refresh();
  };
  const copyAll = () => {
    try { navigator.clipboard?.writeText(bibliography.join(style === 'bibtex' ? '\n\n' : '\n')); } catch { /* ignore */ }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Reading queue */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <BookOpen className="w-3.5 h-3.5 text-red-400" /> Reading queue
        </h3>
        {queue.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">Nothing queued — all references are read.</p>
        ) : (
          <ul className="space-y-1">
            {queue.map((r) => (
              <li key={r.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs text-zinc-200 truncate">{r.title}</p>
                  <p className="text-[10px] text-zinc-400">{r.authors || 'Unknown'}{r.year ? ` · ${r.year}` : ''}</p>
                </div>
                <button type="button" onClick={() => advance(r)}
                  className={cn('text-[10px] px-2 py-0.5 rounded-lg border capitalize shrink-0',
                    r.status === 'reading' ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300' : 'border-amber-700/50 bg-amber-950/40 text-amber-300')}>
                  {r.status === 'reading' ? 'Mark read' : 'Start reading'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Bibliography builder */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Quote className="w-3.5 h-3.5 text-red-400" /> Bibliography builder
        </h3>
        <div className="flex gap-2 mb-2">
          <select value={style} onChange={(e) => setStyle(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {STYLES.map((st) => <option key={st} value={st}>{st.toUpperCase()}</option>)}
          </select>
          <select value={scope} onChange={(e) => setScope(e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">Entire library</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" onClick={copyAll} disabled={bibliography.length === 0}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 rounded-lg">
            <Copy className="w-3.5 h-3.5" /> Copy
          </button>
        </div>
        {bibliography.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No references to format.</p>
        ) : (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
            <ol className="space-y-2">
              {bibliography.map((entry, i) => (
                <li key={i} className="text-[11px] text-zinc-300 break-words whitespace-pre-wrap">{entry}</li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </div>
  );
}
