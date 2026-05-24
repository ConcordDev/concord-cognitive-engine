'use client';

/**
 * ContractRepositorySearch — full-text search across every contract the
 * user owns: titles, counterparties, and the full text of every clause.
 * Backlog item 7. Wires law.repository-search.
 */

import { useState } from 'react';
import { Search, Loader2, FileText } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Hit { field: string; clauseTitle?: string; snippet: string }
interface SearchResult {
  contractId: string; contractTitle: string; status: string; type: string;
  matchCount: number; hits: Hit[];
}
interface SearchResponse {
  query: string; keywords: string[]; contractsSearched: number;
  matchingContracts: number; results: SearchResult[];
}

export function ContractRepositorySearch({ onOpen }: { onOpen?: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<SearchResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    const q = query.trim();
    if (q.length < 2) { setErr('Enter at least 2 characters.'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun('law', 'repository-search', { query: q });
    setBusy(false);
    if (r.data?.ok) { setResp(r.data.result as SearchResponse); }
    else { setErr(r.data?.error || 'Search failed.'); setResp(null); }
  }

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <Search className="w-4 h-4 text-neon-purple" />
        <h2 className="font-semibold text-white">Contract Repository Search</h2>
        <span className="text-[10px] text-gray-400">full-text across all clauses</span>
      </div>
      <div className="flex gap-2 mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
          placeholder="Search every contract — indemnify, termination, NY law…"
          className="flex-1 bg-black/50 border border-white/15 rounded px-2.5 py-1.5 text-sm text-white"
        />
        <button onClick={run} disabled={busy}
          className="px-3 py-1.5 text-xs rounded bg-neon-purple/20 text-neon-purple hover:bg-neon-purple/30 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
          Search
        </button>
      </div>
      {err && <p className="text-xs text-rose-400 mb-2">{err}</p>}
      {resp && (
        <div className="space-y-2">
          <p className="text-[11px] text-gray-400">
            {resp.matchingContracts} of {resp.contractsSearched} contracts match &quot;{resp.query}&quot;
          </p>
          {resp.results.length === 0 && (
            <p className="text-xs text-gray-400 italic py-3 text-center">No matching contracts.</p>
          )}
          {resp.results.map((res) => (
            <div key={res.contractId} className="bg-black/40 border border-white/10 rounded-lg p-2.5">
              <button
                onClick={() => onOpen?.(res.contractId)}
                className="flex items-center gap-1.5 text-left w-full mb-1.5">
                <FileText className="w-3.5 h-3.5 text-neon-cyan shrink-0" />
                <span className="text-xs font-semibold text-white flex-1 truncate hover:text-neon-cyan">{res.contractTitle}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-gray-400">{res.status}</span>
                <span className="text-[9px] text-gray-400">{res.matchCount} hit{res.matchCount !== 1 ? 's' : ''}</span>
              </button>
              <div className="space-y-1 pl-5">
                {res.hits.map((h, i) => (
                  <p key={i} className="text-[10px] text-gray-400">
                    <span className="text-neon-purple uppercase tracking-wide mr-1">
                      {h.field === 'clause' ? (h.clauseTitle || 'clause') : h.field}
                    </span>
                    {h.snippet}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
