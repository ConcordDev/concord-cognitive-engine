'use client';

/**
 * HR: north-star chrome over a real BambooHR/Rippling-parity HRIS. The ~50
 * `hr` macros are surfaced by purpose-built sections: `HrHrisSection` (11-tab
 * HRIS workbench), `HrActionPanel` (people-ops calculators) and the BLS labor
 * data explorer + wage forecast. No separate CRUD store, no macro-button wall.
 */

import { useCallback, useState } from 'react';
import { Users, Calculator, LineChart, UserPlus } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { HrHrisSection } from '@/components/hr/HrHrisSection';
import { HrActionPanel } from '@/components/hr/HrActionPanel';
import { BlsSeriesExplorer } from '@/components/hr/BlsSeriesExplorer';
import { BlsWageForecast } from '@/components/hr/BlsWageForecast';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type View = 'people' | 'calc' | 'bls';

const VIEWS: { id: View; label: string; keys: string; title: string; hint: string; icon: typeof Users }[] = [
  { id: 'people', label: 'People hub', keys: 'g p', title: 'Your people', hint: 'Records, org chart, time off, payroll, benefits, recruiting, learning', icon: Users },
  { id: 'calc', label: 'Calculators', keys: 'g c', title: 'Run the numbers', hint: 'Comp benchmark, turnover, interview scorecard, PTO', icon: Calculator },
  { id: 'bls', label: 'Labor data', keys: 'g w', title: 'What the market pays', hint: 'US Bureau of Labor Statistics series and wage forecast', icon: LineChart },
];

export default function HRLensPage() {
  useLensNav('hr');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('hr');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<View>('people');

  const addPerson = useCallback(() => {
    setView('people');
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[data-lens-theme="hr"] input:not([type="file"]), [data-lens-theme="hr"] textarea');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    });
  }, []);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: v.label,
        category: 'navigation' as const,
        action: () => setView(v.id),
      })),
      { id: 'hr-add-person', keys: 'n', description: 'Add a person', category: 'actions' as const, action: addPerson },
    ],
    { lensId: 'hr' },
  );

  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <LensShell lensId="hr" asMain={false}>
      <FirstRunTour lensId="hr" />
      <DepthBadge lensId="hr" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="hr"
        crumb="Human Resources"
        title={`${current.title}${view === 'people' && who ? `, ${who}` : ''}`}
        subtitle="People, time off, payroll, benefits, recruiting, learning and compliance."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="hr" data={{}} compact />
          </>
        }
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, keys: v.keys, hint: v.hint, icon: v.icon }))}
        activeTab={view}
        onTab={(id) => setView(id as View)}
        cta={{ label: 'Add a person', icon: UserPlus, onClick: addPerson, title: 'Add a person (N)' }}
      >
        {view === 'people' && <HrHrisSection />}
        {view === 'calc' && (
          <PipingProvider>
            <HrActionPanel />
          </PipingProvider>
        )}
        {view === 'bls' && (
          <section className="space-y-4 rounded-2xl border border-white/10 bg-[#111] p-5">
            <BlsSeriesExplorer />
            <div className="border-t border-white/10 pt-4">
              <BlsWageForecast />
            </div>
          </section>
        )}

        <div className="mt-6">
          <RealtimeDataPanel domain="hr" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
