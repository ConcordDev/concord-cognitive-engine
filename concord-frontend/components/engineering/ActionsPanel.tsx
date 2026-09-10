'use client';

import { PipingProvider } from '@/components/panel-polish';
import { EngineeringActionPanel } from './EngineeringActionPanel';

/** Macro quick-actions — was an accordion under the welded page. */
export function ActionsPanel() {
  return (
    <PipingProvider>
      <EngineeringActionPanel />
    </PipingProvider>
  );
}
