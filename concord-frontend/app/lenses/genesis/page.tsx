'use client';

import { useState, useEffect, useMemo } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { SavedSearchesPanel } from '@/components/genesis/SavedSearchesPanel';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { OriginExplorer } from '@/components/genesis/OriginExplorer';
import { RosterExplorer, type RosterFilters } from '@/components/genesis/RosterExplorer';
import { IdentityTimeline } from '@/components/genesis/IdentityTimeline';
import { LineageView } from '@/components/genesis/LineageView';
import { RelationshipGraph } from '@/components/genesis/RelationshipGraph';
import { GenesisMetrics } from '@/components/genesis/GenesisMetrics';
import { ActivityFeed, type FeedEvent } from '@/components/genesis/ActivityFeed';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { Cpu, Zap, MessageSquare, Star, X, ChevronDown, ChevronRight } from 'lucide-react';
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
      <FirstRunTour lensId="genesis" />      <DepthBadge lensId="genesis" size="sm" className="ml-2" />
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
            <ActivityFeed
              feed={feed}
              feedTypes={feedTypes}
              typeBreakdown={typeBreakdown}
              feedFilter={feedFilter}
              onToggleType={toggleFeedType}
              onClearFilter={() => setFeedFilter([])}
              loading={loading}
              loadError={loadError}
              onRetry={() => setReloadKey((k) => k + 1)}
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
        <SavedSearchesPanel className="mt-6" currentFilters={rosterFilters} onRun={runSavedSearch} />
        <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <RelationshipGraph onSelect={setSelectedId} />
        </section>

        {/* Observatory metrics */}
        <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <GenesisMetrics onSelect={setSelectedId} />
        </section>

        {/* Origin & cosmogony reference */}
        <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
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
      </div>      <CrossLensRecentsPanel lensId="genesis" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
