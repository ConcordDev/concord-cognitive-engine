'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Loader2, RefreshCw, DollarSign, Target, Users, Star } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';

interface ReportOverview {
  generatedAt: string;
  revenue: { total: number; outstanding: number; avgTicket: number; fromInvoices: number; fromLinks: number };
  sales: { quotesTotal: number; quotesAccepted: number; quotesDecided: number; closeRate: number };
  jobs: { total: number; completed: number; completionRate: number; byStatus: Record<string, number> };
  labor: { technicians: number; clockedHours: number; baselineHours: number; utilization: number };
  satisfaction: { reviewCount: number; avgRating: number };
}

export function ReportingPanel() {
  const [data, setData] = useState<ReportOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<ReportOverview>('trades', 'report-overview', {});
      if (r.data?.ok && r.data.result) setData(r.data.result);
    } catch (e) { console.error('[Reporting] failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Reporting dashboard</span>
        {data && <span className="ml-auto text-[10px] text-gray-500">as of {new Date(data.generatedAt).toLocaleString()}</span>}
        <button onClick={refresh} className="p-1 rounded hover:bg-white/5 text-gray-400" aria-label="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Crunching numbers…</div>
      ) : !data ? (
        <div className="px-3 py-10 text-center text-xs text-gray-500">No report data yet.</div>
      ) : (
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi icon={DollarSign} tone="emerald" label="Revenue" value={`$${data.revenue.total.toFixed(0)}`} caption={`$${data.revenue.outstanding.toFixed(0)} outstanding`} />
            <Kpi icon={Target} tone="violet" label="Close rate" value={`${data.sales.closeRate.toFixed(0)}%`} caption={`${data.sales.quotesAccepted}/${data.sales.quotesDecided} quotes won`} />
            <Kpi icon={Users} tone="cyan" label="Tech utilization" value={`${data.labor.utilization.toFixed(0)}%`} caption={`${data.labor.clockedHours}h / ${data.labor.baselineHours}h`} />
            <Kpi icon={Star} tone="amber" label="Avg rating" value={data.satisfaction.avgRating > 0 ? data.satisfaction.avgRating.toFixed(1) : '—'} caption={`${data.satisfaction.reviewCount} reviews`} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <Stat label="Avg ticket" value={`$${data.revenue.avgTicket.toFixed(0)}`} />
            <Stat label="Invoice revenue" value={`$${data.revenue.fromInvoices.toFixed(0)}`} />
            <Stat label="Jobs completed" value={`${data.jobs.completed}/${data.jobs.total}`} />
            <Stat label="Job completion" value={`${data.jobs.completionRate.toFixed(0)}%`} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-cyan-400 mb-1">Revenue mix</div>
              <ChartKit
                kind="bar"
                xKey="label"
                series={[{ key: 'amount', label: 'USD', color: '#22c55e' }]}
                height={180}
                data={[
                  { label: 'Invoices', amount: data.revenue.fromInvoices },
                  { label: 'Pay links', amount: data.revenue.fromLinks },
                  { label: 'Outstanding', amount: data.revenue.outstanding },
                ]}
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-violet-400 mb-1">Job pipeline by status</div>
              <ChartKit
                kind="bar"
                xKey="status"
                series={[{ key: 'count', label: 'Jobs', color: '#a855f7' }]}
                height={180}
                data={Object.entries(data.jobs.byStatus).map(([status, count]) => ({ status, count }))}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TONES: Record<string, string> = {
  emerald: 'border-emerald-500/20 text-emerald-300',
  violet: 'border-violet-500/20 text-violet-300',
  cyan: 'border-cyan-500/20 text-cyan-300',
  amber: 'border-amber-500/20 text-amber-300',
};

function Kpi({ icon: Icon, label, value, caption, tone }: { icon: typeof DollarSign; label: string; value: string; caption: string; tone: string }) {
  return (
    <div className={`rounded-lg border bg-white/[0.02] p-2.5 ${TONES[tone]}`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className="w-3 h-3" />
        <span className="text-[9px] uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className="text-lg font-mono font-bold tabular-nums text-white">{value}</div>
      <div className="text-[9px] text-gray-500">{caption}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
      <div className="text-[9px] uppercase text-gray-600">{label}</div>
      <div className="font-mono text-gray-200">{value}</div>
    </div>
  );
}

export default ReportingPanel;
