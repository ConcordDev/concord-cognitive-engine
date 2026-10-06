'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { RoboticsRepos } from '@/components/robotics/RoboticsRepos';
import { ArxivPanel } from '@/components/research/ArxivPanel';
import { RoboticsActionPanel } from '@/components/robotics/RoboticsActionPanel';
import { KinematicsStudio } from '@/components/robotics/KinematicsStudio';
import { FleetManager, type RobotRow } from '@/components/robotics/FleetManager';
import { TelemetryDashboard } from '@/components/robotics/TelemetryDashboard';
import { MissionSequencer } from '@/components/robotics/MissionSequencer';
import { PathPlanner } from '@/components/robotics/PathPlanner';
import { UrdfViewer } from '@/components/robotics/UrdfViewer';
import { TeleopConsole } from '@/components/robotics/TeleopConsole';
import { SensorLogPanel } from '@/components/robotics/SensorLogPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { lensRun } from '@/lib/api/client';

type Tab = 'fleet' | 'telemetry' | 'missions' | 'kinematics' | 'pathplan' | 'urdf' | 'teleop' | 'sensors';

const TABS: { id: Tab; label: string }[] = [
  { id: 'fleet', label: 'Fleet' },
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'missions', label: 'Missions' },
  { id: 'kinematics', label: 'Kinematics' },
  { id: 'pathplan', label: 'Path Planning' },
  { id: 'urdf', label: '3D Viewer' },
  { id: 'teleop', label: 'Teleop' },
  { id: 'sensors', label: 'Sensor Logs' },
];

export default function RoboticsLensPage() {
  useLensNav('robotics');

  const [activeTab, setActiveTab] = useState<Tab>('fleet');
  const [robots, setRobots] = useState<RobotRow[]>([]);
  const [selected, setSelected] = useState<RobotRow | null>(null);
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('robotics');

  // Lens-scoped keyboard commands.
  useLensCommand(
    [
      { id: 'tab-fleet', keys: 'f', description: 'Fleet', category: 'navigation', action: () => setActiveTab('fleet') },
      { id: 'tab-telemetry', keys: 'y', description: 'Telemetry', category: 'navigation', action: () => setActiveTab('telemetry') },
      { id: 'tab-missions', keys: 'm', description: 'Missions', category: 'navigation', action: () => setActiveTab('missions') },
      { id: 'tab-kinematics', keys: 'k', description: 'Kinematics', category: 'navigation', action: () => setActiveTab('kinematics') },
      { id: 'tab-pathplan', keys: 'p', description: 'Path Planning', category: 'navigation', action: () => setActiveTab('pathplan') },
      { id: 'tab-urdf', keys: 'u', description: '3D Viewer', category: 'navigation', action: () => setActiveTab('urdf') },
      { id: 'tab-teleop', keys: 't', description: 'Teleop', category: 'navigation', action: () => setActiveTab('teleop') },
      { id: 'tab-sensors', keys: 's', description: 'Sensor Logs', category: 'navigation', action: () => setActiveTab('sensors') },
    ],
    { lensId: 'robotics' }
  );

  // Keep a shared robot list so telemetry/teleop/sensor/mission tabs all
  // have the fleet available without re-fetching per tab.
  const applyRobotResponse = useCallback((r: Awaited<ReturnType<typeof lensRun>>) => {
    if (r.data?.ok && r.data.result) {
      const list = (r.data.result as { robots: RobotRow[] }).robots || [];
      setRobots(list);
      setSelected(prev => {
        if (prev) { const fresh = list.find(x => x.id === prev.id); return fresh || (list[0] || null); }
        return list[0] || null;
      });
    }
  }, []);
  const loadRobots = useCallback(async () => {
    applyRobotResponse(await lensRun('robotics', 'fleetList', {}));
  }, [applyRobotResponse]);

  useEffect(() => {
    let cancelled = false;
    void lensRun('robotics', 'fleetList', {}).then((r) => { if (!cancelled) applyRobotResponse(r); });
    return () => { cancelled = true; };
  }, [applyRobotResponse]);

  return (
    <LensShell lensId="robotics" asMain={false}>
      <FirstRunTour lensId="robotics" />
      <DepthBadge lensId="robotics" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="robotics"
        crumb="Robotics"
        title="Run the fleet"
        subtitle="Fleet ops, telemetry, mission sequencing, kinematics, path planning and teleop."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="robotics" data={{ robots }} compact />
          </>
        }
        tabs={TABS}
        activeTab={activeTab}
        onTab={(id) => setActiveTab(id as Tab)}
        tabsLabel="Robotics views"
        cta={{ label: 'Register a robot', icon: Plus, onClick: () => setActiveTab('fleet') }}
      >
        <RealtimeDataPanel domain="robotics" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        <ArxivPanel domain="robotics" title="arXiv · Robotics (cs.RO)" />

        {/* Robot selector — shared across the per-robot tabs. */}
        {['telemetry', 'teleop', 'sensors'].includes(activeTab) && robots.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 uppercase tracking-wide">Active robot</span>
            <select
              value={selected?.id || ''}
              onChange={e => setSelected(robots.find(r => r.id === e.target.value) || null)}
              className="bg-black/30 border border-white/10 rounded px-2 py-1.5 text-sm">
              {robots.map(r => <option key={r.id} value={r.id}>{r.name} ({r.type})</option>)}
            </select>
          </div>
        )}

        {activeTab === 'fleet' && (
          <FleetManager
            selectedId={selected?.id || null}
            onSelect={(r) => { setSelected(r); loadRobots(); }}
          />
        )}

        {activeTab === 'telemetry' && (
          robots.length === 0
            ? <p className="text-gray-400 text-sm text-center py-6">Register a robot in the Fleet tab first.</p>
            : <TelemetryDashboard robot={selected} />
        )}

        {activeTab === 'missions' && <MissionSequencer robots={robots} />}

        {activeTab === 'kinematics' && <KinematicsStudio />}

        {activeTab === 'pathplan' && <PathPlanner />}

        {activeTab === 'urdf' && <UrdfViewer />}

        {activeTab === 'teleop' && (
          robots.length === 0
            ? <p className="text-gray-400 text-sm text-center py-6">Register a robot in the Fleet tab first.</p>
            : <TeleopConsole robot={selected} />
        )}

        {activeTab === 'sensors' && (
          robots.length === 0
            ? <p className="text-gray-400 text-sm text-center py-6">Register a robot in the Fleet tab first.</p>
            : <SensorLogPanel robot={selected} />
        )}

        {/* Calculator workbench */}
        <PipingProvider>
          <section className="mt-2">
            <RoboticsActionPanel />
          </section>
        </PipingProvider>

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-4">
          <RoboticsRepos />
        </section>
      </NorthStarFrame>
    </LensShell>
  );
}
