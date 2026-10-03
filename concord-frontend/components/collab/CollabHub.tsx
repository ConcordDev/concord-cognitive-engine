'use client';

import { useState } from 'react';
import { SessionRail } from '@/components/lens/SessionRail';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useQuery } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { api, lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { AnimatePresence } from 'framer-motion';
import {
  Users,
  Plus,
  Mail,
  Archive,
  Search,
  FileText,
  Gauge,
  Clock,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { WorkspaceRoster } from '@/components/collab/WorkspaceRoster';
import { CollabActionPanel } from '@/components/collab/CollabActionPanel';
import { CollabDocWorkspace } from '@/components/collab/CollabDocWorkspace';
import { PipingProvider } from '@/components/panel-polish';
import {
  SessionCard,
  ActiveSessionView,
  InvitationCard,
  HistoryCard,
  CreateSessionModal,
} from '@/components/collab/CollabSessionViews';

import type {
  CollabSession,
  Invitation,
  HistoryEntry,
  MainTab,
  FilterPill,
} from '@/components/collab/collab-model';

export function CollabHub() {
  useLensNav('collab');
  useLensIdentity('collab');
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('collab');
  const { user } = useAuth();
  const myUserId = user?.id || 'anon';
  const myName = user?.username || 'You';
  const who = titleCaseDisplayName(user?.username);
  const {
    isLoading,
    isError,
    error,
    refetch,
    items: sessionItems,
    create: createSessionArtifact,
  } = useLensData('collab', 'session', {
    seed: [],
  });
  // Real invitations — the direct producer is `collab.sessionInviteList`
  // (server/domains/collab.js), NOT the generic cross-user useLensData
  // artifact store: `collab` is a "social" lens domain there, which would
  // make a private 1:1 invite publicly readable by any caller. Default
  // scope is 'received' — the invites sent TO the current user, which is
  // exactly what this tab shows.
  const {
    data: invitesResult,
    isLoading: isLoadingInvitations,
    isError: isError2,
    error: error2,
    refetch: refetch2,
  } = useQuery({
    queryKey: ['collab-invitations', 'received', myUserId],
    queryFn: async () => {
      const r = await lensRun<{ invitations: Invitation[]; total: number }>(
        'collab',
        'sessionInviteList',
        { scope: 'received' }
      );
      if (!r.data.ok) throw new Error(r.data.error || 'Failed to load invitations');
      return r.data.result;
    },
    refetchInterval: 30000,
  });
  const {
    isLoading: isLoadingHistory,
    isError: isError3,
    error: error3,
    refetch: refetch3,
    items: historyItems,
  } = useLensData('collab', 'history', {
    seed: [],
  });

  // Fetch active collaborations from the API
  const { data: activeCollabsData } = useQuery({
    queryKey: ['active-collabs'],
    queryFn: () => api.get('/api/collab/active').then((r) => r.data),
    refetchInterval: 30000,
  });

  const [activeTab, setActiveTab] = useState<MainTab>('active');


  const [filterPill, setFilterPill] = useState<FilterPill>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeSession, setActiveSession] = useState<CollabSession | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Merge the wrapping lens-artifact id into `.data` — the backend assigns
  // the real, stable, cross-user-visible id at the artifact level (`i.id`),
  // not inside the JSON payload, so this is required for join/leave/close to
  // address the right record.
  const sessions: CollabSession[] = sessionItems.map((i) => ({
    ...(i.data as unknown as CollabSession),
    id: i.id,
  }));
  const invitations: Invitation[] = invitesResult?.invitations || [];
  const history: HistoryEntry[] = historyItems.map((i) => ({
    ...(i.data as unknown as HistoryEntry),
    id: i.id,
  }));
  const onlineCount = sessions.reduce(
    (n, s) => n + s.participants.filter((p) => p.online).length,
    0
  );

  // Filter sessions
  const filteredSessions = sessions.filter((s) => {
    if (filterPill !== 'all' && s.projectType !== filterPill) return false;
    if (searchTerm && !s.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const mySessions = sessions.filter(
    (s) => s.host.id === myUserId || s.participants.some((p) => p.id === myUserId)
  );

  const TABS: { key: MainTab; label: string; keys: string; title: string; hint: string; icon: typeof Users }[] = [
    { key: 'active', label: `Rooms · ${sessions.length}`, keys: 'a', title: 'Where people are working', hint: 'Every live session room', icon: Users },
    { key: 'mine', label: `Mine · ${mySessions.length}`, keys: 'm', title: 'Rooms you are in', hint: 'Sessions you host or joined', icon: Users },
    { key: 'invitations', label: 'Invitations', keys: 'i', title: 'Who wants you in the room', hint: 'Invites sent to you', icon: Mail },
    { key: 'workspace', label: 'Docs & people', keys: 'd', title: 'Write together', hint: 'Live docs and the workspace roster', icon: FileText },
    { key: 'facilitator', label: 'Facilitator', keys: 'f', title: 'How the team is doing', hint: 'Analytics, contribution, consensus and workload', icon: Gauge },
    { key: 'history', label: 'History', keys: 'h', title: 'Rooms that wrapped up', hint: 'Completed session history', icon: Clock },
  ];

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `tab-${t.key}`,
        keys: t.keys,
        description: `${t.label} — ${t.hint}`,
        category: 'navigation' as const,
        action: () => setActiveTab(t.key),
      })),
      { id: 'create-session', keys: 'n', description: 'Create session', category: 'actions' as const, action: () => setShowCreateModal(true) },
    ],
    { lensId: 'collab' },
  );

  const currentTab = TABS.find((t) => t.key === activeTab)!;

  const PILLS: { key: FilterPill; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'design', label: 'Design' },
    { key: 'development', label: 'Development' },
    { key: 'research', label: 'Research' },
    { key: 'art', label: 'Art' },
    { key: 'writing', label: 'Writing' },
  ];

  // If viewing an active session
  if (activeSession) {
    return (
      <ActiveSessionView
        session={activeSession}
        currentUserId={myUserId}
        currentUserName={myName}
        onLeave={() => setActiveSession(null)}
      />
    );
  }

  if (isLoading || isLoadingInvitations || isLoadingHistory) {
    return (
      <div className="flex items-center justify-center h-full p-8" role="status" aria-busy="true" aria-live="polite">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2 || isError3) {
    return (
      <div className="flex items-center justify-center h-full p-8" role="alert">
        <ErrorState
          error={error?.message || error2?.message || error3?.message}
          onRetry={() => {
            refetch();
            refetch2();
            refetch3();
          }}
        />
      </div>
    );
  }
  return (
    <>
      <FirstRunTour lensId="collab" />
      <DepthBadge lensId="collab" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="collab"
        crumb="Files & rooms"
        title={`${currentTab.title}${activeTab === 'active' && who ? `, ${who}` : ''}`}
        subtitle="Live docs, session rooms, and presence."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="collab" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <span className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              <span className="text-xs font-medium text-emerald-400">{onlineCount} online</span>
            </span>
          </div>
        }
        tabs={TABS.map((t) => ({ id: t.key, label: t.label, icon: t.icon, keys: t.keys, hint: t.hint }))}
        activeTab={activeTab}
        onTab={(id) => setActiveTab(id as MainTab)}
        tabsLabel="Collab views"
        cta={{ label: 'Create session', icon: Plus, onClick: () => setShowCreateModal(true), title: 'Start a new session room (N)' }}
      >
        <div data-lens-theme="collab" className="space-y-5">
          {activeTab === 'active' && (
            <div className="space-y-4">
            {/* Filter pills + search */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                {PILLS.map((pill) => (
                  <button
                    key={pill.key}
                    onClick={() => setFilterPill(pill.key)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                      filterPill === pill.key
                        ? 'bg-neon-blue/20 text-neon-blue border-neon-blue/40'
                        : 'bg-lattice-surface text-gray-400 border-lattice-border hover:border-gray-500'
                    )}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search sessions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-3 py-1.5 text-sm bg-lattice-surface border border-lattice-border rounded-lg w-56 focus:outline-none focus:border-neon-blue/50"
                />
              </div>
            </div>

            {/* Session grid */}
            {filteredSessions.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#111] p-12 text-center text-gray-400">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p className="font-medium">No sessions found</p>
                <p className="text-sm mt-1">Try adjusting your filters or create a new session.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredSessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    onJoin={() => setActiveSession(session)}
                  />
                ))}
              </div>
            )}
            </div>
          )}

          {activeTab === 'mine' && (
            <div>
            {mySessions.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#111] p-12 text-center text-gray-400">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p className="font-medium">No active sessions</p>
                <p className="text-sm mt-1">Create or join a session to see it here.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {mySessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    onJoin={() => setActiveSession(session)}
                  />
                ))}
              </div>
            )}
            </div>
          )}

          {activeTab === 'invitations' && (
            <div className="space-y-3">
            {invitations.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#111] p-12 text-center text-gray-400">
                <Mail className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p className="font-medium">No invitations</p>
                <p className="text-sm mt-1">
                  When someone invites you to a session, it will appear here.
                </p>
              </div>
            ) : (
              invitations.map((inv) => (
                <InvitationCard
                  key={inv.id}
                  invitation={inv}
                  onResponded={(accepted) => {
                    refetch2();
                    // On accept the invitee is now a real tracked participant
                    // (collab.sessionJoin, called server-side by
                    // sessionInviteRespond) — refresh the session list so
                    // "My Sessions" picks it up too.
                    if (accepted) refetch();
                  }}
                />
              ))
            )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-3">
            {history.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#111] p-12 text-center text-gray-400">
                <Archive className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p className="font-medium">No session history</p>
                <p className="text-sm mt-1">Completed sessions will appear here.</p>
              </div>
            ) : (
              history.map((entry) => <HistoryCard key={entry.id} entry={entry} />)
            )}
            </div>
          )}

          {activeTab === 'workspace' && (
            <PipingProvider>
              <CollabDocWorkspace />
              <section className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-4">
                <WorkspaceRoster />
              </section>
            </PipingProvider>
          )}

          {activeTab === 'facilitator' && (
            <PipingProvider>
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <CollabActionPanel />
              </section>
            </PipingProvider>
          )}

          <AnimatePresence>
            {showCreateModal && (
              <CreateSessionModal
                onClose={() => setShowCreateModal(false)}
                onCreate={createSessionArtifact}
                hostId={myUserId}
                hostName={myName}
              />
            )}
          </AnimatePresence>

      {/* Active Collaborations from API */}
      {activeCollabsData?.collabs?.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-[#111] p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Users className="w-4 h-4 text-neon-blue" />
            Active Collaborations ({activeCollabsData.collabs.length})
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {activeCollabsData.collabs.map(
              (collab: {
                id: string;
                name?: string;
                description?: string;
                domains?: string[];
                participants?: number;
                status?: string;
              }) => (
                <div
                  key={collab.id}
                  className="flex items-center justify-between p-3 bg-black/30 rounded-lg border border-white/5"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium truncate">
                      {collab.name ?? collab.id}
                    </p>
                    {collab.description && (
                      <p className="text-xs text-gray-400 truncate">{collab.description}</p>
                    )}
                    {collab.domains && (
                      <div className="flex gap-1 mt-1">
                        {collab.domains.map((d: string) => (
                          <span
                            key={d}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-neon-blue/10 text-neon-blue"
                          >
                            {d}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() =>
                      api
                        .post(`/api/collab/${collab.id}/close`)
                        .then((r) => r.data)
                        .catch((err) => {
                          console.error('[Collab] Failed to close collaboration:', err);
                          useUIStore
                            .getState()
                            .addToast({ type: 'error', message: 'Failed to close collaboration' });
                        })
                    }
                    className="text-xs px-3 py-1.5 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors font-medium shrink-0 ml-3"
                  >
                    Close
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      )}

          <RealtimeDataPanel data={realtimeInsights} />
        </div>
      </NorthStarFrame>
      <SessionRail lensId="collab" hideWhenEmpty className="mt-4" />
    </>
  );
}
