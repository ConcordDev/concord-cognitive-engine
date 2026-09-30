'use client';

import { Zap } from 'lucide-react';
import { FEAResultViewer } from './FEAResultViewer';
import type { FeaComputationResult } from './fea-verification';
import { SimHistoryPanel } from './SimHistoryPanel';
import { useEngineeringFea } from './EngineeringFeaProvider';

/** FEA result viewer + sim history — extracted from Results tab. */
export function ResultsPanel() {
  const { feaResult, feaNodes, feaMembers, feaDisplacements, historyKey, setActive } = useEngineeringFea();

  return (
    <div className="space-y-4">
      {!feaResult ? (
        <div className="panel p-8 text-center space-y-3">
          <Zap className="w-10 h-10 text-gray-600 mx-auto" />
          <p className="text-gray-400">No results yet. Run FEA from the Analysis tab.</p>
          <button
            onClick={() => setActive('analysis')}
            className="px-4 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30"
          >
            Go to Analysis
          </button>
        </div>
      ) : (
        <FEAResultViewer
          nodes={feaNodes ?? []}
          members={feaMembers ?? []}
          displacements={feaDisplacements}
          amplification={10}
          showDeformed={true}
          showStress={true}
          height="500px"
          result={feaResult as unknown as FeaComputationResult | null}
        />
      )}
      <SimHistoryPanel refreshKey={historyKey} />
    </div>
  );
}
