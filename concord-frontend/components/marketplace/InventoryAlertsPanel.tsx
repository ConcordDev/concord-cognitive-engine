'use client';

/**
 * InventoryAlertsPanel — low-stock & out-of-stock notifications.
 *
 * Scans every active listing and its variations against an adjustable
 * threshold and surfaces a flagged list plus a small bar chart of the
 * stock distribution. Data flows through the `inventory-alerts` macro.
 * No seed data — empty until listings carry finite stock.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, PackageX, PackageMinus, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { cn } from '@/lib/utils';

interface Alert {
  listingId: string;
  title: string;
  level: 'low_stock' | 'out_of_stock';
  stockQty: number;
  scope: 'listing' | 'variation';
  sku?: string;
}

interface AlertsResult {
  threshold: number;
  alerts: Alert[];
  outOfStock: number;
  lowStock: number;
  total: number;
}

export function InventoryAlertsPanel() {
  const [result, setResult] = useState<AlertsResult | null>(null);
  const [threshold, setThreshold] = useState(5);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('marketplace', 'inventory-alerts', {
        lowStockThreshold: threshold,
      });
      if (r.data?.ok) setResult(r.data.result as AlertsResult);
    } catch (e) {
      console.error('[Inventory] alerts failed', e);
    } finally {
      setLoading(false);
    }
  }, [threshold]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const chartData =
    result && result.total > 0
      ? [
          { level: 'Out of stock', count: result.outOfStock },
          { level: 'Low stock', count: result.lowStock },
        ]
      : [];

  return (
    <div className="space-y-3">
      <div className="bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-semibold text-gray-200">Inventory alerts</span>
          <label className="ml-auto text-[10px] text-gray-400 flex items-center gap-1.5">
            Low-stock threshold
            <input
              type="number"
              min={0}
              value={threshold}
              onChange={(e) => setThreshold(Math.max(0, Number(e.target.value) || 0))}
              className="w-14 px-1.5 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
            />
          </label>
          <button
            onClick={refresh}
            className="p-1.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/30 hover:bg-orange-500/25"
            aria-label="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </header>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Scanning inventory…
          </div>
        ) : !result || result.total === 0 ? (
          <div className="px-3 py-12 text-center text-xs text-gray-400">
            <PackageX className="w-7 h-7 mx-auto mb-2 opacity-30" />
            No stock alerts. Every tracked listing is above the threshold.
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="px-4 py-3 grid grid-cols-3 gap-3 border-b border-white/10">
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-2.5">
                <div className="text-[10px] uppercase text-rose-300">Out of stock</div>
                <div className="text-xl font-bold text-rose-200">{result.outOfStock}</div>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-2.5">
                <div className="text-[10px] uppercase text-amber-300">Low stock</div>
                <div className="text-xl font-bold text-amber-200">{result.lowStock}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                <div className="text-[10px] uppercase text-gray-400">Total flagged</div>
                <div className="text-xl font-bold text-gray-200">{result.total}</div>
              </div>
            </div>

            {/* Distribution chart */}
            <div className="px-4 py-3 border-b border-white/10">
              <ChartKit
                kind="bar"
                data={chartData}
                xKey="level"
                series={[{ key: 'count', label: 'Items', color: '#f59e0b' }]}
                height={140}
                showLegend={false}
              />
            </div>

            {/* Alert list */}
            <ul className="max-h-[20rem] overflow-y-auto divide-y divide-white/5">
              {result.alerts.map((a, i) => (
                <li key={`${a.listingId}-${a.sku || i}`} className="px-4 py-2.5 flex items-center gap-3">
                  {a.level === 'out_of_stock' ? (
                    <PackageX className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  ) : (
                    <PackageMinus className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{a.title}</div>
                    <div className="text-[10px] text-gray-400">
                      {a.scope}
                      {a.sku && ` · ${a.sku}`}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'text-xs font-mono px-2 py-0.5 rounded',
                      a.level === 'out_of_stock'
                        ? 'bg-rose-500/20 text-rose-200'
                        : 'bg-amber-500/20 text-amber-200',
                    )}
                  >
                    {a.stockQty} left
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

export default InventoryAlertsPanel;
