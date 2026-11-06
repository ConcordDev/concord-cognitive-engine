'use client';

import { useState, useEffect } from 'react';
import { Activity, Focus, X } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { getSocket } from '@/lib/realtime/socket';

interface AllocationEntry {
  domain: string;
  budget: number;
  urgency: number;
  focused?: boolean;
}

/**
 * The allocator payload is not reliably an array: before the first
 * allocation runs it can arrive as a domain-keyed map. Coerce both
 * shapes to a list; anything else is an empty allocation, never a
 * crash (the lens entry crash was `x.slice is not a function` on a
 * map-shaped payload).
 */
function toAllocationList(v: unknown): AllocationEntry[] {
  if (Array.isArray(v)) return v as AllocationEntry[];
  if (v && typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).filter(
      (e): e is AllocationEntry =>
        !!e && typeof e === 'object' && typeof (e as AllocationEntry).domain === 'string',
    );
  }
  return [];
}

function AttentionPanel() {
  const [allocation, setAllocation] = useState<AllocationEntry[]>([]);
  const [focusOverride, setFocusOverride] = useState<{
    domain: string;
    weight: number;
    expiresAt: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    apiHelpers.attentionAlloc
      .status()
      .then((resp) => {
        const data = resp.data;
        if (data?.lastAllocation?.allocation) {
          setAllocation(toAllocationList(data.lastAllocation.allocation));
        }
        if (data?.focusOverride) setFocusOverride(data.focusOverride);
        setLoading(false);
      })
      .catch(() => { setLoadFailed(true); setLoading(false); });

    const socket = getSocket();
    const handler = (data: {
      allocation: unknown;
      focusOverride: typeof focusOverride;
    }) => {
      if (data.allocation) setAllocation(toAllocationList(data.allocation));
      if (data.focusOverride !== undefined) setFocusOverride(data.focusOverride);
    };
    socket.on('attention:allocation', handler);
    return () => {
      socket.off('attention:allocation', handler);
    };
  }, []);

  const unfocus = async () => {
    try {
      await apiHelpers.attentionAlloc.unfocus();
      setFocusOverride(null);
    } catch (e) {
      console.error('Failed to clear focus override:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to clear focus override' });
    }
  };

  const totalBudget = allocation.reduce((sum, a) => sum + a.budget, 0) || 1;

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-neon-cyan" />
          Attention Allocator
        </h3>
        {focusOverride && (
          <button
            onClick={unfocus}
            className="text-xs text-red-400 flex items-center gap-1 hover:underline"
          >
            <X className="w-3 h-3" /> Clear Focus
          </button>
        )}
      </div>

      {focusOverride && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-2 text-xs text-yellow-400 flex items-center gap-2">
          <Focus className="w-3 h-3" />
          Focus override: <strong>{focusOverride.domain}</strong> @{' '}
          {(focusOverride.weight * 100).toFixed(0)}%
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : loadFailed ? (
        <p className="text-xs text-gray-400">
          The allocator&rsquo;s live state could not be loaded. This is an operator view of how
          the engine divides its attention across domains — nothing here needs your input.
        </p>
      ) : allocation.length === 0 ? (
        <p className="text-xs text-gray-400">No allocation has been computed yet.</p>
      ) : (
        <div className="space-y-1.5">
          {allocation.slice(0, 12).map((a) => (
            <div key={a.domain} className="flex items-center gap-2 text-xs">
              <span className="w-28 truncate text-gray-300" title={a.domain}>
                {a.domain}
              </span>
              <div className="flex-1 h-3 bg-lattice-deep rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${a.focused ? 'bg-yellow-500' : 'bg-neon-cyan/60'}`}
                  style={{ width: `${Math.max(2, (a.budget / totalBudget) * 100)}%` }}
                />
              </div>
              <span className="w-8 text-right text-gray-400">{a.budget}</span>
              <span className="w-12 text-right text-gray-400">{(a.urgency * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedAttentionPanel = withErrorBoundary(AttentionPanel);
export { _WrappedAttentionPanel as AttentionPanel };
