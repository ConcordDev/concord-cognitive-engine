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

import { useCallback, useEffect, useState } from 'react';
import {
  Ship, Network, ClipboardList, AlertTriangle, Loader2, ArrowRight,
  CheckCircle2, PackageX,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';

interface Overview {
  shipments: { inTransit: number; delivered: number; delayed: number; total: number };
  network: { supplier: number; factory: number; warehouse: number; customer: number; edgeCount: number; criticalLeadTime: number };
  workOrders: { openValue: number; overdueCount: number; total: number };
  exceptions: { critical: number; warning: number; alerts: Array<{ id: string; severity: string; kind: string; message: string; detail: string }> };
}

async function run<T>(action: string, input: Record<string, unknown> = {}): Promise<T | null> {
  const r = await lensRun<T>('supplychain', action, input);
  return r.data?.ok ? (r.data.result as T) : null;
}

export function SupplyChainOverview({ onJump }: { onJump: (destination: 'tower' | 'scorecards') => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ships, net, wos, exc] = await Promise.all([
        run<{ shipments: unknown[]; inTransit: number; delivered: number; delayed: number }>('shipmentList'),
        run<{ counts: { supplier: number; factory: number; warehouse: number; customer: number }; edgeCount: number; criticalLeadTime: number }>('networkGraph'),
        run<{ openValue: number; overdueCount: number; workOrders: unknown[] }>('workOrderList'),
        run<{ critical: number; warning: number; alerts: Overview['exceptions']['alerts'] }>('exceptionScan', { inventory: [], suppliers: [] }),
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
        exceptions: { critical: exc?.critical ?? 0, warning: exc?.warning ?? 0, alerts: exc?.alerts ?? [] },
      });
      setErr(null);
    } catch (e) {
      setErr((e as Error).message || 'Failed to load control-tower overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  return (
    <div className="space-y-5">
      {!hasAnyData && (
        <EmptyState
          icon={<Network className="w-8 h-8 text-teal-500" />}
          title="Your control tower is empty."
          description="Book a shipment, map your supply network, or raise a requisition in the Control Tower tab — every tile here reads live from that state, nothing is simulated."
          action={{ label: 'Open Control Tower', onClick: () => onJump('tower') }}
        />
      )}

      <StatTileGrid columns={4}>
        <StatTile label="Shipments in transit" value={data.shipments.inTransit} icon={<Ship className="w-4 h-4" />}
          tone={data.shipments.delayed > 0 ? 'negative' : 'neutral'}
          caption={data.shipments.delayed > 0 ? `${data.shipments.delayed} delayed` : 'on schedule'} onClick={() => onJump('tower')} />
        <StatTile label="Network nodes" value={nodeTotal} icon={<Network className="w-4 h-4" />}
          caption={nodeTotal > 0 ? `${data.network.edgeCount} routes · ${data.network.criticalLeadTime}d critical path` : 'no network mapped yet'} onClick={() => onJump('tower')} />
        <StatTile label="Open PO value" value={data.workOrders.openValue} unit="$" icon={<ClipboardList className="w-4 h-4" />}
          tone={data.workOrders.overdueCount > 0 ? 'negative' : 'neutral'}
          caption={data.workOrders.overdueCount > 0 ? `${data.workOrders.overdueCount} overdue` : `${data.workOrders.total} orders`} onClick={() => onJump('tower')} />
        <StatTile label="Exceptions" value={data.exceptions.critical + data.exceptions.warning} icon={<AlertTriangle className="w-4 h-4" />}
          tone={data.exceptions.critical > 0 ? 'negative' : data.exceptions.warning > 0 ? 'neutral' : 'positive'}
          caption={`${data.exceptions.critical} critical · ${data.exceptions.warning} warning`} onClick={() => onJump('tower')} />
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
        {data.exceptions.alerts.length === 0 ? (
          <p className="flex items-center gap-1.5 py-3 text-center justify-center text-[11px] text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> No shipment or PO exceptions right now.
          </p>
        ) : (
          <div className="space-y-1.5">
            {data.exceptions.alerts.slice(0, 6).map((a) => (
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
