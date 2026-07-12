'use client';

/**
 * RecapDocketSearch — real federal docket / filing search via CourtListener's
 * RECAP Archive, wired to `law.recap-docket-search` (+ `law.recap-docket-documents`
 * to page a docket's full filing list). Separately scoped from the case-law
 * opinion search above (`law.courtlistener-search` / LegalCaseSearch) per
 * docs/WAVE4_INVENTORY.md's "law: No RECAP/PACER docket search" gap.
 *
 * RECAP hosts millions of PACER docket entries + documents "bought once,
 * freed for everyone" by the RECAP browser-extension community — no PACER
 * login needed to search or read what's already in the archive. What it does
 * NOT do is buy documents that were never RECAP'd — those stay PACER-only.
 *
 * Honesty is the whole point of this panel: every filing card carries an
 * explicit tier —
 *   • "Free in RECAP"           → freelyAvailable === true
 *   • "PACER purchase required" → freelyAvailable === false
 *   • "Availability unknown"    → freelyAvailable === null (API omitted the
 *                                  field; never guessed either way)
 * Concord performs no PACER purchase on the user's behalf — a
 * paid-only/unknown filing links out to CourtListener/PACER rather than
 * pretending to be fetched.
 */

import { useState } from 'react';
import {
  Gavel, Loader2, Search, ExternalLink, Calendar, Scale, ChevronDown, ChevronRight,
  FileText, Lock, HelpCircle, CheckCircle2,
} from 'lucide-react';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { EmptyState } from '@/components/ui';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

interface RecapDocument {
  id: number | null;
  description: string | null;
  documentNumber: number | null;
  attachmentNumber: number | null;
  freelyAvailable: boolean | null;
  documentUrl: string | null;
  pageCount?: number | null;
}

interface DocketHit {
  docketId: number | null;
  caseName: string | null;
  court: string | null;
  courtId: string | null;
  docketNumber: string | null;
  dateFiled: string | null;
  dateTerminated: string | null;
  assignedTo: string | null;
  suitNature: string | null;
  absoluteUrl: string | null;
  documentCount: number;
  moreDocsAvailable: boolean;
  documents: RecapDocument[];
}

interface DocketSearchResult {
  query: string;
  results: DocketHit[];
  count: number;
  totalHits: number | null;
  authenticatedWithToken: boolean;
  source: string;
  disclosure: string;
}

interface DocumentPage {
  docketId: number;
  documents: RecapDocument[];
  count: number;
  totalHits: number | null;
}

const QUICK_COURTS = [
  { id: 'scotus', label: 'Supreme Court' },
  { id: 'cafc', label: 'Fed Cir' },
  { id: 'cand', label: 'N.D. Cal' },
  { id: 'nysd', label: 'S.D.N.Y.' },
  { id: 'dcd', label: 'D.D.C.' },
];

function AvailabilityBadge({ available }: { available: boolean | null }) {
  if (available === true) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-emerald-300">
        <CheckCircle2 className="h-2.5 w-2.5" /> Free in RECAP
      </span>
    );
  }
  if (available === false) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-300">
        <Lock className="h-2.5 w-2.5" /> PACER purchase required
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-gray-400">
      <HelpCircle className="h-2.5 w-2.5" /> Availability unknown
    </span>
  );
}

