'use client';

/**
 * AnalysisPanel — artifact actions invariantCheck / consistencyProof /
 * constraintSatisfaction via useRunArtifact. Extracted from invariant/page.tsx.
 */

import { useState } from 'react';
import { Shield, Play, Loader2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import type { Invariant } from './invariant-types';

export function AnalysisPanel() {
  const runAction = useRunArtifact('invariant');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const { items: invariantItems, refetch } = useLensData<Invariant>('invariant', 'invariant', { seed: [] });

  const handleAction = async (action: string) => {
    let targetId = invariantItems[0]?.id;
    if (!targetId) {
      try {
        const created = await apiHelpers.lens.create('invariant', {
          type: 'invariant',
          title: 'System Invariant Set',
          data: {
            name: 'SYSTEM_INVARIANTS',
            description: 'Auto-created invariant set for analysis',
            status: 'enforced',
            category: 'structural',
            frozen: true,
          },
        });
        targetId = created?.data?.artifact?.id;
        if (targetId) refetch();
      } catch (e) {
        console.error('[Invariant] Failed to auto-create artifact:', e);
        setActionResult({ message: 'No invariant artifact found. Please try again.' });
        return;
      }
      if (!targetId) {
        setActionResult({ message: 'Could not create invariant artifact. Please try again.' });
        return;
      }
    }
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) {
        setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` });
      } else {
        setActionResult(res.result as Record<string, unknown>);
      }
    } catch (e) {
      console.error(`Action ${action} failed:`, e);
      setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` });
    } finally {
      setIsRunning(null);
    }
  };

  return (
    <div className="panel p-4 space-y-3">
      <h2 className="font-semibold flex items-center gap-2">
        <Shield className="w-4 h-4 text-neon-green" />
        Invariant Analysis
      </h2>
      <div className="flex flex-wrap gap-2">
        {['invariantCheck', 'consistencyProof', 'constraintSatisfaction'].map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => handleAction(action)}
            disabled={!!isRunning}
            className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50"
          >
            {isRunning === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            {action === 'invariantCheck' ? 'Check Invariants' : action === 'consistencyProof' ? 'Consistency Proof' : 'Constraint Satisfaction'}
          </button>
        ))}
      </div>
      {actionResult && (
        <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
          {'systemStatus' in actionResult && (
            <>
              <div className="flex items-center gap-3">
                <span className={`font-semibold ${actionResult.systemStatus === 'healthy' ? 'text-neon-green' : actionResult.systemStatus === 'critical' ? 'text-red-400' : 'text-yellow-400'}`}>
                  Status: {String(actionResult.systemStatus)}
                </span>
                <span className="text-gray-400">Health Score: {String(actionResult.healthScore)}</span>
              </div>
              {actionResult.summary && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {Object.entries(actionResult.summary as Record<string, unknown>).map(([k, v]) => (
                    <div key={k} className="bg-lattice-surface rounded p-2 text-center">
                      <div className="font-bold">{String(v)}</div><div className="text-gray-400 capitalize">{k}</div>
                    </div>
                  ))}
                </div>
              )}
              {Array.isArray(actionResult.violations) && actionResult.violations.length > 0 && (
                <div>
                  <div className="text-xs text-red-400 font-semibold mb-1">Violations:</div>
                  {(actionResult.violations as Record<string, unknown>[]).map((v, i) => (
                    <div key={i} className="text-xs text-gray-300 flex gap-2">
                      <span className="text-red-400">[{String(v.severity)}]</span>
                      <span>{String(v.name)}</span>
                      <span className="text-gray-400 font-mono">{String(v.expression)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {'consistent' in actionResult && (
            <>
              <div className="flex items-center gap-2">
                <span className={`font-semibold ${actionResult.consistent ? 'text-neon-green' : 'text-red-400'}`}>
                  {actionResult.consistent ? 'Consistent' : 'Inconsistent'}
                </span>
              </div>
              {actionResult.summary && (
                <div className="text-xs text-gray-400 space-y-1">
                  {Object.entries(actionResult.summary as Record<string, unknown>).map(([k, v]) => (
                    <div key={k} className="flex justify-between"><span className="capitalize">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</span><span className="font-mono">{String(v)}</span></div>
                  ))}
                </div>
              )}
              {Array.isArray(actionResult.divergentReplicas) && actionResult.divergentReplicas.length > 0 && (
                <div className="text-xs text-yellow-400">Divergent: {(actionResult.divergentReplicas as string[]).join(', ')}</div>
              )}
            </>
          )}
          {'feasible' in actionResult && (
            <>
              <div className="flex items-center gap-2">
                <span className={`font-semibold ${actionResult.feasible ? 'text-neon-green' : 'text-red-400'}`}>
                  {String(actionResult.status)} — {actionResult.feasible ? 'Feasible' : 'Unsatisfiable'}
                </span>
              </div>
              {actionResult.summary && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {Object.entries(actionResult.summary as Record<string, unknown>).map(([k, v]) => (
                    <div key={k} className="bg-lattice-surface rounded p-2 text-center">
                      <div className="font-bold">{String(v)}</div><div className="text-gray-400 capitalize">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</div>
                    </div>
                  ))}
                </div>
              )}
              {Array.isArray(actionResult.determined) && actionResult.determined.length > 0 && (
                <div className="text-xs">
                  <span className="text-neon-green font-semibold">Determined: </span>
                  {(actionResult.determined as Record<string, unknown>[]).map(d => `${d.name}=${d.value}`).join(', ')}
                </div>
              )}
            </>
          )}
          {'message' in actionResult && <p className="text-gray-400">{String(actionResult.message)}</p>}
        </div>
      )}
    </div>
  );
}
