'use client';

/**
 * SearchPanel — VS Code search side panel. Two modes:
 *  - Text: project-wide search with regex / case / whole-word toggles
 *    and a search-and-replace pass.
 *  - References: word-boundary symbol references with a project-wide
 *    rename.
 */

import { useEffect, useRef, useState } from 'react';
import { Search, Loader2, Replace, CaseSensitive, Regex, WholeWord, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Hit { file: string; line: number; column: number; preview: string }
interface Ref { path: string; line: number; snippet: string }

const TOGGLE_LABELS = {
  caseSensitive: 'Match case',
  wholeWord: 'Whole word',
  regex: 'Use regular expression',
} as const;

export function SearchPanel({
  projectId, onOpen, onReplaced, active,
}: {
  projectId: string | null;
  /** S17 (F17): the panel now stays mounted (hidden) across nav
   *  switches so its query survives; `active` tells it when it becomes
   *  visible again, and a present-but-unrun query runs on activation. */
  active?: boolean;
  onOpen: (path: string, line: number) => void;
  /** S6 (F5): after a successful project replace, the changed paths —
   *  the caller reconciles any open editor tabs from the server store,
   *  because the replace writes there directly and a stale tab buffer
   *  would otherwise hide (and later overwrite) the change. */
  onReplaced?: (paths: string[]) => void;
}) {
  const [mode, setMode] = useState<'text' | 'refs'>('text');
  const [q, setQ] = useState('');
  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [opts, setOpts] = useState({ caseSensitive: false, regex: false, wholeWord: false });
  const [hits, setHits] = useState<Hit[]>([]);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<'ok' | 'error'>('ok');
  // S17: the query+options the current results actually answer. An
  // empty result list may only say "No matches." when it answers the
  // CURRENT query — before that it must say the search has not run.
  const [searchedFor, setSearchedFor] = useState('');
  const runKey = () => `${mode}:${q}:${opts.caseSensitive}:${opts.wholeWord}:${opts.regex}`;

  async function runSearch() {
    if (!projectId || q.trim().length < 1) return;
    setLoading(true); setNotice(null);
    try {
      const r = await lensRun({ domain: 'code', action: 'search-project', input: { projectId, query: q, ...opts } });
      setHits((r.data?.result?.hits || []) as Hit[]);
      setSearchedFor(runKey());
    } catch (e) { console.error('[Search] failed', e); }
    finally { setLoading(false); }
  }

  async function runReplace() {
    if (!projectId || q.trim().length < 1) return;
    setLoading(true); setNotice(null);
    try {
      const r = await lensRun({ domain: 'code', action: 'replace-project', input: { projectId, query: q, replacement, ...opts } });
      if (r.data?.ok === false) {
        setNoticeKind('error');
        setNotice(`Replace failed: ${r.data?.error || 'the server refused'}. Nothing was changed.`);
        return;
      }
      const res = r.data?.result;
      const changedPaths = Array.isArray(res?.changed) ? (res.changed as Array<{ path: string }>).map(c => c.path) : [];
      if (changedPaths.length > 0) onReplaced?.(changedPaths);
      // Regenerate results BEFORE setting the success notice: runSearch
      // clears the notice on entry, so a notice set first is erased
      // before it ever renders (the count this slice exists to report
      // never appeared — caught by code-replace-all in the recipe env,
      // 2026-10-29; the same ordering on main predates this rework).
      await runSearch();
      setNoticeKind('ok');
      setNotice(`Replaced ${res?.totalReplacements || 0} occurrence(s) across ${res?.filesChanged || 0} file(s) — saved.`);
    } catch (e) {
      console.error('[Replace] failed', e);
      setNoticeKind('error');
      setNotice('Replace failed: the request did not complete. Nothing was changed.');
    }
    finally { setLoading(false); }
  }

  async function runRefs() {
    if (!projectId || q.trim().length < 2) return;
    setLoading(true); setNotice(null);
    try {
      const r = await lensRun({ domain: 'code', action: 'find-references', input: { projectId, symbol: q.trim() } });
      if (r.data?.ok === false) {
        // S7 (F7): a failed reference search is not "No references."
        setNoticeKind('error');
        setNotice(`Reference search failed: ${r.data?.error || 'unavailable'}`);
        setRefs([]);
        return;
      }
      setRefs((r.data?.result?.references || []) as Ref[]);
      setSearchedFor(runKey());
    } catch (e) {
      console.error('[Refs] failed', e);
      setNoticeKind('error');
      setNotice('Reference search failed: the request did not complete.');
    }
    finally { setLoading(false); }
  }

  async function runRename() {
    if (!projectId || q.trim().length < 1 || replacement.trim().length < 1) return;
    setLoading(true); setNotice(null);
    try {
      const r = await lensRun({ domain: 'code', action: 'rename-symbol', input: { projectId, from: q.trim(), to: replacement.trim() } });
      if (r.data?.ok === false) { setNoticeKind('error'); setNotice(r.data?.error || 'Rename failed.'); return; }
      const res = r.data?.result;
      // Same ordering rule as runReplace: runRefs clears the notice on
      // entry, so the confirmation is set after it returns.
      await runRefs();
      setNoticeKind('ok');
      setNotice(`Renamed ${res?.totalOccurrences || 0} occurrence(s) in ${res?.filesChanged || 0} file(s).`);
    } catch (e) { console.error('[Rename] failed', e); }
    finally { setLoading(false); }
  }

  // S17: becoming visible with a query that has not been run (or whose
  // options changed while hidden) runs it — no dead "No matches." wait
  // for a Find click that should never have been necessary.
  const wasActive = useRef(false);
  useEffect(() => {
    const becameActive = !!active && !wasActive.current;
    wasActive.current = !!active;
    if (!becameActive || !projectId || q.trim().length < 1) return;
    if (searchedFor === runKey()) return;
    void (mode === 'text' ? runSearch() : runRefs());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activation edge only
  }, [active]);

  // After every hook: returning earlier changed the hook count when a project opened or closed.
  if (!projectId) return <div className="p-3 text-xs text-gray-400 italic">Open a project to search.</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center border-b border-white/10">
        <button type="button" onClick={() => setMode('text')}
          className={cn('px-3 py-1.5 text-[11px] font-semibold border-b-2',
            mode === 'text' ? 'text-white border-blue-400' : 'text-gray-400 border-transparent hover:text-gray-300')}>
          Search
        </button>
        <button type="button" onClick={() => setMode('refs')}
          className={cn('px-3 py-1.5 text-[11px] font-semibold border-b-2',
            mode === 'refs' ? 'text-white border-blue-400' : 'text-gray-400 border-transparent hover:text-gray-300')}>
          References
        </button>
      </div>

      <div className="p-2 border-b border-white/10 space-y-1.5">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setShowReplace((v) => !v)}
            title="Toggle replace" className="text-gray-400 hover:text-white">
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
                title={TOGGLE_LABELS[k]} aria-label={TOGGLE_LABELS[k]} aria-pressed={opts[k]}
                className={cn('p-1 rounded border', opts[k] ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-white/10 text-gray-400 hover:text-white')}>
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

      {notice && <div className={cn('px-3 py-1.5 text-[11px] border-b border-white/5', noticeKind === 'error' ? 'text-rose-300 bg-rose-500/10' : 'text-emerald-300 bg-emerald-500/10')}>{notice}</div>}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3 text-xs text-gray-400"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Working…</div>
        ) : mode === 'text' ? (
          hits.length === 0 ? (
            <div className="p-3 text-xs text-gray-400 italic">{!q ? 'Type a query and press Enter.' : searchedFor === runKey() ? 'No matches.' : 'Press Enter or Find to search.'}</div>
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
            <div className="p-3 text-xs text-gray-400 italic">{!q ? 'Type a symbol and press Enter.' : searchedFor === runKey() ? 'No references.' : 'Press Enter or Find to search.'}</div>
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
