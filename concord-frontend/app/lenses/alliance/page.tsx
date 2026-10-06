'use client';

/**
 * Alliance Lens — Slack Connect / Discord-shape cross-org collaboration
 * (channels, threads, reactions, invites+roles, quorum-vote proposals) plus
 * a strategic-analysis toolkit (compatibility / network / risk), rebuilt as
 * a real app (Frontend Rebuild Program, Wave 2).
 *
 * Capability map: docs/lens-specs/alliance-capability-map.md. Generic
 * scaffold retired: ManifestActionBar,
 * CrossLensRecentsPanel, UniversalActions, LensFeaturePanel — the
 * `compatibilityScore` / `networkAnalysis` / `riskAssessment` macros that
 * were only reachable through the raw auto-discovered-macro button wall
 * now have a real designed UI in `AllianceAnalyticsPanel`.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users2, LineChart, Swords, RefreshCw } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { AllianceWorkspace } from '@/components/alliance/AllianceWorkspace';
import { AllianceAnalyticsPanel } from '@/components/alliance/AllianceAnalyticsPanel';
import { FactionWarIntel } from '@/components/alliance/FactionWarIntel';
import { StatTile, StatTileGrid, Skeleton, ErrorState, StatusDot, DensityToggle } from '@/components/ui';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { lensRun } from '@/lib/api/client';

interface AllianceSummary {
  alliances: { id: string; name: string; type: string; members: unknown[]; activeProposals: number }[];
  count: number;
}
interface Notifications {
  totalUnread: number;
  pendingInvites: number;
}

type TabId = 'workspace' | 'analytics' | 'intel';
const TABS: { id: TabId; label: string; icon: typeof Users2; hotkey: string; desc: string }[] = [
  { id: 'workspace', label: 'Workspace', icon: Users2, hotkey: '1', desc: 'Alliances, channels, invites, quorum votes' },
  { id: 'analytics', label: 'Analytics', icon: LineChart, hotkey: '2', desc: 'Compatibility, network, risk calculators' },
  { id: 'intel', label: 'Faction Intel', icon: Swords, hotkey: '3', desc: "Concord's own emergent faction wars (read-only, separate system)" },
];

export default function AllianceLensPage() {
  useLensNav('alliance');
  const [tab, setTab] = useState<TabId>('workspace');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  const summary = useMacroDispatchFeedback<AllianceSummary>();
  const [notifs, setNotifs] = useState<Notifications | null>(null);

  const loadHeader = useCallback(async () => {
    void summary.dispatch('alliance', 'alliance-list', {});
    const n = await lensRun<Notifications>('alliance', 'notifications', {});
    if (n.data?.ok !== false) setNotifs((n.data?.result as Notifications) || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) void loadHeader(); });
    return () => { cancelled = true; };
  }, [loadHeader]);

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `tab-${t.id}`, keys: t.hotkey, description: t.label, category: 'navigation' as const,
        action: () => setTab(t.id),
      })),
      { id: 'refresh-header', keys: 'r', description: 'Refresh alliance summary', category: 'actions', action: loadHeader },
    ],
    { lensId: 'alliance' }
  );

  const summaryLoading = summary.status === 'dispatched' || summary.status === 'running';
  const data = summary.status === 'done' ? summary.result : null;
  const activeProposals = data?.alliances.reduce((acc, a) => acc + (a.activeProposals || 0), 0) ?? 0;

  const tabs = TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, keys: t.hotkey, hint: t.desc }));
  const titles: Record<TabId, string> = {
    workspace: `Stand with your allies${who ? `, ${who}` : ''}`,
    analytics: 'Weigh the alliance',
    intel: 'Read the faction wars',
  };
  const unread = (notifs?.totalUnread || 0) + (notifs?.pendingInvites || 0);

  return (
    <LensShell lensId="alliance" asMain={false}>
      <FirstRunTour lensId="alliance" />
      <NorthStarFrame
        lensId="alliance"
        crumb="Alliance"
        title={titles[tab]}
        subtitle={<span className="inline-flex items-center gap-2">Cross-group collaboration &amp; diplomatic analysis <DepthBadge lensId="alliance" size="sm" /></span>}
        actions={(
          <>
            <StatusDot state={unread > 0 ? 'warning' : 'idle'} size="xs" pulse={false}
              label={notifs && unread > 0 ? `${notifs.totalUnread} unread · ${notifs.pendingInvites} invites` : 'up to date'}
              showLabel className="hidden sm:flex" />
            <DensityToggle variant="dropdown" />
            <DTUExportButton domain="alliance" data={data || {}} compact />
          </>
        )}
        tabs={tabs}
        activeTab={tab}
        onTab={(id) => setTab(id as TabId)}
        tabsLabel="Alliance views"
        cta={{ label: summaryLoading ? 'Refreshing…' : 'Refresh summary', icon: RefreshCw, onClick: loadHeader, disabled: summaryLoading, title: 'Refresh alliance summary (R)' }}
      >
      <div className="space-y-5">
        {/* KPI strip — real alliance-list + notifications macros */}
        {summaryLoading && !data ? (
          <StatTileGrid columns={4}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-md border border-white/10 bg-black/40 p-3"><Skeleton variant="line" lines={2} /></div>
            ))}
          </StatTileGrid>
        ) : summary.status === 'error' ? (
          <ErrorState message={summary.error || 'Failed to load alliance summary.'} onRetry={loadHeader} retrying={summaryLoading} variant="inline" />
        ) : data ? (
          <StatTileGrid columns={4}>
            <StatTile label="Alliances joined" value={data.count} icon={<Users2 className="w-3.5 h-3.5" />} />
            <StatTile label="Total members" value={data.alliances.reduce((acc, a) => acc + (a.members?.length || 0), 0)} />
            <StatTile label="Active proposals" value={activeProposals} />
            <StatTile label="Unread + invites" value={(notifs?.totalUnread || 0) + (notifs?.pendingInvites || 0)} tone={(notifs?.totalUnread || 0) + (notifs?.pendingInvites || 0) > 0 ? 'negative' : 'neutral'} />
          </StatTileGrid>
        ) : null}

        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {tab === 'workspace' && <AllianceWorkspace />}
            {tab === 'analytics' && <AllianceAnalyticsPanel />}
            {tab === 'intel' && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                <FactionWarIntel />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      </NorthStarFrame>
    </LensShell>
  );
}
