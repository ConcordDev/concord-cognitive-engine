'use client';

/**
 * WebResearchTool — live web research over tools.research (DuckDuckGo
 * Instant Answer + Wikipedia OpenSearch, free no-key APIs). Renders a
 * readable result list with sources/snippets, keeps a per-user search
 * history (tools.research-history / tools.research-clear) and can cite a
 * result into a DTU.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Search, Loader2, ExternalLink, History, Trash2, BookmarkPlus, Globe } from 'lucide-react';

interface ResearchResult {
  title: string;
  snippet: string;
  url: string;
  source: string;
}
interface ResearchAbstract { text: string; source: string; url: string }
interface ResearchPayload {
  query: string;
  abstract: ResearchAbstract | null;
  results: ResearchResult[];
  count: number;
  sources: string[];
}
interface HistoryItem { id: string; query: string; resultCount: number; at: string; topUrl: string }

export function WebResearchTool() {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [payload, setPayload] = useState<ResearchPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [citing, setCiting] = useState<string | null>(null);
  const [cited, setCited] = useState<Record<string, string>>({});

  const loadHistory = useCallback(async () => {
    const r = await lensRun<{ history: HistoryItem[]; total: number }>('tools', 'research-history', { limit: 20 });
    if (r.data?.ok && r.data.result) setHistory(r.data.result.history);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadHistory(); }, []);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    const r = await lensRun<ResearchPayload>('tools', 'research', { query: trimmed, limit: 12 });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setPayload(r.data.result);
      loadHistory();
    } else {
      setPayload(null);
      setError(r.data?.error || 'search failed');
    }
  }, [loadHistory]);

  const clearHistory = useCallback(async () => {
    const r = await lensRun('tools', 'research-clear', {});
    if (r.data?.ok) setHistory([]);
  }, []);

  const citeResult = useCallback(async (res: ResearchResult) => {
    setCiting(res.url);
    const r = await lensRun<{ dtu?: { id?: string } }>('dtu', 'create', {
      title: res.title.slice(0, 140),
      creti: `${res.snippet}\n\nSource: ${res.source} — ${res.url}`,
      tags: ['web-research', res.source.toLowerCase()],
      source: 'tools.research',
      meta: { sourceUrl: res.url, sourceName: res.source, query: payload?.query },
    });
    setCiting(null);
    const newId = r.data?.result?.dtu?.id;
    if (r.data?.ok && newId) {
      setCited((prev) => ({ ...prev, [res.url]: newId }));
    }
  }, [payload]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-yellow-900/40 bg-yellow-950/10 p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-yellow-300">
          <Globe className="h-4 w-4" aria-hidden /> Web research
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(query); }}
            placeholder="Search the live web — DuckDuckGo + Wikipedia"
            className="flex-1 rounded border border-yellow-900/40 bg-black/40 px-2 py-1.5 font-mono text-sm text-yellow-100 focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500"
            aria-label="Web query"
          />
          <button
            onClick={() => runSearch(query)}
            disabled={!query.trim() || busy}
            className="inline-flex items-center gap-2 rounded bg-yellow-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-yellow-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Search
          </button>
        </div>
      </div>

      {busy && (
        <div role="status" aria-live="polite" className="flex items-center gap-2 rounded border border-yellow-900/40 bg-yellow-950/10 px-3 py-2 text-sm text-yellow-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching the live web…
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          <span>{error}</span>
          <button
            onClick={() => runSearch(query)}
            disabled={!query.trim() || busy}
            className="shrink-0 rounded border border-red-800/60 px-2 py-0.5 text-xs text-red-200 hover:bg-red-900/40 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            Retry
          </button>
        </div>
      )}

      {!busy && !error && !payload && (
        <div className="rounded-lg border border-dashed border-yellow-900/40 bg-yellow-950/5 px-3 py-8 text-center text-sm text-yellow-700">
          Search the live web across DuckDuckGo + Wikipedia — results are readable and citable into a DTU.
        </div>
      )}

      {payload && (
        <div className="space-y-3">
          {payload.abstract && (
            <div className="rounded-lg border border-yellow-700/50 bg-yellow-900/10 p-3">
              <p className="text-sm text-yellow-100">{payload.abstract.text}</p>
              <a
                href={payload.abstract.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-yellow-500 hover:text-yellow-300"
              >
                {payload.abstract.source} <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-yellow-700">
            <span>{payload.count} results for &quot;{payload.query}&quot;</span>
            <span>Sources: {payload.sources.join(', ')}</span>
          </div>
          <ul className="space-y-2">
            {payload.results.map((res) => (
              <li key={res.url} className="rounded-lg border border-yellow-900/40 bg-black/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <a
                      href={res.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-yellow-200 hover:text-yellow-100"
                    >
                      {res.title} <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                    </a>
                    <p className="mt-1 text-xs leading-relaxed text-yellow-400/80">{res.snippet}</p>
                    <span className="mt-1 inline-block rounded bg-yellow-950/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-yellow-600">
                      {res.source}
                    </span>
                  </div>
                  <button
                    onClick={() => citeResult(res)}
                    disabled={citing === res.url || !!cited[res.url]}
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-yellow-800/60 px-2 py-1 text-xs text-yellow-400 hover:bg-yellow-900/30 disabled:opacity-50"
                  >
                    {citing === res.url
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <BookmarkPlus className="h-3 w-3" aria-hidden />}
                    {cited[res.url] ? 'Cited' : 'Cite → DTU'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.length > 0 && (
        <div className="rounded-lg border border-yellow-900/30 bg-yellow-950/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-yellow-500">
              <History className="h-3.5 w-3.5" aria-hidden /> Search history
            </h4>
            <button
              onClick={clearHistory}
              className="inline-flex items-center gap-1 text-[11px] text-yellow-700 hover:text-yellow-400"
            >
              <Trash2 className="h-3 w-3" aria-hidden /> Clear
            </button>
          </div>
          <ul className="space-y-1">
            {history.map((h) => (
              <li key={h.id}>
                <button
                  onClick={() => { setQuery(h.query); runSearch(h.query); }}
                  className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs text-yellow-400 hover:bg-yellow-900/20"
                >
                  <span className="truncate">{h.query}</span>
                  <span className="ml-2 shrink-0 text-yellow-700">{h.resultCount} hits</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
