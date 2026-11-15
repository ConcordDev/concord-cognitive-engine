'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shield, Loader2, Server, Globe } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { publicLookup, carryLookupMeta, lookupMeta } from '@/lib/public-lookup';

interface OnionooSummary { relays_published?: string; relays?: { n: string; f: string }[]; bridges_published?: string; bridges?: { n: string; h: string }[] }
interface OnionooDetails { relays?: { nickname?: string; fingerprint?: string; flags?: string[] }[] }

export function TorNetworkStatus() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 60000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const summary = useQuery({
    queryKey: ['onionoo-summary'],
    queryFn: async () => publicLookup<OnionooSummary>('onionoo-summary', {}),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });

  const details = useQuery({
    queryKey: ['onionoo-details'],
    queryFn: async () => publicLookup<OnionooDetails>('onionoo-details', {}),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });

  const data = summary.data || {};
  const meta = lookupMeta(summary.data);
  const relayCount = data.relays?.length ?? 0;
  const bridgeCount = data.bridges?.length ?? 0;
  // FIX-anon-004: the summary payload's per-relay "f" is the FINGERPRINT, not
  // flags — splitting it counted hex letters as flags and read up to 283%.
  // Real flags live in the details document as full names, one per relay.
  const detailRelays = details.data?.relays || [];
  const flagCounts: Record<string, number> = {};
  detailRelays.forEach((r) => {
    (r.flags || []).forEach((f) => { flagCounts[f] = (flagCounts[f] || 0) + 1; });
  });
  const flagBase = detailRelays.length;
  const FLAG_LABEL: Record<string, string> = {
    Authority: 'Authority', BadExit: 'BadExit', Exit: 'Exit', Fast: 'Fast', Guard: 'Guard',
    HSDir: 'HSDir', Named: 'Named', Running: 'Running', Stable: 'Stable', Unnamed: 'Unnamed',
    Valid: 'Valid', V2Dir: 'V2Dir', NoEdConsensus: 'NoEdConsensus', StaleDesc: 'StaleDesc',
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Tor network status</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">Tor Onionoo · via Concord server</span>
        </div>
        {summary.data && (
          <SaveAsDtuButton
            compact
            apiSource="tor-onionoo"
            apiUrl="https://onionoo.torproject.org/"
            title={`Tor network — ${relayCount} relays, ${bridgeCount} bridges`}
            content={`Relays: ${relayCount} (sampled to 2000)\nBridges: ${bridgeCount}\nPublished: ${data.relays_published || '—'}\n\nFlag distribution:\n${Object.entries(flagCounts).sort((a, b) => b[1] - a[1]).map(([f, n]) => `  ${FLAG_LABEL[f] || f}: ${n}`).join('\n')}`}
            extraTags={['anon', 'tor', 'network-health']}
            rawData={{ relayCount, bridgeCount, flagCounts }}
          />
        )}
      </header>

      {summary.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Tor network data (Onionoo) is unavailable right now — nothing is being shown in its place.</div>}
      {meta?.stale && <div className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">Showing cached Tor network data{meta.fetchedAt ? ` from ${new Date(meta.fetchedAt).toLocaleString()}` : ''} — live source unavailable.</div>}
      {summary.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling onionoo…</div>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="Relays" value={relayCount.toLocaleString()} icon={Server} />
        <Cell label="Bridges" value={bridgeCount.toLocaleString()} icon={Shield} />
        <Cell label="Exit nodes" value={(flagCounts.Exit ?? 0).toLocaleString()} icon={Globe} />
        <Cell label="Guard nodes" value={(flagCounts.Guard ?? 0).toLocaleString()} icon={Shield} />
      </div>

      {Object.keys(flagCounts).length > 0 && (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 text-xs font-semibold text-zinc-200">Flag distribution (sampled relays)</div>
          <div className="space-y-1">
            {Object.entries(flagCounts).sort((a, b) => b[1] - a[1]).map(([f, n]) => {
              const pct = flagBase > 0 ? Math.min(100, (n / flagBase) * 100) : 0;
              return (
                <div key={f} className="flex items-center gap-2 text-[11px]">
                  <span className="w-24 font-mono text-zinc-400">{FLAG_LABEL[f] || f}</span>
                  <div className="flex-1 rounded-full bg-zinc-800">
                    <div className="h-2 rounded-full bg-cyan-500/60" style={{ width: `${Math.max(2, pct)}%` }} />
                  </div>
                  <span className="w-16 text-right font-mono text-cyan-300">{n}</span>
                  <span className="w-12 text-right text-zinc-400">{pct.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400">{Icon && <Icon className="h-3 w-3" />}{label}</div>
      <div className="mt-0.5 font-mono text-lg text-cyan-300">{value}</div>
    </div>
  );
}
