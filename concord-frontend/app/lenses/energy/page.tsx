'use client';

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { EnergyMonitorSection } from '@/components/energy/EnergyMonitorSection';
import { EiaPanel } from '@/components/energy/EiaPanel';
import { SolarCarbonPanel } from '@/components/energy/SolarCarbonPanel';
import { EnergyGridCalcPanel } from '@/components/energy/EnergyGridCalcPanel';
import { EnergyActionStack } from '@/components/energy/EnergyActionStack';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { Activity, BarChart3, Share2, Sun, Zap } from 'lucide-react';

type EnergyView = 'monitor' | 'rates' | 'solar' | 'grid' | 'actions';

const VIEWS: { id: EnergyView; label: string; keys: string; title: string; hint: string; icon: typeof Zap }[] = [
  { id: 'monitor', label: 'Monitor', keys: '1', title: 'Where your power is going', hint: 'Live power, usage, devices, solar, time-of-use, billing and insights', icon: Activity },
  { id: 'rates', label: 'Rates', keys: '2', title: 'What power costs right now', hint: 'Live US EIA electricity rates and generation mix', icon: BarChart3 },
  { id: 'solar', label: 'Solar & carbon', keys: '3', title: 'Sun, roof and footprint', hint: 'Residential solar sizing and carbon footprint calculators', icon: Sun },
  { id: 'grid', label: 'Grid', keys: '4', title: 'How the grid is doing', hint: 'Consumption analysis, regional grid status and live carbon intensity', icon: Zap },
  { id: 'actions', label: 'Share', keys: '5', title: 'Put the numbers to work', hint: 'Mint, message the household, publish, agent and CSV export', icon: Share2 },
];

const card = 'rounded-2xl border border-white/10 bg-[#111] p-4';

export default function EnergyLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<EnergyView>('monitor');
  useLensCommand(
    VIEWS.map((v) => ({
      id: `energy-${v.id}`,
      keys: v.keys,
      description: `${v.label}: ${v.hint}`,
      category: 'navigation' as const,
      action: () => setView(v.id),
    })),
    { lensId: 'energy' },
  );
  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <LensShell lensId="energy" asMain={false}>
      <FirstRunTour lensId="energy" />
      <DepthBadge lensId="energy" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="energy"
        crumb="Energy"
        title={`${current.title}${view === 'monitor' && who ? `, ${who}` : ''}`}
        subtitle="Home energy monitoring, live electricity rates, solar and carbon, and grid analysis."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={view}
        onTab={(id) => setView(id as EnergyView)}
        tabsLabel="Energy views"
        cta={{ label: 'Check live rates', icon: BarChart3, onClick: () => setView('rates'), title: 'Open live EIA electricity rates' }}
      >
        <div className="space-y-5">
          {view === 'monitor' && <EnergyMonitorSection />}
          {view === 'rates' && (
            <section className={card}>
              <EiaPanel />
            </section>
          )}
          {view === 'solar' && (
            <section className={card}>
              <SolarCarbonPanel />
            </section>
          )}
          {view === 'grid' && (
            <>
              <section className={card}>
                <EnergyGridCalcPanel />
              </section>
              <LensFeedPanel lensId="energy" />
            </>
          )}
          {view === 'actions' && (
            <section>
              <EnergyActionStack />
            </section>
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
