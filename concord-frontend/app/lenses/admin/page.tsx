'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers, isForbidden } from '@/lib/api/client';
import { useMemo, useState, type ComponentType } from 'react';
import {
  Activity,
  Box,
  DollarSign,
  FileText,
  Gauge,
  HardDrive,
  Key,
} from 'lucide-react';
import { ErrorState, AdminRequiredState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { OverviewPanel } from '@/components/admin/OverviewPanel';
import { InfraPanel } from '@/components/admin/InfraPanel';
import { TreasuryPanel } from '@/components/admin/TreasuryPanel';
import { AccessPanel } from '@/components/admin/AccessPanel';
import { PlatformPanel } from '@/components/admin/PlatformPanel';
import { AuditPanel } from '@/components/admin/AuditPanel';
import { OpsConsole } from '@/components/admin/OpsConsole';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type AdminView = 'overview' | 'ops' | 'infra' | 'access' | 'treasury' | 'platform' | 'audit';

const TABS = [
  { id: 'overview', label: 'Overview', keys: '1', icon: Activity, title: 'How the platform is running', hint: 'Live platform overview' },
  { id: 'ops', label: 'Observability', keys: 'g', icon: Gauge, title: 'What the system is doing', hint: 'Heartbeats, workers, brains and telemetry' },
  { id: 'infra', label: 'Infra', keys: 'i', icon: HardDrive, title: 'What it is running on', hint: 'Infrastructure and capacity' },
  { id: 'access', label: 'Access', keys: 'k', icon: Key, title: 'Who can do what', hint: 'Users, orgs, roles and keys' },
  { id: 'treasury', label: 'Treasury', keys: 't', icon: DollarSign, title: 'Where the coin sits', hint: 'Treasury, ledger and reconciliation' },
  { id: 'platform', label: 'Platform', keys: 'p', icon: Box, title: 'Every macro and domain', hint: 'Macro registry and quality' },
  { id: 'audit', label: 'Audit', keys: 'l', icon: FileText, title: 'What happened, and when', hint: 'Audit log and health scoring' },
] as const;

const PANELS: Record<AdminView, ComponentType> = {
  overview: OverviewPanel,
  ops: OpsConsole,
  infra: InfraPanel,
  access: AccessPanel,
  treasury: TreasuryPanel,
  platform: PlatformPanel,
  audit: AuditPanel,
};

export default function AdminLensPage() {
  useLensNav('admin');
  useLensIdentity('admin');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('admin');
  const [active, setActive] = useState<AdminView>('overview');
  const ActivePanel = PANELS[active];

  const commands = useMemo(
    () => [
      ...TABS.map((t) => ({
        id: `view-${t.id}`,
        keys: t.keys,
        description: `Open ${t.label}`,
        category: 'navigation' as const,
        action: () => setActive(t.id),
      })),
      {
        id: 'macros',
        keys: 'm',
        description: 'Open Platform (macros)',
        category: 'navigation' as const,
        action: () => setActive('platform'),
      },
      {
        id: 'orgs',
        keys: 'o',
        description: 'Open Access (orgs)',
        category: 'navigation' as const,
        action: () => setActive('access'),
      },
      {
        id: 'quality',
        keys: 'q',
        description: 'Open Platform (quality)',
        category: 'navigation' as const,
        action: () => setActive('platform'),
      },
      {
        id: 'sys-health',
        keys: 'h',
        description: 'Open Audit (health scoring)',
        category: 'navigation' as const,
        action: () => setActive('audit'),
      },
      {
        id: 'home',
        keys: 'esc',
        description: 'Back to Overview',
        category: 'navigation' as const,
        action: () => setActive('overview'),
      },
    ],
    [],
  );
  useLensCommand(commands, { lensId: 'admin' });

  // Gate queries — must hit admin-role-gated endpoints so AdminRequiredState fires on 403.
  const dash = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => apiHelpers.admin.dashboard().then((r) => r.data),
    refetchInterval: 5000,
  });
  const metricsQ = useQuery({
    queryKey: ['admin-metrics'],
    queryFn: () => apiHelpers.admin.metrics().then((r) => r.data),
    refetchInterval: 5000,
  });
  const logsQ = useQuery({
    queryKey: ['admin-logs'],
    queryFn: () => apiHelpers.admin.logs({ limit: 20 }).then((r) => r.data),
    refetchInterval: 10000,
  });

  if ([dash.error, metricsQ.error, logsQ.error].some(isForbidden)) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <AdminRequiredState roles={['admin']} />
      </div>
    );
  }
  if (dash.isError || metricsQ.isError || logsQ.isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState
          error={dash.error?.message || metricsQ.error?.message || logsQ.error?.message}
          onRetry={() => {
            void dash.refetch();
            void metricsQ.refetch();
            void logsQ.refetch();
          }}
        />
      </div>
    );
  }

  const current = TABS.find((t) => t.id === active)!;
  const alertCount = realtimeAlerts.length;

  return (
    <LensShell lensId="admin" asMain={false}>
      <FirstRunTour lensId="admin" />
      <DepthBadge lensId="admin" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="admin"
        theme="admin"
        crumb="Ops"
        title={`${current.title}${active === 'overview' && who ? `, ${who}` : ''}`}
        subtitle="Operator console. Live macros, no fabricated stats."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="admin" data={realtimeData || {}} compact />
            {alertCount > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-1 font-mono text-xs text-yellow-400">
                {alertCount} alert{alertCount !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, keys: t.keys, hint: t.hint }))}
        activeTab={active}
        onTab={(id) => setActive(id as AdminView)}
        tabsLabel="Admin views"
        cta={{
          label: 'Open audit log',
          icon: FileText,
          onClick: () => setActive('audit'),
          title: 'Review the audit log',
        }}
      >
        <div className="space-y-5">
          <RealtimeDataPanel
            domain="admin"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
          <ActivePanel />
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
