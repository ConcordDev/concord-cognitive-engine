'use client';

/**
 * Hypothesis lens: the north-star look (serif title, pill views, teal floating
 * CTA) over the real hypothesis-engine lab, the statistical workbench and the
 * arXiv reference feed. Nothing is hidden behind a collapse; every view is a
 * real workbench and the CTA focuses the propose box.
 */

import { useCallback, useState } from 'react';
import { BarChart3, BookOpen, FlaskConical, Plus } from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ArxivFeed } from '@/components/hypothesis/ArxivFeed';
import { StatsWorkbench } from '@/components/hypothesis/StatsWorkbench';
import { HypothesisLab } from '@/components/hypothesis/HypothesisLab';
import { cn } from '@/lib/utils';

type View = 'lab' | 'stats' | 'arxiv';

const VIEWS: { id: View; label: string; keys: string; title: string; hint: string; icon: typeof FlaskConical }[] = [
  { id: 'lab', label: 'Lab', keys: 'g l', title: 'What you are testing', hint: 'Propose, test, predict, confirm or reject', icon: FlaskConical },
  { id: 'stats', label: 'Statistics', keys: 'g s', title: 'Does the data agree', hint: 'Full test battery, datasets, corrections, APA reports', icon: BarChart3 },
  { id: 'arxiv', label: 'arXiv', keys: 'g a', title: 'What the papers say', hint: 'Reference feed from arXiv', icon: BookOpen },
];

export default function HypothesisLensPage() {
  useLensNav('hypothesis');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('hypothesis');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<View>('lab');

  const propose = useCallback(() => {
    setView('lab');
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLTextAreaElement>('textarea[placeholder^="A falsifiable claim"]');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    });
  }, []);

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setView(v.id),
    })),
    { lensId: 'hypothesis' },
  );

  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <LensShell lensId="hypothesis" asMain={false}>
      <FirstRunTour lensId="hypothesis" />
      <DepthBadge lensId="hypothesis" size="sm" className="ml-2" />
      <div data-lens-theme="hypothesis" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Hypothesis</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{view === 'lab' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-[11px] text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <DTUExportButton domain="hypothesis" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Hypothesis views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        {view === 'lab' && <HypothesisLab />}
        {view === 'stats' && (
          <section className="space-y-3">
            <p className="max-w-3xl text-[13px] leading-relaxed text-zinc-500">
              Run the full classical test battery on hand-entered values or imported CSV datasets: t-tests, ANOVA,
              chi-square, correlation and regression, with assumption diagnostics, multiple-comparison correction,
              pre-registration tracking and APA-formatted reports.
            </p>
            <StatsWorkbench />
          </section>
        )}
        {view === 'arxiv' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-5">
            <ArxivFeed />
          </section>
        )}

        {realtimeData && (
          <div className="mt-6">
            <RealtimeDataPanel domain="hypothesis" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={realtimeInsights} compact />
          </div>
        )}

        <CrossLensRecentsPanel lensId="hypothesis" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={propose}
          title="Propose a hypothesis"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New hypothesis
        </button>
      </div>
    </LensShell>
  );
}
