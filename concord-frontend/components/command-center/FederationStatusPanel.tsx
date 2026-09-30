'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  Activity
} from 'lucide-react';
import { StatusDot, Stat } from '@/components/command-center/cc-primitives';


export function FederationStatusPanel() {
  const { data: status } = useQuery({
    queryKey: ['cc-federation-status'],
    queryFn: () => api.get('/api/federation/status').then(r => r.data).catch(() => null),
    refetchInterval: 15000,
  });
  const { data: peers } = useQuery({
    queryKey: ['cc-federation-peers'],
    queryFn: () => api.get('/api/federation/peers').then(r => r.data).catch(() => null),
    refetchInterval: 30000,
  });
  const { data: escalation } = useQuery({
    queryKey: ['cc-federation-escalation'],
    queryFn: () => api.get('/api/federation/escalation/stats').then(r => r.data).catch(() => null),
    refetchInterval: 60000,
  });

  const federation = status?.federation || {};
  const enabled = status?.enabled ?? false;
  const peerList = peers?.peers || [];
  const trustedNodes = federation?.trustedNodes ?? federation?.nodes?.length ?? 0;
  const escalationStats = escalation || {};
  const hasPeers = peerList.length > 0 || trustedNodes > 0;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Federation</h3>

      {!hasPeers ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-500/10 border border-zinc-500/20 text-sm text-zinc-400">
          <Activity className="w-4 h-4" />
          <span>Standalone mode — federation available when peers connect</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20 text-sm text-neon-cyan">
          <Activity className="w-4 h-4" />
          <span>Federation active — {trustedNodes || peerList.length} peer{(trustedNodes || peerList.length) !== 1 ? 's' : ''} connected</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Status" value={enabled ? 'Enabled' : 'Disabled'} />
        <Stat label="Trusted Nodes" value={trustedNodes || 0} />
        <Stat label="Peers" value={peerList.length} />
      </div>

      {(federation?.nodes?.length > 0 || peerList.length > 0) && (
        <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-lattice-border">
          <p className="text-xs font-semibold text-gray-400 uppercase">Connected Instances</p>
          {(federation?.nodes || []).map((node: { id: string; trustScore?: number }, i: number) => (
            <div key={node.id || i} className="flex items-center gap-2 text-xs">
              <StatusDot status="green" />
              <span className="text-gray-300 flex-1 truncate font-mono">{node.id}</span>
              {node.trustScore != null && <span className="text-gray-400">trust: {node.trustScore}</span>}
            </div>
          ))}
          {peerList.map((peer: { id?: string; entityId?: string; peerType?: string }, i: number) => (
            <div key={peer.id || peer.entityId || i} className="flex items-center gap-2 text-xs">
              <StatusDot status="green" />
              <span className="text-gray-300 flex-1 truncate font-mono">{peer.id || peer.entityId}</span>
              {peer.peerType && <span className="text-gray-400">{peer.peerType}</span>}
            </div>
          ))}
        </div>
      )}

      {escalationStats?.ok && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400">Federated DTU Count</p>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Escalated" value={escalationStats.totalEscalated ?? escalationStats.count ?? 0} />
            <Stat label="Regional" value={escalationStats.regional ?? 0} />
            <Stat label="National" value={escalationStats.national ?? 0} />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-lattice-surface border border-lattice-border text-xs text-gray-400">
        <StatusDot status={enabled ? 'green' : 'gray'} />
        <span>Sync: {enabled ? 'Active — DTUs propagate on federation channel' : 'Inactive — local-first mode'}</span>
      </div>
    </div>
  );
}
