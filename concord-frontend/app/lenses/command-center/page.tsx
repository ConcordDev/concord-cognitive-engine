'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Shield, Activity, Brain, Puzzle, Cpu, Users, Settings,
  AlertTriangle, Moon, FileText,
  Trash2, ArrowUp,
  Zap, Focus, ShieldAlert,
  Lightbulb, GitBranch, Globe, Undo2, Compass, Radio, Gauge,
  Layers,
} from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { AdminRequiredState } from '@/components/common/EmptyState';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ActivityFeed } from '@/components/guidance/ActivityFeed';
import { UndoTimeline } from '@/components/guidance/UndoTimeline';
import { SystemGuidePanel } from '@/components/guidance/SystemGuidePanel';
import { OpsCockpit } from '@/components/command-center/OpsCockpit';
import { VitalsPanel } from '@/components/command-center/VitalsPanel';
import { BrainsPanel } from '@/components/command-center/BrainsPanel';
import { CognitiveEnginesPanel } from '@/components/command-center/CognitiveEnginesPanel';
import { LoafPanel } from '@/components/command-center/LoafPanel';
import { AffectPanel } from '@/components/command-center/AffectPanel';
import { EmergentPanel } from '@/components/command-center/EmergentPanel';
import { LatticePanel } from '@/components/command-center/LatticePanel';
import { ShieldStatusPanel } from '@/components/command-center/ShieldStatusPanel';
import { AttentionPanel } from '@/components/command-center/AttentionPanel';
import { ForgettingPanel } from '@/components/command-center/ForgettingPanel';
import { RepairCortexPanel } from '@/components/command-center/RepairCortexPanel';
import { PromotionPanel } from '@/components/command-center/PromotionPanel';
import { PluginPanel } from '@/components/command-center/PluginPanel';
import { PipelinePanel } from '@/components/command-center/PipelinePanel';
import { OrganismPipelinePanel } from '@/components/command-center/OrganismPipelinePanel';
import { FederationStatusPanel } from '@/components/command-center/FederationStatusPanel';
import { UserPanel } from '@/components/command-center/UserPanel';
import { ConfigPanel } from '@/components/command-center/ConfigPanel';
import { EmergencyPanel } from '@/components/command-center/EmergencyPanel';
import { DreamPanel } from '@/components/command-center/DreamPanel';
import { BreakthroughPanel } from '@/components/command-center/BreakthroughPanel';
import { MetaDerivationPanel } from '@/components/command-center/MetaDerivationPanel';
import { FoundationPanel } from '@/components/command-center/FoundationPanel';
import { LogsPanel } from '@/components/command-center/LogsPanel';
import { PredictionMarketPanel } from '@/components/command-center/PredictionMarketPanel';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';

const TABS = [
  { id: 'vitals', label: 'Vitals', icon: Activity },
  { id: 'ops', label: 'Ops Cockpit', icon: Gauge },
  { id: 'brains', label: 'Brains', icon: Brain },
  { id: 'cognitive', label: 'Cognitive', icon: Brain },
  { id: 'loaf', label: 'LOAF', icon: Shield },
  { id: 'affect', label: 'Affect', icon: Activity },
  { id: 'emergents', label: 'Emergents', icon: Cpu },
  { id: 'lattice', label: 'Lattice', icon: Layers },
  { id: 'shield', label: 'Shield', icon: Shield },
  { id: 'attention', label: 'Attention', icon: Focus },
  { id: 'forgetting', label: 'Forgetting', icon: Trash2 },
  { id: 'repair', label: 'Repair', icon: ShieldAlert },
  { id: 'promotions', label: 'Promotions', icon: ArrowUp },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'pipeline', label: 'Pipeline', icon: Zap },
  { id: 'organism', label: 'Organism', icon: GitBranch },
  { id: 'federation', label: 'Federation', icon: Globe },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'config', label: 'Config', icon: Settings },
  { id: 'emergency', label: 'Emergency', icon: AlertTriangle },
  { id: 'dream', label: 'Dream', icon: Moon },
  { id: 'breakthrough', label: 'Breakthrough', icon: Lightbulb },
  { id: 'metaDerivation', label: 'Meta-Derivation', icon: GitBranch },
  { id: 'foundation', label: 'Foundation', icon: Globe },
  { id: 'predictions', label: 'Predictions', icon: Puzzle },
  { id: 'logs', label: 'Logs', icon: FileText },
  { id: 'activity', label: 'Activity', icon: Radio },
  { id: 'undo', label: 'Undo', icon: Undo2 },
  { id: 'guide', label: 'Guide', icon: Compass },
] as const;

type TabId = typeof TABS[number]['id'];

