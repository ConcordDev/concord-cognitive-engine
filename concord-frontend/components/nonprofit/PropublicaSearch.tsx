'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Heart, Loader2, ExternalLink } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Org { ein: string; name: string; city?: string; state?: string; nteeCode?: string; score?: number; rulingYear?: number }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('nonprofit', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function PropublicaSearch() {
  const [query, setQuery] = useState('');
  const [state, setState] = useState('');
  const [orgs, setOrgs] = useState<Org[]>([]);
  const search = useMutation({
    mutationFn: async () => callMacro<{ orgs: Org[] }>('search-orgs', state ? { query: query.trim(), state } : { query: query.trim() }),
    onSuccess: (env) => { if (env.ok && env.result) setOrgs(env.result.orgs); else setOrgs([]); },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Nonprofit Explorer</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">propublica · 1.8M filings</span>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (query.trim().length >= 3) search.mutate(); }} className="flex items-center gap-2">
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Organization name — Red Cross, MoMA, MSF…" className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-white" />
        <input type="text" maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} placeholder="State" className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono uppercase text-xs text-white" />
        <button type="submit" disabled={query.trim().length < 3 || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Heart className="h-3.5 w-3.5" />}
          Search 990s
        </button>
      </form>
      <div className="space-y-1.5">
        {orgs.map((o) => (
          <motion.div key={o.ein} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 rounded border border-zinc-800 bg-zinc-950 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-white">{o.name}</span>
                <span className="font-mono text-[10px] text-zinc-400">EIN {o.ein}</span>
                {o.nteeCode && <span className="rounded bg-zinc-800 px-1.5 text-[9px] font-mono text-cyan-300">NTEE {o.nteeCode}</span>}
              </div>
              <div className="text-[11px] text-zinc-400">
                {o.city ? `${o.city}, ` : ''}{o.state}{o.rulingYear ? ` · 501(c)(3) since ${o.rulingYear}` : ''}
              </div>
            </div>
            <SaveAsDtuButton
              compact
              apiSource="propublica-nonprofit-explorer"
              apiUrl={`https://projects.propublica.org/nonprofits/organizations/${o.ein.replace(/-/g, '')}`}
              title={`${o.name} — EIN ${o.ein}`}
              content={`Organization: ${o.name}\nEIN: ${o.ein}\nLocation: ${o.city}, ${o.state}\nNTEE: ${o.nteeCode}\n501(c)(3) ruling year: ${o.rulingYear}\nProPublica: https://projects.propublica.org/nonprofits/organizations/${o.ein.replace(/-/g, '')}`}
              extraTags={['nonprofit', '990', 'propublica', o.state?.toLowerCase() || 'us']}
              rawData={o}
            />
            <a href={`https://projects.propublica.org/nonprofits/organizations/${o.ein.replace(/-/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"><ExternalLink className="h-3 w-3" /></a>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
