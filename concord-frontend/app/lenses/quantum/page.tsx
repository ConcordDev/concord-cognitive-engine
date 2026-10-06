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
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { ComposerPanel } from '@/components/quantum/ComposerPanel';
import { ResearchPanel } from '@/components/quantum/ResearchPanel';
import { type QuantumView } from '@/components/quantum/quantum-shared';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

const PANELS: Record<QuantumView, ComponentType> = {
  composer: ComposerPanel,
  research: ResearchPanel,
};

export default function QuantumLensPage() {
  useLensNav('quantum');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<QuantumView>('composer');

  useLensCommand(
    [
      { id: 'view-composer', keys: 'c', description: 'Circuit composer', category: 'navigation', action: () => setActive('composer') },
      { id: 'view-research', keys: 'r', description: 'Quantum research', category: 'navigation', action: () => setActive('research') },
      { id: 'new-circuit', keys: 'n', description: 'Compose a circuit', category: 'actions', action: () => setActive('composer') },
    ],
    { lensId: 'quantum' },
  );

  const Panel = PANELS[active];

  return (
    <LensShell lensId="quantum" asMain={false}>
      <FirstRunTour lensId="quantum" />
      <DepthBadge lensId="quantum" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="quantum"
        crumb="Quantum"
        title={active === 'composer' ? `Build a circuit${who ? `, ${who}` : ''}` : 'What the field is publishing'}
        subtitle="Visual circuit composer with a real state-vector simulator."
        tabs={[
          { id: 'composer', label: 'Composer', icon: Atom, keys: 'c', hint: 'Circuit composer' },
          { id: 'research', label: 'Research', icon: BookOpen, keys: 'r', hint: 'arXiv quantum research' },
        ]}
        activeTab={active}
        onTab={(id) => setActive(id as QuantumView)}
        cta={{ label: 'New circuit', icon: Atom, onClick: () => setActive('composer'), title: 'Compose a circuit (N)' }}
      >
        <section key={active}>
          <Panel />
        </section>
      </NorthStarFrame>
    </LensShell>
  );
}
