'use client';

/**
 * PhysicsSolversPanel — PhET-adjacent equation bench.
 * kinematicsSim / orbitalMechanics / waveInterference / thermodynamics
 * plus Keplerian orbitalMechanicsAdvanced. Workbench overlay for 1D/projectile.
 */

import { useState } from 'react';
import { Calculator, Orbit } from 'lucide-react';
import { PhysicsAdvancedLab } from '@/components/physics/PhysicsAdvancedLab';
import { PhysicsKeplerianLab } from '@/components/physics/PhysicsKeplerianLab';
import { PhysicsWorkbench } from '@/components/physics/PhysicsWorkbench';
import { PhysicsActionPanel } from '@/components/physics/PhysicsActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { ds } from '@/lib/design-system';

export function PhysicsSolversPanel() {
  const [workbenchOpen, setWorkbenchOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className={ds.heading2}>Solvers</h2>
          <p className={ds.textMuted}>
            Live contracts for kinematics, orbits, waves, thermo — plus Keplerian transfer Δv.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setWorkbenchOpen(true)}
          className={ds.btnSecondary}
        >
          <Calculator className="w-4 h-4" />
          Kinematics workbench
          <kbd className="ml-1 text-[10px] font-mono opacity-70">W</kbd>
        </button>
      </div>

      <PhysicsAdvancedLab />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-indigo-200 flex items-center gap-2">
          <Orbit className="w-4 h-4" />
          Keplerian lab
        </h3>
        <PhysicsKeplerianLab />
      </section>

      <PipingProvider>
        <PhysicsActionPanel />
      </PipingProvider>

      <PhysicsWorkbench open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />
    </div>
  );
}
