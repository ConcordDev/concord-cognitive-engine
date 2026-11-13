'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Network, Loader2, MapPin } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Walker {
  id: string;
  name?: string;
  species?: string;
  speedMps?: number;
  reliability?: number;
  costPerKm?: number | string;
  /** Snake-case alias, in case a row is forwarded without camel-casing. */
  cost_per_km?: number | string;
  capacity?: number;
  specialization?: string[];
  activeContracts?: number;
  [k: string]: unknown;
}

const UNREPORTED_RATE = new Set(['', '?', '—', '-', 'n/a', 'na', 'null', 'undefined']);

/**
 * GET /api/concord-link/walkers selects id, npc_id, home_world,
 * current_world, status, reputation. There is no per-kilometre rate on
 * that row. A missing rate used to render as "?/km".
 */
export function walkerRateLabel(walker: { costPerKm?: unknown; cost_per_km?: unknown }): string {
  const raw = walker.costPerKm ?? walker.cost_per_km;
  if (typeof raw === 'number' && Number.isFinite(raw)) return `${raw}/km`;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed && !UNREPORTED_RATE.has(trimmed.toLowerCase())) return `${trimmed}/km`;
  }
  return 'not reported';
}
// The anchors endpoint returns concord_link_anchors rows verbatim:
// { id, world_id, name, access_method, description, location,
// controlled_by_faction, stability }. There are NO coordinates in the
// data model — the panel used to type the row as { label, x, y, z }
// and so rendered every anchor's id as its title and '(?, ?, ?)' as
// its values (FIX-concord-link-frontier-002).
interface Anchor {
  id: string;
  world_id?: string;
  name?: string;
  access_method?: string;
  description?: string;
  location?: string;
  controlled_by_faction?: string;
  stability?: number;
}

export function ConcordLinkWalkers() {
  const [worldId, setWorldId] = useState('concordia-hub');

  const walkers = useQuery({
    queryKey: ['concord-link-walkers', worldId],
    queryFn: async () => {
      // Scoped to the entered world, like the anchors query below: the
      // endpoint filters on home_world server-side (?homeWorld=). Without
      // it this panel showed the hub's contracts under any world id.
      const r = await api.get(`/api/concord-link/walkers?homeWorld=${encodeURIComponent(worldId)}`);
      const data = r.data as { walkers?: Walker[] } | Walker[];
      return (Array.isArray(data) ? data : data.walkers || []) as Walker[];
    },
    enabled: !!worldId.trim(),
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
    // Same 20s live refresh as the walkers query above — the header
    // bills both lists as live, but anchors never refetched after
    // mount, so the two counts drifted apart between loads
    // (FIX-concord-link-frontier-002).
    refetchInterval: 20000,
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
            content={`World: ${worldId}\n\nWalkers (${walkers.data?.length ?? 0}):\n${(walkers.data || []).slice(0, 15).map((w) => `  ${w.id} · ${w.name || w.species || w.id} · ${w.speedMps != null ? `${w.speedMps} m/s` : 'speed not reported'} · rate ${walkerRateLabel(w)} · ${w.capacity != null ? `capacity ${w.capacity}` : 'capacity not reported'}`).join('\n')}\n\nAnchors:\n${(anchors.data || []).slice(0, 15).map((a) => `  ${a.id}: ${a.name || '(unnamed)'}${a.location ? ` @ ${a.location}` : ''}${a.access_method ? ` · access ${a.access_method}` : ''}`).join('\n')}`}
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
          <div className="mb-2 text-xs font-semibold text-zinc-200">Walker contracts in {worldId} ({walkers.isPending ? '—' : (walkers.data?.length ?? 0)})</div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {(walkers.data || []).map((w) => {
              const rate = walkerRateLabel(w);
              const rateMissing = rate === 'not reported';
              return (
                <div key={w.id} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-white">{w.name || w.species || w.id}</span>
                    <span className={`font-mono ${rateMissing ? 'text-zinc-400' : 'text-cyan-300'}`} title={rateMissing ? 'This walker list does not include a per-kilometre rate.' : undefined}>{rate}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-zinc-400">
                    {w.status != null && <span>status={String(w.status)} · </span>}
                    {typeof w.reputation === 'number' && <span>rep={w.reputation} · </span>}
                    {w.current_world != null && w.current_world !== w.home_world && <span>now in {String(w.current_world)} · </span>}
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
              );
            })}
            {walkers.data?.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[10px] text-zinc-400">No walkers in this world.</div>}
          </div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200"><MapPin className="h-3.5 w-3.5 text-cyan-400" /> Anchors in {worldId} ({anchors.isPending ? '—' : (anchors.data?.length ?? 0)})</div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {(anchors.data || []).map((a) => (
              <div key={a.id} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-white">{a.name || a.id}</span>
                  {a.location && <span className="font-mono text-[10px] text-zinc-400">{a.location}</span>}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-zinc-400">
                  {a.access_method && <span>access={a.access_method} · </span>}
                  {typeof a.stability === 'number' && <span>stability={(a.stability * 100).toFixed(0)}%</span>}
                  {a.controlled_by_faction && <span> · faction={a.controlled_by_faction}</span>}
                </div>
                {a.description && <p className="mt-0.5 text-[10px] text-zinc-400">{a.description}</p>}
              </div>
            ))}
            {anchors.data?.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[10px] text-zinc-400">No anchors in this world.</div>}
          </div>
        </div>
      </div>
      {(walkers.isPending || anchors.isPending) && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Polling Concord-Link…</div>}
    </div>
  );
}
