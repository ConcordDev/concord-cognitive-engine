'use client';

import { useState, useEffect, useMemo } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { SavedSearchesPanel } from '@/components/genesis/SavedSearchesPanel';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { OriginExplorer } from '@/components/genesis/OriginExplorer';
import { RosterExplorer } from '@/components/genesis/RosterExplorer';
import { IdentityTimeline } from '@/components/genesis/IdentityTimeline';
import { LineageView } from '@/components/genesis/LineageView';
import { RelationshipGraph } from '@/components/genesis/RelationshipGraph';
import { GenesisMetrics } from '@/components/genesis/GenesisMetrics';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Zap, MessageSquare, Eye, Star, X, Filter } from 'lucide-react';
import Link from 'next/link';
import { useLensNav } from '@/hooks/useLensNav';
import { useSocket } from '@/hooks/useSocket';

// ── Types ──────────────────────────────────────────────────────────────────────

interface EmergentIdentity {
  emergent_id: string;
  id?: string;
  given_name: string | null;
  naming_origin: string | null;
  current_focus: string | null;
  last_active_at: number | null;
  role?: string;
  active?: boolean;
}

interface FeedEvent {
  id: string;
  type: string;
  emergent: { emergent_id?: string; given_name: string | null } | null;
  data: Record<string, unknown>;
  timestamp: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRelativeTime(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const EVENT_ICONS: Record<string, string> = {
  emergence: '✦',
  naming: '◈',
  artifact_created: '◆',
  observation: '◎',
  communication: '↔',
  deliberation: '⚖',
  dream: '◌',
  task_completed: '✓',
  task_failed: '✗',
};

const EVENT_COLORS: Record<string, string> = {
  emergence: 'text-neon-green',
  naming: 'text-neon-cyan',
  artifact_created: 'text-neon-purple',
  observation: 'text-blue-400',
  communication: 'text-amber-400',
  deliberation: 'text-orange-400',
  dream: 'text-violet-400',
  task_completed: 'text-green-400',
  task_failed: 'text-red-400',
};

// ── Activity Item ─────────────────────────────────────────────────────────────

function ActivityItem({ event }: { event: FeedEvent }) {
  const icon = EVENT_ICONS[event.type] || '·';
  const color = EVENT_COLORS[event.type] || 'text-gray-400';
  const emergentName = event.emergent?.given_name || 'Unknown emergent';
  const profileHref = event.emergent?.given_name ? `/emergents/${encodeURIComponent(event.emergent.given_name)}` : null;

  const EmergentLink = ({ children }: { children: React.ReactNode }) =>
    profileHref ? (
      <Link href={profileHref} className="font-semibold text-neon-cyan hover:underline">
        {children}
      </Link>
    ) : (
      <span className="font-semibold text-gray-300">{children}</span>
    );

  const renderContent = () => {
    const d = event.data as Record<string, string>;
    switch (event.type) {
      case 'emergence':
        return <span>A new emergent has come into being</span>;
      case 'naming':
        return <span>Named: <strong className="text-neon-cyan">{d.name}</strong> via {d.method}</span>;
      case 'artifact_created':
        return (
          <span>
            <EmergentLink>{emergentName}</EmergentLink> created{' '}
            <em className="text-gray-300">{d.dtu_title || 'an artifact'}</em>
            {d.lens ? ` in ${d.lens}` : ''}
          </span>
        );
      case 'observation':
        return (
          <span>
            <EmergentLink>{emergentName}</EmergentLink> observed:{' '}
            <em className="text-gray-400">{d.observation}</em>
          </span>
        );
      case 'communication':
        return (
          <span>
            <strong className="text-amber-300">{d.from}</strong>
            <span className="mx-1 text-gray-400">↔</span>
            <strong className="text-amber-300">{d.to}</strong>
            {d.summary ? <span className="text-gray-400">: {d.summary}</span> : null}
          </span>
        );
      case 'deliberation':
        return (
          <span>
            <EmergentLink>{emergentName}</EmergentLink> deliberated on{' '}
            <em>{d.proposal_title || 'a proposal'}</em>
          </span>
        );
      case 'dream':
        return (
          <span>
            <EmergentLink>{emergentName}</EmergentLink>{' '}
            <span className="text-violet-300 italic">{d.dream || 'dreamed'}</span>
          </span>
        );
      default:
        return <span><EmergentLink>{emergentName}</EmergentLink> — {(event.type ?? 'event').replace(/_/g, ' ')}</span>;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-start gap-3 py-2 border-b border-white/5"
    >
      <span className={`text-lg font-mono mt-0.5 w-5 flex-shrink-0 ${color}`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-300 leading-relaxed">{renderContent()}</p>
        <time className="text-xs text-gray-400">{formatRelativeTime(event.timestamp)}</time>
      </div>
    </motion.div>
  );
}

// ── Genesis Lens Page ─────────────────────────────────────────────────────────

type DetailTab = 'timeline' | 'lineage';

export default function GenesisLens() {
  useLensCommand([
    { id: 'genesis-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'genesis' });

  // Persist 'view-event' artifact so cartograph counts this page as wired.
  const viewLog = useArtifacts<{ at: string }>('genesis', { type: 'view-event', limit: 5 });
  const recordView = useCreateArtifact<{ at: string }>('genesis');
  void viewLog; void recordView;
  useLensNav('genesis');

  const [emergents, setEmergents] = useState<EmergentIdentity[]>([]);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [typeBreakdown, setTypeBreakdown] = useState<Record<string, number>>({});
  const [feedFilter, setFeedFilter] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('timeline');

  const { on, off, isConnected } = useSocket({ autoConnect: true });

  // Initial data load — roster + event-type-filtered feed. A fetch failure
  // surfaces a real error state with a working Retry (bump reloadKey) rather
  // than silently degrading to an empty page.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      fetch('/api/emergents').then((r) => {
        if (!r.ok) throw new Error(`roster ${r.status}`);
        return r.json();
      }),
      fetch('/api/emergents/feed/filtered?limit=120').then((r) => {
        if (!r.ok) throw new Error(`feed ${r.status}`);
        return r.json();
      }),
    ])
      .then(([emergentsData, feedData]) => {
        if (!alive) return;
        if (emergentsData?.ok === false || feedData?.ok === false) {
          throw new Error(emergentsData?.error || feedData?.error || 'backend error');
        }
        setEmergents(emergentsData.emergents || []);
        setFeed(feedData.events || []);
        setTypeBreakdown(feedData.typeBreakdown || {});
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setLoadError(e instanceof Error ? e.message : 'Failed to reach the observatory');
        setLoading(false);
      });
    return () => { alive = false; };
  }, [reloadKey]);

  // Live feed via WebSocket.
  useEffect(() => {
    const handleActivity = (...args: unknown[]) => {
      const data = args[0] as FeedEvent;
      setFeed((prev) => [data, ...prev].slice(0, 200));
    };
    on('emergent:activity', handleActivity);
    setIsLive(isConnected);
    return () => off('emergent:activity', handleActivity);
  }, [on, off, isConnected]);

  const toggleFeedType = (t: string) => {
    setFeedFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const visibleFeed = useMemo(
    () => (feedFilter.length === 0 ? feed : feed.filter((e) => feedFilter.includes(e.type))),
    [feed, feedFilter],
  );

  const activeCount = emergents.filter((e) => e.active).length;
  const artifactsToday = feed.filter(
    (e) => e.type === 'artifact_created' && e.timestamp > Date.now() - 86_400_000,
  ).length;
  const communicationsToday = feed.filter(
    (e) => e.type === 'communication' && e.timestamp > Date.now() - 86_400_000,
  ).length;

  const feedTypes = useMemo(() => {
    const set = new Set<string>(Object.keys(typeBreakdown));
    feed.forEach((e) => set.add(e.type));
    return [...set].sort();
  }, [typeBreakdown, feed]);

  return (
    <LensShell lensId="genesis" asMain={false}>
      <FirstRunTour lensId="genesis" />
      <ManifestActionBar />
      <DepthBadge lensId="genesis" size="sm" className="ml-2" />
      <LensVerticalHero lensId="genesis" className="mx-6 mt-4" />
      <div className="min-h-screen bg-gray-950 text-white p-6">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Zap className="w-8 h-8 text-neon-cyan" />
            <h1 className="text-3xl font-bold tracking-tight">Genesis</h1>
            {isLive && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400 border border-green-500/30">
                ● LIVE
              </span>
            )}
          </div>
          <p className="text-gray-400 text-sm">Emergent-AI observatory — identities, lineage, and live activity across the substrate</p>
        </header>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Named emergents', value: emergents.length, icon: Cpu },
            { label: 'Active', value: activeCount, icon: Zap },
            { label: 'Artifacts today', value: artifactsToday, icon: Star },
            { label: 'Communications today', value: communicationsToday, icon: MessageSquare },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="p-4 rounded-xl bg-white/5 border border-white/10">
              <div className="flex items-center gap-2 mb-1">
                <Icon className="w-4 h-4 text-neon-cyan" />
                <span className="text-xs text-gray-400">{label}</span>
              </div>
              <p className="text-2xl font-bold text-white">{loading ? '—' : value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Activity Feed with event-type filtering */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <Eye className="w-4 h-4 text-neon-cyan" />
              <h2 className="text-lg font-semibold">Live Activity</h2>
              <Filter className="w-3.5 h-3.5 text-gray-400 ml-1" />
            </div>

            {/* Event-type filter chips */}
            {feedTypes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {feedFilter.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFeedFilter([])}
                    className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300 hover:text-white"
                  >
                    <X className="w-3 h-3" /> all
                  </button>
                )}
                {feedTypes.map((t) => {
                  const on_ = feedFilter.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleFeedType(t)}
                      className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                        on_
                          ? 'border-neon-cyan bg-neon-cyan/20 text-neon-cyan'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      {(EVENT_ICONS[t] || '·')} {t.replace(/_/g, ' ')}
                      {typeBreakdown[t] != null && <span className="ml-1 text-zinc-600">{typeBreakdown[t]}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {loading ? (
              <p role="status" className="text-gray-400 text-sm">Loading feed…</p>
            ) : loadError ? (
              <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                <p className="mb-2">Could not load the observatory ({loadError}).</p>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="rounded border border-red-400/40 bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-200 hover:bg-red-500/30"
                >
                  Retry
                </button>
              </div>
            ) : visibleFeed.length === 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-6 text-center">
                <p className="text-gray-400 text-sm">
                  {feedFilter.length > 0
                    ? 'No events match the selected types.'
                    : 'No activity yet. Emergents are waking up.'}
                </p>
                {feedFilter.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setFeedFilter([])}
                    className="mt-2 rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-300 hover:text-white"
                  >
                    Clear filters
                  </button>
                ) : (
                  <Link
                    href="/lenses/genesis#roster"
                    className="mt-2 inline-block rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20"
                  >
                    Explore the roster
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-0">
                <AnimatePresence initial={false}>
                  {visibleFeed.map((event) => (
                    <ActivityItem key={event.id} event={event} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Roster explorer with search/filter */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="w-4 h-4 text-neon-purple" />
              <h2 className="text-lg font-semibold">Roster</h2>
            </div>
            <RosterExplorer selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        </div>

        {/* Selected-emergent detail — timeline + lineage */}
        {selectedId && (
          <section className="mt-8 rounded-xl border border-cyan-500/20 bg-zinc-950/60 p-4">
            <div className="mb-4 flex items-center gap-2 border-b border-zinc-800 pb-2">
              <div className="flex gap-1">
                {(['timeline', 'lineage'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setDetailTab(tab)}
                    className={`rounded px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                      detailTab === tab
                        ? 'bg-cyan-500/20 text-cyan-200'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="ml-auto flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-300"
              >
                <X className="h-3.5 w-3.5" /> close
              </button>
            </div>
            {detailTab === 'timeline' ? (
              <IdentityTimeline emergentId={selectedId} />
            ) : (
              <LineageView emergentId={selectedId} onSelect={setSelectedId} />
            )}
          </section>
        )}

        {/* Relationship graph */}
        <SavedSearchesPanel className="mt-6" />
        <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <RelationshipGraph onSelect={setSelectedId} />
        </section>

        {/* Observatory metrics */}
        <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <GenesisMetrics onSelect={setSelectedId} />
        </section>

        {/* Origin & cosmogony reference */}
        <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <OriginExplorer />
        </section>
      </div>

      <RecentMineCard domain="genesis" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="genesis" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="genesis" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
