'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { SessionRail } from '@/components/lens/SessionRail';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { apiHelpers, api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Plus,
  Clock,
  Send,
  X,
  Hand as Handshake,
  Paintbrush,
  PenTool,
  Globe,
  Lock,
  Mail,
  UserPlus,
  LogOut,
  Settings,
  Upload,
  Monitor,
  MessageSquare,
  Check,
  XCircle,
  Loader2,
  Crown,
  Hash,
  Paperclip,
  Timer,
  Archive,
  Search,
  Layers,
  ChevronDown,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { SharedSessionChat } from '@/components/social/SharedSessionChat';
import { SharedSessionInvite } from '@/components/social/SharedSessionInvite';
import { WorkspaceRoster } from '@/components/collab/WorkspaceRoster';
import { CollabActionPanel } from '@/components/collab/CollabActionPanel';
import { CollabDocWorkspace } from '@/components/collab/CollabDocWorkspace';
import { PipingProvider } from '@/components/panel-polish';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProjectType = 'design' | 'development' | 'research' | 'art' | 'writing';
type SessionStatus = 'open' | 'in-progress' | 'full' | 'private';
type Privacy = 'public' | 'private' | 'invite-only';
type ParticipantRole = 'host' | 'developer' | 'designer' | 'reviewer' | 'creator' | 'writer';
type MainTab = 'active' | 'mine' | 'invitations' | 'history';
type FilterPill = 'all' | ProjectType;

interface Participant {
  id: string;
  name: string;
  avatar: string;
  role: ParticipantRole;
  online: boolean;
}

