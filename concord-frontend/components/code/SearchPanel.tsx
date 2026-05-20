'use client';

/**
 * SearchPanel — VS Code search side panel. Two modes:
 *  - Text: project-wide search with regex / case / whole-word toggles
 *    and a search-and-replace pass.
 *  - References: word-boundary symbol references with a project-wide
 *    rename.
 */

import { useState } from 'react';
import { Search, Loader2, Replace, CaseSensitive, Regex, WholeWord, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Hit { file: string; line: number; column: number; preview: string }
interface Ref { path: string; line: number; snippet: string }

export function SearchPanel({
  projectId, onOpen,
}: { projectId: string | null; onOpen: (path: string, line: number) => void }) {
  const [mode, setMode] = useState<'text' | 'refs'>('text');
  const [q, setQ] = useState('');
  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [opts, setOpts] = useState({ caseSensitive: false, regex: false, wholeWord: false });
  const [hits, setHits] = useState<Hit[]>([]);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function runSearch() {
    if (!projectId || q.trim().length < 1) return;
    setLoading(true); setNotice(null);
    try {
      const r = await lensRun({ domain: 'code', action: 'search-project', input: { projectId, query: q, ...opts } });
      setHits((r.data?.result?.hits || []) as Hit[]);
    } catch (e) { console.error('[Search] failed', e); }
    finally { setLoading(false); }
  }

  async function runReplace() {
    if (!projectId || q.trim().length < 1) return;
    setLoading(true); setNotice(null);
    try {
      const r = await lensRun({ domain: 'code', action: 'replace-project', input: { projectId, query: q, replacement, ...opts } });
      const res = r.data?.result;
      setNotice(`Replaced ${res?.totalReplacements || 0} occurrence(s) across ${res?.filesChanged || 0} file(s).`);
      await runSearch();
    } catch (e) { console.error('[Replace] failed', e); }
    finally { setLoading(false); }
  }

  async function runRefs() {
    if (!projectId || q.trim().length < 2) return;
    setLoading(true); setNotice(null);
    try {
      const r = await lensRun({ domain: 'code', action: 'find-references', input: { projectId, symbol: q.trim() } });
      setRefs((r.data?.result?.references || []) as Ref[]);
    } catch (e) { console.error('[Refs] failed', e); }
    finally { setLoading(false); }
  }

  async function runRename() {
    if (!projectId || q.trim().length < 1 || replacement.trim().length < 1) return;
    setLoading(true); setNotice(null);
    try {
      const r = await lensRun({ domain: 'code', action: 'rename-symbol', input: { projectId, from: q.trim(), to: replacement.trim() } });
      if (r.data?.ok === false) { setNotice(r.data?.error || 'Rename failed.'); return; }
      const res = r.data?.result;
      setNotice(`Renamed ${res?.totalOccurrences || 0} occurrence(s) in ${res?.filesChanged || 0} file(s).`);
      await runRefs();
    } catch (e) { console.error('[Rename] failed', e); }
    finally { setLoading(false); }
  }

  if (!projectId) return <div className="p-3 text-xs text-gray-500 italic">Open a project to search.</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center border-b border-white/10">
        <button type="button" onClick={() => setMode('text')}
          className={cn('px-3 py-1.5 text-[11px] font-semibold border-b-2',
            mode === 'text' ? 'text-white border-blue-400' : 'text-gray-500 border-transparent hover:text-gray-300')}>
          Search
        </button>
        <button type="button" onClick={() => setMode('refs')}
          className={cn('px-3 py-1.5 text-[11px] font-semibold border-b-2',
            mode === 'refs' ? 'text-white border-blue-400' : 'text-gray-500 border-transparent hover:text-gray-300')}>
          References
        </button>
      </div>

      <div className="p-2 border-b border-white/10 space-y-1.5">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setShowReplace((v) => !v)}
            title="Toggle replace" className="text-gray-500 hover:text-white">
            <Replace className="w-3.5 h-3.5" />
          </button>
          <input value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (mode === 'text' ? runSearch() : runRefs())}
            placeholder={mode === 'text' ? 'Search text…' : 'Symbol (word-boundary)…'}
            className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        </div>
        {(showReplace || mode === 'refs') && (
          <div className="flex items-center gap-1 pl-5">
            <input value={replacement} onChange={(e) => setReplacement(e.target.value)}
              placeholder={mode === 'text' ? 'Replace with…' : 'Rename to…'}
              className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <button type="button" onClick={() => (mode === 'text' ? runReplace() : runRename())}
              title={mode === 'text' ? 'Replace all' : 'Rename symbol'}
              className="px-1.5 py-1 rounded bg-blue-500/80 text-white hover:bg-blue-400">
              <Check className="w-3 h-3" />
            </button>
          </div>
        )}
        {mode === 'text' && (
          <div className="flex items-center gap-1 pl-5">
            {([['caseSensitive', CaseSensitive], ['wholeWord', WholeWord], ['regex', Regex]] as const).map(([k, Icon]) => (
              <button key={k} type="button" onClick={() => setOpts({ ...opts, [k]: !opts[k] })}
                className={cn('p-1 rounded border', opts[k] ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-white/10 text-gray-500 hover:text-white')}>
                <Icon className="w-3 h-3" />
              </button>
            ))}
            <button type="button" onClick={runSearch}
              className="ml-auto px-2 py-1 text-[11px] rounded bg-blue-500 text-white font-bold hover:bg-blue-400 inline-flex items-center gap-1">
              <Search className="w-3 h-3" /> Find
            </button>
          </div>
        )}
      </div>

      {notice && <div className="px-3 py-1.5 text-[11px] text-emerald-300 bg-emerald-500/10 border-b border-white/5">{notice}</div>}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3 text-xs text-gray-500"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Working…</div>
        ) : mode === 'text' ? (
          hits.length === 0 ? (
            <div className="p-3 text-xs text-gray-500 italic">{q ? 'No matches.' : 'Type a query and press Enter.'}</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {hits.map((h, i) => (
                <li key={i} onClick={() => onOpen(h.file, h.line)} className="px-3 py-1.5 cursor-pointer hover:bg-white/[0.04]">
                  <div className="text-[10px] font-mono text-blue-300 truncate">{h.file}:{h.line}:{h.column}</div>
                  <div className="text-[11px] text-white font-mono truncate">{h.preview}</div>
                </li>
              ))}
            </ul>
          )
        ) : (
          refs.length === 0 ? (
            <div className="p-3 text-xs text-gray-500 italic">{q ? 'No references.' : 'Type a symbol and press Enter.'}</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {refs.map((r, i) => (
                <li key={i} onClick={() => onOpen(r.path, r.line)} className="px-3 py-1.5 cursor-pointer hover:bg-white/[0.04]">
                  <div className="text-[10px] font-mono text-blue-300 truncate">{r.path}:{r.line}</div>
                  <div className="text-[11px] text-white font-mono truncate">{r.snippet}</div>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}

export default SearchPanel;
