'use client';

/**
 * SimHistoryPanel — "Simulation Studies" run history (Fusion 360 / SimScale
 * shape). Backs `engineering.listSimJobs`, which was registered but had zero
 * frontend call sites — every FEA run persisted a job (name, elapsedMs,
 * summary, timestamp) into the per-user store, but nothing ever read it
 * back. This renders that history so a past run's pass/fail + peak
 * utilization is visible without re-running the analysis.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { History, RefreshCw, Loader2, CheckCircle2, XCircle } from 'lucide-react';

interface SimJob {
  id: string;
  name: string;
  type: string;
  status: string;
  elapsedMs: number;
  summary?: { maxDisplacement?: number; maxUtilization?: number; allPass?: boolean; memberCount?: number };
  createdAt: string;
}

export function SimHistoryPanel({ refreshKey }: { refreshKey?: unknown }) {
  const [jobs, setJobs] = useState<SimJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const r = await lensRun<{ jobs: SimJob[] }>('engineering', 'listSimJobs', {});
    if (r.data.ok && r.data.result) setJobs(r.data.result.jobs || []);
    else setError(r.data.error || 'Failed to load simulation history');
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <div className="panel p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <History className="w-4 h-4 text-purple-400" /> Simulation History
        </h3>
        <button
          onClick={load}
          className="text-gray-400 hover:text-white"
          aria-label="Refresh simulation history"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!loading && !error && jobs.length === 0 && (
        <p className="text-xs text-gray-400 py-3 text-center">
          No runs yet. Solve a model from the Analysis tab to build history.
        </p>
      )}
      {jobs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-white/10">
                <th className="text-left py-1 px-2">Run</th>
                <th className="text-right py-1 px-2">Members</th>
                <th className="text-right py-1 px-2">Max util.</th>
                <th className="text-right py-1 px-2">Max disp.</th>
                <th className="text-right py-1 px-2">Elapsed</th>
                <th className="text-center py-1 px-2">Status</th>
                <th className="text-right py-1 px-2">When</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-white/5">
                  <td className="py-1 px-2 truncate max-w-[10rem]">{j.name}</td>
                  <td className="py-1 px-2 text-right font-mono text-gray-300">{j.summary?.memberCount ?? '—'}</td>
                  <td className="py-1 px-2 text-right font-mono">
                    <span className={j.summary?.allPass === false ? 'text-red-400' : 'text-green-400'}>
                      {j.summary?.maxUtilization != null ? `${(j.summary.maxUtilization * 100).toFixed(1)}%` : '—'}
                    </span>
                  </td>
                  <td className="py-1 px-2 text-right font-mono text-gray-300">
                    {j.summary?.maxDisplacement != null ? `${j.summary.maxDisplacement.toFixed(4)}"` : '—'}
                  </td>
                  <td className="py-1 px-2 text-right font-mono text-gray-400">{j.elapsedMs} ms</td>
                  <td className="py-1 px-2 text-center">
                    {j.summary?.allPass ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-400 inline" aria-label="Pass" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-400 inline" aria-label="Fail" />
                    )}
                  </td>
                  <td className="py-1 px-2 text-right text-gray-500">
                    {new Date(j.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
