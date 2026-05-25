'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Bot, Loader2, Play, Search, Plus, Activity } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Agent { id: string; name?: string; type?: string; status?: string; enabled?: boolean; lastTickAt?: string; ticks?: number; config?: Record<string, unknown>; createdAt?: string }
interface AgentStatus { total?: number; active?: number; idle?: number; [k: string]: unknown }

export function AgentRoster() {
  const [researchTopic, setResearchTopic] = useState('');
  const [tickingId, setTickingId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['agents-list'],
    queryFn: async () => {
      const r = await apiHelpers.agents.list();
      const data = r.data as { agents?: Agent[] } | Agent[];
      return (Array.isArray(data) ? data : data.agents || []) as Agent[];
    },
    refetchInterval: 6000,
  });
  const status = useQuery({
    queryKey: ['agents-status'],
    queryFn: async () => (await apiHelpers.agents.status()).data as AgentStatus,
    refetchInterval: 6000,
  });

  const spawn = useMutation({
    mutationFn: async (topic: string) => apiHelpers.agents.spawnResearch(topic),
    onSuccess: () => { setResearchTopic(''); list.refetch(); status.refetch(); },
  });
  const tickOne = useMutation({
    mutationFn: async (id: string) => { setTickingId(id); try { return await apiHelpers.agents.tick(id); } finally { setTickingId(null); } },
    onSuccess: () => list.refetch(),
  });

  const agents = list.data || [];
  const s = status.data || {};

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Agent roster</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/agents · 6s poll</span>
        </div>
        {agents.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="concord-agents"
            title={`Agent roster — ${agents.length} agents`}
            content={`Total: ${s.total ?? agents.length} · active: ${s.active ?? '—'} · idle: ${s.idle ?? '—'}\n\n${agents.slice(0, 30).map((a) => `  ${a.id?.slice(0, 8)} · ${a.name || a.type || '?'} · ${a.status || '?'}${a.lastTickAt ? ` · ticked ${a.lastTickAt}` : ''}`).join('\n')}`}
            extraTags={['agents', 'roster']}
            rawData={{ status: s, agents }}
          />
        )}
      </header>

      <form onSubmit={(e) => { e.preventDefault(); if (researchTopic.trim()) spawn.mutate(researchTopic.trim()); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={researchTopic} onChange={(e) => setResearchTopic(e.target.value)} placeholder="Spawn research agent for topic…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <button type="submit" disabled={!researchTopic.trim() || spawn.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {spawn.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Spawn research
        </button>
      </form>

      <div className="grid grid-cols-3 gap-2">
        <Cell label="Total" value={String(s.total ?? agents.length)} />
        <Cell label="Active" value={String(s.active ?? '—')} />
        <Cell label="Idle" value={String(s.idle ?? '—')} />
      </div>

      {(list.isError || status.isError) && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Agent runtime unreachable.</div>}

      <div className="space-y-1 max-h-96 overflow-y-auto">
        {agents.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Activity className={`h-3 w-3 ${a.status === 'active' || a.status === 'running' ? 'text-emerald-300' : 'text-zinc-400'}`} />
                <span className="line-clamp-1 text-sm text-white">{a.name || a.type || a.id.slice(0, 8)}</span>
                {a.type && <span className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-400">{a.type}</span>}
                {a.status && <span className={`rounded px-1 font-mono text-[9px] ${a.status === 'active' || a.status === 'running' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-zinc-800 text-zinc-400'}`}>{a.status}</span>}
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-zinc-400">id {a.id?.slice(0, 12)}{a.ticks != null ? ` · ${a.ticks} ticks` : ''}{a.lastTickAt ? ` · last ${new Date(a.lastTickAt).toLocaleTimeString()}` : ''}</div>
            </div>
            <button type="button" onClick={() => tickOne.mutate(a.id)} disabled={tickingId === a.id} className="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
              {tickingId === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} tick
            </button>
          </div>
        ))}
        {agents.length === 0 && !list.isPending && !list.isError && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">No agents yet. Spawn a research agent above.</div>
        )}
      </div>
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
