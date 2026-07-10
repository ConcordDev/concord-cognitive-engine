'use client';

/**
 * PatentSearch — real US patent search via USPTO PatentsView, wired to
 * `law.uspto-patent-search`. Free, no API key. This macro previously had
 * ZERO frontend callers anywhere in the repo — this is its first surface.
 */

import { useState } from 'react';
import { Lightbulb, Loader2, Search, ExternalLink, Calendar, Building2, Users } from 'lucide-react';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { EmptyState } from '@/components/ui';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

type Field = 'title' | 'abstract' | 'inventor' | 'assignee';

interface Patent {
  patentId: string;
  title: string;
  abstract: string | null;
  grantDate: string | null;
  inventors: string[];
  assignees: string[];
}
interface PatentSearchResult {
  query: string;
  field: Field;
  patents: Patent[];
  count: number;
  totalHits: number | null;
  source: string;
}

const FIELDS: { id: Field; label: string }[] = [
  { id: 'title', label: 'Title' },
  { id: 'abstract', label: 'Abstract' },
  { id: 'inventor', label: 'Inventor' },
  { id: 'assignee', label: 'Assignee' },
];

export function PatentSearch() {
  const [query, setQuery] = useState('');
  const [field, setField] = useState<Field>('title');
  const { status, error, result, dispatch } = useMacroDispatchFeedback<PatentSearchResult>();
  const busy = status === 'dispatched' || status === 'running';

  async function search() {
    const q = query.trim();
    if (!q) return;
    await dispatch('law', 'uspto-patent-search', { query: q, field, limit: 25 });
  }

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <div className="flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-amber-300" />
        <h2 className="font-semibold text-white">Patent Search</h2>
        <span className="text-[10px] text-gray-400">USPTO PatentsView · free, no key</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
          placeholder="neural network training · Acme Corp · Jane Doe…"
          className={cn(ds.input, 'flex-1 min-w-[200px] text-sm py-1.5')}
        />
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Search field">
          {FIELDS.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={field === f.id}
              onClick={() => setField(f.id)}
              className={cn(
                'text-[10px] px-2 py-1 rounded border font-medium transition-colors',
                field === f.id ? 'bg-amber-400/20 border-amber-400/40 text-amber-300' : 'bg-gray-500/10 border-gray-500/30 text-gray-400 hover:bg-white/5'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={search}
          disabled={busy || !query.trim()}
          className="px-3 py-1.5 text-xs rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Search
        </button>
      </div>

      {status === 'error' && <p className="text-xs text-rose-400" role="alert">{error}</p>}

      {status !== 'done' && !busy && !error && (
        <EmptyState
          compact
          icon={<Lightbulb className="h-5 w-5" aria-hidden="true" />}
          title="Search granted US patents."
          description="Live query against USPTO PatentsView by title, abstract, inventor, or assignee."
          ariaLabel="Patent search empty"
        />
      )}

      {result && result.patents.length === 0 && status === 'done' && (
        <EmptyState compact title={`No patents matched "${result.query}".`} description="Try a broader term or a different field." ariaLabel="No patent results" />
      )}

      {result && result.patents.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] text-gray-400">
            {result.count} of {result.totalHits?.toLocaleString() ?? '?'} patents
          </p>
          {result.patents.map((p) => (
            <div key={p.patentId} className="bg-black/40 border border-white/10 rounded-lg p-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h3 className="text-sm font-semibold text-white">{p.title || 'Untitled patent'}</h3>
                    <span className="font-mono text-[11px] text-amber-300/80">US {p.patentId}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-gray-400">
                    {p.grantDate && <span className="flex items-center gap-1"><Calendar className="h-2.5 w-2.5" />{p.grantDate}</span>}
                    {p.inventors.length > 0 && <span className="flex items-center gap-1"><Users className="h-2.5 w-2.5" />{p.inventors.slice(0, 3).join(', ')}</span>}
                    {p.assignees.length > 0 && <span className="flex items-center gap-1"><Building2 className="h-2.5 w-2.5" />{p.assignees.slice(0, 2).join(', ')}</span>}
                  </div>
                  {p.abstract && <p className="mt-1.5 line-clamp-2 text-xs text-gray-300">{p.abstract}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <SaveAsDtuButton
                    compact
                    apiSource="uspto-patentsview"
                    apiUrl={`https://search.patentsview.org/api/v1/patent/?q=${encodeURIComponent(JSON.stringify({ patent_id: p.patentId }))}`}
                    title={`US ${p.patentId} — ${p.title}`}
                    content={[
                      `Patent: US ${p.patentId}`,
                      `Title: ${p.title}`,
                      p.grantDate ? `Granted: ${p.grantDate}` : '',
                      p.inventors.length ? `Inventors: ${p.inventors.join('; ')}` : '',
                      p.assignees.length ? `Assignees: ${p.assignees.join('; ')}` : '',
                      '',
                      p.abstract ? `Abstract:\n${p.abstract}` : '',
                    ].filter(Boolean).join('\n')}
                    extraTags={['law', 'patent', 'uspto']}
                    rawData={p}
                  />
                  <a
                    href={`https://patents.google.com/?q=${encodeURIComponent(p.patentId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-200"
                    title="Open on Google Patents"
                    aria-label="Open on Google Patents"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