interface CollabSession {
  id: string;
  name: string;
  projectType: ProjectType;
  host: Participant;
  participants: Participant[];
  status: SessionStatus;
  privacy: Privacy;
  genre: string[];
  maxCapacity: number;
  description: string;
  startedAt: number;
  linkedProjectId?: string;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

interface Invitation {
  id: string;
  sessionName: string;
  fromName: string;
  fromAvatar: string;
  projectType: ProjectType;
  genre: string;
  sentAt: number;
}

interface HistoryEntry {
  id: string;
  sessionName: string;
  projectType: ProjectType;
  duration: number;
  participantCount: number;
  filesShared: number;
  endedAt: number;
}

// ---------------------------------------------------------------------------
// Avatar palette — a real per-user visual, deterministic from the user's own
// id (same technique as the backend's `colorFor(userId)` in
// server/domains/collab.js), never a fabricated name/identity generator.
// ---------------------------------------------------------------------------

const AVATARS = [
  'bg-gradient-to-br from-neon-blue to-neon-purple',
  'bg-gradient-to-br from-neon-cyan to-neon-blue',
  'bg-gradient-to-br from-neon-purple to-pink-500',
  'bg-gradient-to-br from-amber-500 to-orange-600',
  'bg-gradient-to-br from-emerald-500 to-teal-600',
  'bg-gradient-to-br from-rose-500 to-red-600',
  'bg-gradient-to-br from-violet-500 to-indigo-600',
  'bg-gradient-to-br from-sky-400 to-blue-600',
];

function avatarForUser(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATARS[h % AVATARS.length];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<ProjectType, typeof Handshake> = {
  design: Paintbrush,
  development: Monitor,
  research: Search,
  art: PenTool,
  writing: PenTool,
};

const TYPE_COLORS: Record<ProjectType, string> = {
  design: 'text-neon-blue',
  development: 'text-neon-purple',
  research: 'text-neon-cyan',
  art: 'text-amber-400',
  writing: 'text-emerald-400',
};

const STATUS_STYLES: Record<SessionStatus, string> = {
  open: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'in-progress': 'bg-neon-blue/20 text-neon-blue border-neon-blue/30',
  full: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  private: 'bg-neon-purple/20 text-neon-purple border-neon-purple/30',
};

const ROLE_BADGE: Record<ParticipantRole, { label: string; color: string }> = {
  host: { label: 'Host', color: 'bg-amber-500/20 text-amber-400' },
  developer: { label: 'Developer', color: 'bg-neon-blue/20 text-neon-blue' },
  designer: { label: 'Designer', color: 'bg-neon-purple/20 text-neon-purple' },
  reviewer: { label: 'Reviewer', color: 'bg-neon-cyan/20 text-neon-cyan' },
  creator: { label: 'Creator', color: 'bg-amber-400/20 text-amber-400' },
  writer: { label: 'Writer', color: 'bg-emerald-400/20 text-emerald-400' },
};

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CollabLensPage() {
  useLensNav('collab');
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
  const {
    isLoading: isLoadingInvitations,
    isError: isError2,
    error: error2,
    refetch: refetch2,
    items: invitationItems,
  } = useLensData('collab', 'invitation', {
    seed: [],
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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeSession, setActiveSession] = useState<CollabSession | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);
  const [inviteSessionId, setInviteSessionId] = useState<string | null>(null);

  // Merge the wrapping lens-artifact id into `.data` — the backend assigns
  // the real, stable, cross-user-visible id at the artifact level (`i.id`),
  // not inside the JSON payload, so this is required for join/leave/close to
  // address the right record.
  const sessions: CollabSession[] = sessionItems.map((i) => ({
    ...(i.data as unknown as CollabSession),
    id: i.id,
  }));
  const invitations: Invitation[] = invitationItems.map((i) => ({
    ...(i.data as unknown as Invitation),
    id: i.id,
  }));
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
    <LensShell lensId="collab" asMain={false}>
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
            <h1 className="text-xl font-bold tracking-tight">Collaboration Hub</h1>
            <p className="text-sm text-gray-400">Create, join, and collaborate in real time</p>
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
            {/* Sovereignty gate for joining an invited session */}
            {inviteSessionId && (
              <div className="panel p-4 mb-4 border border-neon-blue/20">
                <SharedSessionInvite
                  sessionId={inviteSessionId}
                  onJoined={(sid) => {
                    setInviteSessionId(null);
                    const joinedSession = sessions.find((s) => s.id === sid);
                    if (joinedSession) setActiveSession(joinedSession);
                  }}
                  onDeclined={() => setInviteSessionId(null)}
                />
              </div>
            )}
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
                <div
                  key={inv.id}
                  onClick={() => setInviteSessionId(inv.id)}
                  className="cursor-pointer" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                  <InvitationCard invitation={inv} />
                </div>
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
      <UniversalActions domain="collab" artifactId={null} compact />

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`}
          />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="collab" />
          </div>
        )}
        <PipingProvider>
          <section className="mt-6">
            <CollabDocWorkspace />
          </section>

          <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <WorkspaceRoster />
          </section>

          <section className="mt-6">
            <CollabActionPanel />
          </section>
        </PipingProvider>
      </div>
    </div>
          <SessionRail lensId="collab" hideWhenEmpty className="mt-4" />
          <RecentMineCard domain="collab" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="collab" hideWhenEmpty className="mt-3" title="More actions" />
          <CrossLensRecentsPanel lensId="collab" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

// ---------------------------------------------------------------------------
// Session Card
// ---------------------------------------------------------------------------

function SessionCard({ session, onJoin }: { session: CollabSession; onJoin: () => void }) {
  const TypeIcon = TYPE_ICONS[session.projectType];
  const elapsed = Date.now() - session.startedAt;
  const isPrivate = session.privacy === 'private' || session.privacy === 'invite-only';

  return (
    <motion.div
      layout
      className="lens-card p-4 space-y-3 hover:border-neon-blue/30 transition-colors cursor-pointer group"
      onClick={onJoin}
    >
      {/* Top row: type icon + name + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center bg-lattice-surface shrink-0',
              TYPE_COLORS[session.projectType]
            )}
          >
            <TypeIcon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate group-hover:text-neon-blue transition-colors">
              {session.name}
            </h3>
            <p className="text-[11px] text-gray-400 capitalize">{session.projectType}</p>
          </div>
        </div>
        <span
          className={cn(
            'text-[10px] px-2 py-0.5 rounded-full border shrink-0 capitalize font-medium',
            STATUS_STYLES[session.status]
          )}
        >
          {session.status}
        </span>
      </div>

      {/* Host */}
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white',
            session.host.avatar
          )}
        >
          {session.host.name[0]}
        </div>
        <span className="text-xs text-gray-400">
          Hosted by <span className="text-gray-200">{session.host.name}</span>
        </span>
      </div>

      {/* Genre tags */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {session.genre.map((g) => (
          <span
            key={g}
            className="text-[10px] px-2 py-0.5 bg-lattice-surface border border-lattice-border rounded-full text-gray-400"
          >
            <Hash className="w-2.5 h-2.5 inline mr-0.5 -mt-px" />
            {g}
          </span>
        ))}
      </div>

      {/* Bottom row: participants + timer + join */}
      <div className="flex items-center justify-between pt-1 border-t border-lattice-border">
        <div className="flex items-center gap-3">
          {/* Stacked avatars */}
          <div className="flex items-center -space-x-1.5">
            {session.participants.slice(0, 3).map((p, i) => (
              <div
                key={p.id}
                className={cn(
                  'w-6 h-6 rounded-full border-2 border-lattice-surface flex items-center justify-center text-[8px] font-bold text-white',
                  p.avatar
                )}
                style={{ zIndex: 10 - i }}
                title={p.name}
              >
                {p.name[0]}
              </div>
            ))}
            {session.participants.length > 3 && (
              <div
                className="w-6 h-6 rounded-full border-2 border-lattice-surface bg-gray-700 flex items-center justify-center text-[9px] text-gray-300 font-medium"
                style={{ zIndex: 6 }}
              >
                +{session.participants.length - 3}
              </div>
            )}
          </div>
          <span className="text-[11px] text-gray-400">
            {session.participants.length}/{session.maxCapacity}
          </span>
          <div className="flex items-center gap-1 text-[11px] text-gray-400">
            <Timer className="w-3 h-3" />
            {formatDuration(elapsed)}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onJoin();
          }}
          className={cn(
            'text-xs px-3 py-1 rounded-md font-medium transition-colors',
            session.status === 'full'
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : isPrivate
                ? 'bg-neon-purple/20 text-neon-purple hover:bg-neon-purple/30'
                : 'bg-neon-blue/20 text-neon-blue hover:bg-neon-blue/30'
          )}
          disabled={session.status === 'full'}
        >
          {session.status === 'full' ? 'Full' : isPrivate ? 'Request' : 'Join'}
        </button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Active Session View
// ---------------------------------------------------------------------------

function ActiveSessionView({
  session,
  currentUserId,
  currentUserName,
  onLeave,
}: {
  session: CollabSession;
  currentUserId: string;
  currentUserName: string;
  onLeave: () => void;
}) {
  const isHost = session.host.id === currentUserId;
  // Every shared-state slice below (`chat` / `shared-notes` / `shared-file`)
  // is tagged with this session's id, both on read (the `tags` filter) and
  // on write (`meta.tags` at creation) — without this, all sessions in the
  // domain would read/write the exact same global rows (they share one
  // (domain, type) pair with no other session-scoping field).
  const sessionTag = session.id;

  const [chatInput, setChatInput] = useState('');
  const { items: chatItems, create: createChatMessage } = useLensData('collab', 'chat', {
    seed: [],
    tags: [sessionTag],
  });
  const messages: ChatMessage[] = chatItems.map((i) => i.data as unknown as ChatMessage);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(Date.now() - session.startedAt);

  // --- Shared notes persistence ---
  const {
    items: notesItems,
    create: createNote,
    update: updateNote,
  } = useLensData('collab', 'shared-notes', {
    tags: [sessionTag],
    noSeed: true,
  });
  const notesItem = notesItems[0];
  const [notesText, setNotesText] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const notesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync notes from backend on load
  useEffect(() => {
    if (notesItem?.data) {
      setNotesText(((notesItem.data as Record<string, unknown>).text as string) || '');
    }
  }, [notesItem]);

  // Auto-save notes with debounce
  const handleNotesChange = useCallback(
    (value: string) => {
      setNotesText(value);
      if (notesSaveTimer.current) clearTimeout(notesSaveTimer.current);
      notesSaveTimer.current = setTimeout(async () => {
        setNotesSaving(true);
        try {
          if (notesItem) {
            await updateNote(notesItem.id, { data: { text: value } });
          } else {
            await createNote({
              title: 'session-notes',
              data: { text: value },
              meta: { tags: [sessionTag] },
            });
          }
        } catch (err) {
          console.error('[Collab] Failed to save notes:', err);
        } finally {
          setNotesSaving(false);
        }
      }, 800);
    },
    [notesItem, updateNote, createNote, sessionTag]
  );

  // --- File upload state ---
  const { items: fileItems, create: createFileEntry } = useLensData('collab', 'shared-file', {
    tags: [sessionTag],
    noSeed: true,
  });
  const sharedFiles = fileItems.map(
    (i) => i.data as unknown as { name: string; size: string; by: string; uploadedAt: number }
  );
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(
    async (file: File) => {
      setIsUploading(true);
      try {
        const arrayBuffer = await file.arrayBuffer();
        const base64Data = btoa(
          new Uint8Array(arrayBuffer).reduce((d, byte) => d + String.fromCharCode(byte), '')
        );
        await apiHelpers.artistry.blobs.upload({
          data: base64Data,
          mimeType: file.type,
          filename: file.name,
        });
        const sizeStr =
          file.size < 1024
            ? `${file.size} B`
            : file.size < 1024 * 1024
              ? `${(file.size / 1024).toFixed(1)} KB`
              : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
        await createFileEntry({
          title: file.name,
          data: { name: file.name, size: sizeStr, by: currentUserName, uploadedAt: Date.now() },
          meta: { tags: [sessionTag] },
        });
        useUIStore.getState().addToast({ type: 'success', message: `Uploaded "${file.name}"` });
      } catch (err) {
        console.error('[Collab] File upload failed:', err);
        useUIStore.getState().addToast({
          type: 'error',
          message: `Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        });
      } finally {
        setIsUploading(false);
      }
    },
    [createFileEntry, currentUserName, sessionTag]
  );

  // --- Screen sharing (WebRTC) ---
  const [isSharing, setIsSharing] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const ICE_SERVERS = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }]);
  const shareRoom = `collab:${session.id}`;

  const stopScreenShare = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    setIsSharing(false);
    try {
      import('@/lib/realtime/socket')
        .then(({ getSocket }) => {
          getSocket().emit('screen-share:stop', { room: shareRoom });
        })
        .catch(() => {
          /* socket unavailable */
        });
    } catch (_) {
      /* socket unavailable */
    }
  }, [shareRoom]);

  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      stream.getVideoTracks()[0].onended = stopScreenShare;

      const { getSocket } = await import('@/lib/realtime/socket');
      const socket = getSocket();
      socket.emit('room:join', { room: shareRoom });

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS.current });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.onicecandidate = ({ candidate }) => {
        if (candidate)
          socket.emit('screen-share:ice-candidate', { to: null, room: shareRoom, candidate });
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('screen-share:start', { room: shareRoom });
      socket.emit('screen-share:offer', { room: shareRoom, offer });

      socket.on(
        'screen-share:answer',
        async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
          if (pc.signalingState !== 'closed') await pc.setRemoteDescription(answer);
        }
      );

      setIsSharing(true);
    } catch (err) {
      if ((err as Error).name !== 'NotAllowedError') {
        useUIStore
          .getState()
          .addToast({
            type: 'error',
            message: 'Screen share failed: ' + (err instanceof Error ? err.message : String(err)),
          });
      }
    }
  }, [shareRoom, stopScreenShare]);

  // Receive incoming screen share from another participant
  useEffect(() => {
    let socket: ReturnType<typeof import('@/lib/realtime/socket').getSocket>;
    let cleanup = false;

    import('@/lib/realtime/socket').then(({ getSocket }) => {
      if (cleanup) return;
      socket = getSocket();
      socket.emit('room:join', { room: shareRoom });

      socket.on('screen-share:start', () => {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS.current });
        pcRef.current = pc;
        pc.ontrack = (e) => setRemoteStream(e.streams[0]);
        pc.onicecandidate = ({ candidate }) => {
          if (candidate)
            socket.emit('screen-share:ice-candidate', { to: null, room: shareRoom, candidate });
        };
        socket.on(
          'screen-share:offer',
          async ({ from, offer }: { from: string; offer: RTCSessionDescriptionInit }) => {
            await pc.setRemoteDescription(offer);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('screen-share:answer', { to: from, answer });
          }
        );
        socket.on(
          'screen-share:ice-candidate',
          async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
            if (pc.remoteDescription) await pc.addIceCandidate(candidate);
          }
        );
      });

      socket.on('screen-share:stop', () => {
        pcRef.current?.close();
        pcRef.current = null;
        setRemoteStream(null);
      });
    });

    return () => {
      cleanup = true;
      pcRef.current?.close();
    };
  }, [shareRoom]);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - session.startedAt), 1000);
    return () => clearInterval(t);
  }, [session.startedAt]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const sendMessage = useCallback(() => {
    if (!chatInput.trim()) return;
    const newMsg: ChatMessage = {
      id: `m-${Date.now()}`,
      senderId: currentUserId,
      senderName: currentUserName,
      senderAvatar: avatarForUser(currentUserId),
      text: chatInput.trim(),
      timestamp: Date.now(),
    };
    createChatMessage({
      title: newMsg.senderName,
      data: newMsg as unknown as Record<string, unknown>,
      meta: { tags: [sessionTag] },
    });
    setChatInput('');
  }, [chatInput, createChatMessage, currentUserId, currentUserName, sessionTag]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-lattice-border bg-lattice-surface/50">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center',
              TYPE_COLORS[session.projectType]
            )}
          >
            {(() => {
              const I = TYPE_ICONS[session.projectType];
              return <I className="w-4 h-4" />;
            })()}
          </div>
          <div>
            <h2 className="font-semibold text-sm">{session.name}</h2>
            <div className="flex items-center gap-3 text-[11px] text-gray-400">
              <span className="flex items-center gap-1">
                <Timer className="w-3 h-3" />
                {formatDuration(elapsed)}
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {session.participants.length}/{session.maxCapacity}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={async () => {
            // Only the host actually ends the session for everyone (flips
            // `status` so it drops out of "Active Sessions" for other
            // viewers of this shared directory); a non-host just stops
            // watching locally. There's no live per-participant membership
            // tracking yet, so a guest "leaving" can't remove itself from
            // `participants` — that's a real, scoped gap (see capability
            // map), not something to fake here.
            if (isHost) {
              try {
                await api.put(`/api/lens/collab/${session.id}`, {
                  data: { ...session, status: 'closed' },
                });
              } catch (err) {
                console.error('[Collab] Failed to close session:', err);
                useUIStore
                  .getState()
                  .addToast({ type: 'error', message: 'Failed to close session' });
              }
            }
            onLeave();
          }}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors font-medium"
        >
          <LogOut className="w-3.5 h-3.5" />
          {isHost ? 'End Session' : 'Leave'}
        </button>
      </div>

      {/* Main content: 3-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: participants */}
        <div className="w-56 border-r border-lattice-border bg-lattice-surface/30 p-3 flex flex-col gap-1 overflow-y-auto shrink-0">
          <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
            Participants ({session.participants.length})
          </h3>
          {session.participants.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-lattice-surface transition-colors"
            >
              <div className="relative">
                <div
                  className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white',
                    p.avatar
                  )}
                >
                  {p.name[0]}
                </div>
                <span
                  className={cn(
                    'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-lattice-surface',
                    p.online ? 'bg-emerald-400' : 'bg-gray-600'
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{p.name}</p>
                <span
                  className={cn(
                    'text-[9px] px-1.5 py-0.5 rounded-full font-medium',
                    ROLE_BADGE[p.role].color
                  )}
                >
                  {p.role === 'host' && <Crown className="w-2 h-2 inline mr-0.5 -mt-px" />}
                  {ROLE_BADGE[p.role].label}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Center: shared workspace */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 p-5 overflow-y-auto space-y-4">
            {/* Remote screen share video */}
            {remoteStream && (
              <div className="panel p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
                  <h3 className="text-xs font-semibold text-neon-green uppercase tracking-wider">
                    Live Screen Share
                  </h3>
                </div>
                <video
                  autoPlay
                  playsInline
                  className="w-full rounded-lg bg-black"
                  style={{ maxHeight: 320 }}
                  ref={(el) => {
                    (remoteVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current =
                      el;
                    if (el && remoteStream) el.srcObject = remoteStream;
                  }}
                />
              </div>
            )}
            {/* Project timeline placeholder */}
            <div className="panel p-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Project Timeline
              </h3>
              <div className="space-y-2">
                {['Planning', 'Research', 'Design', 'Development', 'Review', 'Delivery'].map(
                  (section, i) => (
                    <div key={section} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 w-12 text-right">
                        {i * 8 + 1}-{(i + 1) * 8}
                      </span>
                      <div
                        className={cn(
                          'h-7 rounded flex items-center px-2 text-[11px] font-medium',
                          i % 3 === 0
                            ? 'bg-neon-blue/15 text-neon-blue'
                            : i % 3 === 1
                              ? 'bg-neon-purple/15 text-neon-purple'
                              : 'bg-neon-cyan/15 text-neon-cyan'
                        )}
                        style={{ width: `${Math.max(60, ((i + 1) / 6) * 100)}%` }}
                      >
                        {section}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Shared notes — persisted via lens data API */}
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Shared Notes
                </h3>
                {notesSaving && (
                  <span className="flex items-center gap-1 text-[10px] text-neon-cyan">
                    <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                  </span>
                )}
                {!notesSaving && notesItem && (
                  <span className="text-[10px] text-gray-400">Auto-saved</span>
                )}
              </div>
              <textarea
                value={notesText}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Add shared notes for this session..."
                rows={6}
                className="w-full bg-lattice-surface rounded-lg p-3 text-sm text-gray-300 min-h-[80px] border border-lattice-border focus:outline-none focus:border-neon-blue/50 resize-y leading-relaxed"
              />
            </div>

            {/* Shared files */}
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Shared Files
                </h3>
                <span className="text-[10px] text-gray-400">{sharedFiles.length} uploaded</span>
              </div>
              <div className="space-y-1.5">
                {sharedFiles.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-3">
                    No files uploaded yet. Use the Upload File button below.
                  </p>
                ) : (
                  sharedFiles.map((f) => (
                    <div
                      key={`${f.name}-${f.uploadedAt}`}
                      className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-lattice-surface transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Paperclip className="w-3.5 h-3.5 text-neon-cyan" />
                        <span className="text-xs font-medium">{f.name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-gray-400">
                        <span>{f.size}</span>
                        <span>{f.by}</span>
                        {f.uploadedAt && <span>{formatTimeAgo(f.uploadedAt)}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Bottom action bar */}
          <div className="flex items-center gap-2 px-5 py-3 border-t border-lattice-border bg-lattice-surface/50">
            <button
              onClick={isSharing ? stopScreenShare : startScreenShare}
              className={cn(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-colors',
                isSharing
                  ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                  : 'bg-lattice-surface border-lattice-border text-gray-300 hover:border-neon-blue/40'
              )}
            >
              <Monitor className="w-3.5 h-3.5" /> {isSharing ? 'Stop Sharing' : 'Share Screen'}
            </button>
            {remoteStream && (
              <span className="flex items-center gap-1.5 text-xs text-neon-green">
                <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
                Receiving screen share
              </span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-lattice-surface border border-lattice-border text-gray-300 hover:border-neon-blue/40 transition-colors disabled:opacity-50"
            >
              {isUploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              {isUploading ? 'Uploading...' : 'Upload File'}
            </button>
            <button
              onClick={async () => {
                const link = `${window.location.origin}/lenses/collab?session=${encodeURIComponent(session.id)}`;
                try {
                  await navigator.clipboard.writeText(link);
                  useUIStore
                    .getState()
                    .addToast({ type: 'success', message: 'Invite link copied to clipboard' });
                } catch (err) {
                  console.error('[Collab] Clipboard write failed:', err);
                  useUIStore
                    .getState()
                    .addToast({ type: 'error', message: `Could not copy — link: ${link}` });
                }
              }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-lattice-surface border border-lattice-border text-gray-300 hover:border-neon-blue/40 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" /> Invite
            </button>
            <button
              onClick={() =>
                useUIStore.getState().addToast({ type: 'info', message: 'Session settings' })
              }
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-lattice-surface border border-lattice-border text-gray-300 hover:border-neon-blue/40 transition-colors"
            >
              <Settings className="w-3.5 h-3.5" /> Settings
            </button>
          </div>
        </div>

        {/* Right panel: live chat */}
        <div className="w-72 border-l border-lattice-border flex flex-col shrink-0">
          {/* Multi-sovereign shared session chat */}
          <div className="border-b border-lattice-border">
            <SharedSessionChat
              sessionId={session.id}
              currentUserId="current-user"
              onEnd={() => onLeave()}
            />
          </div>
          <div className="px-3 py-2.5 border-b border-lattice-border">
            <h3 className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" /> Live Chat
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((msg) => (
              <div key={msg.id}>
                {msg.isSystem ? (
                  <p className="text-[10px] text-gray-400 text-center italic py-1">{msg.text}</p>
                ) : (
                  <div className="flex gap-2">
                    <div
                      className={cn(
                        'w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0 mt-0.5',
                        msg.senderAvatar
                      )}
                    >
                      {msg.senderName[0]}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[11px] font-semibold text-gray-300">
                          {msg.senderName}
                        </span>
                        <span className="text-[9px] text-gray-400">
                          {formatTimestamp(msg.timestamp)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 leading-relaxed break-words">
                        {msg.text}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="p-2 border-t border-lattice-border">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 text-gray-400 hover:text-gray-300 transition-colors"
                title="Attach file"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
              <input
                type="text"
                placeholder="Type a message..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                className="flex-1 text-xs py-1.5 px-2.5 bg-lattice-surface border border-lattice-border rounded-md focus:outline-none focus:border-neon-blue/50"
              />
              <button
                onClick={sendMessage}
                className="p-1.5 text-neon-blue hover:text-neon-cyan transition-colors"
              aria-label="Send">
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invitation Card
// ---------------------------------------------------------------------------

function InvitationCard({ invitation }: { invitation: Invitation }) {
  const [responded, setResponded] = useState<'accepted' | 'declined' | null>(null);
  const TypeIcon = TYPE_ICONS[invitation.projectType];

  if (responded) {
    return (
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: 0.5 }}
        className="panel p-4 flex items-center justify-between"
      >
        <span className="text-sm text-gray-400">
          {responded === 'accepted' ? 'Accepted' : 'Declined'}: {invitation.sessionName}
        </span>
        <span
          className={cn(
            'text-xs px-2 py-0.5 rounded-full',
            responded === 'accepted'
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-red-500/20 text-red-400'
          )}
        >
          {responded === 'accepted' ? (
            <Check className="w-3 h-3 inline mr-0.5" />
          ) : (
            <XCircle className="w-3 h-3 inline mr-0.5" />
          )}
          {responded}
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div layout className="panel p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={cn(
            'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white',
            invitation.fromAvatar
          )}
        >
          {invitation.fromName[0]}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            <span className="text-gray-200">{invitation.fromName}</span>
            <span className="text-gray-400"> invited you to </span>
            <span className="text-neon-blue">{invitation.sessionName}</span>
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <TypeIcon className={cn('w-3 h-3', TYPE_COLORS[invitation.projectType])} />
            <span className="text-[11px] text-gray-400 capitalize">{invitation.projectType}</span>
            <span className="text-[11px] text-gray-400">|</span>
            <span className="text-[11px] text-gray-400">{invitation.genre}</span>
            <span className="text-[11px] text-gray-400">|</span>
            <span className="text-[11px] text-gray-400">{formatTimeAgo(invitation.sentAt)}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => {
            api
              .post(`/api/collab/${invitation.id}/close`)
              .then((r) => r.data)
              .then(() => setResponded('declined'))
              .catch((err) => {
                console.error('[Collab] Failed to decline invitation:', err);
                useUIStore
                  .getState()
                  .addToast({ type: 'error', message: 'Failed to decline invitation' });
              });
          }}
          className="text-xs px-3 py-1.5 rounded-md bg-lattice-surface border border-lattice-border text-gray-400 hover:text-red-400 hover:border-red-500/30 transition-colors"
        >
          Decline
        </button>
        <button
          onClick={() => {
            api
              .post(`/api/collab/${invitation.id}/accept`)
              .then((r) => r.data)
              .then(() => setResponded('accepted'))
              .catch((err) => {
                console.error('[Collab] Failed to accept invitation:', err);
                useUIStore
                  .getState()
                  .addToast({ type: 'error', message: 'Failed to accept invitation' });
              });
          }}
          className="text-xs px-3 py-1.5 rounded-md bg-neon-blue/20 text-neon-blue hover:bg-neon-blue/30 font-medium transition-colors"
        >
          Accept
        </button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// History Card
// ---------------------------------------------------------------------------

function HistoryCard({ entry }: { entry: HistoryEntry }) {
  const TypeIcon = TYPE_ICONS[entry.projectType];
  return (
    <div className="panel p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center bg-lattice-surface',
            TYPE_COLORS[entry.projectType]
          )}
        >
          <TypeIcon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-medium truncate">{entry.sessionName}</h3>
          <p className="text-[11px] text-gray-400 capitalize">{entry.projectType} session</p>
        </div>
      </div>
      <div className="flex items-center gap-5 text-[11px] text-gray-400 shrink-0">
        <div className="flex items-center gap-1" title="Duration">
          <Clock className="w-3 h-3" />
          {formatDuration(entry.duration)}
        </div>
        <div className="flex items-center gap-1" title="Participants">
          <Users className="w-3 h-3" />
          {entry.participantCount}
        </div>
        <div className="flex items-center gap-1" title="Files shared">
          <Paperclip className="w-3 h-3" />
          {entry.filesShared}
        </div>
        <div className="flex items-center gap-1" title="Ended">
          <Archive className="w-3 h-3" />
          {formatTimeAgo(entry.endedAt)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Session Modal
// ---------------------------------------------------------------------------

function CreateSessionModal({
  onClose,
  onCreate,
  hostId,
  hostName,
}: {
  onClose: () => void;
  onCreate: (input: { title?: string; data?: Record<string, unknown> }) => Promise<unknown>;
  hostId: string;
  hostName: string;
}) {
  const [form, setForm] = useState({
    name: '',
    type: 'design' as ProjectType,
    genre: '',
    maxParticipants: 6,
    privacy: 'public' as Privacy,
    description: '',
    linkedProjectId: '',
  });

  const { data: projectsData } = useQuery({
    queryKey: ['studio-projects-for-link'],
    queryFn: () => apiHelpers.artistry.studio.projects.list().then((r) => r.data),
    retry: 1,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const host: Participant = {
        id: hostId,
        name: hostName,
        avatar: avatarForUser(hostId),
        role: 'host',
        online: true,
      };
      const session: Omit<CollabSession, 'id'> = {
        name: data.name,
        projectType: data.type,
        host,
        participants: [host],
        status: 'open',
        privacy: data.privacy,
        genre: data.genre ? data.genre.split(',').map((g) => g.trim()).filter(Boolean) : [],
        maxCapacity: data.maxParticipants,
        description: data.description,
        startedAt: Date.now(),
        ...(data.linkedProjectId ? { linkedProjectId: data.linkedProjectId } : {}),
      };
      const created = await onCreate({
        title: data.name,
        data: session as unknown as Record<string, unknown>,
      });

      // Best-effort only: linking an existing studio project also opens a
      // real Artistry live-jam session for it (project-scoped audio/asset
      // collab — a genuinely separate capability). Its failure must never
      // block or silently swallow the session the user actually asked to
      // create, which is why it isn't awaited into the primary result.
      if (data.linkedProjectId) {
        apiHelpers.artistry.collab.sessions
          .create({ projectId: data.linkedProjectId, maxParticipants: data.maxParticipants, mode: data.privacy })
          .catch((err) => {
            console.warn('[Collab] Linked-project jam session not started:', err instanceof Error ? err.message : err);
          });
      }
      return created;
    },
    onSuccess: () => {
      useUIStore.getState().addToast({ type: 'success', message: `Session "${form.name}" created.` });
      onClose();
    },
    onError: (err) => {
      console.error('[Collab] Failed to create session:', err instanceof Error ? err.message : err);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to create session.' });
    },
  });

  const projects: { id: string; title: string }[] = projectsData?.projects ?? [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-lattice-surface border border-lattice-border rounded-xl p-6 w-full max-w-lg space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Create Session</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-300 transition-colors"
          aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Session name */}
        <div>
          <label className="text-xs font-medium text-gray-400 block mb-1">Session Name</label>
          <input
            type="text"
            placeholder="e.g. Q2 Design Sprint"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 text-sm bg-lattice-surface border border-lattice-border rounded-lg focus:outline-none focus:border-neon-blue/50"
          />
        </div>

        {/* Type + Genre row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as ProjectType })}
              className="w-full px-3 py-2 text-sm bg-lattice-surface border border-lattice-border rounded-lg focus:outline-none focus:border-neon-blue/50"
            >
              <option value="design">Design</option>
              <option value="development">Development</option>
              <option value="research">Research</option>
              <option value="art">Art</option>
              <option value="writing">Writing</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Category</label>
            <input
              type="text"
              placeholder="e.g. UI/UX, Backend"
              value={form.genre}
              onChange={(e) => setForm({ ...form, genre: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-lattice-surface border border-lattice-border rounded-lg focus:outline-none focus:border-neon-blue/50"
            />
          </div>
        </div>

        {/* Max participants + Privacy row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Max Participants</label>
            <select
              value={form.maxParticipants}
              onChange={(e) => setForm({ ...form, maxParticipants: Number(e.target.value) })}
              className="w-full px-3 py-2 text-sm bg-lattice-surface border border-lattice-border rounded-lg focus:outline-none focus:border-neon-blue/50"
            >
              {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n} participants
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Privacy</label>
            <select
              value={form.privacy}
              onChange={(e) => setForm({ ...form, privacy: e.target.value as Privacy })}
              className="w-full px-3 py-2 text-sm bg-lattice-surface border border-lattice-border rounded-lg focus:outline-none focus:border-neon-blue/50"
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
              <option value="invite-only">Invite Only</option>
            </select>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-gray-400 block mb-1">Description</label>
          <textarea
            placeholder="What's this session about?"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 text-sm bg-lattice-surface border border-lattice-border rounded-lg focus:outline-none focus:border-neon-blue/50 resize-none"
          />
        </div>

        {/* Link existing project */}
        <div>
          <label className="text-xs font-medium text-gray-400 block mb-1">
            Link Existing Project (optional)
          </label>
          <select
            value={form.linkedProjectId}
            onChange={(e) => setForm({ ...form, linkedProjectId: e.target.value })}
            className="w-full px-3 py-2 text-sm bg-lattice-surface border border-lattice-border rounded-lg focus:outline-none focus:border-neon-blue/50"
          >
            <option value="">No linked project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title || `Project ${p.id.slice(-6)}`}
              </option>
            ))}
          </select>
        </div>

        {/* Privacy indicator */}
        <div className="flex items-center gap-2 text-xs text-gray-400">
          {form.privacy === 'public' && (
            <>
              <Globe className="w-3.5 h-3.5 text-emerald-400" /> Anyone can join this session
            </>
          )}
          {form.privacy === 'private' && (
            <>
              <Lock className="w-3.5 h-3.5 text-neon-purple" /> Only people with the link can join
            </>
          )}
          {form.privacy === 'invite-only' && (
            <>
              <Mail className="w-3.5 h-3.5 text-amber-400" /> Only invited users can join
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => createMutation.mutate(form)}
            disabled={!form.name.trim() || createMutation.isPending}
            className={cn(
              'btn-primary px-5 py-2 rounded-lg text-sm font-medium',
              (!form.name.trim() || createMutation.isPending) && 'opacity-50 cursor-not-allowed'
            )}
          >
            {createMutation.isPending ? 'Creating...' : 'Create Session'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
