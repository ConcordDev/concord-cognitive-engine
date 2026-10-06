'use client';

/**
 * Detective: north-star chrome over the deduction board. Case browser and
 * dossier live in DetectiveBoardPanel; open cases or your own case file.
 */

import { useState } from 'react';
import { Search, FolderOpen } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { DetectiveBoardPanel, type DetectiveView } from '@/components/detective/DetectiveBoardPanel';

const VIEWS: { id: DetectiveView; label: string; keys: string; title: string; hint: string; icon: typeof Search }[] = [
  { id: 'open', label: 'Open cases', keys: '1', title: 'Cases waiting on you', hint: 'Browse unsolved cases', icon: Search },
  { id: 'mine', label: 'My case file', keys: '2', title: 'Your case file', hint: 'Cases you are working', icon: FolderOpen },
];

export default function DetectiveLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<DetectiveView>('open');

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: v.label,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'take-case', keys: 'n', description: 'Find a case to take', category: 'actions' as const, action: () => setActive('open') },
    ],
    { lensId: 'detective' },
  );

  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="detective" asMain={false}>
      <NorthStarFrame
        lensId="detective"
        crumb="Detective"
        title={`${current.title}${active === 'open' && who ? `, ${who}` : ''}`}
        subtitle="Open cases. Collect evidence. Lock in three facts."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, keys: v.keys, hint: v.hint, icon: v.icon }))}
        activeTab={active}
        onTab={(id) => setActive(id as DetectiveView)}
        cta={{ label: 'Find a case', icon: Search, onClick: () => setActive('open'), title: 'Find a case to take (N)' }}
      >
        <section>
          <DetectiveBoardPanel active={active} onActiveChange={setActive} />
        </section>
      </NorthStarFrame>
    </LensShell>
  );
}