const PANELS: Record<TabId, () => ReactElement> = {
  vitals: () => <VitalsPanel />,
  ops: () => <OpsCockpit />,
  brains: () => <BrainsPanel />,
  cognitive: () => <CognitiveEnginesPanel />,
  loaf: () => <LoafPanel />,
  affect: () => <AffectPanel />,
  emergents: () => <EmergentPanel />,
  lattice: () => <LatticePanel />,
  shield: () => <ShieldStatusPanel />,
  attention: () => <AttentionPanel />,
  forgetting: () => <ForgettingPanel />,
  repair: () => <RepairCortexPanel />,
  promotions: () => <PromotionPanel />,
  plugins: () => <PluginPanel />,
  pipeline: () => <PipelinePanel />,
  organism: () => <OrganismPipelinePanel />,
  federation: () => <FederationStatusPanel />,
  users: () => <UserPanel />,
  config: () => <ConfigPanel />,
  emergency: () => <EmergencyPanel />,
  dream: () => <DreamPanel />,
  breakthrough: () => <BreakthroughPanel />,
  metaDerivation: () => <MetaDerivationPanel />,
  foundation: () => <FoundationPanel />,
  predictions: () => <PredictionMarketPanel />,
  logs: () => <LogsPanel />,
  activity: () => <ActivityFeed />,
  undo: () => <UndoTimeline />,
  guide: () => <SystemGuidePanel />,
};

export default function CommandCenterPage() {
  useLensNav('command-center');
  useLensIdentity('command-center');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('command-center');
  const router = useRouter();
  const [active, setActive] = useState<TabId>('vitals');

  const recentSessions = useArtifacts<{ kind: string; at: string }>('command-center', { type: 'session', limit: 5 });
  const recordSession = useCreateArtifact<{ kind: string; at: string }>('command-center');
  void recentSessions;
  useEffect(() => {
    recordSession.mutate({
      type: 'session',
      title: `Command-center session ${new Date().toLocaleString()}`,
      data: { kind: 'open', at: new Date().toISOString() },
      meta: { tags: ['command-center'], status: 'completed', visibility: 'private' },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLensCommand(
    [
      { id: 'tab-vitals', keys: 'v', description: 'Vitals', category: 'navigation', action: () => setActive('vitals') },
      { id: 'tab-brains', keys: 'b', description: 'Brains', category: 'navigation', action: () => setActive('brains') },
      { id: 'tab-cognitive', keys: 'c', description: 'Cognitive', category: 'navigation', action: () => setActive('cognitive') },
      { id: 'tab-loaf', keys: 'l', description: 'Loaf', category: 'navigation', action: () => setActive('loaf') },
      { id: 'tab-affect', keys: 'a', description: 'Affect', category: 'navigation', action: () => setActive('affect') },
      { id: 'tab-emergents', keys: 'e', description: 'Emergents', category: 'navigation', action: () => setActive('emergents') },
      { id: 'tab-lattice', keys: 't', description: 'Lattice', category: 'navigation', action: () => setActive('lattice') },
      { id: 'tab-shield', keys: 's', description: 'Shield', category: 'navigation', action: () => setActive('shield') },
      { id: 'tab-attention', keys: 'n', description: 'Attention', category: 'navigation', action: () => setActive('attention') },
      { id: 'tab-forgetting', keys: 'f', description: 'Forgetting', category: 'navigation', action: () => setActive('forgetting') },
      { id: 'tab-repair', keys: 'r', description: 'Repair', category: 'navigation', action: () => setActive('repair') },
      { id: 'tab-promotions', keys: 'p', description: 'Promotions', category: 'navigation', action: () => setActive('promotions') },
    ],
    { lensId: 'command-center' },
  );

  const { data: me, isLoading: authLoading } = useQuery({
    queryKey: ['cc-auth'],
    queryFn: () => apiHelpers.auth.me().then((r) => r.data),
    retry: false,
  });
  const userRole = useUIStore((s) => s.userRole);
  const isSovereignRole = userRole === 'admin' || userRole === 'sovereign';

  useEffect(() => {
    if (!authLoading && !me) router.push('/login');
  }, [me, authLoading, router]);

  if (authLoading) return null;
  if (!me) return null;
  if (!isSovereignRole) {
    return (
      <LensShell lensId="command-center" asMain={false}>
        <div className="flex items-center justify-center h-full p-8">
          <AdminRequiredState roles={['admin', 'sovereign']} />
        </div>
      </LensShell>
    );
  }

  const Panel = PANELS[active];

  return (
    <LensShell lensId="command-center" asMain={false}>
      <FirstRunTour lensId="command-center" />
      <DepthBadge lensId="command-center" size="sm" className="ml-2" />
      <div data-lens-theme="dashboard" className="min-h-screen bg-[#070b10] text-white" style={{ background: 'var(--lens-gradient, #070b10)' }}>
        <div className="sticky top-0 z-50 bg-[#0a0f18]/95 backdrop-blur-md border-b border-cyan-900/20 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Shield className="w-5 h-5 text-cyan-400" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
            </div>
            <h1 className="text-base font-bold tracking-tight text-cyan-50">Command Center</h1>
            <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-700">Gotham C2</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="command-center" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="sticky top-[52px] z-40 bg-[#0a0f18]/95 backdrop-blur-md border-b border-cyan-900/15 overflow-x-auto">
          <div className="flex min-w-max px-2" role="tablist" aria-label="Command center stations">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = active === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActive(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
                    isActive
                      ? 'text-cyan-400 border-cyan-400'
                      : 'text-gray-600 border-transparent hover:text-cyan-300/70'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-4 max-w-2xl mx-auto space-y-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <Panel />
            </motion.div>
          </AnimatePresence>
          {realtimeData && (
            <RealtimeDataPanel
              domain="command-center"
              data={realtimeData}
              isLive={isLive}
              lastUpdated={lastUpdated}
              insights={realtimeInsights}
              compact
            />
          )}
        </div>
      </div>
      <CrossLensRecentsPanel lensId="command-center" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
