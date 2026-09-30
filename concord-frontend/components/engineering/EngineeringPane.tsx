'use client';

import type { ComponentType } from 'react';
import { BomPanel } from './BomPanel';
import { TolerancePanel } from './TolerancePanel';
import { MultiDisciplineCalcPanel } from './MultiDisciplineCalcPanel';
import { GeometryPanel } from './GeometryPanel';
import { ModelPanel } from './ModelPanel';
import { LoadsPanel } from './LoadsPanel';
import { MaterialsPanel } from './MaterialsPanel';
import { AnalysisPanel } from './AnalysisPanel';
import { ResultsPanel } from './ResultsPanel';
import { FeedPanel } from './FeedPanel';
import { ActionsPanel } from './ActionsPanel';
import type { EngView } from './types';

const PANELS: Record<EngView, ComponentType> = {
  geometry: GeometryPanel,
  model: ModelPanel,
  loads: LoadsPanel,
  materials: MaterialsPanel,
  analysis: AnalysisPanel,
  bom: BomPanel,
  tolerance: TolerancePanel,
  calcs: MultiDisciplineCalcPanel,
  results: ResultsPanel,
  feed: FeedPanel,
  actions: ActionsPanel,
};

export function EngineeringPane({ active }: { active: EngView }) {
  const Panel = PANELS[active];
  return <Panel />;
}
