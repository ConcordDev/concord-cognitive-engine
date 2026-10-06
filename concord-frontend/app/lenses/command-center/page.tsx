'use client';

import { useEffect, useState, type ReactElement } from 'react';
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
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
  { id: 'vitals', label: 'Vitals', title: 'How the system is breathing', icon: Activity },
  { id: 'ops', label: 'Ops Cockpit', title: 'The ops cockpit', icon: Gauge },
  { id: 'brains', label: 'Brains', title: 'The brains and what they are running', icon: Brain },
  { id: 'cognitive', label: 'Cognitive', title: 'The cognitive engines', icon: Brain },
  { id: 'loaf', label: 'LOAF', title: 'LOAF scoring', icon: Shield },
  { id: 'affect', label: 'Affect', title: 'The system mood', icon: Activity },
  { id: 'emergents', label: 'Emergents', title: 'Emergent entities', icon: Cpu },
  { id: 'lattice', label: 'Lattice', title: 'The knowledge lattice', icon: Layers },
  { id: 'shield', label: 'Shield', title: 'What the shield is holding off', icon: Shield },
  { id: 'attention', label: 'Attention', title: 'Where attention is going', icon: Focus },
  { id: 'forgetting', label: 'Forgetting', title: 'What is being forgotten', icon: Trash2 },
  { id: 'repair', label: 'Repair', title: 'The repair cortex', icon: ShieldAlert },
  { id: 'promotions', label: 'Promotions', title: 'What is up for promotion', icon: ArrowUp },
  { id: 'plugins', label: 'Plugins', title: 'Plugins', icon: Puzzle },
  { id: 'pipeline', label: 'Pipeline', title: 'The DTU pipeline', icon: Zap },
  { id: 'organism', label: 'Organism', title: 'The organism pipeline', icon: GitBranch },
  { id: 'federation', label: 'Federation', title: 'Federation status', icon: Globe },
  { id: 'users', label: 'Users', title: 'Users', icon: Users },
  { id: 'config', label: 'Config', title: 'Configuration', icon: Settings },
  { id: 'emergency', label: 'Emergency', title: 'Emergency controls', icon: AlertTriangle },
  { id: 'dream', label: 'Dream', title: 'The dream cycle', icon: Moon },
  { id: 'breakthrough', label: 'Breakthrough', title: 'Breakthroughs', icon: Lightbulb },
  { id: 'metaDerivation', label: 'Meta-Derivation', title: 'Meta-derivation', icon: GitBranch },
  { id: 'foundation', label: 'Foundation', title: 'The foundation', icon: Globe },
  { id: 'predictions', label: 'Predictions', title: 'Prediction markets', icon: Puzzle },
  { id: 'logs', label: 'Logs', title: 'System logs', icon: FileText },
  { id: 'activity', label: 'Activity', title: 'Everything that just happened', icon: Radio },
  { id: 'undo', label: 'Undo', title: 'Undo timeline', icon: Undo2 },
  { id: 'guide', label: 'Guide', title: 'A guide to the system', icon: Compass },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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

  const current = TABS.find((t) => t.id === active)!;

  return (
    <LensShell lensId="command-center" asMain={false}>
      <FirstRunTour lensId="command-center" />
      <DepthBadge lensId="command-center" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="command-center"
        theme="dashboard"
        crumb="Command Center"
        title={active === 'vitals' && who ? `${current.title}, ${who}` : current.title}
        subtitle="Every station of the running system: brains, lattice, shield, pipeline, federation and the controls behind them."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="command-center" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-1 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))}
        activeTab={active}
        onTab={(id) => setActive(id as TabId)}
        tabsLabel="Command center stations"
        cta={{ label: 'Open emergency panel', icon: AlertTriangle, onClick: () => setActive('emergency'), title: 'Jump to the emergency controls' }}
      >
        <div className="mx-auto max-w-5xl space-y-4">
          <Panel />
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
      </NorthStarFrame>
    </LensShell>
  );
}
