'use client';

// Roster explorer — filter/search the emergent roster by query, role,
// naming origin, and activity state. Backed by GET /api/emergents/roster/search.

import { useEffect, useState } from 'react';
import { Loader2, Search, Cpu, Clock, X } from 'lucide-react';

interface RosterRow {
  emergent_id: string;
  id: string;
  given_name: string | null;
  naming_origin: string | null;
  current_focus: string | null;
  last_active_at: number | null;
  role: string | null;
  active: boolean;
}
interface RosterResponse {
  ok: boolean;
  error?: string;
  roster?: RosterRow[];
  total?: number;
  matchedOf?: number;
  availableRoles?: string[];
  availableOrigins?: string[];
}

function rel(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function RosterExplorer({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [origin, setOrigin] = useState('');
  const [state, setState] = useState<'all' | 'active' | 'dormant'>('all');
  const [data, setData] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (role) params.set('role', role);
    if (origin) params.set('focus', origin);
    if (state !== 'all') params.set('state', state);
    const t = setTimeout(() => {
      fetch(`/api/emergents/roster/search?${params.toString()}`)
        .then((r) => r.json())
        .then((d: RosterResponse) => { if (alive) { setData(d); setLoading(false); } })
        .catch(() => { if (alive) { setData({ ok: false, error: 'unreachable' }); setLoading(false); } });
    }, 220);
    return () => { alive = false; clearTimeout(t); };
  }, [query, role, origin, state]);

  const roster = data?.roster || [];
  const roles = data?.availableRoles || [];
  const hasFilter = Boolean(query.trim() || role || origin || state !== 'all');

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emergents by name, focus, origin…"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pl-8 pr-3 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500/50 focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300"
        >
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <input
          type="text"
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          placeholder="focus contains…"
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 placeholder-zinc-600"
        />
        <div className="flex overflow-hidden rounded border border-zinc-800">
          {(['all', 'active', 'dormant'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setState(s)}
              className={`px-2 py-1 text-[11px] capitalize transition-colors ${
                state === s ? 'bg-cyan-500/20 text-cyan-200' : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        {hasFilter && (
          <button
            type="button"
            onClick={() => { setQuery(''); setRole(''); setOrigin(''); setState('all'); }}
            className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {data?.ok && (
        <p className="text-[11px] text-zinc-500">
          {data.total} of {data.matchedOf} emergents{hasFilter ? ' match the filters' : ''}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching roster…
        </div>
      ) : !data?.ok ? (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          Roster search failed ({data?.error || 'unknown error'}).
        </div>
      ) : roster.length === 0 ? (
        <p className="text-xs text-zinc-600">No emergents match those filters.</p>
      ) : (
        <div className="space-y-1.5">
          {roster.map((e) => {
            const name = e.given_name || e.emergent_id;
            const sel = selectedId === e.emergent_id;
            return (
              <button
                key={e.emergent_id}
                type="button"
                onClick={() => onSelect(e.emergent_id)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  sel
                    ? 'border-cyan-500/50 bg-cyan-500/10'
                    : 'border-zinc-800 bg-zinc-950/40 hover:border-cyan-500/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Cpu className="h-3.5 w-3.5 flex-shrink-0 text-cyan-400" />
                  <span className="truncate font-semibold text-white">{name}</span>
                  {e.active && (
                    <span className="ml-auto h-2 w-2 flex-shrink-0 rounded-full bg-green-400" title="active" />
                  )}
                </div>
                {e.role && <p className="text-[11px] text-zinc-500">{e.role}</p>}
                {e.current_focus && (
                  <p className="mt-0.5 truncate text-[11px] text-zinc-400">↳ {e.current_focus}</p>
                )}
                <p className="mt-0.5 text-[10px] text-zinc-600">
                  <Clock className="mr-1 inline h-3 w-3" />
                  {rel(e.last_active_at)}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
