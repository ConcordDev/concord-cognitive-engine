'use client';

/**
 * Inference lens — one logical-inference app.
 *
 * Single `active` union. Desk modes (facts/query/syllogism/forward/unify)
 * plus Rule engine + Frameworks — the old showRuleEngine/showFrameworks
 * accordion booleans are folded in. Screens live in components/inference/.
 */

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  GitMerge, Plus, Search, Zap, Link, Database, BookOpen,
} from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { InferenceDeskPanel, type DeskMode } from '@/components/inference/InferenceDeskPanel';
import { RuleEnginePanel } from '@/components/inference/RuleEnginePanel';
import { FrameworksPanel } from '@/components/inference/FrameworksPanel';

type View = DeskMode | 'rules' | 'frameworks';

const TABS: { id: View; label: string; keys: string; icon: typeof GitMerge }[] = [
  { id: 'facts', label: 'Facts', keys: 'f', icon: Plus },
  { id: 'query', label: 'Query', keys: 'q', icon: Search },
  { id: 'syllogism', label: 'Syllogism', keys: 's', icon: GitMerge },
  { id: 'forward', label: 'Forward', keys: 'o', icon: Zap },
  { id: 'unify', label: 'Unify', keys: 'u', icon: Link },
  { id: 'rules', label: 'Rule engine', keys: 'r', icon: Database },
  { id: 'frameworks', label: 'Frameworks', keys: 'w', icon: BookOpen },
];

const DESK: DeskMode[] = ['facts', 'query', 'syllogism', 'forward', 'unify'];

function isDesk(v: View): v is DeskMode {
  return (DESK as string[]).includes(v);
}


function InferencePane({ active }: { active: View }) {
  if (isDesk(active)) return <InferenceDeskPanel mode={active} />;
  if (active === 'rules') return <RuleEnginePanel />;
  return <FrameworksPanel />;
}

export default function InferenceLensPage() {
  useLensNav('inference');
  useLensIdentity('inference');
  const reduceMotion = useReducedMotion();
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } =
    useRealtimeLens('inference');
  const [active, setActive] = useState<View>('facts');

  useLensCommand(
    TABS.map((t) => ({
      id: `tab-${t.id}`,
      keys: t.keys,
      description: t.label,
      category: 'navigation' as const,
      action: () => setActive(t.id),
    })),
    { lensId: 'inference' },
  );

  return (
    <LensShell lensId="inference" asMain={false}>
      <FirstRunTour lensId="inference" />
      <DepthBadge lensId="inference" size="sm" className="ml-2" />
      <div data-lens-theme="inference" className={cn(ds.pageContainer, 'space-y-4')}>
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <GitMerge className="w-7 h-7 text-teal-500 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold">Inference</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="inference" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-400">
                Logical inference — facts, syllogisms, unify, Prolog/Drools KB.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Inference views"
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors capitalize',
                  on
                    ? 'border-neon-cyan text-neon-cyan'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                )}
              >
                <Icon className="w-4 h-4" />
                {t.label}
                <kbd className="hidden sm:inline text-[10px] text-white/30 font-mono">{t.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
          >
            <InferencePane active={active} />
          </motion.div>
        </AnimatePresence>

        {realtimeData && (
          <RealtimeDataPanel
            domain="inference"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}

        <CrossLensRecentsPanel lensId="inference" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
      <a href="#inference-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
        Skip to inference content
      </a>
    </LensShell>
  );
}
