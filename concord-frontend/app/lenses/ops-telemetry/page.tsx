'use client';

import { useState } from 'react';
import {
  Cpu, Brain, Globe, Layers, Target, LayoutDashboard, RefreshCw,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import {
  OpsTelemetryConsole,
  type OpsView,
} from '@/components/ops-telemetry/OpsTelemetryConsole';

const VIEWS: { id: OpsView; label: string; keys: string; title: string; hint: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', keys: '1', title: 'How the system is running', hint: 'Cost story, simulation and federation mesh', icon: LayoutDashboard },
  { id: 'missions', label: 'Missions', keys: '2', title: 'What the agents are doing', hint: 'Mission activity', icon: Target },
  { id: 'heartbeats', label: 'Heartbeats', keys: '3', title: 'The pulse of every module', hint: 'Per-module p50/p90/p99 timings', icon: Layers },
  { id: 'workers', label: 'Workers', keys: '4', title: 'Who is carrying the load', hint: 'Macro pool and heartbeat pool utilisation', icon: Cpu },
  { id: 'brains', label: 'Brains', keys: '5', title: 'Where inference is landing', hint: 'Per-brain endpoint inflight and failures', icon: Brain },
  { id: 'shards', label: 'Shards', keys: '6', title: 'How the worlds are split', hint: 'World shard status', icon: Globe },
];

export default function OpsTelemetryPage() {
  useLensIdentity('ops-telemetry');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<OpsView>('overview');
  const [refreshNonce, setRefreshNonce] = useState(0);

  useLensCommand(
    VIEWS.map((v) => ({
      id: `ops-${v.id}`,
      keys: v.keys,
      description: `${v.label}: ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'ops-telemetry' },
  );

  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="ops-telemetry" asMain={false}>
      <FirstRunTour lensId="ops-telemetry" />
      <DepthBadge lensId="ops-telemetry" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="ops-telemetry"
        crumb="Ops telemetry"
        title={`${current.title}${active === 'overview' && who ? `, ${who}` : ''}`}
        subtitle="Live operator dashboard over the admin telemetry routes: heartbeats, worker pools, brain endpoints and world shards."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={active}
        onTab={(id) => setActive(id as OpsView)}
        tabsLabel="Telemetry views"
        cta={{ label: 'Refresh view', icon: RefreshCw, onClick: () => setRefreshNonce((n) => n + 1), title: 'Re-fetch this view' }}
      >
        <OpsTelemetryConsole key={`${active}:${refreshNonce}`} view={active} />
      </NorthStarFrame>
    </LensShell>
  );
}
