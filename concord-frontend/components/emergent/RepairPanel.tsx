'use client';

import { useState, useEffect } from 'react';
import { Wrench, Zap, Activity, Lock } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';

// Repair Cortex is a SYSTEM-level surface (one loop for the whole server,
// not per-user) — reading status is safe for anyone, but forcing a cycle
// is a mutating admin action. Gate it the same way `isLensVisible` gates
// the admin/command-center lenses (`lib/lens-registry.ts`): real role
// synced from `/api/auth/me` into `useUIStore.userRole` (Providers.tsx),
// fail-closed to 'user' when unauthenticated/unknown.
function isRepairAdmin(role: string): boolean {
  return role === 'admin' || role === 'sovereign';
}

interface RepairStatus {
  ok: boolean;
  loopRunning: boolean;
  cycleCount: number;
  lastCycleResult: { patternsChecked: number; fixesApplied: number } | null;
  errorAccumulator: { size: number };
  executors: Record<string, { canApply: boolean }>;
  repairNetwork?: { enabled: boolean; lastPush: string | null; lastPull: string | null };
}

function RepairPanel() {
  const [status, setStatus] = useState<RepairStatus | null>(null);
  const [forcing, setForcing] = useState(false);
  const userRole = useUIStore((s) => s.userRole);
  const canForceCycle = isRepairAdmin(userRole);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const resp = await apiHelpers.repairExtended.fullStatus();
      setStatus(resp.data);
    } catch (e) {
      console.error('[RepairPanel] Failed to load status:', e);
    }
  };

  const forceCycle = async () => {
    setForcing(true);
    try {
      await apiHelpers.repairExtended.forceCycle();
      await loadStatus();
    } catch (e) {
      console.error('[RepairPanel] Failed to force repair cycle:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to force repair cycle' });
    }
    setForcing(false);
  };

  return (
    <div className="panel p-4 space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <Wrench className="w-4 h-4 text-orange-400" />
        Repair Cortex
      </h3>

      {status ? (
        <>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="bg-lattice-deep rounded p-2 text-center">
              <p className="text-gray-400">Cycles</p>
              <p className="text-lg font-mono text-gray-200">{status.cycleCount || 0}</p>
            </div>
            <div className="bg-lattice-deep rounded p-2 text-center">
              <p className="text-gray-400">Errors</p>
              <p className="text-lg font-mono text-gray-200">
                {status.errorAccumulator?.size || 0}
              </p>
            </div>
            <div className="bg-lattice-deep rounded p-2 text-center">
              <p className="text-gray-400">Fixes</p>
              <p className="text-lg font-mono text-gray-200">
                {status.lastCycleResult?.fixesApplied || 0}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${status.loopRunning ? 'bg-green-400' : 'bg-red-400'}`}
            />
            <span className="text-gray-400">
              {status.loopRunning ? 'Loop active (30s)' : 'Loop stopped'}
            </span>
          </div>

          {/* Executor Status */}
          {status.executors && (
            <div className="text-xs text-gray-400">
              {Object.entries(status.executors).filter(([, v]) => v.canApply).length} executors
              ready
            </div>
          )}

          {/* Network Status */}
          {status.repairNetwork?.enabled && (
            <div className="bg-lattice-deep rounded p-2 text-xs flex items-center gap-2">
              <Activity className="w-3 h-3 text-neon-cyan" />
              <span className="text-gray-400">Repair Network: connected</span>
            </div>
          )}

          {canForceCycle ? (
            <button
              onClick={forceCycle}
              disabled={forcing}
              className="w-full bg-orange-500/10 border border-orange-500/30 rounded py-1.5 text-xs text-orange-400 hover:bg-orange-500/20 disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <Zap className="w-3 h-3" /> {forcing ? 'Running...' : 'Force Repair Cycle'}
            </button>
          ) : (
            <button
              disabled
              title="Forcing a repair cycle is a system-wide action, restricted to admin/sovereign roles"
              className="w-full bg-lattice-deep border border-lattice-border rounded py-1.5 text-xs text-gray-500 opacity-60 cursor-not-allowed flex items-center justify-center gap-1"
            >
              <Lock className="w-3 h-3" /> Force Repair Cycle (admin only)
            </button>
          )}
        </>
      ) : (
        <p className="text-xs text-gray-400">Loading...</p>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedRepairPanel = withErrorBoundary(RepairPanel);
export { _WrappedRepairPanel as RepairPanel };
