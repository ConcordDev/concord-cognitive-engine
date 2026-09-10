'use client';

/**
 * Creatures — one fauna ops desk.
 * Single view union: populations | codex | lineage. Panels own macros:
 * roster/breed/affect, species/taxonomy, lineage.
 */

import { useEffect, useState } from 'react';
import { Dna } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { PopulationsPanel } from '@/components/creatures/PopulationsPanel';
import { SpeciesCodexPanel } from '@/components/creatures/SpeciesCodexPanel';
import { LineagePanel } from '@/components/creatures/LineagePanel';
import type { CreaturesView } from '@/components/creatures/types';
import { cn } from '@/lib/utils';

const VIEWS: { id: CreaturesView; label: string; keys: string }[] = [
  { id: 'populations', label: 'Populations', keys: '1' },
  { id: 'codex', label: 'Species codex', keys: '2' },
  { id: 'lineage', label: 'Lineage', keys: '3' },
];

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
  const [worldId, setWorldId] = useState('concordia-hub');
  const [active, setActive] = useState<CreaturesView>('populations');

  useEffect(() => {
    const w = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    if (w) setWorldId(w);
  }, []);

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'creatures' },
  );

  return (
    <LensShell lensId="creatures">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-violet-200">
            <Dna size={22} aria-hidden /> Creatures
          </h1>
          <p className="text-sm text-zinc-400">{worldId} populations · crossbreeding pen · lineage browser</p>
        </header>

        <nav className="flex gap-1 border-b border-zinc-800" aria-label="Creatures views">
          {VIEWS.map((v) => {
            const on = active === v.id;
            return (
              <button key={v.id} type="button" onClick={() => setActive(v.id)}
                className={cn(
                  'px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on ? 'border-violet-400 text-violet-100' : 'border-transparent text-zinc-400 hover:text-zinc-200',
                )}
              >
                {v.label}
                <kbd className="ml-2 hidden sm:inline text-[10px] text-zinc-500">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <CreaturesPane active={active} worldId={worldId} />
      </div>
    </LensShell>
  );
}
