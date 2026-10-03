'use client';

/**
 * Housing: north-star chrome over player housing (claim / decorate / visit).
 * Screens live in panels; REST routes + land_claims.list_for_user preserved.
 */

import { useCallback, useState } from 'react';
import { Home, Compass, Hammer } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { MineHousesPanel } from '@/components/housing/MineHousesPanel';
import { VisitHousesPanel } from '@/components/housing/VisitHousesPanel';

type HousingView = 'mine' | 'visit';

const VIEWS: { id: HousingView; label: string; keys: string; title: string; hint: string; icon: typeof Home }[] = [
  { id: 'mine', label: 'My houses', keys: '1', title: 'Your places', hint: 'Claim land, place a building, decorate, lock the door', icon: Home },
  { id: 'visit', label: 'Visit', keys: '2', title: 'Someone else’s door', hint: 'Walk into public houses', icon: Compass },
];

export default function HousingLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<HousingView>('mine');
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const onFlash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 2500);
  }, []);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `housing-${v.id}`,
        keys: v.keys,
        description: v.label,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'housing-build', keys: 'n', description: 'Claim land and build', category: 'actions' as const, action: () => setActive('mine') },
    ],
    { lensId: 'housing' },
  );

  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="housing" asMain={false}>
      <NorthStarFrame
        lensId="housing"
        crumb="Housing"
        title={`${current.title}${active === 'mine' && who ? `, ${who}` : ''}`}
        subtitle="Claim land, place a building, decorate, lock the door."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, keys: v.keys, hint: v.hint, icon: v.icon }))}
        activeTab={active}
        onTab={(id) => setActive(id as HousingView)}
        cta={{ label: 'Claim & build', icon: Hammer, onClick: () => setActive('mine'), title: 'Claim land and build (N)' }}
      >
        {flash && (
          <div
            role="status"
            className={`mb-4 rounded-xl px-3 py-2 text-[12px] ${flash.kind === 'ok' ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/30 bg-rose-500/10 text-rose-200'}`}
          >
            {flash.msg}
          </div>
        )}
        {active === 'mine' ? (
          <MineHousesPanel flash={flash} onFlash={onFlash} />
        ) : (
          <VisitHousesPanel onFlash={onFlash} />
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
