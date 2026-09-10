'use client';

/**
 * Kingdoms — one realm-ops app (browse / found / decree / CK3 layers).
 *
 * Single active union. REST kingdom routes + realm/dynasty macros preserved
 * via HistoryExplorer / RealmActionPanel / DynastyRealmManager.
 */

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { SessionRail } from '@/components/lens/SessionRail';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { HistoryExplorer } from '@/components/kingdoms/HistoryExplorer';
import { RealmActionPanel } from '@/components/kingdoms/RealmActionPanel';
import { DynastyRealmManager } from '@/components/kingdoms/DynastyRealmManager';
import { KingdomListPanel } from '@/components/kingdoms/KingdomListPanel';
import { KingdomDetailPanel } from '@/components/kingdoms/KingdomDetailPanel';
import { KingdomCreatePanel } from '@/components/kingdoms/KingdomCreatePanel';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { Crown, List, Plus, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KingdomView } from '@/components/kingdoms/types';

const VIEWS: { id: KingdomView; label: string; keys: string }[] = [
  { id: 'list', label: 'Browse', keys: 'l' },
  { id: 'create', label: 'Found', keys: 'c' },
  { id: 'detail', label: 'Detail', keys: 'd' },
  { id: 'history', label: 'History', keys: 'h' },
  { id: 'realm', label: 'Realm', keys: 'r' },
  { id: 'dynasty', label: 'Dynasty', keys: 'y' },
];

export default function KingdomsPage() {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<KingdomView>('list');
  const [activeId, setActiveId] = useState<string | null>(null);

  useLensCommand(
    VIEWS.map((v) => ({
      id: `tab-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'kingdoms' },
  );

  return (
    <LensShell lensId="kingdoms" asMain={false}>
      <FirstRunTour lensId="kingdoms" />
      <DepthBadge lensId="kingdoms" size="sm" className="ml-2" />
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <div className="mx-auto max-w-6xl">
          <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Crown className="h-7 w-7 text-amber-300" />
              <h1 className="text-2xl font-bold">Kingdoms</h1>
            </div>
            <nav className="flex gap-2 flex-wrap" aria-label="Kingdoms views">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    if (v.id === 'list') setActiveId(null);
                    setActive(v.id);
                  }}
                  className={cn(
                    'rounded px-3 py-1 text-sm',
                    active === v.id ? 'bg-amber-600' : 'bg-slate-800 hover:bg-slate-700',
                  )}
                >
                  {v.id === 'create' ? (
                    <span className="inline-flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Found</span>
                  ) : (
                    v.label
                  )}
                </button>
              ))}
            </nav>
          </header>

          <AnimatePresence mode="wait">
            <motion.div
              key={active + (activeId || '')}
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.16 }}
            >
              {active === 'list' && (
                <KingdomListPanel onPick={(id) => { setActiveId(id); setActive('detail'); }} />
              )}
              {active === 'detail' && (
                activeId
                  ? <KingdomDetailPanel kingdomId={activeId} />
                  : <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">Pick a kingdom from Browse.</div>
              )}
              {active === 'create' && (
                <KingdomCreatePanel onCreated={(id) => { setActiveId(id); setActive('detail'); }} />
              )}
              {active === 'history' && <HistoryExplorer />}
              {active === 'realm' && <RealmActionPanel />}
              {active === 'dynasty' && <DynastyRealmManager />}
            </motion.div>
          </AnimatePresence>

          <SessionRail lensId="kingdoms" className="mt-6" hideWhenEmpty />
        </div>
      </div>
      <CrossLensRecentsPanel lensId="kingdoms" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      <MobileTabBar
        tabs={[
          { id: 'list', label: 'Browse', icon: List },
          { id: 'create', label: 'Found', icon: Plus },
          { id: 'detail', label: 'Detail', icon: Eye },
          { id: 'dynasty', label: 'Dynasty', icon: Crown },
        ]}
        active={active}
        onSelect={(id) => setActive(id as KingdomView)}
      />
    </LensShell>
  );
}
