'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Server, HardDrive, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api/client';
import { StatusCard } from './db-utils';

export function ConnectionStrip({ onRefreshExtra }: { onRefreshExtra?: () => void }) {
  const queryClient = useQueryClient();
  const { data: dbStatus, refetch: refetchDb } = useQuery({
    queryKey: ['db-status'],
    queryFn: () => api.get('/api/db/status').then(r => r.data),
    refetchInterval: 10000,
  });
  const { data: redisStats, refetch: refetchRedis } = useQuery({
    queryKey: ['redis-stats'],
    queryFn: () => api.get('/api/redis/stats').then(r => r.data),
    refetchInterval: 10000,
  });

  const refreshAll = () => {
    refetchDb();
    refetchRedis();
    queryClient.invalidateQueries({ queryKey: ['perf-metrics'] });
    queryClient.invalidateQueries({ queryKey: ['db-tables'] });
    queryClient.invalidateQueries({ queryKey: ['db-indexes'] });
    onRefreshExtra?.();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={refreshAll} className="btn-neon flex items-center gap-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
          <RefreshCw className="w-4 h-4" />
          Refresh All
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatusCard
          title="Storage Mode"
          value={dbStatus?.mode || 'in-memory'}
          icon={<HardDrive className="w-6 h-6" />}
          status={dbStatus?.mode === 'postgresql' ? 'success' : 'warning'}
        />
        <StatusCard
          title="PostgreSQL"
          value={dbStatus?.postgres?.connected ? 'Connected' : 'Disconnected'}
          icon={<Database className="w-6 h-6" />}
          status={dbStatus?.postgres?.connected ? 'success' : dbStatus?.postgres?.enabled ? 'error' : 'neutral'}
          detail={dbStatus?.postgres?.pool ? `Pool: ${dbStatus.postgres.pool.total} total, ${dbStatus.postgres.pool.idle} idle` : undefined}
        />
        <StatusCard
          title="Redis Cache"
          value={redisStats?.enabled ? 'Connected' : 'Fallback Mode'}
          icon={<Server className="w-6 h-6" />}
          status={redisStats?.enabled ? 'success' : 'warning'}
          detail={redisStats?.keys ? `${redisStats.keys} keys cached` : 'Using in-memory cache'}
        />
      </div>
    </div>
  );
}
