'use client';

/**
 * Privacy — one OneTrust/GitHub-settings consent desk.
 *
 * Single view union (consent | dpo | controls | feed). Accordion booleans
 * for DPO / Data Controls / PrivacyFeed are gone. Page is a thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Shield, Scale, Database, MessageCircle } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ConsentPanel } from '@/components/privacy/ConsentPanel';
import { DpoStudioPanel } from '@/components/privacy/DpoStudioPanel';
import { DataControlsPanel } from '@/components/privacy/DataControlsPanel';
import { PrivacyFeed } from '@/components/privacy/PrivacyFeed';

type PrivacyView = 'consent' | 'dpo' | 'controls' | 'feed';

const VIEWS: { id: PrivacyView; label: string; keys: string; hint: string; icon: typeof Shield }[] = [
  { id: 'consent', label: 'Consent', keys: '1', hint: 'Sharing toggles · save ⌘S', icon: Shield },
  { id: 'dpo', label: 'DPO studio', keys: '2', hint: 'Inventory · DPIA · breach', icon: Scale },
  { id: 'controls', label: 'Data controls', keys: '3', hint: 'DSAR · export · retention', icon: Database },
  { id: 'feed', label: 'Discussion', keys: '4', hint: 'External privacy reference', icon: MessageCircle },
];

const PANELS: Record<PrivacyView, ComponentType> = {
  consent: ConsentPanel,
  dpo: DpoStudioPanel,
  controls: DataControlsPanel,
  feed: PrivacyFeed,
};

export default function PrivacySharingPage() {
  useLensNav('privacy');
  useLensIdentity('privacy');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<PrivacyView>('consent');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'privacy' },
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
    <LensShell lensId="privacy" asMain={false}>
      <FirstRunTour lensId="privacy" />
      <DepthBadge lensId="privacy" size="sm" className="ml-2" />
      <div data-lens-theme="privacy" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-indigo-500/20 border border-indigo-500/30">
              <Shield className="w-6 h-6 text-indigo-500" />
            </div>
            <div className="min-w-0">
              <h1 className={ds.heading1}>Privacy & Sharing</h1>
              <p className={ds.textMuted}>
                Consent, DPO studio, and data controls — one privacy desk.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Privacy views"
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

        <main className="min-w-0 pt-4">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              <Panel />
            </motion.div>
          </AnimatePresence>
        </main>

        <CrossLensRecentsPanel lensId="privacy" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
