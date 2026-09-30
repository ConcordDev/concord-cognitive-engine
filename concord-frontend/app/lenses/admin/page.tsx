'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers, isForbidden } from '@/lib/api/client';
import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  Box,
  DollarSign,
  FileText,
  Gauge,
  HardDrive,
  Key,
  Settings,
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
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

type AdminView = 'overview' | 'ops' | 'infra' | 'access' | 'treasury' | 'platform' | 'audit';

const TABS = [
  { id: 'overview', label: 'Overview', keys: '1', icon: Activity },
  { id: 'ops', label: 'Observability', keys: 'g', icon: Gauge },
  { id: 'infra', label: 'Infra', keys: 'i', icon: HardDrive },
  { id: 'access', label: 'Access', keys: 'k', icon: Key },
  { id: 'treasury', label: 'Treasury', keys: 't', icon: DollarSign },
  { id: 'platform', label: 'Platform', keys: 'p', icon: Box },
  { id: 'audit', label: 'Audit', keys: 'l', icon: FileText },
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
  const reduceMotion = useReducedMotion();
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('admin');
  const [active, setActive] = useState<
    'overview' | 'ops' | 'infra' | 'access' | 'treasury' | 'platform' | 'audit'
  >('overview');
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

  return (
    <LensShell lensId="admin" asMain={false}>
      <FirstRunTour lensId="admin" />
      <DepthBadge lensId="admin" size="sm" className="ml-2" />
      <div data-lens-theme="admin" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-lattice-border">
              <Settings className="w-5 h-5 text-[color:var(--lens-accent,#546E7A)]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className={ds.heading1}>Ops</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="admin" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400 font-mono">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>Linear / Vercel-style operator console · live macros, no fabricated stats</p>
            </div>
          </div>
        </header>

        <RealtimeDataPanel
          domain="admin"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />

        <nav className={ds.tabBar} aria-label="Admin views">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                className={on ? ds.tabActive() : ds.tabInactive}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
                <kbd className="ml-1 px-1 py-0.5 rounded bg-black/30 border border-white/10 font-mono text-[10px] text-gray-500">
                  {t.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className={cn('pt-4')}
          >
            <ActivePanel />
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="admin" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
