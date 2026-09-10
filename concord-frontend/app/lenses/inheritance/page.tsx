'use client';

/**
 * Inheritance — one estate-planning + heir-slot market desk
 * (Trust & Will / FreeWill shaped).
 *
 * Single view union. Screens extracted to components/inheritance/*Panel.tsx.
 * Page is a thin shell.
 */

import { useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { EstateProvider, useEstate } from '@/components/inheritance/EstateContext';
import { OverviewPanel } from '@/components/inheritance/OverviewPanel';
import { BeneficiariesPanel } from '@/components/inheritance/BeneficiariesPanel';
import { WillsPanel } from '@/components/inheritance/WillsPanel';
import { AssetsPanel } from '@/components/inheritance/AssetsPanel';
import { ExecutorsPanel } from '@/components/inheritance/ExecutorsPanel';
import { ProbatePanel } from '@/components/inheritance/ProbatePanel';
import { NoticesPanel } from '@/components/inheritance/NoticesPanel';
import { MarketPanel } from '@/components/inheritance/MarketPanel';
import { IntestacyPanel } from '@/components/inheritance/IntestacyPanel';
import { DiscussionPanel } from '@/components/inheritance/DiscussionPanel';
import { TABS, type Tab } from '@/components/inheritance/inheritance-shared';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';

type View = Tab | 'discussion';

const VIEW_TABS: { id: View; label: string; keys: string }[] = [
  ...TABS.map((t, i) => ({ id: t.id as View, label: t.label, keys: String(i + 1) })),
  { id: 'discussion', label: 'Discussion', keys: '0' },
];

const PANELS: Record<View, ComponentType> = {
  overview: OverviewPanel,
  beneficiaries: BeneficiariesPanel,
  wills: WillsPanel,
  assets: AssetsPanel,
  executors: ExecutorsPanel,
  probate: ProbatePanel,
  notices: NoticesPanel,
  market: MarketPanel,
  intestacy: IntestacyPanel,
  discussion: DiscussionPanel,
};

function EstateShellInner({ active, setActive }: { active: View; setActive: (v: View) => void }) {
  const reduceMotion = useReducedMotion();
  const { status, loadAll, loading, loadError } = useEstate();

  useLensCommand(
    [
      ...VIEW_TABS.map((t) => ({
        id: `inheritance-${t.id}`,
        keys: t.keys,
        description: `${t.label} tab`,
        category: 'navigation' as const,
        action: () => setActive(t.id),
      })),
      {
        id: 'inheritance-reload',
        keys: 'r',
        description: 'Reload estate',
        category: 'actions' as const,
        action: () => { void loadAll(); },
      },
    ],
    { lensId: 'inheritance' },
  );

  const Panel = PANELS[active];

  return (
    <div id="inheritance-main" className="mx-auto max-w-5xl p-4 space-y-4 text-white">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-amber-300">Inheritance</h1>
        <p className="text-sm text-zinc-400">
          Estate planner + heir-slot market — Trust &amp; Will density.
        </p>
        {status && <p className="text-xs text-amber-200/80 font-mono">{status}</p>}
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-zinc-800" aria-label="Estate views">
        {VIEW_TABS.map((t) => {
          const on = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium',
                on ? 'border-b-2 border-amber-500 text-amber-300' : 'text-zinc-400 hover:text-zinc-300',
              )}
              aria-current={on ? 'page' : undefined}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {loading ? (
        <div role="status" aria-live="polite" className="flex items-center gap-2 py-10 text-zinc-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" aria-hidden="true" />
          <span>Loading estate…</span>
        </div>
      ) : loadError ? (
        <div role="alert" className="rounded-xl border border-rose-700/50 bg-rose-950/40 p-6 text-center">
          <p className="text-sm text-rose-200">Couldn&apos;t load your estate.</p>
          <p className="mt-1 font-mono text-[11px] text-rose-300/70">{loadError}</p>
          <button
            type="button"
            onClick={() => { void loadAll(); }}
            className="mt-3 rounded bg-amber-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
          >Retry</button>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
          >
            <Panel />
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

function EstateShell() {
  const [active, setActive] = useState<View>('overview');
  return (
    <EstateProvider onNavigate={(t) => setActive(t as View)}>
      <EstateShellInner active={active} setActive={setActive} />
    </EstateProvider>
  );
}

export default function InheritancePage() {
  useLensNav('inheritance');
  useLensIdentity('inheritance');

  return (
    <LensShell lensId="inheritance" asMain={false}>
      <FirstRunTour lensId="inheritance" />
      <DepthBadge lensId="inheritance" size="sm" className="ml-2" />
      <div data-lens-theme="inheritance">
        <a href="#inheritance-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500">
          Skip to estate desk
        </a>
        <EstateShell />
        <CrossLensRecentsPanel lensId="inheritance" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
