'use client';

import { useState, useEffect, useMemo } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { SavedSearchesPanel } from '@/components/genesis/SavedSearchesPanel';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { OriginExplorer } from '@/components/genesis/OriginExplorer';
import { RosterExplorer, type RosterFilters } from '@/components/genesis/RosterExplorer';
import { IdentityTimeline } from '@/components/genesis/IdentityTimeline';
import { LineageView } from '@/components/genesis/LineageView';
import { RelationshipGraph } from '@/components/genesis/RelationshipGraph';
import { GenesisMetrics } from '@/components/genesis/GenesisMetrics';
import { ActivityFeed, type FeedEvent } from '@/components/genesis/ActivityFeed';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { Cpu, Zap, MessageSquare, Star, X, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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

// ── Genesis Lens Page ─────────────────────────────────────────────────────────

type DetailTab = 'timeline' | 'lineage';

export default function GenesisLens() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

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
  const [now, setNow] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('timeline');

  // Roster filters, lifted so SavedSearchesPanel can (a) save the roster's
  // live filter set and (b) re-apply a saved search back onto the roster.
  const [rosterFilters, setRosterFilters] = useState<RosterFilters>({ query: '', role: '', focus: '', state: 'all' });
  const [appliedFilters, setAppliedFilters] = useState<RosterFilters | null>(null);
  const [appliedKey, setAppliedKey] = useState(0);
  const [showOriginExplorer, setShowOriginExplorer] = useState(false);
  const runSavedSearch = (f: RosterFilters) => {
    setAppliedFilters(f);
    setAppliedKey((k) => k + 1);
    document.getElementById('roster')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const { on, off, isConnected } = useSocket({ autoConnect: true });

  // Initial data load — roster + event-type-filtered feed. A fetch failure
  // surfaces a real error state with a working Retry (bump reloadKey) rather
  // than silently degrading to an empty page.
  useEffect(() => {
    let alive = true;
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
    return () => off('emergent:activity', handleActivity);
  }, [on, off, isConnected]);

  const begin = () => {
    const first = emergents[0];
    const id = first?.emergent_id || first?.id;
    if (id) {
      setSelectedId(id);
      setDetailTab('timeline');
    }
    document.getElementById('roster')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useLensCommand([
    { id: 'genesis-begin', keys: 'n', description: 'Open the first identity', category: 'actions', action: begin },
    { id: 'genesis-roster', keys: 'r', description: 'Jump to the roster', category: 'navigation', action: () => document.getElementById('roster')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
  ], { lensId: 'genesis' });

  const isLive = isConnected;

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const toggleFeedType = (t: string) => {
    setFeedFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const activeCount = emergents.filter((e) => e.active).length;
  const artifactsToday = feed.filter(
    (e) => e.type === 'artifact_created' && e.timestamp > now - 86_400_000,
  ).length;
  const communicationsToday = feed.filter(
    (e) => e.type === 'communication' && e.timestamp > now - 86_400_000,
  ).length;

  const feedTypes = useMemo(() => {
    const set = new Set<string>(Object.keys(typeBreakdown));
    feed.forEach((e) => set.add(e.type));
    return [...set].sort();
  }, [typeBreakdown, feed]);

  return (
    <LensShell lensId="genesis" asMain={false}>
      <FirstRunTour lensId="genesis" />
      <DepthBadge lensId="genesis" size="sm" className="ml-2" />
      <div data-lens-theme="genesis" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Genesis</p>
            <h1 className="mb-2 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              Where it starts{who ? `, ${who}` : ''}
            </h1>
            <p className="mb-6 max-w-2xl text-[14px] text-zinc-500">Emergent-AI observatory — identities, lineage, and live activity across the substrate</p>
          </div>
          {isLive && (
            <span className="mt-3 shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
              ● Live
            </span>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Named emergents', value: emergents.length, icon: Cpu },
            { label: 'Active', value: activeCount, icon: Zap },
            { label: 'Artifacts today', value: artifactsToday, icon: Star },
            { label: 'Communications today', value: communicationsToday, icon: MessageSquare },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-[#111] p-5">
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
            <ActivityFeed
              feed={feed}
              feedTypes={feedTypes}
              typeBreakdown={typeBreakdown}
              feedFilter={feedFilter}
              onToggleType={toggleFeedType}
              onClearFilter={() => setFeedFilter([])}
              loading={loading}
              loadError={loadError}
              onRetry={() => { setLoading(true); setLoadError(null); setReloadKey((k) => k + 1); }}
            />
          </div>

          {/* Roster explorer with search/filter */}
          <div id="roster" className="scroll-mt-6">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="w-4 h-4 text-neon-purple" />
              <h2 className="text-lg font-semibold">Roster</h2>
            </div>
            <RosterExplorer
              selectedId={selectedId}
              onSelect={setSelectedId}
              onFiltersChange={setRosterFilters}
              applyFilters={appliedFilters}
              applyKey={appliedKey}
            />
          </div>
        </div>

        {/* Selected-emergent detail — timeline + lineage */}
        {selectedId && (
          <section className="mt-8 rounded-2xl border border-white/10 bg-[#111] p-5">
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
        <SavedSearchesPanel className="mt-6" currentFilters={rosterFilters} onRun={runSavedSearch} />
        <section className="mt-8 rounded-2xl border border-white/10 bg-[#111] p-5">
          <RelationshipGraph onSelect={setSelectedId} />
        </section>

        {/* Observatory metrics */}
        <section className="mt-8 rounded-2xl border border-white/10 bg-[#111] p-5">
          <GenesisMetrics onSelect={setSelectedId} />
        </section>

        {/* Origin & cosmogony reference */}
        <section className="mt-8 rounded-2xl border border-white/10 bg-[#111] p-5">
          <button
            type="button"
            onClick={() => setShowOriginExplorer(v => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>Origin & cosmogony reference</span>
            {showOriginExplorer ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showOriginExplorer && (
            <div className="mt-3">
              <OriginExplorer />
            </div>
          )}
        </section>

        <CrossLensRecentsPanel lensId="genesis" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={begin}
          title="Open the first identity (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Sparkles className="h-4 w-4" />
          Begin
        </button>
      </div>
    </LensShell>
  );
}
