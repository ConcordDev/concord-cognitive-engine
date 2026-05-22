'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
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
import { TeleopConsole } from '@/components/robotics/TeleopConsole';
import { SensorLogPanel } from '@/components/robotics/SensorLogPanel';
import { PipingProvider } from '@/components/panel-polish';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useState, useEffect, useCallback } from 'react';
import { Bot, Layers, ChevronDown } from 'lucide-react';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { lensRun } from '@/lib/api/client';

type Tab = 'fleet' | 'telemetry' | 'missions' | 'kinematics' | 'pathplan' | 'teleop' | 'sensors';

const TABS: { id: Tab; label: string }[] = [
  { id: 'fleet', label: 'Fleet' },
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'missions', label: 'Missions' },
  { id: 'kinematics', label: 'Kinematics' },
  { id: 'pathplan', label: 'Path Planning' },
  { id: 'teleop', label: 'Teleop' },
  { id: 'sensors', label: 'Sensor Logs' },
];

export default function RoboticsLensPage() {
  useLensNav('robotics');

  const [activeTab, setActiveTab] = useState<Tab>('fleet');
  const [showFeatures, setShowFeatures] = useState(false);
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
      { id: 'tab-teleop', keys: 't', description: 'Teleop', category: 'navigation', action: () => setActiveTab('teleop') },
      { id: 'tab-sensors', keys: 's', description: 'Sensor Logs', category: 'navigation', action: () => setActiveTab('sensors') },
    ],
    { lensId: 'robotics' }
  );

  // Keep a shared robot list so telemetry/teleop/sensor/mission tabs all
  // have the fleet available without re-fetching per tab.
  const loadRobots = useCallback(async () => {
    const r = await lensRun('robotics', 'fleetList', {});
    if (r.data?.ok && r.data.result) {
      const list = (r.data.result as { robots: RobotRow[] }).robots || [];
      setRobots(list);
      setSelected(prev => {
        if (prev) { const fresh = list.find(x => x.id === prev.id); return fresh || (list[0] || null); }
        return list[0] || null;
      });
    }
  }, []);

  useEffect(() => { loadRobots(); }, [loadRobots]);

  return (
    <LensShell lensId="robotics" asMain={false}>
      <FirstRunTour lensId="robotics" />
      <ManifestActionBar />
      <DepthBadge lensId="robotics" size="sm" className="ml-2" />
      <div data-lens-theme="robotics" className="p-6 space-y-6">
        <ArxivPanel domain="robotics" title="arXiv · Robotics (cs.RO)" />

        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bot className="w-8 h-8 text-neon-cyan" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">Robotics Lens</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <p className="text-sm text-gray-400">
                Fleet ops, telemetry, mission sequencing, kinematics, path planning &amp; teleop
              </p>
            </div>
          </div>
        </header>

        <RealtimeDataPanel domain="robotics" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        <UniversalActions domain="robotics" artifactId={undefined} compact />
        <DTUExportButton domain="robotics" data={{ robots }} compact />

        {/* Tabs */}
        <div className="flex gap-1.5 border-b border-white/10 pb-2 flex-wrap">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-2 rounded-t-lg text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-neon-cyan/20 text-neon-cyan border-b-2 border-neon-cyan' : 'text-gray-400 hover:text-white'}`}>
              {tab.label}
            </button>
          ))}
        </div>

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
            ? <p className="text-gray-500 text-sm text-center py-6">Register a robot in the Fleet tab first.</p>
            : <TelemetryDashboard robot={selected} />
        )}

        {activeTab === 'missions' && <MissionSequencer robots={robots} />}

        {activeTab === 'kinematics' && <KinematicsStudio />}

        {activeTab === 'pathplan' && <PathPlanner />}

        {activeTab === 'teleop' && (
          robots.length === 0
            ? <p className="text-gray-500 text-sm text-center py-6">Register a robot in the Fleet tab first.</p>
            : <TeleopConsole robot={selected} />
        )}

        {activeTab === 'sensors' && (
          robots.length === 0
            ? <p className="text-gray-500 text-sm text-center py-6">Register a robot in the Fleet tab first.</p>
            : <SensorLogPanel robot={selected} />
        )}

        {/* Calculator workbench */}
        <PipingProvider>
          <section className="mt-2">
            <RoboticsActionPanel />
          </section>
        </PipingProvider>

        {/* Lens Features */}
        <div className="border-t border-white/10">
          <button onClick={() => setShowFeatures(!showFeatures)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
            <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features &amp; Capabilities</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
          </button>
          {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="robotics" /></div>}
        </div>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <RoboticsRepos />
        </section>
      </div>
      <RecentMineCard domain="robotics" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="robotics" hideWhenEmpty className="mt-3" title="More actions" />
      <CrossLensRecentsPanel lensId="robotics" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
