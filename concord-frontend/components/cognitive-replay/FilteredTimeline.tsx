'use client';

/**
 * FilteredTimeline — the cognitive-replay.filter macro surface. Lets the
 * user slice the timeline by brain / tool / role and renders the
 * matching turns. Clicking a turn fires onJump with its eventId so the
 * page can deep-link to that conversation via cognitive-replay.event.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Filter, ExternalLink } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface FEvent {
  eventId: string;
  sessionId: string;
  turnIndex: number;
  ts: number | null;
  role: string;
  brainsUsed: string[];
  toolCalls: unknown[];
  dtusCited: string[];
  tokenCount: number | null;
  contentPreview: string | null;
}
interface FilterResult {
  events: FEvent[];
  count: number;
  totalMatching: number;
  facets: { brains: string[]; tools: string[]; roles: string[] };
}

const BRAIN_COLORS: Record<string, string> = {
  conscious: 'bg-amber-500', subconscious: 'bg-purple-500',
  utility: 'bg-cyan-500', repair: 'bg-rose-500', vision: 'bg-emerald-500',
};

export function FilteredTimeline({ onJump }: { onJump: (eventId: string) => void }) {
  const [data, setData] = useState<FilterResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brain, setBrain] = useState('');
  const [tool, setTool] = useState('');
  const [role, setRole] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const input: Record<string, string> = {};
    if (brain) input.brain = brain;
    if (tool) input.tool = tool;
    if (role) input.role = role;
    const r = await lensRun<FilterResult>('cognitive-replay', 'filter', input);
    if (r.data.ok && r.data.result) setData(r.data.result);
    else setError(r.data.error || 'filter failed');
    setLoading(false);
  }, [brain, tool, role]);

  useEffect(() => { load(); }, [load]);

  const facets = data?.facets || { brains: [], tools: [], roles: ['user', 'assistant', 'system'] };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-zinc-100">Filter timeline</h2>
        {data && <span className="text-[11px] text-zinc-400">{data.count} of {data.totalMatching} turns</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Select label="Brain" value={brain} onChange={setBrain} options={facets.brains} />
        <Select label="Tool" value={tool} onChange={setTool} options={facets.tools} />
        <Select label="Role" value={role} onChange={setRole} options={facets.roles} />
        {(brain || tool || role) && (
          <button
            onClick={() => { setBrain(''); setTool(''); setRole(''); }}
            className="rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
          >
            Clear
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          <span>{error}</span>
          <button onClick={load} className="rounded border border-rose-500/40 px-2 py-0.5 font-medium text-rose-100 hover:bg-rose-500/20">Retry</button>
        </div>
      )}
      {loading ? (
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Filtering…</div>
      ) : data && data.events.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">No turns match these filters.</div>
      ) : (
        <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {(data?.events || []).slice().reverse().map((e) => (
            <li key={e.eventId}>
              <button
                onClick={() => onJump(e.eventId)}
                className="group flex w-full items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 text-left hover:border-cyan-500/40"
              >
                <span className="mt-0.5 w-24 shrink-0 font-mono text-[10px] text-zinc-400">
                  {e.ts ? new Date(e.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="text-[10px] font-bold uppercase text-zinc-400">{e.role}</span>
                    {e.brainsUsed.map((b) => (
                      <span key={b} className={`rounded px-1.5 py-0 text-[9px] font-mono uppercase text-white ${BRAIN_COLORS[b] || 'bg-zinc-600'}`}>{b}</span>
                    ))}
                  </span>
                  {e.contentPreview && <span className="mt-0.5 block truncate text-xs text-zinc-300">{e.contentPreview}</span>}
                  <span className="mt-0.5 block font-mono text-[9px] text-zinc-400">
                    tok {e.tokenCount ?? '—'} · tools {e.toolCalls.length} · cites {e.dtusCited.length}
                  </span>
                </span>
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-zinc-700 group-hover:text-cyan-400" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 focus:border-cyan-500 focus:outline-none"
    >
      <option value="">{label}: all</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
