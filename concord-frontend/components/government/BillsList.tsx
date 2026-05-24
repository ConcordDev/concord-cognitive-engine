'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Landmark, Loader2, ExternalLink } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Bill {
  billId: string; congress?: number; type?: string; number?: number;
  title: string; introducedDate?: string;
  latestAction?: string; latestActionDate?: string;
  originChamber?: string; url?: string;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('government', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function BillsList() {
  const [topic, setTopic] = useState('');
  const [bills, setBills] = useState<Bill[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: async () => callMacro<{ bills: Bill[] }>('bills-list', { topic, limit: 25 }),
    onSuccess: (env) => {
      if (env.ok && env.result) { setBills(env.result.bills); setError(null); }
      else { setBills([]); setError(env.error || 'failed'); }
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Congress.gov Bills</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">119th congress</span>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); load.mutate(); }} className="flex items-center gap-2">
        <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic filter (optional)" className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" />
        <button type="submit" disabled={load.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {load.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Landmark className="h-3.5 w-3.5" />}
          Load recent bills
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="space-y-1.5">
        {bills.map((b) => (
          <motion.div key={b.billId} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-cyan-300">{b.type}{b.number}</span>
                  <span className="text-[10px] text-zinc-400">{b.originChamber}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-sm text-white">{b.title}</p>
                <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-zinc-400">
                  {b.introducedDate && <span>Introduced {b.introducedDate}</span>}
                  {b.latestActionDate && <span>· Last action {b.latestActionDate}</span>}
                </div>
                {b.latestAction && <p className="mt-0.5 line-clamp-2 text-[11px] italic text-zinc-400">"{b.latestAction}"</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <SaveAsDtuButton
                  compact
                  apiSource="congress-gov"
                  apiUrl={b.url}
                  title={`${b.type}${b.number} — ${b.title.slice(0, 80)}`}
                  content={`Bill: ${b.type}${b.number}\nTitle: ${b.title}\nChamber: ${b.originChamber}\nIntroduced: ${b.introducedDate}\nLatest action: ${b.latestActionDate} — ${b.latestAction}\nCongress.gov: ${b.url}`}
                  extraTags={['government', 'bill', 'congress', String(b.congress)]}
                  rawData={b}
                />
                {b.url && <a href={b.url} target="_blank" rel="noopener noreferrer" className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" aria-label="open"><ExternalLink className="h-3 w-3" /></a>}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
