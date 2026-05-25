'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import type { CQDebt, CQHotspots, CQScan, CQTrendPoint } from './types';
import { CQ_SEVERITY_STYLE } from './types';

export function DebtTrendPanel({ scan }: { scan: CQScan | null }) {
  const [debt, setDebt] = useState<CQDebt | null>(null);
  const [trend, setTrend] = useState<CQTrendPoint[]>([]);
  const [hotspots, setHotspots] = useState<CQHotspots | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    Promise.all([
      scan
        ? lensRun<CQDebt>('code-quality', 'debt', { scanId: scan.scanId })
        : Promise.resolve(null),
      lensRun<{ points: CQTrendPoint[] }>('code-quality', 'trend', { limit: 30 }),
      scan
        ? lensRun<CQHotspots>('code-quality', 'hotspots', { scanId: scan.scanId })
        : Promise.resolve(null),
    ])
      .then(([d, t, h]) => {
        if (cancelled) return;
        if (d) {
          if (d.data.ok && d.data.result) setDebt(d.data.result);
          else setError(d.data.error || 'debt failed');
        }
        if (t.data.ok && t.data.result) setTrend(t.data.result.points);
        if (h) {
          if (h.data.ok && h.data.result) setHotspots(h.data.result);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scan]);

  const trendData = trend.map((p, i) => ({
    label: `#${i + 1}`,
    total: p.total,
    critical: p.critical,
    high: p.high,
    debtHours: p.debtHours,
    maintainability: p.maintainability,
  }));

  if (busy && !debt && !trend.length) {
    return <p className="text-sm text-gray-400">Loading debt + trend…</p>;
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div>
        <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-2">
          Issue trend over scan history
        </h3>
        {trendData.length < 2 ? (
          <p className="text-sm text-gray-400">
            Run at least two analyses to chart a trend.
          </p>
        ) : (
          <>
            <ChartKit
              kind="line"
              data={trendData}
              xKey="label"
              height={200}
              series={[
                { key: 'total', label: 'total issues', color: '#6366f1' },
                { key: 'critical', label: 'critical', color: '#ef4444' },
                { key: 'high', label: 'high', color: '#f59e0b' },
              ]}
            />
            <div className="mt-3">
              <ChartKit
                kind="area"
                data={trendData}
                xKey="label"
                height={160}
                series={[
                  { key: 'maintainability', label: 'maintainability', color: '#22c55e' },
                  { key: 'debtHours', label: 'debt (h)', color: '#ec4899' },
                ]}
              />
            </div>
          </>
        )}
      </div>

      {debt && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-2">
            Technical-debt estimate
          </h3>
          <div className="flex flex-wrap gap-3 mb-3">
            <Box label="total debt" value={`${debt.totalHours}h`} />
            <Box label="workdays" value={debt.workdays} />
            <Box label="debt ratio" value={`${debt.debtRatioPct}%`} />
            <Box label="SQALE rating" value={debt.rating} />
          </div>
          <div className="rounded border border-gray-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-black/40 text-gray-400">
                <tr>
                  <th className="text-left px-2 py-1.5">rule</th>
                  <th className="text-right px-2 py-1.5">count</th>
                  <th className="text-right px-2 py-1.5">effort</th>
                </tr>
              </thead>
              <tbody>
                {debt.byRule.map((r) => (
                  <tr key={r.rule} className="border-t border-gray-900">
                    <td className="px-2 py-1 font-mono text-gray-300">{r.rule}</td>
                    <td className="px-2 py-1 text-right font-mono text-gray-400">{r.count}</td>
                    <td className="px-2 py-1 text-right font-mono text-gray-200">{r.hours}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hotspots && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-2">
            Duplication &amp; complexity hotspots
          </h3>
          <p className="text-xs text-gray-400 mb-2">
            File duplication: {hotspots.duplicationPct}% ·{' '}
            {hotspots.duplicateBlocks.length} duplicate block
            {hotspots.duplicateBlocks.length === 1 ? '' : 's'}
          </p>
          {hotspots.functionHotspots.length > 0 ? (
            <div className="space-y-1.5">
              {hotspots.functionHotspots.map((fn, i) => (
                <div
                  key={`${fn.file}-${fn.function}-${i}`}
                  className="rounded border border-gray-800 bg-black/30 px-2 py-1.5 flex flex-wrap items-center gap-3 text-xs"
                >
                  <span className="font-mono text-gray-200">{fn.function}</span>
                  <span className="font-mono text-gray-400">
                    {fn.file}:{fn.startLine}
                  </span>
                  <span className="text-gray-400">cx {fn.complexity}</span>
                  <span className="text-gray-400">nest {fn.maxNesting}</span>
                  <span className="text-gray-400">{fn.lineCount} lines</span>
                  <span className="ml-auto font-mono text-orange-400">
                    risk {fn.riskScore}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-emerald-400">No function hotspots.</p>
          )}
          {hotspots.duplicateBlocks.length > 0 && (
            <div className="mt-2 space-y-1">
              {hotspots.duplicateBlocks.map((d, i) => (
                <div
                  key={`${d.file}-${d.line}-${i}`}
                  className={`rounded border px-2 py-1 text-xs ${CQ_SEVERITY_STYLE[d.severity]}`}
                >
                  <span className="font-mono">{d.file}:{d.line}</span> — {d.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Box({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-gray-700 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-gray-400 block">{label}</span>
      <span className="text-xl font-mono text-gray-100">{value}</span>
    </div>
  );
}
