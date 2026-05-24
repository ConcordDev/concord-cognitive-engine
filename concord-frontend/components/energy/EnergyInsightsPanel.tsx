'use client';

/**
 * EnergyInsightsPanel — usage alerts and month-over-month comparison.
 * Alerts are detected entirely from real logged data (spike vs trailing
 * baseline, always-on device with no recent reading, goal over budget).
 * The comparison charts this month's daily usage against last month.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BellRing, CalendarRange, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';

interface Alert { kind: string; severity: 'high' | 'medium' | 'low'; message: string }
interface MonthStat {
  month: string;
  consumedKwh: number;
  solarKwh: number;
  netKwh: number;
  cost: number;
  readingDays: number;
  dailyAvgKwh: number;
  dailySeries: { date: string; kwh: number }[];
}
interface Delta { abs: number; pct: number | null; direction: 'up' | 'down' | 'flat' }
interface Comparison {
  current: MonthStat;
  previous: MonthStat;
  change: { consumed: Delta; cost: Delta; solar: Delta };
  hasData: boolean;
}

const SEV_STYLE: Record<string, string> = {
  high: 'border-rose-900/60 bg-rose-950/40 text-rose-300',
  medium: 'border-amber-900/60 bg-amber-950/40 text-amber-300',
  low: 'border-zinc-800 bg-zinc-900/70 text-zinc-300',
};

export function EnergyInsightsPanel({ onChange }: { onChange: () => void }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [cmp, setCmp] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [a, c] = await Promise.all([
      lensRun('energy', 'usage-alerts', {}),
      lensRun('energy', 'month-comparison', {}),
    ]);
    setAlerts((a.data?.result?.alerts as Alert[]) || []);
    setCmp(c.data?.ok ? (c.data.result as Comparison) : null);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const chartData = mergeSeries(cmp);

  return (
    <div className="space-y-4">
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <BellRing className="w-3.5 h-3.5 text-lime-400" /> Usage alerts
        </h3>
        {alerts.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No alerts — your usage looks stable.</p>
        ) : (
          <ul className="space-y-1.5">
            {alerts.map((al, i) => (
              <li key={`${al.kind}-${i}`} className={`flex items-start gap-2 text-[11px] border rounded-lg px-3 py-2 ${SEV_STYLE[al.severity]}`}>
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{al.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <CalendarRange className="w-3.5 h-3.5 text-lime-400" /> This month vs last month
        </h3>
        {!cmp || !cmp.hasData ? (
          <p className="text-[11px] text-zinc-400 italic">Log readings across two months to compare.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <DeltaCard label="Consumption" unit="kWh" cur={cmp.current.consumedKwh} d={cmp.change.consumed} />
              <DeltaCard label="Cost" unit="$" cur={cmp.current.cost} d={cmp.change.cost} prefix />
              <DeltaCard label="Solar" unit="kWh" cur={cmp.current.solarKwh} d={cmp.change.solar} invert />
            </div>
            {chartData.length > 1 && (
              <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 mt-2">
                <ChartKit kind="line" data={chartData} xKey="day" height={160}
                  series={[
                    { key: 'previous', label: cmp.previous.month, color: '#71717a' },
                    { key: 'current', label: cmp.current.month, color: '#a3e635' },
                  ]} />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** Align each month's daily series onto a shared day-of-month axis. */
function mergeSeries(cmp: Comparison | null): Array<Record<string, number | string>> {
  if (!cmp) return [];
  const byDay = new Map<number, { day: number; current?: number; previous?: number }>();
  const put = (s: { date: string; kwh: number }[], key: 'current' | 'previous') => {
    for (const p of s) {
      const dom = Number(p.date.slice(8, 10));
      if (!Number.isFinite(dom)) continue;
      const row = byDay.get(dom) || { day: dom };
      row[key] = p.kwh;
      byDay.set(dom, row);
    }
  };
  put(cmp.current.dailySeries, 'current');
  put(cmp.previous.dailySeries, 'previous');
  return [...byDay.values()]
    .sort((a, b) => a.day - b.day)
    .map((r) => ({ day: String(r.day), current: r.current ?? 0, previous: r.previous ?? 0 }));
}

function DeltaCard({ label, unit, cur, d, prefix = false, invert = false }: {
  label: string; unit: string; cur: number; d: Delta; prefix?: boolean; invert?: boolean;
}) {
  // For consumption/cost, "up" is bad; for solar, "up" is good.
  const good = d.direction === 'flat' ? null : (invert ? d.direction === 'up' : d.direction === 'down');
  const tone = good == null ? 'text-zinc-400' : good ? 'text-emerald-400' : 'text-rose-400';
  const arrow = d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '–';
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2 text-center">
      <p className="text-base font-bold text-zinc-100">{prefix ? '$' : ''}{cur}{prefix ? '' : ` ${unit}`}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
      <p className={`text-[10px] font-medium ${tone}`}>
        {arrow} {prefix ? '$' : ''}{Math.abs(d.abs)}{d.pct != null ? ` (${Math.abs(d.pct)}%)` : ''}
      </p>
    </div>
  );
}
