'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Home, Loader2, MapPin } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Stats {
  address: string; matchedAddress?: string;
  coords?: { lat: number; lng: number };
  tract?: { state: string; county: string; tract: string; name: string };
  demographics?: { totalPopulation: number; medianAge: number; bachelorsOrHigherPct: number | null };
  economics?: { medianHouseholdIncome: number; medianIncomeUSD: string | null };
  housing?: Record<string, number | string | null>;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('realestate', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function NeighborhoodStats() {
  const [address, setAddress] = useState('1600 Pennsylvania Ave NW, Washington, DC');
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lookup = useMutation({
    mutationFn: async () => callMacro<Stats>('neighborhood-stats', { address: address.trim() }),
    onSuccess: (env) => { if (env.ok && env.result) { setStats(env.result); setError(null); } else { setStats(null); setError(env.error || 'lookup failed'); } },
  });
  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Home className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Neighborhood Stats</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">census acs 5-year</span>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (address.trim()) lookup.mutate(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address — '1 Apple Park Way, Cupertino, CA'" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <button type="submit" disabled={!address.trim() || lookup.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {lookup.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Home className="h-3.5 w-3.5" />}
          Lookup
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {stats && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">{stats.matchedAddress || stats.address}</h3>
              {stats.tract && <p className="text-[10px] text-zinc-400">{stats.tract.name} · tract {stats.tract.tract}, county {stats.tract.county}, state {stats.tract.state}</p>}
              {stats.coords && <p className="text-[10px] text-zinc-400">{stats.coords.lat.toFixed(4)}, {stats.coords.lng.toFixed(4)}</p>}
            </div>
            <SaveAsDtuButton
              compact
              apiSource="census-acs"
              title={`Neighborhood stats — ${stats.matchedAddress || stats.address}`}
              content={JSON.stringify(stats, null, 2)}
              extraTags={['realestate', 'demographics', 'acs', stats.tract?.state || 'us']}
              rawData={stats}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.economics?.medianHouseholdIncome != null && <Cell label="Median income" value={stats.economics.medianIncomeUSD || '—'} />}
            {stats.demographics?.totalPopulation != null && <Cell label="Population" value={stats.demographics.totalPopulation.toLocaleString()} />}
            {stats.demographics?.medianAge != null && <Cell label="Median age" value={`${stats.demographics.medianAge.toFixed(1)} yr`} />}
            {stats.demographics?.bachelorsOrHigherPct != null && <Cell label="Bachelors+" value={`${stats.demographics.bachelorsOrHigherPct.toFixed(1)}%`} />}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-cyan-300">{value}</div>
    </div>
  );
}
