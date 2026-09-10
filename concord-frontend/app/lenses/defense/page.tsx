'use client';

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
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
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Shield, BarChart3, Target, Crosshair, Users, Eye, MapPin, Radio,
  ChevronDown, ChevronRight,
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
  const [showActionPanel, setShowActionPanel] = useState(false);

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
    <div className={cn(ds.pageContainer, 'space-y-4')}>
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Military & Defense</h1>
            <p className="text-sm text-gray-400">Common operating picture, readiness, threats, personnel & logistics</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="defense" data={realtimeData || {}} compact />
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
        {MODE_TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveMode(key)}
            className={cn('flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
              activeMode === key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300')}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* Dashboard — C2 common operating picture + readiness rollups */}
      {activeMode === 'Dashboard' && (
        <div className="space-y-4">
          <DashboardStats />
          <CommonOperatingPicture />
          <ThreatBoard />
          <AssetReadiness />
          <ResourceAllocationPanel />
        </div>
      )}

      {/* Operations — mission planner */}
      {activeMode === 'Operations' && <MissionPlanner />}

      {/* Assets — readiness rollup */}
      {activeMode === 'Assets' && <AssetReadiness />}

      {/* Personnel — roster */}
      {activeMode === 'Personnel' && <PersonnelRoster />}

      {/* Intel — threat tracking board */}
      {activeMode === 'Intel' && <ThreatBoard />}

      {/* Logistics — supply-chain tracking */}
      {activeMode === 'Logistics' && <LogisticsBoard />}

      {/* Communications — secure comms log */}
      {activeMode === 'Communications' && <CommsLog />}

      <RealtimeDataPanel data={insights} />

      {/* Bespoke USAspending DoD contract search with Save-as-DTU */}
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <ContractSearch />
      </section>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <button
          type="button"
          onClick={() => setShowActionPanel(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>Security ops bench</span>
          {showActionPanel ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showActionPanel && (
          <div className="mt-3">
            <PipingProvider>
              <DefenseActionPanel />
            </PipingProvider>
          </div>
        )}
      </section>
    </div>          <CrossLensRecentsPanel lensId="defense" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
