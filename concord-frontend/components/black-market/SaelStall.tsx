'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Skull, Coins, Eye } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Listing { id: string; fenceNpcId?: string; teaser?: string; price?: number; sparks?: number; messageKind?: string; interceptedAt?: string; rarity?: string; [k: string]: unknown }
interface Reputation { fenceNpcId: string; standing?: string; score?: number; purchases?: number }

export function SaelStall() {
  const [fence, setFence] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 30000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const listings = useQuery({
    queryKey: ['black-market', fence],
    queryFn: async () => {
      const r = await api.get('/api/black-market', { params: fence ? { fence } : {} });
      const data = r.data as { listings?: Listing[] };
      return data.listings || [];
    },
    refetchInterval: 30000,
  });
  const rep = useQuery({
    queryKey: ['black-market-rep'],
    queryFn: async () => {
      const r = await api.get('/api/black-market/reputation');
      const data = r.data as { reputation?: Reputation[] };
      return data.reputation || [];
    },
    refetchInterval: 60000,
  });

  const purchase = useMutation({
    mutationFn: async (listingId: string) => api.post(`/api/black-market/${listingId}/purchase`),
    onSuccess: () => { listings.refetch(); rep.refetch(); },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Skull className="h-5 w-5 text-rose-400" />
          <h2 className="text-sm font-semibold text-white">Sael's stall — black market intercepts</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/black-market · live</span>
        </div>
        {(listings.data?.length ?? 0) > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="concord-black-market"
            title={`Black market intercepts — ${listings.data?.length} listings`}
            content={(listings.data || []).slice(0, 25).map((l, i) => `${i + 1}. ${l.id} · ${l.messageKind || '?'} · ${l.sparks ?? l.price ?? '—'}✦ ${l.rarity ? `(${l.rarity})` : ''}\n   "${(l.teaser || '').slice(0, 120)}"\n   fence: ${l.fenceNpcId || '—'}`).join('\n\n')}
            extraTags={['black-market', 'concord', 'intercepts']}
            rawData={{ fence, listings: listings.data, reputation: rep.data }}
          />
        )}
      </header>
      <div className="flex items-center gap-2">
        <input type="text" value={fence} onChange={(e) => setFence(e.target.value)} placeholder="Filter by fence NPC id (empty = all)" className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-white" />
        {rep.data && rep.data.length > 0 && (
          <div className="flex flex-wrap gap-1 text-[10px]">
            {rep.data.slice(0, 4).map((r) => (
              <span key={r.fenceNpcId} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-300">{r.fenceNpcId.slice(0, 10)} · {r.standing || '?'} ({r.score ?? '-'})</span>
            ))}
          </div>
        )}
      </div>
      {listings.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Black-market unreachable.</div>}
      <div className="space-y-2 max-h-[480px] overflow-y-auto">
        {(listings.data || []).map((l) => (
          <div key={l.id} className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-rose-300">{l.id.slice(0, 8)}</span>
                  {l.messageKind && <span className="rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-300">{l.messageKind}</span>}
                  {l.rarity && <span className="rounded bg-amber-500/20 px-1 font-mono text-[10px] uppercase text-amber-200">{l.rarity}</span>}
                </div>
                <p className="mt-1 line-clamp-2 italic text-[12px] text-zinc-200">&quot;{l.teaser}&quot;</p>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-zinc-400">
                  {l.fenceNpcId && <span>fence: {l.fenceNpcId}</span>}
                  {l.interceptedAt && <span>intercepted {new Date(l.interceptedAt).toLocaleString()}</span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="font-mono text-cyan-300 text-sm">{l.sparks ?? l.price ?? '—'}✦</span>
                <button onClick={() => purchase.mutate(l.id)} disabled={purchase.isPending} className="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
                  <Coins className="h-3 w-3" /> buy
                </button>
              </div>
            </div>
          </div>
        ))}
        {listings.data && listings.data.length === 0 && !listings.isPending && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400"><Eye className="mx-auto mb-1 h-5 w-5" />No intercepts on the rack right now.</div>
        )}
      </div>
    </div>
  );
}
