'use client';

/**
 * SupplyChainOverview — control-tower landing dashboard.
 *
 * Aggregates real state across the STATE-backed supplychain macros
 * (shipmentList / networkGraph / workOrderList / exceptionScan) into one
 * at-a-glance view — the SAP-IBP "control tower" pattern: real-time
 * visibility + KPI tracking + exception alerts, no simulation, no
 * fabricated numbers. Every tile traces to a live macro call.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Ship, Network, ClipboardList, AlertTriangle, Loader2, ArrowRight,
  CheckCircle2, PackageX, RefreshCw,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import { EmptyState } from '@/components/ui/EmptyState';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';

interface Overview {
  shipments: { inTransit: number; delivered: number; delayed: number; total: number };
  network: { supplier: number; factory: number; warehouse: number; customer: number; edgeCount: number; criticalLeadTime: number };
  workOrders: { openValue: number; overdueCount: number; total: number };
  exceptions: {
    critical: number; warning: number;
    alerts: Array<{ id: string; severity: string; kind: string; message: string; detail: string }>;
    byKind: Record<string, number>;
  };
}

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

async function run<T>(action: string, input: Record<string, unknown> = {}): Promise<T | null> {
  const r = await lensRun<T>('supplychain', action, input);
  return r.data?.ok ? (r.data.result as T) : null;
}

export function SupplyChainOverview({ onJump }: { onJump: (destination: 'tower' | 'scorecards') => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [kindFilter, setKindFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [ships, net, wos, exc] = await Promise.all([
        run<{ shipments: unknown[]; inTransit: number; delivered: number; delayed: number }>('shipmentList'),
        run<{ counts: { supplier: number; factory: number; warehouse: number; customer: number }; edgeCount: number; criticalLeadTime: number }>('networkGraph'),
        run<{ openValue: number; overdueCount: number; workOrders: unknown[] }>('workOrderList'),
        run<{ critical: number; warning: number; alerts: Overview['exceptions']['alerts']; byKind: Record<string, number> }>('exceptionScan', { inventory: [], suppliers: [] }),
      ]);
      setData({
        shipments: {
          inTransit: ships?.inTransit ?? 0, delivered: ships?.delivered ?? 0,
          delayed: ships?.delayed ?? 0, total: ships?.shipments?.length ?? 0,
        },
        network: {
          supplier: net?.counts?.supplier ?? 0, factory: net?.counts?.factory ?? 0,
          warehouse: net?.counts?.warehouse ?? 0, customer: net?.counts?.customer ?? 0,
          edgeCount: net?.edgeCount ?? 0, criticalLeadTime: net?.criticalLeadTime ?? 0,
        },
        workOrders: { openValue: wos?.openValue ?? 0, overdueCount: wos?.overdueCount ?? 0, total: wos?.workOrders?.length ?? 0 },
        exceptions: { critical: exc?.critical ?? 0, warning: exc?.warning ?? 0, alerts: exc?.alerts ?? [], byKind: exc?.byKind ?? {} },
      });
      setLastLoadedAt(Date.now());
    } catch (e) {
      setErr((e as Error).message || 'Failed to load control-tower overview.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  useLensCommand(
    [{ id: 'overview-refresh', keys: 'r', description: 'Refresh control-tower overview', category: 'actions', action: refresh }],
    { lensId: 'supplychain' }
  );

  const filteredAlerts = useMemo(() => {
    const alerts = data?.exceptions.alerts ?? [];
    return kindFilter ? alerts.filter((a) => a.kind === kindFilter) : alerts;
  }, [data, kindFilter]);

  if (loading) {
    return (
      <div role="status" aria-label="Loading control tower overview" className="flex items-center gap-2 py-16 justify-center text-xs text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading live network state…
      </div>
    );
  }
  if (err || !data) {
    return (
      <div role="alert" className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">{err || 'No data.'}</div>
    );
  }

  const hasAnyData = data.shipments.total > 0 || data.network.edgeCount > 0 || data.workOrders.total > 0;
  const nodeTotal = data.network.supplier + data.network.factory + data.network.warehouse + data.network.customer;
  const kinds = Object.keys(data.exceptions.byKind);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between -mb-2">
        <span className="text-[10px] text-zinc-500">
          {lastLoadedAt ? `Updated ${timeAgo(lastLoadedAt)}` : ''}
        </span>
        <button type="button" onClick={refresh} disabled={refreshing}
          title="Refresh (r)"
          className="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-teal-300 disabled:opacity-50 transition-colors">
          <RefreshCw className={cn('w-3 h-3', refreshing && 'animate-spin')} /> Refresh
        </button>
      </div>

      {!hasAnyData && (
        <EmptyState
          icon={<Network className="w-8 h-8 text-teal-500" />}
          title="Your control tower is empty."
          description="Book a shipment, map your supply network, or raise a requisition in the Control Tower tab — every tile here reads live from that state, nothing is simulated."
          action={{ label: 'Open Control Tower', onClick: () => onJump('tower') }}
        />
      )}

      <StatTileGrid columns={4}>
        {[
          { label: 'Shipments in transit', value: data.shipments.inTransit, icon: <Ship className="w-4 h-4" />,
            tone: data.shipments.delayed > 0 ? 'negative' as const : 'neutral' as const,
            caption: data.shipments.delayed > 0 ? `${data.shipments.delayed} delayed` : 'on schedule' },
          { label: 'Network nodes', value: nodeTotal, icon: <Network className="w-4 h-4" />, tone: 'neutral' as const,
            caption: nodeTotal > 0 ? `${data.network.edgeCount} routes · ${data.network.criticalLeadTime}d critical path` : 'no network mapped yet' },
          { label: 'Open PO value', value: data.workOrders.openValue, icon: <ClipboardList className="w-4 h-4" />,
            tone: data.workOrders.overdueCount > 0 ? 'negative' as const : 'neutral' as const,
            caption: data.workOrders.overdueCount > 0 ? `${data.workOrders.overdueCount} overdue` : `${data.workOrders.total} orders`, unit: '$' },
          { label: 'Exceptions', value: data.exceptions.critical + data.exceptions.warning, icon: <AlertTriangle className="w-4 h-4" />,
            tone: data.exceptions.critical > 0 ? 'negative' as const : data.exceptions.warning > 0 ? 'neutral' as const : 'positive' as const,
            caption: `${data.exceptions.critical} critical · ${data.exceptions.warning} warning` },
        ].map((tile, i) => (
          <motion.div key={tile.label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: i * 0.05 }}>
            <StatTile label={tile.label} value={tile.value} unit={tile.unit} icon={tile.icon}
              tone={tile.tone} caption={tile.caption} onClick={() => onJump('tower')} />
          </motion.div>
        ))}
      </StatTileGrid>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <AlertTriangle className="w-4 h-4 text-amber-400" /> Live exceptions
          </div>
          <button onClick={() => onJump('tower')} className="flex items-center gap-1 text-[11px] text-teal-300 hover:text-teal-200">
            Manage in Control Tower <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {kinds.length > 1 && (
          <div className="flex flex-wrap gap-1 mb-2">
            <button type="button" onClick={() => setKindFilter(null)}
              className={cn('px-2 py-0.5 rounded-full text-[10px] border transition-colors',
                kindFilter === null ? 'border-teal-500/50 bg-teal-500/15 text-teal-200' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200')}>
              All ({data.exceptions.alerts.length})
            </button>
            {kinds.map((k) => (
              <button key={k} type="button" onClick={() => setKindFilter(k === kindFilter ? null : k)}
                className={cn('px-2 py-0.5 rounded-full text-[10px] border capitalize transition-colors',
                  kindFilter === k ? 'border-teal-500/50 bg-teal-500/15 text-teal-200' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200')}>
                {k.replace(/_/g, ' ')} ({data.exceptions.byKind[k]})
              </button>
            ))}
          </div>
        )}
        {data.exceptions.alerts.length === 0 ? (
          <p className="flex items-center gap-1.5 py-3 text-center justify-center text-[11px] text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> No shipment or PO exceptions right now.
          </p>
        ) : (
          <div className="space-y-1.5">
            {filteredAlerts.slice(0, 6).map((a) => (
              <div key={a.id} className={cn('rounded-md border px-2.5 py-1.5 flex items-start gap-2',
                a.severity === 'critical' ? 'border-rose-700/50 bg-rose-950/20' : 'border-amber-700/50 bg-amber-950/20')}>
                <PackageX className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', a.severity === 'critical' ? 'text-rose-400' : 'text-amber-400')} />
                <div>
                  <div className="text-[11px] text-white">{a.message}</div>
                  {a.detail && <div className="text-[10px] text-zinc-400">{a.detail}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button onClick={() => onJump('tower')} className="rounded-lg border border-teal-700/40 bg-teal-950/20 p-3 text-left hover:border-teal-500/60 transition-colors">
          <div className="flex items-center gap-2 text-sm font-semibold text-teal-200"><Network className="w-4 h-4" /> Open Control Tower</div>
          <p className="mt-1 text-[11px] text-zinc-400">Shipments, supply network, multi-echelon inventory, what-if scenarios, seasonal forecast, exceptions, procurement, spend.</p>
        </button>
        <button onClick={() => onJump('scorecards')} className="rounded-lg border border-blue-700/40 bg-blue-950/20 p-3 text-left hover:border-blue-500/60 transition-colors">
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-200"><ClipboardList className="w-4 h-4" /> Scorecards &amp; quick analysis</div>
          <p className="mt-1 text-[11px] text-zinc-400">Lead-time reliability, EOQ reorder points, supplier scorecards, demand forecast — plus mint / DM / publish / agent risk review.</p>
        </button>
      </div>
    </div>
  );
}
