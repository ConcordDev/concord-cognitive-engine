'use client';

// Phase AB — Village Gossip Feed.
//
// Floating panel (collapsed by default) that surfaces recent NPC↔NPC
// relationship events from the nemesis-cycle. Mounts in /lenses/world
// alongside DistrictActivityFeed. Reads from
// GET /api/worlds/:worldId/npc-relationships/gossip-feed.

import { useState, useEffect, useCallback } from 'react';
import { Skull, Users, ChevronDown, ChevronUp, Filter } from 'lucide-react';

interface GossipEntry {
  event_id: string;
  relationship_id: string;
  event_kind: string;
  summary: string;
  ts: number;
  npc_a_id: string;
  npc_b_id: string;
  relationship_kind: string;
  intensity: number;
}

interface VillageGossipFeedProps {
  worldId: string;
}

const RELATIONSHIP_KINDS = [
  'rival', 'mentor', 'apprentice', 'blood_brother',
  'family_enemy', 'spy', 'bodyguard', 'former_lover', 'debt_holder',
] as const;

type KindFilter = typeof RELATIONSHIP_KINDS[number] | 'all';

function timeAgo(ts: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export function VillageGossipFeed({ worldId }: VillageGossipFeedProps) {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<GossipEntry[]>([]);
  const [filter, setFilter] = useState<KindFilter>('all');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!worldId) return;
    setLoading(true);
    fetch(`/api/worlds/${worldId}/npc-relationships/gossip-feed?limit=50`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.entries) setEntries(d.entries);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [worldId]);

  useEffect(() => {
    if (!expanded) return;
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [expanded, refresh]);

  const filtered = filter === 'all'
    ? entries
    : entries.filter((e) => e.relationship_kind === filter);

  return (
    <div className="fixed bottom-4 right-4 z-30 max-w-sm rounded-lg border border-amber-600/40 bg-zinc-900/95 text-zinc-100 shadow-xl backdrop-blur">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-t-lg px-3 py-2 hover:bg-zinc-800/60"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <Users size={14} className="text-amber-400" />
          Village Gossip
          {!expanded && entries.length > 0 && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
              {entries.length}
            </span>
          )}
        </span>
        {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>

      {expanded && (
        <div className="border-t border-zinc-800/80 px-3 py-2">
          <div className="mb-2 flex items-center gap-1 overflow-x-auto text-xs">
            <Filter size={10} className="text-zinc-500" />
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`rounded px-1.5 py-0.5 ${filter === 'all' ? 'bg-amber-500/30 text-amber-200' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              all
            </button>
            {RELATIONSHIP_KINDS.map((k) => (
              <button
                type="button"
                key={k}
                onClick={() => setFilter(k)}
                className={`whitespace-nowrap rounded px-1.5 py-0.5 ${filter === k ? 'bg-amber-500/30 text-amber-200' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                {k.replace(/_/g, ' ')}
              </button>
            ))}
          </div>

          <div className="max-h-72 space-y-1.5 overflow-y-auto text-xs">
            {loading && entries.length === 0 && (
              <div className="py-4 text-center text-zinc-500">Listening…</div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="py-4 text-center text-zinc-500">No gossip yet.</div>
            )}
            {filtered.map((e) => (
              <div key={e.event_id} className="rounded border border-zinc-800 bg-zinc-900/60 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-amber-300">
                    {e.relationship_kind === 'rival' && <Skull size={10} />}
                    {e.relationship_kind.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[10px] text-zinc-500">{timeAgo(e.ts)}</span>
                </div>
                <div className="mt-1 text-zinc-300">{e.summary}</div>
                <div className="mt-1 text-[10px] text-zinc-500">
                  {e.npc_a_id} ↔ {e.npc_b_id}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
