'use client';

/**
 * Inference lens — one logical-inference app.
 *
 * Single `active` union. Desk modes (facts/query/syllogism/forward/unify)
 * plus Rule engine + Frameworks — the old showRuleEngine/showFrameworks
 * accordion booleans are folded in. Screens live in components/inference/.
 */

import { useState } from 'react';
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { InferenceDeskPanel, type DeskMode } from '@/components/inference/InferenceDeskPanel';
import { RuleEnginePanel } from '@/components/inference/RuleEnginePanel';
import { FrameworksPanel } from '@/components/inference/FrameworksPanel';

type View = DeskMode | 'rules' | 'frameworks';

const TABS: { id: View; label: string; keys: string; icon: typeof GitMerge; title: string }[] = [
  { id: 'facts', label: 'Facts', keys: 'f', icon: Plus, title: 'What you know' },
  { id: 'query', label: 'Query', keys: 'q', icon: Search, title: 'Ask the knowledge base' },
  { id: 'syllogism', label: 'Syllogism', keys: 's', icon: GitMerge, title: 'If this, then that' },
  { id: 'forward', label: 'Forward', keys: 'o', icon: Zap, title: 'Chain forward from the facts' },
  { id: 'unify', label: 'Unify', keys: 'u', icon: Link, title: 'Make two terms match' },
  { id: 'rules', label: 'Rule engine', keys: 'r', icon: Database, title: 'The rules doing the work' },
  { id: 'frameworks', label: 'Frameworks', keys: 'w', icon: BookOpen, title: 'Prolog, Drools and friends' },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } =
    useRealtimeLens('inference');
  const [active, setActive] = useState<View>('facts');
  const current = TABS.find((t) => t.id === active)!;

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
      <div data-lens-theme="inference" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Inference</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'facts' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-[11px] text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <DTUExportButton domain="inference" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Inference views">
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
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <section key={active}>
          <InferencePane active={active} />
        </section>

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

        <CrossLensRecentsPanel lensId="inference" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => setActive('facts')}
          title="Add a fact (F)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Add a fact
        </button>
      </div>
      <a href="#inference-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
        Skip to inference content
      </a>
    </LensShell>
  );
}