function DocumentRow({ doc }: { doc: RecapDocument }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-white/5 bg-black/20 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs text-gray-200">
          <FileText className="h-3 w-3 shrink-0 text-gray-500" />
          <span className="truncate">
            {doc.documentNumber != null && <span className="mr-1 font-mono text-gray-400">#{doc.documentNumber}{doc.attachmentNumber ? `-${doc.attachmentNumber}` : ''}</span>}
            {doc.description || 'Untitled filing'}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <AvailabilityBadge available={doc.freelyAvailable} />
        {doc.freelyAvailable && doc.documentUrl && (
          <a
            href={doc.documentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-white/10 hover:text-gray-200"
            title="Open document (free, RECAP)"
            aria-label="Open document"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function DocketCard({ hit }: { hit: DocketHit }) {
  const [expanded, setExpanded] = useState(false);
  const docsFeedback = useMacroDispatchFeedback<DocumentPage>();

  const loadAllDocs = async () => {
    setExpanded((v) => !v);
    if (!expanded && hit.moreDocsAvailable && hit.docketId && docsFeedback.status === 'idle') {
      await docsFeedback.dispatch('law', 'recap-docket-documents', { docketId: hit.docketId, limit: 50 });
    }
  };

  const shownDocuments = (docsFeedback.result?.documents?.length ? docsFeedback.result.documents : hit.documents);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 transition-colors hover:border-indigo-500/30">
      <div className="flex items-start gap-3">
        <Gavel className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400/80" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-sm font-semibold text-white">{hit.caseName || 'Untitled docket'}</h3>
            {hit.docketNumber && <span className="font-mono text-[11px] text-indigo-300/80">{hit.docketNumber}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-zinc-400">
            {hit.court && <span>{hit.court}</span>}
            {hit.dateFiled && (
              <span className="flex items-center gap-1"><Calendar className="h-2.5 w-2.5" />filed {hit.dateFiled}</span>
            )}
            {hit.dateTerminated && <span className="text-zinc-500">terminated {hit.dateTerminated}</span>}
            {hit.assignedTo && <span>Judge: {hit.assignedTo}</span>}
            {hit.suitNature && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-400">{hit.suitNature}</span>
            )}
          </div>

          {hit.documents.length > 0 && (
            <div className="mt-2 space-y-1">
              {(expanded ? shownDocuments : hit.documents).map((doc, i) => (
                <DocumentRow key={doc.id ?? i} doc={doc} />
              ))}
              {docsFeedback.status === 'dispatched' && (
                <p className="flex items-center gap-1.5 text-[10px] text-zinc-500"><Loader2 className="h-2.5 w-2.5 animate-spin" /> Loading full filing list…</p>
              )}
              {docsFeedback.status === 'error' && (
                <p className="text-[10px] text-rose-400">{docsFeedback.error}</p>
              )}
            </div>
          )}
          {hit.moreDocsAvailable && (
            <button
              type="button"
              onClick={loadAllDocs}
              className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-indigo-300 hover:text-indigo-200"
            >
              {expanded ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
              {expanded ? 'Hide' : 'Load all filings for this docket'}
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <SaveAsDtuButton
            compact
            apiSource="courtlistener-recap"
            apiUrl={hit.absoluteUrl || `https://www.courtlistener.com/?q=${encodeURIComponent(hit.docketNumber || hit.caseName || '')}`}
            title={`${hit.caseName || 'Docket'}${hit.docketNumber ? ` · ${hit.docketNumber}` : ''}`}
            content={[
              hit.caseName ? `Case: ${hit.caseName}` : '',
              hit.docketNumber ? `Docket: ${hit.docketNumber}` : '',
              hit.court ? `Court: ${hit.court}` : '',
              hit.dateFiled ? `Filed: ${hit.dateFiled}` : '',
              hit.dateTerminated ? `Terminated: ${hit.dateTerminated}` : '',
              hit.assignedTo ? `Assigned to: ${hit.assignedTo}` : '',
              hit.suitNature ? `Nature of suit: ${hit.suitNature}` : '',
              '',
              'Filings (source: RECAP Archive — free-vs-PACER status per document):',
              ...hit.documents.map((d) =>
                `  #${d.documentNumber ?? '?'} ${d.description || 'Untitled'} — ${
                  d.freelyAvailable === true ? 'free in RECAP' : d.freelyAvailable === false ? 'PACER purchase required' : 'availability unknown'
                }`
              ),
              '',
              hit.absoluteUrl ? `Full docket: ${hit.absoluteUrl}` : '',
            ].filter(Boolean).join('\n')}
            extraTags={['law', 'recap', 'docket', hit.courtId || 'court']}
            rawData={hit}
          />
          {hit.absoluteUrl && (
            <a
              href={hit.absoluteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              title="Open full docket on CourtListener"
              aria-label="Open docket"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function RecapDocketSearch() {
  const [queryInput, setQueryInput] = useState('');
  const [docketNumberInput, setDocketNumberInput] = useState('');
  const [court, setCourt] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const { status, error, result, dispatch } = useMacroDispatchFeedback<DocketSearchResult>();
  const busy = status === 'dispatched' || status === 'running';

  const runSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = queryInput.trim();
    const dn = docketNumberInput.trim();
    if (!q && !dn) return;
    const params: Record<string, unknown> = { limit: 20 };
    if (q) params.query = q;
    if (dn) params.docketNumber = dn;
    if (court.trim()) params.court = court.trim();
    await dispatch('law', 'recap-docket-search', params);
  };

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <header className="flex items-center justify-between gap-3 border-b border-indigo-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-indigo-400" />
          <h2 className="text-sm font-semibold text-white">Docket &amp; Filing Search</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            RECAP Archive — free PACER filings
          </span>
        </div>
        {result && (
          <span className="text-[11px] text-zinc-400">
            {result.results.length} of {result.totalHits?.toLocaleString() ?? '?'} dockets
            {result.authenticatedWithToken && <span className="ml-2 text-indigo-300/80">· authenticated</span>}
          </span>
        )}
      </header>

      <form onSubmit={runSearch} className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Case name — United States v. …"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white placeholder-zinc-600 focus:border-indigo-500/40 focus:outline-none"
            />
          </div>
          <input
            type="text"
            value={docketNumberInput}
            onChange={(e) => setDocketNumberInput(e.target.value)}
            placeholder="or docket # — 3:24-cv-01234"
            className="w-48 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-indigo-500/40 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
              court || showFilters
                ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300'
                : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
            )}
          >
            Court
            <ChevronDown className={cn('h-3 w-3 transition-transform', showFilters && 'rotate-180')} />
          </button>
          <button
            type="submit"
            disabled={busy || (!queryInput.trim() && !docketNumberInput.trim())}
            className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Search
          </button>
        </div>

        {showFilters && (
          <div className="flex flex-wrap gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/40 p-2">
            <button
              type="button"
              onClick={() => setCourt('')}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                court === '' ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-200' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-indigo-500/30'
              )}
            >
              All courts
            </button>
            {QUICK_COURTS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCourt(c.id)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                  court === c.id ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-200' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-indigo-500/30'
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </form>

      {status === 'error' && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300" role="alert">{error}</div>
      )}

      {status !== 'done' && !busy && status !== 'error' && (
        <EmptyState
          compact
          icon={<Gavel className="h-5 w-5" aria-hidden="true" />}
          title="Search federal dockets already freed from PACER."
          description="Live query against CourtListener's RECAP Archive. Each filing is tagged free-in-RECAP, PACER-purchase-required, or availability-unknown — never guessed."
          ariaLabel="Docket search empty"
        />
      )}

      {result && result.results.length === 0 && status === 'done' && (
        <EmptyState compact title="No dockets matched." description="Try a broader case name, drop the court filter, or search by docket number." ariaLabel="No docket results" />
      )}

      {result && result.results.length > 0 && (
        <div className="space-y-2">
          {result.results.map((hit) => (
            <DocketCard key={hit.docketId ?? `${hit.caseName}-${hit.docketNumber}`} hit={hit} />
          ))}
          <p className="text-[10px] text-zinc-500">{result.disclosure}</p>
        </div>
      )}
    </div>
  );
}
