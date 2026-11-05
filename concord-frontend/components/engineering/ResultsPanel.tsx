'use client';

import { Zap } from 'lucide-react';
import { FEAResultViewer } from './FEAResultViewer';
import type { FeaComputationResult } from './fea-verification';
import { SimHistoryPanel } from './SimHistoryPanel';
import { EngineeringKeepMenu } from './EngineeringKeepMenu';
import { useEngineeringFea } from './EngineeringFeaProvider';

/** FEA result viewer + sim history — extracted from Results tab. */
export function ResultsPanel() {
  const { feaResult, feaNodes, feaMembers, feaDisplacements, historyKey, setActive, summary, staleRunNote } =
    useEngineeringFea();

  // Utilization basis (F14): every utilization figure in this lens is
  // combined stress ÷ the member's allowable stress. The solver carries
  // the allowable in each result entry (default 21,600 psi — the A36
  // ASD allowable — or the member material's own); print it wherever
  // utilization is shown so the percentage is checkable.
  const utilizationBasis = (() => {
    const utils = (feaResult as { utilization?: { id: string; allowableStress?: number }[] } | null)?.utilization;
    if (!utils || utils.length === 0) return null;
    const parts = utils
      .filter((u) => typeof u.allowableStress === 'number')
      .map((u) => `${u.id} ${u.allowableStress!.toLocaleString()} psi`);
    return parts.length > 0 ? parts.join(' · ') : null;
  })();

  return (
    <div className="space-y-4">
      {!feaResult ? (
        <div className="panel p-8 text-center space-y-3">
          <Zap className="w-10 h-10 text-gray-600 mx-auto" />
          {staleRunNote ? (
            <p className="text-gray-400">{staleRunNote}</p>
          ) : (
            <p className="text-gray-400">No results yet. Run FEA from the Analysis tab.</p>
          )}
          <button
            onClick={() => setActive('analysis')}
            className="px-4 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30"
          >
            Go to Analysis
          </button>
        </div>
      ) : (
        <>
          <FEAResultViewer
            nodes={feaNodes ?? []}
            members={feaMembers ?? []}
            displacements={feaDisplacements}
            amplification={10}
            showDeformed={true}
            showStress={true}
            stressUnit="psi"
            height="500px"
            result={feaResult as unknown as FeaComputationResult | null}
          />
          {utilizationBasis && (
            <p className="text-[11px] text-gray-500 px-1">
              Utilization basis: combined stress ÷ member allowable stress — {utilizationBasis}. The default
              21,600 psi is the A36 ASD allowable; a member's material sets its own where one is assigned.
            </p>
          )}
          <EngineeringKeepMenu
            facts={{
              jobName: 'FEA run',
              result: summary
                ? { ...(feaResult as Record<string, unknown>), summary }
                : (feaResult as Record<string, unknown>),
            }}
          />
        </>
      )}
      <SimHistoryPanel refreshKey={historyKey} />
    </div>
  );
}
