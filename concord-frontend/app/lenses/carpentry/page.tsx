'use client';

/**
 * Carpentry lens: a real trade-management + shop-calculator surface. Every
 * view calls genuine `carpentry.*` macros (server/domains/carpentry.js):
 *
 *   JobOps              cut-list optimizer, material takeoff to estimate,
 *                       crew roster + dispatch calendar, time tracking, photo
 *                       log, estimate to invoice with e-signature + portal.
 *   CarpentryShop       board-foot calculator, joint-strength guide, wood
 *                       selection guide, finish recommender.
 *   WoodSpeciesReference live Wikipedia REST lookups for named species.
 *
 * See docs/lens-specs/carpentry-capability-map.md.
 */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { Briefcase, Hammer, Ruler, TreePine } from 'lucide-react';
import { WoodSpeciesReference } from '@/components/carpentry/WoodSpeciesReference';
import { CarpentryShop } from '@/components/carpentry/CarpentryShop';
import { JobOps } from '@/components/carpentry/JobOps';

type CarpView = 'jobs' | 'shop' | 'wood';

const VIEWS: { id: CarpView; label: string; keys: string; title: string; hint: string; icon: typeof Hammer }[] = [
  { id: 'jobs', label: 'Jobs', keys: '1', title: 'What is on the bench', hint: 'Cut lists, takeoffs, crew, time, photos, estimates and invoices', icon: Briefcase },
  { id: 'shop', label: 'Shop calculators', keys: '2', title: 'Measure twice', hint: 'Board feet, joint strength, wood selection and finish', icon: Ruler },
  { id: 'wood', label: 'Wood species', keys: '3', title: 'Know your lumber', hint: 'Live species reference lookups', icon: TreePine },
];

const card = 'rounded-2xl border border-white/10 bg-[#111] p-4';

export default function CarpentryLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<CarpView>('jobs');
  useLensCommand(
    VIEWS.map((v) => ({
      id: `carpentry-${v.id}`,
      keys: v.keys,
      description: `${v.label}: ${v.hint}`,
      category: 'navigation' as const,
      action: () => setView(v.id),
    })),
    { lensId: 'carpentry' },
  );
  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <LensShell lensId="carpentry" asMain={false}>
      <FirstRunTour lensId="carpentry" />
      <DepthBadge lensId="carpentry" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="carpentry"
        crumb="Carpentry"
        title={`${current.title}${view === 'jobs' && who ? `, ${who}` : ''}`}
        subtitle="Cut lists, material takeoffs, crew dispatch, time tracking, photo logs and estimate-to-invoice with a client portal, plus the shop calculators."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={view}
        onTab={(id) => setView(id as CarpView)}
        tabsLabel="Carpentry views"
        cta={{ label: 'Open shop calculators', icon: Hammer, onClick: () => setView('shop'), title: 'Board feet, joints, wood and finish' }}
      >
        <div id="carpentry-skip" className="space-y-5">
          {view === 'jobs' && (
            <section aria-label="Trade job management">
              <JobOps />
            </section>
          )}
          {view === 'shop' && (
            <section aria-label="Shop calculator suite" className={card}>
              <CarpentryShop />
            </section>
          )}
          {view === 'wood' && (
            <section aria-label="Wood species reference" className={card}>
              <WoodSpeciesReference />
            </section>
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
