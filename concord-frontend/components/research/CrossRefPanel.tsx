'use client';

/**
 * CrossRefPanel — real CrossRef DOI metadata search, drop-in for paper +
 * research lenses. No API key (polite User-Agent recommended; the server
 * sets one).
 *
 * Phase 4 (third wave) of the UX completeness sprint.
 */

import { useState, useCallback, useRef } from 'react';
import { BookText, RefreshCw, AlertTriangle, ExternalLink, Search, Quote, BookmarkPlus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface CrossRefWork {
  doi: string;
  title: string | null;
  authors: { name: string; orcid: string | null }[];
  publishedYear: number | null;
  containerTitle: string | null;
  publisher: string | null;
  type: string | null;
  subjects: string[];
  citationCount: number | null;
  url: string | null;
}

// The normalised work shape `research.academic-resolve-import` returns
// (same shape academic-search emits and academic-import consumes).
interface ResolvedWork {
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  citationCount: number | null;
  url: string | null;
  source: string | null;
}

// A DOI pasted into the search box is an identifier, not keywords —
// treating it as keywords was F1 (it matched unrelated works). Detect
// the shape panel-side and resolve it as a DOI instead; the shared
// live_crossref handler (which also serves the Paper lens) is untouched.
const DOI_SHAPE = /^(?:doi:\s*)?(?:https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i;
function doiFromQuery(q: string): string | null {
  const m = q.trim().match(DOI_SHAPE);
  return m ? m[1].replace(/[).,;]+$/, '') : null;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await lensRun({ domain, name, input });
    // lensRun() already unwraps the { ok, result } envelope one (or more)
    // levels — its own return shape is { data: { ok, result, error } }, so
    // the macro's real payload ({ ok, works, total, ... }) is r.data.result,
    // not r.data. Reading r.data directly used to silently return zero
    // results for every real CrossRef search.
    return (r?.data?.result ?? null) as T;
  } catch {
    return null;
  }
}

export interface CrossRefPanelProps {
  domain: 'paper' | 'research';
  className?: string;
}

