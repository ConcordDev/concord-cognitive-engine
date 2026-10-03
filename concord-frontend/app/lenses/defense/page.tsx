'use client';

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ContractSearch } from '@/components/defense/ContractSearch';
import { DefenseActionPanel } from '@/components/defense/DefenseActionPanel';
import { CommonOperatingPicture } from '@/components/defense/CommonOperatingPicture';
import { MissionPlanner } from '@/components/defense/MissionPlanner';
import { AssetReadiness } from '@/components/defense/AssetReadiness';
import { ThreatBoard } from '@/components/defense/ThreatBoard';
import { PersonnelRoster } from '@/components/defense/PersonnelRoster';
import { LogisticsBoard } from '@/components/defense/LogisticsBoard';
import { CommsLog } from '@/components/defense/CommsLog';
import { ResourceAllocationPanel } from '@/components/defense/ResourceAllocationPanel';
import { DashboardStats } from '@/components/defense/DashboardStats';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import {
  BarChart3, Target, Crosshair, Users, Eye, MapPin, Radio,
} from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'Dashboard' | 'Operations' | 'Assets' | 'Personnel' | 'Intel' | 'Logistics' | 'Communications';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Shield }[] = [
  { key: 'Dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'Operations', label: 'Operations', icon: Target },
  { key: 'Assets', label: 'Assets', icon: Crosshair },
  { key: 'Personnel', label: 'Personnel', icon: Users },
  { key: 'Intel', label: 'Intelligence', icon: Eye },
  { key: 'Logistics', label: 'Logistics', icon: MapPin },
  { key: 'Communications', label: 'Comms', icon: Radio },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DefenseLensPage() {
  useLensNav('defense');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('defense');

  const [activeMode, setActiveMode] = useState<ModeTab>('Dashboard');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  useLensCommand(
    [
      { id: 'mode-dashboard', keys: 'd', description: 'Dashboard', category: 'navigation', action: () => setActiveMode('Dashboard') },
      { id: 'mode-operations', keys: 'o', description: 'Operations', category: 'navigation', action: () => setActiveMode('Operations') },
      { id: 'mode-assets', keys: 'a', description: 'Assets', category: 'navigation', action: () => setActiveMode('Assets') },
      { id: 'mode-personnel', keys: 'p', description: 'Personnel', category: 'navigation', action: () => setActiveMode('Personnel') },
      { id: 'mode-intel', keys: 'i', description: 'Intel', category: 'navigation', action: () => setActiveMode('Intel') },
      { id: 'mode-logistics', keys: 'l', description: 'Logistics', category: 'navigation', action: () => setActiveMode('Logistics') },
      { id: 'mode-comms', keys: 'c', description: 'Communications', category: 'navigation', action: () => setActiveMode('Communications') },
    ],
    { lensId: 'defense' }
  );

  return (
    <LensShell lensId="defense" asMain={false}>
      <FirstRunTour lensId="defense" />      <DepthBadge lensId="defense" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="defense"
        crumb="Defense"
        title={`${activeMode === 'Dashboard' ? 'Common operating picture' : MODE_TABS.find((t) => t.key === activeMode)?.label}${activeMode === 'Dashboard' && who ? `, ${who}` : ''}`}
        subtitle="Readiness, threats, personnel, logistics and comms in one command desk."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="defense" data={realtimeData || {}} compact />
          </>
        }
        tabs={MODE_TABS.map((t) => ({ id: t.key, label: t.label, icon: t.icon }))}
        activeTab={activeMode}
        onTab={(id) => setActiveMode(id as ModeTab)}
        tabsLabel="Defense views"
        cta={{ label: 'Plan a mission', icon: Target, onClick: () => setActiveMode('Operations'), title: 'Open the mission planner (O)' }}
      >
        <div className="space-y-4">
          {activeMode === 'Dashboard' && (
            <div className="space-y-4">
              <DashboardStats />
              <CommonOperatingPicture />
              <ThreatBoard />
              <AssetReadiness />
              <ResourceAllocationPanel />
            </div>
          )}
          {activeMode === 'Operations' && <MissionPlanner />}
          {activeMode === 'Assets' && <AssetReadiness />}
          {activeMode === 'Personnel' && <PersonnelRoster />}
          {activeMode === 'Intel' && <ThreatBoard />}
          {activeMode === 'Logistics' && <LogisticsBoard />}
          {activeMode === 'Communications' && <CommsLog />}

          <RealtimeDataPanel domain="defense" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <ContractSearch />
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <h2 className="mb-3 text-sm font-semibold text-white">Security ops bench</h2>
            <PipingProvider>
              <DefenseActionPanel />
            </PipingProvider>
          </section>
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
