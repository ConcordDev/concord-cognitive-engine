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
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { CasesPanel } from '@/components/disputes/CasesPanel';
import { WorkbenchPanel } from '@/components/disputes/WorkbenchPanel';
import { LawFeedPanel } from '@/components/disputes/LawFeedPanel';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

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
      <div data-lens-theme="disputes" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Shield className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <h1 className={ds.heading1}>Dispute Resolution</h1>
              <p className={ds.textMuted}>
                Resolution Center cases + ODR workbench — one dispute desk.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Disputes views"
        >
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on
                    ? 'border-[var(--lens-accent)] text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {v.label}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {v.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            <Panel />
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="disputes" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
