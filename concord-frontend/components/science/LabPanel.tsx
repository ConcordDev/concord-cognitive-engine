'use client';

/**
 * Lab ops panel — Quartzy/Benchling action surface (calibration, protocol,
 * custody, audit). Extracted wrapper; macros live in ExperimentActionPanel.
 */

import { PipingProvider } from '@/components/panel-polish';
import { ExperimentActionPanel } from '@/components/science/ExperimentActionPanel';

export function LabPanel() {
  return (
    <PipingProvider>
      <section className="mt-1">
        <ExperimentActionPanel />
      </section>
    </PipingProvider>
  );
}

export default LabPanel;
