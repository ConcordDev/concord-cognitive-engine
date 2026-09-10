'use client';

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  Users
} from 'lucide-react';
import { Stat } from '@/components/command-center/cc-primitives';


export function UserPanel() {
  const { data } = useQuery({ queryKey: ['cc-admin-stats'], queryFn: () => apiHelpers.analytics.dashboard().then(r => r.data).catch((err) => { console.error('Failed to fetch admin stats:', err instanceof Error ? err.message : err); return {}; }), refetchInterval: 60000 });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">User Overview</h3>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Total Users" value={data?.totalUsers ?? '—'} />
        <Stat label="Active (24h)" value={data?.activeUsers24h ?? '—'} />
        <Stat label="New Today" value={data?.newToday ?? '—'} />
        <Stat label="WS Connections" value={data?.wsConnections ?? '—'} />
      </div>
      <p className="text-[10px] text-gray-400 text-center">Aggregate metrics only. No individual user data exposed.</p>
    </div>
  );
}
