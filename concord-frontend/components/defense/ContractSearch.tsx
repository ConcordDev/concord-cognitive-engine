'use client';

/**
 * ContractSearch — bespoke USAspending DoD contract search for the
 * defense lens. Backed by defense.usaspending-dod-contracts.
 *
 * Per category-leader research (USAspending, OpenTheBooks, GovSpend,
 * GovTribe, BGOV): keyword search + award-type chips + virtualized
 * award table + per-row Save-as-DTU.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Shield, Loader2, Search } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Award {
  awardId: string;
  recipient: string;
  amount: number;
  agency: string;
  subAgency?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  naicsCode?: string;
  pscCode?: string;
  placeOfPerformanceState?: string;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('defense', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const AWARD_TYPES = ['contracts', 'grants', 'loans', 'idvs'] as const;

function fmtCurrency(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function ContractSearch() {
  const [keyword, setKeyword] = useState('');
  const [awardType, setAwardType] = useState<typeof AWARD_TYPES[number]>('contracts');
  const [results, setResults] = useState<Award[]>([]);
  const [total, setTotal] = useState(0);

  const searchMutation = useMutation({
    mutationFn: async () => callMacro<{ results: Award[]; totalAmount: number }>('usaspending-dod-contracts', { keyword: keyword.trim(), awardType, limit: 30 }),
    onSuccess: (env) => {
      if (env.ok && env.result) { setResults(env.result.results); setTotal(env.result.totalAmount); }
      else { setResults([]); setTotal(0); }
    },
  });

  const submit = (e: React.FormEvent) => { e.preventDefault(); if (keyword.trim()) searchMutation.mutate(); };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">DoD Contract Search</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">usaspending.gov</span>
        </div>
      </header>

      <form onSubmit={submit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Keyword — F-35, Lockheed, missile defense…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none" />
        </div>
        <div className="flex gap-1">
          {AWARD_TYPES.map((t) => (
            <button key={t} type="button" onClick={() => setAwardType(t)} className={`rounded-full border px-2 py-1 text-[10px] uppercase ${awardType === t ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200' : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'}`}>{t}</button>
          ))}
        </div>
        <button type="submit" disabled={!keyword.trim() || searchMutation.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {searchMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>

      {results.length > 0 && (
        <>
          <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2 text-xs">
            <span className="font-mono text-cyan-300">{fmtCurrency(total)}</span> across {results.length} awards (top results, last 2 years)
          </div>
          <div className="space-y-1.5">
            {results.map((r) => (
              <motion.div key={r.awardId} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded border border-zinc-800 bg-zinc-950 p-3 transition-colors hover:border-cyan-500/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-bold text-cyan-300">{fmtCurrency(r.amount || 0)}</span>
                      <span className="truncate text-sm font-medium text-white">{r.recipient}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-400">{r.description || '(no description)'}</p>
                    <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-zinc-400">
                      <span>{r.subAgency || r.agency}</span>
                      {r.naicsCode && <span>NAICS {r.naicsCode}</span>}
                      {r.pscCode && <span>PSC {r.pscCode}</span>}
                      {r.placeOfPerformanceState && <span>POP {r.placeOfPerformanceState}</span>}
                      {r.startDate && <span>{r.startDate} → {r.endDate || '—'}</span>}
                    </div>
                  </div>
                  <SaveAsDtuButton
                    compact
                    apiSource="usaspending"
                    apiUrl={`https://www.usaspending.gov/award/${r.awardId}`}
                    title={`${r.recipient} — ${fmtCurrency(r.amount || 0)}${r.subAgency ? ` (${r.subAgency})` : ''}`}
                    content={[
                      `Award ID: ${r.awardId}`,
                      `Recipient: ${r.recipient}`,
                      `Amount: $${(r.amount || 0).toLocaleString()}`,
                      `Awarding agency: ${r.agency}${r.subAgency ? ` / ${r.subAgency}` : ''}`,
                      r.description ? `Description: ${r.description}` : '',
                      r.naicsCode ? `NAICS: ${r.naicsCode}` : '',
                      r.pscCode ? `PSC: ${r.pscCode}` : '',
                      r.placeOfPerformanceState ? `Place of performance: ${r.placeOfPerformanceState}` : '',
                      r.startDate ? `Period: ${r.startDate} → ${r.endDate}` : '',
                    ].filter(Boolean).join('\n')}
                    extraTags={['defense', 'contract', 'usaspending', r.placeOfPerformanceState?.toLowerCase() || 'us']}
                    rawData={r}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
