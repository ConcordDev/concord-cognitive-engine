'use client';

/**
 * Disputes — one online dispute-resolution app.
 *
 * Reference: eBay/PayPal Resolution Center + Modria ODR workbench.
 * Single view union (cases | workbench | law). Accordion for CaseWorkbench
 * is gone; LawStackFeed is its own tab. Page is a thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Briefcase, Gavel, Scale, Shield } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { CasesPanel } from '@/components/disputes/CasesPanel';
import { WorkbenchPanel } from '@/components/disputes/WorkbenchPanel';
import { LawFeedPanel } from '@/components/disputes/LawFeedPanel';

type DisputesView = 'cases' | 'workbench' | 'law';

const VIEWS: { id: DisputesView; label: string; keys: string; hint: string; icon: typeof Shield }[] = [
  { id: 'cases', label: 'Cases', keys: '1', hint: 'My disputes + admin queue', icon: Briefcase },
  { id: 'workbench', label: 'ODR workbench', keys: '2', hint: 'Full case lifecycle', icon: Gavel },
  { id: 'law', label: 'Law stack', keys: '3', hint: 'Precedent + legal feed', icon: Scale },
];

const PANELS: Record<DisputesView, ComponentType> = {
  cases: CasesPanel,
  workbench: WorkbenchPanel,
  law: LawFeedPanel,
};

export default function DisputesPage() {
  useLensNav('disputes');
  useLensIdentity('disputes');
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<DisputesView>('cases');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'disputes' },
  );

  const Panel = PANELS[active];
  const motionProps = useMemo(
    () => (reduceMotion
      ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -6 },
          transition: { duration: 0.16 },
        }),
    [reduceMotion],
  );

  return (
    <LensShell lensId="disputes" asMain={false}>
      <FirstRunTour lensId="disputes" />
      <DepthBadge lensId="disputes" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="disputes"
        crumb="Disputes"
        title={`Settle it fairly${who ? `, ${who}` : ''}`}
        subtitle="Resolution Center cases and the ODR workbench: one dispute desk, from filing to precedent."
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as DisputesView)}
        tabsLabel="Disputes views"
        cta={{ label: 'File a case', icon: Briefcase, onClick: () => setActive('cases'), title: 'Open your cases and file a dispute (1)' }}
      >
        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            <Panel />
          </motion.div>
        </AnimatePresence>
      </NorthStarFrame>
    </LensShell>
  );
}
