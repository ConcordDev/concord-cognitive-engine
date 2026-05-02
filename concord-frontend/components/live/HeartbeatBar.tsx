'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { subscribe, connectSocket } from '@/lib/realtime/socket';
import { Zap, Shield, Brain, Radio } from 'lucide-react';
import { use70Lock } from '@/hooks/use70Lock';

interface EmergentEntity {
  id?: string;
  role?: string;
  name?: string;
  state?: string;
  status?: string;
  active?: boolean;
  activity?: string;
}

interface EmergentStatusData {
  emergents?: EmergentEntity[];
  entities?: EmergentEntity[];
  active?: number;
  total?: number;
}

function HeartbeatBar() {
  const queryClient = useQueryClient();
  const { lockPercentage } = use70Lock();
  const [liveDtuCount, setLiveDtuCount] = useState<number | null>(null);
  const [recentDtuFlash, setRecentDtuFlash] = useState(false);

  // Fetch emergent status
  const { data: emergentData } = useQuery({
    queryKey: ['emergent-status'],
    queryFn: () => apiHelpers.emergent.status().then((r) => r.data as EmergentStatusData),
    refetchInterval: 15000,
    retry: false,
  });

  // Fetch scope metrics
  const { data: scopeData } = useQuery({
    queryKey: ['scope-metrics'],
    queryFn: () => apiHelpers.scope.metrics().then((r) => r.data),
    refetchInterval: 30000,
    retry: false,
  });

  // Fetch resonance for DTU count
  const { data: resonance } = useQuery({
    queryKey: ['resonance-quick'],
    queryFn: () => apiHelpers.emergent.resonance().then((r) => r.data),
    refetchInterval: 15000,
    retry: false,
  });

  // Connect socket and subscribe to real-time events
  useEffect(() => {
    connectSocket();

    const unsubDtu = subscribe<{ id?: string; count?: number }>('dtu:created', (_data) => {
      // Flash indicator
      setRecentDtuFlash(true);
      setTimeout(() => setRecentDtuFlash(false), 1500);

      // Increment count
      setLiveDtuCount((prev) => (prev ?? 0) + 1);

      // Invalidate queries so dashboard updates
      queryClient.invalidateQueries({ queryKey: ['dtus-paginated'] });
      queryClient.invalidateQueries({ queryKey: ['resonance-quick'] });
    });

    const unsubPromoted = subscribe<{ id?: string }>('dtu:promoted', () => {
      queryClient.invalidateQueries({ queryKey: ['council-actions'] });
    });

    const unsubCouncil = subscribe<{ id?: string }>('council:vote', () => {
      queryClient.invalidateQueries({ queryKey: ['council-actions'] });
    });

    const unsubResonance = subscribe<unknown>('resonance:update', () => {
      queryClient.invalidateQueries({ queryKey: ['resonance-quick'] });
      queryClient.invalidateQueries({ queryKey: ['emergent-status'] });
    });

    return () => {
      unsubDtu();
      unsubPromoted();
      unsubCouncil();
      unsubResonance();
    };
  }, [queryClient]);

  // Sync live count with server count
  const serverDtuCount = ((resonance as Record<string, unknown>)?.dtuCount as number) || 0;
  const displayCount =
    liveDtuCount !== null ? Math.max(liveDtuCount, serverDtuCount) : serverDtuCount;

  // Reset live count when server count updates
  useEffect(() => {
    if (serverDtuCount > 0) {
      setLiveDtuCount(serverDtuCount);
    }
  }, [serverDtuCount]);

  const emergents =
    (emergentData as EmergentStatusData)?.emergents ||
    (emergentData as EmergentStatusData)?.entities ||
    [];
  const activeEmergents = emergents.filter(
    (e: EmergentEntity) =>
      e.state === 'active' || e.state === 'thinking' || e.status === 'active' || e.active === true
  );

  return (
    <div className="flex items-center gap-1.5 lg:gap-3 text-xs">
      {/* Live DTU Counter */}
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-all ${
          recentDtuFlash
            ? 'bg-neon-cyan/20 text-neon-cyan ring-1 ring-neon-cyan/50'
            : 'bg-lattice-deep text-gray-300'
        }`}
        title={`${displayCount.toLocaleString()} DTUs in the lattice`}
      >
        <Zap
          className={`w-3.5 h-3.5 ${recentDtuFlash ? 'text-neon-cyan animate-pulse' : 'text-neon-blue'}`}
        />
        <span className="font-mono font-medium tabular-nums">{displayCount.toLocaleString()}</span>
        <span className="hidden xl:inline text-gray-500">DTUs</span>
      </div>

      {/* Active Emergents */}
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-lattice-deep"
        title={`${activeEmergents.length} emergent${activeEmergents.length !== 1 ? 's' : ''} active`}
      >
        <Brain
          className={`w-3.5 h-3.5 ${activeEmergents.length > 0 ? 'text-neon-purple animate-pulse' : 'text-gray-500'}`}
        />
        <span className="font-mono">{activeEmergents.length}</span>
        <span className="hidden xl:inline text-gray-500">active</span>
        {/* Mini role indicators */}
        <div className="hidden lg:flex items-center gap-0.5 ml-0.5">
          {activeEmergents.slice(0, 3).map((e: EmergentEntity, i: number) => (
            <EmergentDot
              key={e.id || i}
              role={e.role || 'unknown'}
              name={e.name || e.role || 'Emergent'}
            />
          ))}
          {activeEmergents.length > 3 && (
            <span className="text-gray-500 text-[10px]">+{activeEmergents.length - 3}</span>
          )}
        </div>
      </div>

      {/* Sovereignty Badge */}
      <div
        className="hidden md:flex items-center gap-1 px-2 py-1 rounded-md bg-neon-green/10 text-neon-green"
        title={`${lockPercentage}% Sovereignty Lock - Immutable core protections`}
      >
        <Shield className="w-3.5 h-3.5" />
        <span className="font-mono font-medium">{lockPercentage}%</span>
      </div>

      {/* Scope Metrics */}
      {scopeData && (
        <div
          className="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded-md bg-lattice-deep text-gray-300"
          title={`Scope: ${(scopeData as Record<string, unknown>).local ?? 0} local · ${(scopeData as Record<string, unknown>).marketplace ?? 0} market · ${(scopeData as Record<string, unknown>).global ?? 0} global`}
        >
          <span className="font-mono text-xs">
            {String((scopeData as Record<string, unknown>).total ?? 0)}
          </span>
          <span className="text-gray-500 text-xs">scope</span>
        </div>
      )}

      {/* Live Pulse */}
      <div className="flex items-center gap-1 px-1.5 py-1" title="System generating autonomously">
        <Radio
          className={`w-3 h-3 ${activeEmergents.length > 0 ? 'text-neon-cyan animate-pulse' : 'text-gray-600'}`}
        />
      </div>
    </div>
  );
}

const ROLE_COLORS: Record<string, string> = {
  builder: 'bg-neon-green',
  critic: 'bg-red-400',
  historian: 'bg-amber-400',
  economist: 'bg-neon-blue',
  ethicist: 'bg-neon-purple',
  synthesizer: 'bg-neon-cyan',
  cipher: 'bg-white',
};

function EmergentDot({ role, name }: { role: string; name: string }) {
  const color = ROLE_COLORS[role.toLowerCase()] || 'bg-gray-400';
  return <span className={`w-1.5 h-1.5 rounded-full ${color}`} title={name} />;
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedHeartbeatBar = withErrorBoundary(HeartbeatBar);
export { _WrappedHeartbeatBar as HeartbeatBar };
