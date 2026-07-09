'use client';

/**
 * EmsOverviewPanel — the emergency-services Dashboard tab.
 *
 * Replaces the fake `Dashboard` tab the old page shipped, which rendered
 * `stats` derived from a disconnected generic-CRUD artifact store (types
 * `Call`/`Unit` that never matched any registered backend macro) and a
 * literal hardcoded `'4.2m'` "Avg Response" figure with no computation
 * behind it whatsoever.
 *
 * Every tile here is a real number from two live macros:
 *   - `ems-dashboard`     → incidents / openIncidents / units / availableUnits / byKind
 *   - `readiness-rollup`  → totalUnits / available / committed / outOfService /
 *                            readinessPct / status / byKind / kindCoverageGaps
 *
 * Both read from the same per-user CAD roster `CADConsole` writes to, so
 * logging an incident or adding a unit there updates this dashboard too.
 */

import { useCallback, useEffect, useState } from 'react';
import { LayoutDashboard, RefreshCw, Loader2, AlertTriangle, Siren, Truck, ShieldCheck, Ban } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { cn } from '@/lib/utils';

const DOMAIN = 'emergency-services';

interface DashboardResult {
  incidents: number;
  openIncidents: number;
  units: number;
  availableUnits: number;
  byKind: Record<string, number>;
}
interface RollupResult {
  totalUnits: number;
  available: number;
  committed: number;
  outOfService: number;
  readinessPct: number;
  status: string;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  kindCoverageGaps: string[];
}

async function call<T>(action: string, input: Record<string, unknown> = {}): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  try {
    const r = await lensRun<T>(DOMAIN, action, input);
    if (r?.data?.ok) return { ok: true, result: r.data.result as T };
    return { ok: false, error: (r?.data as { error?: string } | undefined)?.error ?? `${action} failed` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const STATUS_TONE: Record<string, string> = {
  'fully-operational': 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5',
  'operational': 'text-cyan-400 border-cyan-500/30 bg-cyan-500/5',
  'limited': 'text-amber-400 border-amber-500/30 bg-amber-500/5',
  'critical': 'text-rose-400 border-rose-500/30 bg-rose-500/5',
  'no-roster': 'text-zinc-400 border-zinc-700 bg-zinc-900',
};

export function EmsOverviewPanel() {
  const [dash, setDash] = useState<DashboardResult | null>(null);
  const [rollup, setRollup] = useState<RollupResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [d, r] = await Promise.all([
      call<DashboardResult>('ems-dashboard'),
      call<RollupResult>('readiness-rollup'),
    ]);
    if (!d.ok) { setError(d.error); setLoading(false); return; }
    setDash(d.result);
    if (r.ok) setRollup(r.result);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !dash) {
    return (
      <div className="space-y-3">
        <StatTileGrid columns={4}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="block" height={72} />)}
        </StatTileGrid>
        <Skeleton variant="block" height={120} />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={load} retrying={loading} />;
  }

  if (!dash) return null;

  const byKindEntries = Object.entries(dash.byKind).sort((a, b) => b[1] - a[1]);
  const maxKind = byKindEntries.length ? byKindEntries[0][1] : 1;

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <LayoutDashboard className="h-5 w-5 text-red-400" />
        <h2 className="text-base font-semibold text-white">Operations Overview</h2>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </header>

      <StatTileGrid columns={4}>
        <StatTile
          label="Open Incidents"
          value={dash.openIncidents}
          caption={`of ${dash.incidents} total`}
          icon={<Siren className="h-4 w-4" />}
          tone={dash.openIncidents > 0 ? 'negative' : 'neutral'}
        />
        <StatTile
          label="Available Units"
          value={dash.availableUnits}
          caption={`of ${dash.units} on roster`}
          icon={<Truck className="h-4 w-4" />}
          tone={dash.availableUnits > 0 ? 'positive' : 'negative'}
        />
        <StatTile
          label="Readiness"
          value={rollup ? `${rollup.readinessPct}%` : '—'}
          caption={rollup ? rollup.status.replace(/-/g, ' ') : 'no roster data'}
          icon={<ShieldCheck className="h-4 w-4" />}
          tone={rollup ? (rollup.readinessPct >= 60 ? 'positive' : rollup.readinessPct > 0 ? 'neutral' : 'negative') : 'neutral'}
        />
        <StatTile
          label="Out of Service"
          value={rollup?.outOfService ?? 0}
          caption={rollup ? `${rollup.committed} committed` : undefined}
          icon={<Ban className="h-4 w-4" />}
          tone={rollup && rollup.outOfService > 0 ? 'negative' : 'neutral'}
        />
      </StatTileGrid>

      {rollup && (
        <div className={cn('rounded-lg border p-3', STATUS_TONE[rollup.status] || STATUS_TONE['no-roster'])}>
          <p className="text-xs font-semibold uppercase tracking-wide">Fleet status: {rollup.status.replace(/-/g, ' ')}</p>
          {rollup.kindCoverageGaps.length > 0 ? (
            <p className="mt-1 flex items-center gap-1.5 text-[11px]">
              <AlertTriangle className="h-3.5 w-3.5" /> No available unit of type: {rollup.kindCoverageGaps.join(', ')}
            </p>
          ) : (
            <p className="mt-1 text-[11px] opacity-80">Every unit kind on the roster has at least one available unit.</p>
          )}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Incidents by kind</p>
        {byKindEntries.length === 0 && <p className="py-3 text-center text-[11px] text-zinc-400">No incidents logged yet — log one from the CAD Console tab.</p>}
        <div className="space-y-1.5">
          {byKindEntries.map(([kind, count]) => (
            <div key={kind} className="flex items-center gap-2 text-xs">
              <span className="w-20 shrink-0 truncate text-zinc-300">{kind}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-900">
                <div className="h-full rounded-full bg-red-500/60" style={{ width: `${Math.max(4, (count / maxKind) * 100)}%` }} />
              </div>
              <span className="w-6 shrink-0 text-right font-mono text-zinc-400">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default EmsOverviewPanel;
