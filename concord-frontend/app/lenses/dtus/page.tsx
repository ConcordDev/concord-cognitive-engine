'use client';

/**
 * DTUs — one Roam/Obsidian-style vault browser.
 *
 * Single view union (browser | workbench | trending | ops). Stacked
 * workbench/ops/trending accordion piles are folded into the union.
 * Page is a thin shell.
 */

import { Suspense, useCallback, useMemo, useState, type ComponentType } from 'react';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Search } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { BrowserPanel } from '@/components/dtus/BrowserPanel';
import { WorkbenchPanel } from '@/components/dtus/WorkbenchPanel';
import { TrendingDtus } from '@/components/dtus/TrendingDtus';
import { OpsPanel } from '@/components/dtus/OpsPanel';

type DtusView = 'browser' | 'workbench' | 'trending' | 'ops';

const VIEWS: { id: DtusView; label: string; keys: string; title: string; hint: string }[] = [
  { id: 'browser', title: 'One unit of thought', label: 'Browser', keys: '1', hint: 'Vault list · compute actions' },
  { id: 'workbench', title: 'Cite it, trace it, layer it', label: 'Workbench', keys: '2', hint: 'Citation · lineage · bulk · layers' },
  { id: 'trending', title: 'What the lattice is reading', label: 'Trending', keys: '3', hint: 'Discovery trending' },
  { id: 'ops', title: 'Probe the substrate', label: 'Operations', keys: '4', hint: 'Substrate macro probes' },
];

function TrendingPane() {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
      <TrendingDtus />
    </section>
  );
}

const PANELS: Record<DtusView, ComponentType> = {
  browser: BrowserPanel,
  workbench: WorkbenchPanel,
  trending: TrendingPane,
  ops: OpsPanel,
};

function DTUBrowserPageInner() {
  useLensNav('dtus');
  useLensIdentity('dtus');
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const reduceMotion = useReducedMotion();
  const { isLive, lastUpdated } = useRealtimeLens('dtus');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<DtusView>('browser');
  const [viewsOpen, setViewsOpen] = useState(false);
  const browse = useCallback(() => {
    setActive('browser');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>('input[placeholder^="Search DTUs"]');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    }));
  }, []);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'browse', keys: '/', description: 'Search the vault', category: 'actions' as const, action: browse },
    ],
    { lensId: 'dtus' },
  );

  const Panel = PANELS[active];
  const current = VIEWS.find((v) => v.id === active)!;
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
    <LensShell lensId="dtus" asMain={false}>
      <FirstRunTour lensId="dtus" />
      <DepthBadge lensId="dtus" size="sm" className="ml-2" />
      <div data-lens-theme="dtus" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">DTU Browser</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'browser' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="dtus" data={{}} compact />
          </div>
        </div>

        <div className="mb-4">
          <button
            type="button"
            aria-expanded={viewsOpen}
            aria-controls="dtu-view-strip"
            onClick={() => setViewsOpen((open) => !open)}
            className="text-sm text-zinc-400 hover:text-zinc-200"
          >
            Views
          </button>
          {viewsOpen && (
            <nav id="dtu-view-strip" aria-label="DTU views" className="mt-2 flex flex-wrap gap-2">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-current={active === v.id ? 'page' : undefined}
                  title={v.hint}
                  onClick={() => setActive(v.id)}
                  className={
                    active === v.id
                      ? 'rounded-full border border-teal-400/40 bg-teal-400/10 px-3 py-1 text-xs text-teal-200'
                      : 'rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200'
                  }
                >
                  {v.label}
                  <span className="ml-1 text-zinc-600">{v.keys}</span>
                </button>
              ))}
            </nav>
          )}
        </div>

        <main className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              {active === 'browser' ? <BrowserPanel initialQuery={initialQuery} /> : <Panel />}
            </motion.div>
          </AnimatePresence>
        </main>

        <CrossLensRecentsPanel lensId="dtus" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={browse}
          title="Search the vault (/)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Search className="h-4 w-4" />
          Browse
        </button>
      </div>
    </LensShell>
  );
}

export default function DTUBrowserPage() {
  return (
    <Suspense fallback={null}>
      <DTUBrowserPageInner />
    </Suspense>
  );
}
