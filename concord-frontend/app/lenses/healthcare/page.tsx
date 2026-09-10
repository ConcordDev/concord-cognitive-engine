'use client';

/**
 * Healthcare — one clinical ops desk (EHR / Epic Hyperspace shape).
 *
 * Single `active` union drives EpicShell nav. Welded artifact ModeTabs,
 * portal widgets, immunizations, and lookups live as panels under
 * components/healthcare/ (ClinicalArtifactsPanel + EpicSection router).
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Activity,
  Archive,
  Calendar,
  ClipboardList,
  HeartPulse,
  LayoutDashboard,
  Pill,
  Stethoscope,
  Users,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { SubLensQuickNav } from '@/components/lens/SubLensQuickNav';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import LiveFeed, { adaptToLiveFeedArticles } from '@/components/lens/LiveFeed';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { EpicSection } from '@/components/healthcare/EpicSection';
import type { EpicNav } from '@/components/healthcare/EpicShell';

const COMMANDS: { id: EpicNav; keys: string; description: string }[] = [
  { id: 'dashboard', keys: 'g d', description: 'Clinical dashboard' },
  { id: 'patients', keys: 'p', description: 'Patients' },
  { id: 'chart', keys: 'c', description: 'Patient chart' },
  { id: 'encounters', keys: 'e', description: 'Encounters' },
  { id: 'schedule', keys: 's', description: 'Schedule' },
  { id: 'inbox', keys: 'i', description: 'Inbox' },
  { id: 'refills', keys: 'r', description: 'Refills' },
  { id: 'artifacts', keys: 'a', description: 'Records desk' },
  { id: 'actions', keys: 'g l', description: 'Lookups / actions' },
];

export default function HealthcareLensPage() {
  useLensNav('healthcare');
  useLensIdentity('healthcare');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('healthcare');
  const [active, setActive] = useState<EpicNav>('dashboard');

  const go = useCallback((id: EpicNav) => setActive(id), []);

  useLensCommand(
    COMMANDS.map((c) => ({
      id: `hc-${c.id}`,
      keys: c.keys,
      description: c.description,
      category: 'navigation' as const,
      action: () => go(c.id),
    })),
    { lensId: 'healthcare' },
  );

  const activeLabel = useMemo(
    () => COMMANDS.find((c) => c.id === active)?.description ?? active,
    [active],
  );

  return (
    <LensShell lensId="healthcare" asMain={false}>
      <FirstRunTour lensId="healthcare" />
      <DepthBadge lensId="healthcare" size="sm" className="ml-2" />
      <div data-lens-theme="healthcare" className={cn(ds.pageContainer, 'pb-20 lg:pb-6')}>
        <a href="#healthcare-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-[var(--lens-accent)]">
          Skip to clinical ops
        </a>
        <ShellPreview lensId="healthcare" defaultOpen={true} />

        <header className={cn(ds.sectionHeader, 'gap-3 flex-wrap')}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-md bg-blue-500/20 flex items-center justify-center shrink-0">
              <HeartPulse className="w-5 h-5 text-blue-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Clinical ops</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <p className={cn(ds.textMuted, 'font-mono text-xs tracking-wide')}>
                {activeLabel} · EHR desk · organizational records only — not a substitute for care
              </p>
            </div>
          </div>
          <DTUExportButton domain="healthcare" data={{}} compact />
        </header>

        <SubLensQuickNav lensId="healthcare" />

        <LiveFeed
          articles={adaptToLiveFeedArticles(realtimeData as Record<string, unknown> | null)}
          domain="healthcare"
          isLive={isLive}
          lastUpdated={lastUpdated}
          limit={8}
        />
        <RealtimeDataPanel
          domain="healthcare"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={insights}
          compact
        />

        <main id="healthcare-main" className="min-w-0 mt-3">
          <EpicSection activeNav={active} onNavChange={go} />
        </main>

        <div className="px-1 mt-4 mb-2">
          <LensFeedPanel lensId="healthcare" />
        </div>

        <div className="sticky bottom-0 bg-blue-950/90 backdrop-blur-sm border-t border-blue-400/10 px-4 py-2 text-center rounded-b-lg">
          <p className="text-xs text-blue-400/50">
            This tool is for organizational purposes only. Not a substitute for professional medical
            advice, diagnosis, or treatment.
          </p>
        </div>
      </div>

      <MobileTabBar
        tabs={[
          { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
          { id: 'patients', label: 'Pts', icon: Users },
          { id: 'encounters', label: 'Visits', icon: ClipboardList },
          { id: 'schedule', label: 'Appts', icon: Calendar },
          { id: 'refills', label: 'Rx', icon: Pill },
          { id: 'artifacts', label: 'Records', icon: Archive },
          { id: 'chart', label: 'Chart', icon: Stethoscope },
          { id: 'actions', label: 'Ops', icon: Activity },
        ]}
        active={active}
        onSelect={(id) => go(id as EpicNav)}
      />
    </LensShell>
  );
}