export function CrossRefPanel({ domain, className }: CrossRefPanelProps) {
  const [query, setQuery] = useState('');
  const [works, setWorks] = useState<CrossRefWork[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [duplicates, setDuplicates] = useState<Set<string>>(new Set());
  const [resolvedWork, setResolvedWork] = useState<ResolvedWork | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedImported, setResolvedImported] = useState(false);
  const [resolvedDuplicate, setResolvedDuplicate] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (q: string) => {
    if (!q.trim()) {
      setWorks([]); setTotal(0); setResolvedWork(null); setResolveError(null); return;
    }
    // DOI-shaped query (research lens only — the resolver macro lives in
    // the research domain): resolve the exact work instead of keyword
    // search. Preview mode — nothing is filed until the user imports.
    const doi = domain === 'research' ? doiFromQuery(q) : null;
    if (doi) {
      setLoading(true);
      setError(null);
      setWorks([]); setTotal(0);
      setResolvedWork(null); setResolveError(null); setResolvedImported(false); setResolvedDuplicate(false);
      try {
        const r = await lensRun('research', 'academic-resolve-import', { identifier: doi, preview: true });
        const work = r.data?.result?.work as ResolvedWork | undefined;
        if (r.data?.ok && work) {
          setResolvedWork({ ...work, doi: work.doi || doi });
          setUpdatedAt(Math.floor(Date.now() / 1000));
        } else if (r.data?.error === 'not_found') {
          setResolveError('No reference found for that DOI in Crossref or OpenAlex.');
        } else {
          setResolveError(r.data?.message || r.data?.error || 'Could not resolve that DOI.');
        }
      } catch {
        setResolveError('Could not resolve that DOI.');
      }
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setResolvedWork(null); setResolveError(null);
    const r = await runMacro<{ ok: boolean; works?: CrossRefWork[]; total?: number; fetchedAt?: number; reason?: string }>(
      domain, 'live_crossref', { query: q, limit: 15 },
    );
    if (r?.ok) {
      setWorks(r.works || []);
      setTotal(r.total || 0);
      setUpdatedAt(r.fetchedAt || Math.floor(Date.now() / 1000));
    } else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, [domain]);

  // File one keyword-search result into the reference library
  // (research domain only — the button only renders there). CrossRef's
  // shape is mapped to the academic-import work shape field by field;
  // feeding it through raw would store null years and "[object Object]"
  // authors.
  const importWork = useCallback(async (w: CrossRefWork) => {
    try {
      const r = await lensRun('research', 'academic-import', {
        work: {
          title: w.title,
          authors: (w.authors || []).map((a) => a.name),
          year: w.publishedYear,
          venue: w.containerTitle,
          doi: w.doi,
          url: w.url,
          citationCount: w.citationCount,
          source: 'crossref',
        },
      });
      if (r.data?.ok) {
        // S3 (F8): a duplicate files nothing — say "Already in
        // library", never a false "Imported".
        if ((r.data.result as { duplicate?: boolean } | null)?.duplicate) {
          setDuplicates((prev) => new Set(prev).add(w.doi));
        } else {
          setImported((prev) => new Set(prev).add(w.doi));
        }
      }
    } catch { /* button stays enabled on failure */ }
  }, []);

  const importResolved = useCallback(async () => {
    if (!resolvedWork) return;
    try {
      const r = await lensRun('research', 'academic-import', { work: resolvedWork });
      if (r.data?.ok) {
        if ((r.data.result as { duplicate?: boolean } | null)?.duplicate) {
          setResolvedDuplicate(true);
        } else {
          setResolvedImported(true);
        }
      }
    } catch { /* button stays enabled on failure */ }
  }, [resolvedWork]);

  const onQueryChange = (next: string) => {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchData(next), 600);
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <BookText className="w-4 h-4 text-violet-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">CrossRef · DOI search</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData(query)}
          disabled={loading || !query.trim()}
          className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-zinc-800/40 relative">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Title, author, DOI…"
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
        />
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> CrossRef unreachable ({error})
        </div>
      )}

      {!error && resolveError && (
        <div className="px-3 py-6 text-xs text-zinc-400 italic text-center">{resolveError}</div>
      )}

      {!error && resolvedWork && (
        <div className="px-3 py-2.5 text-xs border-b border-zinc-800/40 bg-violet-500/5">
          <div className="flex items-start gap-2">
            <Quote className="w-3 h-3 text-zinc-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-zinc-200 font-medium leading-snug">{resolvedWork.title}</p>
              <div className="text-[10px] text-zinc-400 mt-0.5 font-mono">
                {resolvedWork.year ? `${resolvedWork.year} · ` : ''}
                {resolvedWork.venue || ''}
                {resolvedWork.doi ? ` · DOI:${resolvedWork.doi}` : ''}
                {typeof resolvedWork.citationCount === 'number' && resolvedWork.citationCount > 0 ? ` · ${resolvedWork.citationCount.toLocaleString()} cites` : ''}
              </div>
              {resolvedWork.authors.length > 0 && (
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  {resolvedWork.authors.slice(0, 4).join(', ')}
                  {resolvedWork.authors.length > 4 && ` +${resolvedWork.authors.length - 4}`}
                </div>
              )}
              <p className="text-[10px] text-violet-300/80 mt-1">
                Exact DOI match via {resolvedWork.source === 'openalex' ? 'OpenAlex' : 'Crossref'} — not a keyword search.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void importResolved()}
              disabled={resolvedImported || resolvedDuplicate}
              className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-[10px] text-violet-200 disabled:opacity-50 mt-0.5"
            >
              <BookmarkPlus className="w-2.5 h-2.5" />
              {resolvedImported ? 'Imported' : resolvedDuplicate ? 'Already in library' : 'Add to library'}
            </button>
          </div>
        </div>
      )}

      {!error && !loading && works.length === 0 && query.trim() && !resolvedWork && !resolveError && (
        <div className="px-3 py-6 text-xs text-zinc-400 italic text-center">No CrossRef works for that query.</div>
      )}

      {!error && !query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-400 italic text-center">Search 130M+ scholarly works by DOI metadata.</div>
      )}

      {works.length > 0 && (
        <ul className="divide-y divide-zinc-800/40 max-h-[600px] overflow-y-auto">
          {works.map((w) => (
            <li key={w.doi} className="px-3 py-2.5 text-xs">
              <div className="flex items-start gap-2">
                <Quote className="w-3 h-3 text-zinc-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <a
                    href={w.url || `https://doi.org/${w.doi}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-zinc-200 font-medium hover:text-violet-300 leading-snug"
                  >
                    {w.title || w.doi}
                  </a>
                  <div className="text-[10px] text-zinc-400 mt-0.5 font-mono">
                    {w.publishedYear ? `${w.publishedYear} · ` : ''}
                    {w.containerTitle || w.publisher || ''}
                    {w.doi ? ` · DOI:${w.doi}` : ''}
                    {typeof w.citationCount === 'number' && w.citationCount > 0 ? ` · ${w.citationCount.toLocaleString()} cites` : ''}
                  </div>
                  {w.authors.length > 0 && (
                    <div className="text-[10px] text-zinc-400 mt-0.5">
                      {w.authors.slice(0, 4).map(a => a.name).join(', ')}
                      {w.authors.length > 4 && ` +${w.authors.length - 4}`}
                    </div>
                  )}
                  {w.subjects.length > 0 && (
                    <div className="text-[10px] text-zinc-400 mt-0.5 truncate">{w.subjects.slice(0, 3).join(' · ')}</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0 mt-0.5">
                  {w.url && (
                    <a
                      href={w.url}
                      target="_blank" rel="noopener noreferrer"
                      className="text-zinc-400 hover:text-violet-300 text-[10px] flex items-center gap-0.5"
                      aria-label="Open work"
                    >
                      DOI<ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                  {domain === 'research' && (
                    <button
                      type="button"
                      onClick={() => void importWork(w)}
                      disabled={imported.has(w.doi) || duplicates.has(w.doi)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-[10px] text-violet-200 disabled:opacity-50"
                    >
                      <BookmarkPlus className="w-2.5 h-2.5" />
                      {imported.has(w.doi) ? 'Imported' : duplicates.has(w.doi) ? 'Already in library' : 'Add to library'}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/40">
        Source: CrossRef · {total > 0 && `${total.toLocaleString()} total · `}{updatedAt && new Date(updatedAt * 1000).toLocaleTimeString()}
      </footer>
    </section>
  );
}

export default CrossRefPanel;
