'use client';

/**
 * HrAnalyticsPanel — org-wide workforce analytics: headcount, tenure
 * distribution, compensation distribution + bands, department mix and
 * employment-type mix. Every figure is computed server-side from real
 * employee records.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';

interface CompStats { min: number; max: number; median: number; mean: number; p25: number; p75: number }
interface CompBand { label: string; lower: number; upper: number; count: number }
interface DeptRow { department: string; headcount: number; payroll: number; avgSalary: number }
interface Analytics {
  headcount: number; terminated: number; avgTenureYears: number;
  tenureDistribution: Record<string, number>;
  compensation: CompStats;
  compensationBands: CompBand[];
  departments: DeptRow[];
  employmentTypeMix: Record<string, number>;
  annualPayroll: number;
}

const usd = (n: number) => `$${n.toLocaleString()}`;

export function HrAnalyticsPanel() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('hr', 'workforce-analytics', {});
    setData(r.data?.ok ? (r.data.result as Analytics) : null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }
  if (!data) {
    return <p className="text-[11px] text-zinc-400 italic">Analytics unavailable.</p>;
  }
  if (data.headcount === 0) {
    return <p className="text-[11px] text-zinc-400 italic">No employees yet — add employees to see workforce analytics.</p>;
  }

  const tenureData = Object.entries(data.tenureDistribution).map(([bucket, count]) => ({ bucket, count }));
  const bandData = data.compensationBands.map((b) => ({
    band: `${usd(b.lower)}–${usd(b.upper)}`, count: b.count,
  }));
  const deptData = data.departments.map((d) => ({ department: d.department, headcount: d.headcount }));
  const typeData = Object.entries(data.employmentTypeMix).map(([type, count]) => ({
    type: type.replace(/_/g, ' '), count,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">Workforce snapshot</span>
        <button type="button" onClick={refresh}
          className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi label="Headcount" value={String(data.headcount)} />
        <Kpi label="Avg tenure" value={`${data.avgTenureYears}y`} />
        <Kpi label="Annual payroll" value={usd(data.annualPayroll)} />
        <Kpi label="Terminated" value={String(data.terminated)} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Kpi label="Median salary" value={usd(data.compensation.median)} />
        <Kpi label="Mean salary" value={usd(data.compensation.mean)} />
        <Kpi label="P25 / P75" value={`${usd(data.compensation.p25)} / ${usd(data.compensation.p75)}`} />
      </div>

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Tenure distribution</h3>
        <ChartKit kind="bar" data={tenureData} xKey="bucket"
          series={[{ key: 'count', label: 'Employees', color: '#22c55e' }]} height={180} showLegend={false} />
      </section>

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Compensation distribution</h3>
        <ChartKit kind="bar" data={bandData} xKey="band"
          series={[{ key: 'count', label: 'Employees', color: '#6366f1' }]} height={180} showLegend={false} />
      </section>

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Headcount by department</h3>
        <ChartKit kind="bar" data={deptData} xKey="department"
          series={[{ key: 'headcount', label: 'Headcount', color: '#06b6d4' }]} height={180} showLegend={false} />
      </section>

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Employment-type mix</h3>
        <ChartKit kind="bar" data={typeData} xKey="type"
          series={[{ key: 'count', label: 'Employees', color: '#f59e0b' }]} height={160} showLegend={false} />
      </section>

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Department payroll</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-zinc-400 text-left border-b border-zinc-800">
                <th className="py-1.5 pr-2">Department</th>
                <th className="py-1.5 px-2 text-right">Headcount</th>
                <th className="py-1.5 px-2 text-right">Payroll</th>
                <th className="py-1.5 pl-2 text-right">Avg salary</th>
              </tr>
            </thead>
            <tbody>
              {data.departments.map((d) => (
                <tr key={d.department} className="border-b border-zinc-900 text-zinc-300">
                  <td className="py-1.5 pr-2 text-zinc-100">{d.department}</td>
                  <td className="py-1.5 px-2 text-right">{d.headcount}</td>
                  <td className="py-1.5 px-2 text-right">{usd(d.payroll)}</td>
                  <td className="py-1.5 pl-2 text-right">{usd(d.avgSalary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
      <p className="text-sm font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
