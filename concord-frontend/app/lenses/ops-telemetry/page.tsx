'use client';

import { useState } from 'react';
import {
  Cpu, Brain, Globe, Layers, Target, LayoutDashboard, RefreshCw,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { AdminRequiredState } from '@/components/common/EmptyState';
import {
  OpsTelemetryConsole,
  type OpsView,
} from '@/components/ops-telemetry/OpsTelemetryConsole';

// Same allow-list as requireRole("owner", "admin", "sovereign", "founder")
// on every route this lens reads, including GET /api/runtime/constellation
// (server.js — it is admin-only, the same gate as /api/admin/heartbeat-stats
// and /api/admin/liveness). requireRole also admits a wildcard scope ("*");
// a named scope such as "admin" does not, and sovereign already passes every
// requireRole check.
//
// A non-operator used to mount OpsTelemetryConsole immediately. Its first
// paint falls through to the dashboard (loading starts false), so
// LivenessPanel and RuntimeConstellationPanel fetch on mount in the same
// turn as the heartbeat-stats probe — the 403 branch inside refresh() is
// too late to stop those requests (heartbeat-stats was observed twice).
// Wait for /api/auth/me and mount the console only for a viewer the
// server would allow.
const OPS_TELEMETRY_ROLES = new Set(['owner', 'admin', 'sovereign', 'founder']);

function isOpsTelemetryOperator(user: { role?: string; scopes?: string[] } | null | undefined): boolean {
  if (!user) return false;
  if (typeof user.role === 'string' && OPS_TELEMETRY_ROLES.has(user.role)) return true;
  return Array.isArray(user.scopes) && user.scopes.includes('*');
}

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
  const { user, isLoading: authLoading } = useAuth();
  const isOperator = isOpsTelemetryOperator(user);
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

  if (authLoading) {
    return (
      <LensShell lensId="ops-telemetry" asMain={false}>
        <p role="status" className="px-4 py-6 text-sm text-zinc-400">Checking access…</p>
      </LensShell>
    );
  }

  if (!isOperator) {
    return (
      <LensShell lensId="ops-telemetry" asMain={false}>
        <AdminRequiredState roles={['owner', 'admin', 'sovereign', 'founder']} />
      </LensShell>
    );
  }

  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="ops-telemetry" asMain={false}>

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
