'use client';

import { useState } from 'react';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
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
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Plus,
  Mail,
  Archive,
  Search,
  ChevronDown,
  ChevronRight,
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


  // Lens-scoped keyboard commands (auto-wired by codemod).

  useLensCommand(

    [

      { id: 'tab-active', keys: 'a', description: 'Active', category: 'navigation', action: () => setActiveTab('active') },

      { id: 'tab-mine', keys: 'm', description: 'Mine', category: 'navigation', action: () => setActiveTab('mine') },

      { id: 'tab-invitations', keys: 'i', description: 'Invitations', category: 'navigation', action: () => setActiveTab('invitations') },

      { id: 'tab-history', keys: 'h', description: 'History', category: 'navigation', action: () => setActiveTab('history') },

    ],

    { lensId: 'collab' }

  );
  const [filterPill, setFilterPill] = useState<FilterPill>('all');
  const [showCollabActionPanel, setShowCollabActionPanel] = useState(false);
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

  const TABS: { key: MainTab; label: string; count?: number }[] = [
    { key: 'active', label: 'Active Sessions', count: sessions.length },
    { key: 'mine', label: 'My Sessions', count: mySessions.length },
    { key: 'invitations', label: 'Invitations' },
    { key: 'history', label: 'Session History' },
  ];

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
    <div data-lens-theme="collab" className="p-6 space-y-5 max-w-[1440px] mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neon-blue to-neon-purple flex items-center justify-center">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--lens-accent)' }}>Files &amp; Rooms</h1>
            <p className="text-sm text-gray-400">Figma-style live docs, session rooms, and presence</p>
          </div>

          {/* Real-time Enhancement Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="collab" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400 font-medium">{onlineCount} online</span>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Create Session
          </button>
        </div>
      </header>

      {/* Tab navigation */}
      <nav className="flex items-center gap-1 border-b border-lattice-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? 'border-neon-blue text-neon-blue'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full',
                  activeTab === tab.key
                    ? 'bg-neon-blue/20 text-neon-blue'
                    : 'bg-gray-700 text-gray-400'
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        {activeTab === 'active' && (
          <motion.div
            key="active"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
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
              <div className="panel p-12 text-center text-gray-400">
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
          </motion.div>
        )}

        {activeTab === 'mine' && (
          <motion.div
            key="mine"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {mySessions.length === 0 ? (
              <div className="panel p-12 text-center text-gray-400">
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
          </motion.div>
        )}

        {activeTab === 'invitations' && (
          <motion.div
            key="invitations"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-3"
          >
            {invitations.length === 0 ? (
              <div className="panel p-12 text-center text-gray-400">
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
          </motion.div>
        )}

        {activeTab === 'history' && (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-3"
          >
            {history.length === 0 ? (
              <div className="panel p-12 text-center text-gray-400">
                <Archive className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p className="font-medium">No session history</p>
                <p className="text-sm mt-1">Completed sessions will appear here.</p>
              </div>
            ) : (
              history.map((entry) => <HistoryCard key={entry.id} entry={entry} />)
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create session modal */}
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
        <div className="panel p-4 space-y-3">
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

      <div className="border-t border-white/10">
        <PipingProvider>
          <section className="mt-6">
            <CollabDocWorkspace />
          </section>

          <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <WorkspaceRoster />
          </section>

          {/* Team facilitator bench: session analytics / contribution score /
              consensus detection / workload balance + actions. Collapsed by
              default — was previously mounted unconditionally below every
              tab regardless of which was active. */}
          <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40">
            <button
              type="button"
              onClick={() => setShowCollabActionPanel((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-gray-200 hover:text-white"
              aria-expanded={showCollabActionPanel}
            >
              <span>Team facilitator bench (analytics, consensus, workload)</span>
              {showCollabActionPanel ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {showCollabActionPanel && (
              <div className="px-4 pb-4">
                <CollabActionPanel />
              </div>
            )}
          </section>
        </PipingProvider>
      </div>
    </div>
          <SessionRail lensId="collab" hideWhenEmpty className="mt-4" />
          <CrossLensRecentsPanel lensId="collab" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </>
  );
}
