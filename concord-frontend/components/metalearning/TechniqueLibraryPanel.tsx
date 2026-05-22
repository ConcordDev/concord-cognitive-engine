'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { BookOpen, Loader2, Search, ChevronRight } from 'lucide-react';

interface Technique {
  id: string;
  name: string;
  summary: string;
  whenToUse: string;
  steps: string[];
  evidence: string;
  strength: number;
}

export function TechniqueLibraryPanel() {
  const [techniques, setTechniques] = useState<Technique[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setErr(null);
    try {
      const { data: r } = await lensRun<any>('metalearning', 'techniqueLibrary', q ? { query: q } : {});
      if (r?.ok === false) { setErr(r.error || 'Failed to load techniques'); return; }
      setTechniques((r?.result || r).techniques || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load techniques');
    } finally { setLoading(false); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(''); }, []);

  return (
    <div className="space-y-3">
      <h3 className="font-semibold flex items-center gap-2 text-sm">
        <BookOpen className="w-4 h-4 text-neon-cyan" /> Technique Library
        <span className="text-xs text-gray-500 font-normal">{techniques.length}</span>
      </h3>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2 top-1/2 -translate-y-1/2" />
          <input value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(query); }}
            placeholder="Search techniques…"
            className="input-lattice w-full text-sm pl-7" />
        </div>
        <button onClick={() => load(query)} disabled={loading}
          className="btn-secondary text-sm px-3 disabled:opacity-50">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Search'}
        </button>
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}
      {techniques.length === 0 && !loading && (
        <p className="text-center py-4 text-gray-500 text-sm">No techniques match.</p>
      )}

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {techniques.map((t) => (
          <div key={t.id} className="bg-lattice-surface rounded-lg border border-white/5">
            <button onClick={() => setExpanded((p) => (p === t.id ? null : t.id))}
              className="w-full flex items-center justify-between p-3 text-left">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-gray-500 truncate">{t.summary}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-green/15 text-neon-green">
                  {(t.strength * 100).toFixed(0)}% evidence
                </span>
                <ChevronRight className={`w-4 h-4 text-gray-500 transition-transform ${expanded === t.id ? 'rotate-90' : ''}`} />
              </div>
            </button>
            {expanded === t.id && (
              <div className="px-3 pb-3 space-y-2 text-xs">
                <p className="text-gray-400"><span className="text-neon-cyan">When:</span> {t.whenToUse}</p>
                <div>
                  <p className="text-neon-purple mb-1">How to apply:</p>
                  <ol className="list-decimal list-inside space-y-0.5 text-gray-300">
                    {t.steps.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                </div>
                <p className="text-gray-500 italic">{t.evidence}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
