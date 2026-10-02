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
      <div data-lens-theme="healthcare" className="space-y-4 p-4 pb-20 lg:p-5 lg:pb-6">
        <a href="#healthcare-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-[var(--lens-accent)]">
          Skip to clinical ops
        </a>
        <ShellPreview lensId="healthcare" defaultOpen={true} />

        {/* Compact header: the workbench is the product, so it comes first. */}
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <HeartPulse className="h-4 w-4 shrink-0 text-blue-300" />
            <h1 className="text-[15px] font-semibold text-zinc-100">Clinical ops</h1>
            <span className="truncate text-[13px] text-zinc-500">{activeLabel}</span>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
          </div>
          <DTUExportButton domain="healthcare" data={{}} compact />
        </header>

        <main id="healthcare-main" className="min-w-0">
          <EpicSection activeNav={active} onNavChange={go} />
        </main>

        {/* Secondary: outbreak wire + realtime insights + feed + sub-lenses.
            Each renders nothing until it has real content. */}
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
        <LensFeedPanel lensId="healthcare" />
        <SubLensQuickNav lensId="healthcare" />

        <div className="border-t border-white/5 pt-3 text-center">
          <p className="text-[11px] text-zinc-500">
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
