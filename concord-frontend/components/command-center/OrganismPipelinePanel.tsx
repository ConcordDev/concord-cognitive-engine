'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { StatusDot, Stat } from '@/components/command-center/cc-primitives';


export function OrganismPipelinePanel() {
  const { data } = useQuery({
    queryKey: ['cc-organism-pipeline'],
    queryFn: () => api.get('/api/organism/pipeline/status').then(r => r.data).catch(() => null),
    refetchInterval: 10000,
  });

  const pipeline = data?.pipeline;
  const wal = data?.wal;
  const snapshots = data?.snapshots;
  const health = data?.health;
  const recentCommits = (data?.recentCommits || []) as Array<{
    id: string; action: string; status: string; createdAt: string;
    updatedAt: string; dtuTitle: string | null; actor: { kind: string; id: string };
  }>;

  const healthColor = health?.status === 'healthy' ? 'text-neon-green' : health?.status === 'degraded' ? 'text-yellow-400' : 'text-red-400';
  const backlogColor = health?.proposalBacklog === 'low' ? 'text-neon-green' : health?.proposalBacklog === 'medium' ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Organism Pipeline</h3>

      {/* Health Status */}
      {health && (
        <div className="flex items-center gap-3 bg-lattice-surface rounded-lg p-3 border border-lattice-border">
          <StatusDot status={health.status === 'healthy' ? 'green' : health.status === 'degraded' ? 'yellow' : 'red'} />
          <span className={`text-sm font-medium ${healthColor}`}>{health.status}</span>
          <span className="text-xs text-gray-400 ml-auto">
            {pipeline?.enabled ? 'Pipeline enabled' : 'Pipeline disabled'}
          </span>
        </div>
      )}

      {/* Pipeline Counters */}
      {pipeline && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="Total Proposals" value={pipeline.totalProposals ?? '—'} />
          <Stat label="Pending" value={pipeline.pending ?? 0} sub={<span className={backlogColor}>{health?.proposalBacklog || 'unknown'} backlog</span>} />
          <Stat label="Verification Queue" value={pipeline.verificationQueue ?? 0} />
          <Stat label="Council Pending" value={pipeline.councilPending ?? 0} />
          <Stat label="Approved" value={pipeline.approved ?? 0} />
          <Stat label="Rejected" value={pipeline.rejected ?? 0} />
        </div>
      )}

      {/* WAL Status */}
      {wal && (
        <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase">Write-Ahead Log</p>
            <StatusDot status={wal.exists ? 'green' : 'gray'} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-gray-400">Size: </span>
              <span className="text-white font-mono">{wal.sizeFormatted}</span>
            </div>
            <div>
              <span className="text-gray-400">Status: </span>
              <span className={wal.exists ? 'text-neon-green' : 'text-gray-400'}>{wal.exists ? 'Active' : 'No WAL'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Snapshots */}
      {snapshots && (
        <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase">Snapshots (Rollback Points)</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-gray-400">Count: </span>
              <span className="text-white font-mono">{snapshots.count}</span>
            </div>
            <div className="truncate">
              <span className="text-gray-400">Latest: </span>
              <span className="text-gray-300 font-mono">{snapshots.latest || 'none'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Recent Commits */}
      {recentCommits.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase">Recent Commits (24h)</p>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {recentCommits.map(c => (
              <div key={c.id} className="flex items-center gap-2 bg-lattice-surface rounded p-2 border border-lattice-border text-xs">
                <StatusDot status="green" />
                <span className="text-white truncate flex-1">{c.dtuTitle || c.action}</span>
                <span className="text-gray-400 shrink-0">{c.actor?.id?.slice(0, 15) || 'system'}</span>
                <span className="text-gray-600 shrink-0">{c.createdAt ? new Date(c.createdAt).toLocaleTimeString() : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!data && <p className="text-xs text-gray-400 text-center py-4">Loading pipeline status...</p>}
    </div>
  );
}
