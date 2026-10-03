'use client';

/**
 * Creatures: north-star chrome over the fauna ops desk. Populations (roster,
 * crossbreeding pen), species codex, and lineage browser.
 */

import { useState, useSyncExternalStore } from 'react';
import { Dna, GitBranch, BookMarked, PawPrint } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { PopulationsPanel } from '@/components/creatures/PopulationsPanel';
import { SpeciesCodexPanel } from '@/components/creatures/SpeciesCodexPanel';
import { LineagePanel } from '@/components/creatures/LineagePanel';
import type { CreaturesView } from '@/components/creatures/types';

const VIEWS: { id: CreaturesView; label: string; keys: string; title: string; hint: string; icon: typeof Dna }[] = [
  { id: 'populations', label: 'Populations', keys: '1', title: 'Who lives here', hint: 'Roster and crossbreeding pen', icon: PawPrint },
  { id: 'codex', label: 'Species codex', keys: '2', title: 'Every kind of creature', hint: 'Species and taxonomy', icon: BookMarked },
  { id: 'lineage', label: 'Lineage', keys: '3', title: 'Where they come from', hint: 'Lineage browser', icon: GitBranch },
];

const DEFAULT_WORLD = 'concordia-hub';
const subscribeNoop = () => () => {};
function readActiveWorld(): string {
  try {
    return localStorage.getItem('concordia:activeWorldId') || DEFAULT_WORLD;
  } catch {
    return DEFAULT_WORLD;
  }
}

function CreaturesPane({ active, worldId }: { active: CreaturesView; worldId: string }) {
  switch (active) {
    case 'populations':
      return <PopulationsPanel worldId={worldId} />;
    case 'codex':
      return <SpeciesCodexPanel />;
    case 'lineage':
      return <LineagePanel />;
  }
}

export default function CreaturesLensPage() {
  useLensNav('creatures');
  const worldId = useSyncExternalStore(subscribeNoop, readActiveWorld, () => DEFAULT_WORLD);
  const [active, setActive] = useState<CreaturesView>('populations');

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: v.label,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'breed', keys: 'n', description: 'Open the crossbreeding pen', category: 'actions' as const, action: () => setActive('populations') },
    ],
    { lensId: 'creatures' },
  );

  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="creatures" asMain={false}>
      <NorthStarFrame
        lensId="creatures"
        crumb={`Creatures · ${worldId}`}
        title={current.title}
        subtitle="Populations, crossbreeding pen and lineage browser."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, keys: v.keys, hint: v.hint, icon: v.icon }))}
        activeTab={active}
        onTab={(id) => setActive(id as CreaturesView)}
        cta={{ label: 'Breed a pair', icon: Dna, onClick: () => setActive('populations'), title: 'Open the crossbreeding pen (N)' }}
      >
        <section key={active}>
          <CreaturesPane active={active} worldId={worldId} />
        </section>
      </NorthStarFrame>
    </LensShell>
  );
}
