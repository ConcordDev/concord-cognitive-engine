'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Network, Loader2, MapPin } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Walker { id: string; name?: string; species?: string; speedMps?: number; reliability?: number; costPerKm?: number; capacity?: number; specialization?: string[]; activeContracts?: number; [k: string]: unknown }
interface Anchor { id: string; worldId: string; label?: string; x?: number; y?: number; z?: number }

export function ConcordLinkWalkers() {
  const [worldId, setWorldId] = useState('concordia-hub');
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 20000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const walkers = useQuery({
    queryKey: ['concord-link-walkers'],
    queryFn: async () => {
      const r = await api.get('/api/concord-link/walkers');
      const data = r.data as { walkers?: Walker[] } | Walker[];
      return (Array.isArray(data) ? data : data.walkers || []) as Walker[];
    },
    refetchInterval: 20000,
  });
  const anchors = useQuery({
    queryKey: ['concord-link-anchors', worldId],
    queryFn: async () => {
      const r = await api.get(`/api/concord-link/anchors/${encodeURIComponent(worldId)}`);
      const data = r.data as { anchors?: Anchor[] } | Anchor[];
      return (Array.isArray(data) ? data : data.anchors || []) as Anchor[];
    },
    enabled: !!worldId.trim(),
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Concord-Link bridges</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/concord-link/walkers + anchors · live</span>
        </div>
        {(walkers.data || anchors.data) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-link"
            title={`Concord-Link snapshot — ${(walkers.data?.length ?? 0)} walkers · ${(anchors.data?.length ?? 0)} anchors @ ${worldId}`}
            content={`World: ${worldId}\n\nWalkers (${walkers.data?.length ?? 0}):\n${(walkers.data || []).slice(0, 15).map((w) => `  ${w.id} · ${w.name || w.species} · ${w.speedMps || '?'} m/s · cost ${w.costPerKm || '?'}/km · capacity ${w.capacity || '?'}`).join('\n')}\n\nAnchors:\n${(anchors.data || []).slice(0, 15).map((a) => `  ${a.id}: ${a.label || '(unnamed)'} @ (${a.x?.toFixed(1)}, ${a.y?.toFixed(1)})`).join('\n')}`}
            extraTags={['bridge', 'concord-link', 'walkers']}
            rawData={{ worldId, walkers: walkers.data, anchors: anchors.data }}
          />
        )}
      </header>
      <div className="flex items-center gap-2">
        <input type="text" value={worldId} onChange={(e) => setWorldId(e.target.value)} placeholder="world id (e.g. concordia-hub)" className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-white" />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 text-xs font-semibold text-zinc-200">Walker contracts ({walkers.data?.length ?? 0})</div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {(walkers.data || []).map((w) => (
              <div key={w.id} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-white">{w.name || w.species || w.id}</span>
                  <span className="font-mono text-cyan-300">{w.costPerKm ?? '?'}/km</span>
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-zinc-500">
                  {w.speedMps != null && <span>v={w.speedMps}m/s · </span>}
                  {w.reliability != null && <span>rel={(w.reliability * 100).toFixed(0)}% · </span>}
                  {w.capacity != null && <span>cap={w.capacity} · </span>}
                  {w.activeContracts != null && <span>active={w.activeContracts}</span>}
                </div>
                {w.specialization && w.specialization.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {w.specialization.slice(0, 4).map((s) => <span key={s} className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-cyan-300/80">{s}</span>)}
                  </div>
                )}
              </div>
            ))}
            {walkers.data?.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[10px] text-zinc-500">No walkers registered.</div>}
          </div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200"><MapPin className="h-3.5 w-3.5 text-cyan-400" /> Anchors in {worldId} ({anchors.data?.length ?? 0})</div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {(anchors.data || []).map((a) => (
              <div key={a.id} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-white">{a.label || a.id}</span>
                  <span className="font-mono text-[10px] text-zinc-500">({a.x?.toFixed(1) || '?'}, {a.y?.toFixed(1) || '?'}, {a.z?.toFixed(1) || '?'})</span>
                </div>
              </div>
            ))}
            {anchors.data?.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[10px] text-zinc-500">No anchors in this world.</div>}
          </div>
        </div>
      </div>
      {(walkers.isPending || anchors.isPending) && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Polling Concord-Link…</div>}
    </div>
  );
}
