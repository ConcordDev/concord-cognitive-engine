'use client';

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';


export function LogsPanel() {
  const { data: errors } = useQuery({ queryKey: ['cc-errors'], queryFn: () => apiHelpers.eventsLog.list({ type: 'error', limit: 20 }).then(r => r.data), refetchInterval: 15000 });
  const { data: traces } = useQuery({ queryKey: ['cc-slow-traces'], queryFn: () => apiHelpers.perf.metrics().then(r => r.data), refetchInterval: 30000 });
  const { data: rejections } = useQuery({ queryKey: ['cc-rejections'], queryFn: () => apiHelpers.eventsLog.list({ type: 'governance-rejection', limit: 20 }).then(r => r.data), refetchInterval: 60000 });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Logs & Traces</h3>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-red-400">Recent Errors ({errors?.count ?? 0})</p>
        <div className="max-h-48 overflow-y-auto space-y-1">
          {(errors?.errors || []).slice(0, 15).map((e: { source: string; message: string; at: string }, i: number) => (
            <div key={i} className="text-[11px] bg-red-950/30 border border-red-900/30 rounded p-2">
              <span className="text-red-400">{e.source}</span>
              <span className="text-gray-400 ml-2">{e.message?.slice(0, 80)}</span>
            </div>
          ))}
          {(!errors?.errors || errors.errors.length === 0) && <p className="text-xs text-gray-400">No recent errors</p>}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-yellow-400">Slow Requests ({traces?.traces?.length ?? 0})</p>
        <div className="max-h-32 overflow-y-auto space-y-1">
          {(traces?.traces || []).slice(0, 10).map((t: { path: string; durationMs: number }, i: number) => (
            <div key={i} className="text-[11px] flex justify-between bg-lattice-surface rounded p-1.5 border border-lattice-border">
              <span className="text-gray-300 truncate">{t.path}</span>
              <span className="text-yellow-400 ml-2">{t.durationMs}ms</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400">Governance Rejections ({rejections?.count ?? 0})</p>
        {(rejections?.rejections || []).slice(0, 5).map((r: { type?: string; event?: string; reason?: string }, i: number) => (
          <div key={i} className="text-[11px] bg-lattice-surface rounded p-1.5 border border-lattice-border text-gray-400">
            {r.type || r.event || 'rejection'} — {r.reason || '—'}
          </div>
        ))}
      </div>
    </div>
  );
}
