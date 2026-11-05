'use client';

/**
 * Quantum: north-star chrome over the circuit composer (real state-vector
 * simulator) and the arXiv research surface.
 */

import { useState, type ComponentType } from 'react';
import { Atom, BookOpen } from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { ComposerPanel } from '@/components/quantum/ComposerPanel';
import { ResearchPanel } from '@/components/quantum/ResearchPanel';
import {
  type QuantumView,
  QUANTUM_NEW_CIRCUIT_EVENT, QUANTUM_NEW_CIRCUIT_PENDING_KEY,
} from '@/components/quantum/quantum-shared';

const PANELS: Record<QuantumView, ComponentType> = {
  composer: ComposerPanel,
  research: ResearchPanel,
};

export default function QuantumLensPage() {
  useLensNav('quantum');
  const [active, setActive] = useState<QuantumView>('composer');

  // "New circuit" performs a real fresh-circuit action in the panel
  // (F5: it used to only switch to the Composer view, which on the
  // Composer view itself was a no-op). The event reaches a mounted
  // panel immediately; the pending flag covers the Research view,
  // where the panel mounts a moment later and consumes it.
  const startNewCircuit = () => {
    setActive('composer');
    try { sessionStorage.setItem(QUANTUM_NEW_CIRCUIT_PENDING_KEY, '1'); } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(QUANTUM_NEW_CIRCUIT_EVENT));
  };

  useLensCommand(
    [
      { id: 'view-composer', keys: 'c', description: 'Circuit composer', category: 'navigation', action: () => setActive('composer') },
      { id: 'view-research', keys: 'r', description: 'Quantum research', category: 'navigation', action: () => setActive('research') },
      { id: 'new-circuit', keys: 'n', description: 'Start a new circuit', category: 'actions', action: startNewCircuit },
    ],
    { lensId: 'quantum' },
  );

  const Panel = PANELS[active];

  return (
    <LensShell lensId="quantum" asMain={false}>

      <DepthBadge lensId="quantum" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="quantum"
        crumb="Quantum"
        subtitle="Visual circuit composer with a real state-vector simulator."
        tabs={[
          { id: 'composer', label: 'Composer', icon: Atom, keys: 'c', hint: 'Circuit composer' },
          { id: 'research', label: 'Research', icon: BookOpen, keys: 'r', hint: 'arXiv quantum research' },
        ]}
        activeTab={active}
        onTab={(id) => setActive(id as QuantumView)}
        cta={{ label: 'New circuit', icon: Atom, onClick: startNewCircuit, title: 'Start a new circuit (N)' }}
      >
        <section key={active}>
          <Panel />
        </section>
      </NorthStarFrame>
    </LensShell>
  );
}
