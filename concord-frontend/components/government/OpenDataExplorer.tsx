'use client';

import { useState } from 'react';
import { Database, Search, Loader2, ExternalLink, Stamp, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Dataset { id: string; name: string; title: string; organization: string; notes: string; resourceCount: number; firstResourceUrl: string | null; firstResourceFormat: string | null; lastModified: string | null }

interface IngestDtu {
  content: { name: string; ingestKind: string; source: { url: string | null; id: string | null }; record: Record<string, unknown> };
  metadata?: { provenance?: { sourceUrl: string | null; sourceId: string | null; contentSha256: string; fetchedAt: string } };
}
interface IngestResult { dtu: IngestDtu; readyForDtuCreate: boolean; source: string }

// Provenance-stamped ingest → real DTU. `government.open-data-ingest` fetches
// ONE real data.gov record and wraps it in a C2PA-style provenance-stamped
// envelope (sourceUrl + contentSha256 + fetchedAt) — a shared Wave-1 primitive
// (docs/NEXT_ARC_PLAN.md). Previously this macro had zero callers anywhere:
// the search results above rendered, but nothing could turn a result into a
// citable Concord DTU. This wires that path end to end: ingest (server-side
// fetch + stamp) → dtu.create (persist as a real, citable DTU carrying the
// provenance block in its meta), using only the real fetched fields — no
// invented content.
function IngestButton({ dataset }: { dataset: Dataset }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function ingest() {
    setState('busy'); setMessage(null);
    try {
      const ing = await lensRun<IngestResult>('government', 'open-data-ingest', { id: dataset.id });
      if (ing.data?.ok === false || !ing.data?.result) {
        setState('error'); setMessage(ing.data?.error || 'ingest failed'); return;
      }
      const { dtu } = ing.data.result;
      const record = dtu.content.record as { title?: string; organization?: string; notes?: string; resourceCount?: number; firstResourceUrl?: string | null };
      const provenance = dtu.metadata?.provenance;
      const contentLines = [
        record.title || dtu.content.name,
        record.organization ? `Organization: ${record.organization}` : null,
        record.notes || null,
        record.firstResourceUrl ? `Primary resource: ${record.firstResourceUrl}` : null,
        provenance ? `Source: ${provenance.sourceUrl} · fetched ${provenance.fetchedAt} · sha256 ${provenance.contentSha256.slice(0, 16)}…` : null,
      ].filter(Boolean).join('\n');
      const created = await lensRun('dtu', 'create', {
        title: record.title || dtu.content.name,
        content: contentLines,
        tags: ['open-data', 'government', 'data.gov'],
        source: 'data.gov',
        meta: { provenance, ingestKind: dtu.content.ingestKind, sourceDatasetId: dataset.id },
      });
      if (created.data?.ok === false) { setState('error'); setMessage(created.data?.error || 'dtu.create failed'); return; }
      setState('done'); setMessage('Saved as a provenance-stamped DTU.');
    } catch (e) {
      setState('error'); setMessage(e instanceof Error ? e.message : 'ingest failed');
    }
  }

  if (state === 'done') {
    return <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-300"><Check className="w-2.5 h-2.5" />{message}</span>;
  }
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <button
        onClick={ingest} disabled={state === 'busy'}
        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-40"
        title="Fetch this record from data.gov, stamp its provenance (source URL + content hash), and save it as a citable DTU"
      >
        {state === 'busy' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Stamp className="w-2.5 h-2.5" />}
        Ingest as DTU
      </button>
      {state === 'error' && <span className="text-[10px] text-rose-400">{message}</span>}
    </div>
  );
}

export function OpenDataExplorer() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Dataset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await lensRun({ domain: 'government', action: 'open-data-search', input: { query } });
      if (res.data?.ok === false) {
        setError((res.data?.error as string) || 'search failed');
        setResults([]); setTotal(0);
      } else {
        setResults((res.data?.result?.results || []) as Dataset[]);
        setTotal(res.data?.result?.total || 0);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Database className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Open data search</span>
        <span className="ml-auto text-[10px] text-gray-400">data.gov CKAN</span>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="p-3 border-b border-white/10 flex items-center gap-2">
        <Search className="w-4 h-4 text-gray-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search 300,000+ federal datasets (e.g. 'crime', 'water quality', 'permits')" className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button type="submit" disabled={loading} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Search
        </button>
      </form>
      <div className="max-h-96 overflow-y-auto p-3">
        {error && <div className="px-3 py-3 text-center text-xs text-rose-300">{error}</div>}
        {!loading && !error && results.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-gray-400"><Database className="w-6 h-6 mx-auto mb-2 opacity-30" />Search to explore federal/state/local open datasets.</div>
        )}
        {total > 0 && <div className="text-[10px] text-gray-400 mb-2">{total.toLocaleString()} matches · showing top {results.length}</div>}
        {results.length > 0 && (
          <ul className="space-y-2">
            {results.map(d => (
              <li key={d.id} className="px-3 py-2 rounded border border-white/10 bg-white/[0.03]">
                <div className="flex items-start gap-2">
                  <Database className="w-3.5 h-3.5 text-cyan-300 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white">{d.title}</div>
                    <div className="text-[10px] text-gray-400">{d.organization}{d.lastModified && ` · updated ${d.lastModified.slice(0, 10)}`}</div>
                    {d.notes && <p className="mt-1 text-[11px] text-gray-400 line-clamp-2">{d.notes}</p>}
                    {d.firstResourceUrl && (
                      <a href={d.firstResourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-cyan-300 hover:text-cyan-200">
                        <ExternalLink className="w-2.5 h-2.5" /> {d.firstResourceFormat || 'open'} · {d.resourceCount} files
                      </a>
                    )}
                    <IngestButton dataset={d} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default OpenDataExplorer;
