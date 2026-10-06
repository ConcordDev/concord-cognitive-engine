'use client';

/**
 * Temporal lens: north-star look (serif title, pill tabs) over the full
 * time-series desk. Series = ForecastWorkbench (all 13 `temporal.*` macros:
 * dataset import/list/get/delete, forecast, decompose, anomalies, changepoints,
 * seasonality, holiday forecast, backtest, cross-correlation, simulate).
 * Rhythms = time-crystal detection + archaeology + substrate diff.
 * Tooling = GitHub time-series tooling. See docs/lens-specs/temporal-capability-map.md.
 */

import { useState } from 'react';
import { Activity, Diamond, Wrench } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { ForecastWorkbench } from '@/components/temporal/ForecastWorkbench';
import { TimeCrystals } from '@/components/temporal/TimeCrystals';
import { TemporalRepos } from '@/components/temporal/TemporalRepos';

type View = 'series' | 'rhythms' | 'tooling';

const VIEWS: { id: View; label: string; title: string; hint: string; icon: typeof Activity }[] = [
  { id: 'series', label: 'Series', title: 'What the series says', hint: 'Import, forecast, decompose, detect anomalies and changepoints, backtest', icon: Activity },
  { id: 'rhythms', label: 'Rhythms', title: 'What keeps repeating', hint: 'Time crystals, archaeology and substrate diff', icon: Diamond },
  { id: 'tooling', label: 'Tooling', title: 'Time-series tooling', hint: 'Open-source forecasting repos', icon: Wrench },
];

export default function TemporalLensPage() {
  useLensNav('temporal');
  useLensIdentity('temporal');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<View>('series');

  useLensCommand(
    VIEWS.map((v, i) => ({
      id: `temporal-view-${v.id}`,
      keys: String(i + 1),
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setView(v.id),
    })),
    { lensId: 'temporal' },
  );

  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <LensShell lensId="temporal" asMain={false}>
      <FirstRunTour lensId="temporal" />
      <DepthBadge lensId="temporal" size="sm" className="ml-2" />
      <div data-lens-theme="temporal" className="relative min-h-full px-8 pb-10 pt-6">
        <p className="text-[14px] text-zinc-500">Temporal</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {current.title}{view === 'series' && who ? `, ${who}` : ''}
        </h1>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Temporal views">
          {VIEWS.map((v, i) => {
            const Icon = v.icon;
            const on = view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${i + 1})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{i + 1}</kbd>
              </button>
            );
          })}
        </nav>

        {view === 'series' && <ForecastWorkbench />}
        {view === 'rhythms' && (
          <div className="max-w-4xl">
            <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-zinc-500">
              Recurring structure the substrate has detected in its own activity. Run detection, then expand to read the archaeology and the diff between substrate states.
            </p>
            <TimeCrystals />
          </div>
        )}
        {view === 'tooling' && <TemporalRepos />}

        <CrossLensRecentsPanel lensId="temporal" sinceDays={7} limit={6} hideWhenEmpty className="mt-6" />
      </div>
    </LensShell>
  );
}
