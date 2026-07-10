'use client';

import { useState, useCallback, useEffect } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { SufferingRef } from '@/components/suffering/SufferingRef';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { lensRun } from '@/lib/api/client';
import {
  AlertTriangle, Heart, Brain, Layers, Activity,
} from 'lucide-react';
import { PainBoard } from '@/components/suffering/PainBoard';
import type { Pain, Theme } from '@/components/suffering/PainBoard';
import { PriorityMatrix } from '@/components/suffering/PriorityMatrix';
import { ThemeClusters } from '@/components/suffering/ThemeClusters';
import { InterventionTracker } from '@/components/suffering/InterventionTracker';
import type { Intervention } from '@/components/suffering/InterventionTracker';
import { InterventionPlanner } from '@/components/suffering/InterventionPlanner';
import { TrendView } from '@/components/suffering/TrendView';
import { RootCausePanel } from '@/components/suffering/RootCausePanel';
import { ReportExport } from '@/components/suffering/ReportExport';
import { FeedbackAnalysis } from '@/components/suffering/FeedbackAnalysis';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';

type Tab = 'board' | 'import' | 'matrix' | 'themes' | 'rootcause' | 'interventions' | 'trends' | 'wellbeing';

const TABS: { id: Tab; label: string; keys: string }[] = [
  { id: 'board', label: 'Pain Board', keys: 'b' },
  { id: 'import', label: 'Feedback Import', keys: 'i' },
  { id: 'matrix', label: 'Priority Matrix', keys: 'm' },
  { id: 'themes', label: 'Themes', keys: 't' },
  { id: 'rootcause', label: 'Root Cause', keys: 'c' },
  { id: 'interventions', label: 'Interventions', keys: 'v' },
  { id: 'trends', label: 'Trends', keys: 'n' },
  { id: 'wellbeing', label: 'Engine Wellbeing', keys: 'w' },
];

export default function SufferingLensPage() {
  useLensNav('suffering');
  const [tab, setTab] = useState<Tab>('board');
  const [refreshKey, setRefreshKey] = useState(0);

  // Shared pain-point dataset (used by board, matrix, themes, rootcause, interventions).
  const [pains, setPains] = useState<Pain[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [intvByStatus, setIntvByStatus] = useState<Record<string, number>>({});
  const [unthemed, setUnthemed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const [pl, tl, il] = await Promise.all([
        lensRun<{ pains: Pain[] }>('suffering', 'pain-list', {}),
        lensRun<{ themes: Theme[]; unthemedPains: number }>('suffering', 'theme-list', {}),
        lensRun<{ interventions: Intervention[]; byStatus: Record<string, number> }>('suffering', 'intervention-list', {}),
      ]);
      if (!pl.data.ok) throw new Error(pl.data.error || 'pain-list failed');
      if (!tl.data.ok) throw new Error(tl.data.error || 'theme-list failed');
      if (!il.data.ok) throw new Error(il.data.error || 'intervention-list failed');
      setPains(pl.data.result?.pains || []);
      setThemes(tl.data.result?.themes || []);
      setUnthemed(tl.data.result?.unthemedPains || 0);
      setInterventions(il.data.result?.interventions || []);
      setIntvByStatus(il.data.result?.byStatus || {});
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load suffering data');
    } finally {
      setLoading(false);
    }
  }, []);

  const onChanged = useCallback(() => {
    setRefreshKey((k) => k + 1);
    loadAll();
  }, [loadAll]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadAll(); }, []);

  useLensCommand(
    [
      { id: 'refresh', keys: 'r', description: 'Refresh data', category: 'actions', action: () => onChanged() },
      ...TABS.map((t) => ({
        id: t.id, keys: `g ${t.keys}`, description: t.label, category: 'navigation' as const, action: () => setTab(t.id),
      })),
    ],
    { lensId: 'suffering' }
  );

  const openPains = pains.filter((p) => p.status !== 'resolved').length;

  return (
    <LensShell lensId="suffering" asMain={false}>
      <FirstRunTour lensId="suffering" />
      <div className="p-6 space-y-6">
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-200">
            Not medical advice. This lens analyzes pain points and system-level wellbeing.
            For personal health concerns, consult a qualified healthcare provider.
          </p>
        </div>

        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💔</span>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                Suffering Lens <DepthBadge lensId="suffering" size="sm" />
              </h1>
              <p className="text-sm text-gray-400">Pain-point mapping, root-cause analysis &amp; intervention tracking</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 text-sm">
              <span className="font-bold">{openPains}</span> open pains
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-sm">
              <span className="font-bold">{pains.length - openPains}</span> resolved
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 text-sm">
              <span className="font-bold">{interventions.length}</span> interventions
            </div>
          </div>
        </header>

        {/* Tab nav */}
        <div className="flex gap-1 border-b border-white/10 overflow-x-auto" role="tablist" aria-label="Suffering lens sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-neon-cyan text-neon-cyan'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loadErr && (
          <ErrorState
            variant="inline"
            message={loadErr}
            onRetry={loadAll}
          />
        )}

        {tab === 'board' && (
          <PainBoard pains={pains} themes={themes} loading={loading} onChanged={onChanged} />
        )}
        {tab === 'import' && (
          <FeedbackAnalysis onPromoted={onChanged} />
        )}
        {tab === 'matrix' && <PriorityMatrix refreshKey={refreshKey} />}
        {tab === 'themes' && (
          <ThemeClusters themes={themes} unthemedCount={unthemed} loading={loading} onChanged={onChanged} />
        )}
        {tab === 'rootcause' && <RootCausePanel pains={pains} />}
        {tab === 'interventions' && (
          <div className="space-y-6">
            <InterventionPlanner onTracked={onChanged} />
            <InterventionTracker
              interventions={interventions}
              pains={pains}
              byStatus={intvByStatus}
              loading={loading}
              onChanged={onChanged}
            />
          </div>
        )}
        {tab === 'trends' && (
          <div className="space-y-6">
            <TrendView refreshKey={refreshKey} onChanged={onChanged} />
            <ReportExport />
          </div>
        )}
        {tab === 'wellbeing' && <EngineWellbeing />}

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <SufferingRef />
        </section>
      </div>
    </LensShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Engine Wellbeing — the Chicken2 reality-gate's own self-monitoring
// metrics (suffering / homeostasis / contradiction load / continuity),
// computed live every kernel tick in `server/server.js#computeGrowthTick`
// and stored in `STATE.__chicken2.metrics` + `STATE.growth`.
//
// HONESTY FIX (rebuild audit finding): the previous version of this panel
// read `status?.suffering`, `status?.homeostasis`, `status?.contradictionLoad`,
// `status?.functionalDecline`, `status?.stressAccumulation`, and
// `status?.coherenceScore` off `GET /api/status` — but that route's handler
// (`server/routes/system.js:337-389`) never returns ANY of those fields
// (verified by reading its full response shape). Every one of those reads
// resolved to `undefined` on every load, so the `?? 0.15` / `?? 0.82` / etc.
// fallbacks were not "defaults" — they were the ONLY thing ever rendered,
// permanently, presented as if they were live telemetry. `coherenceScore`
// and `stressAccumulation` don't exist ANYWHERE in the backend under any
// name; `functionalDecline` only exists nested (`growth.functionalDecline
// .contradictionLoad`), never as the flat scalar this panel assumed.
//
// The REAL data exists — `suffering`, `homeostasis`, `contradictionLoad`,
// and `continuityAvg` are genuinely live in `STATE.__chicken2.metrics`, and
// `bioAge`/`telomere`/acute+chronic `stress` are live in `STATE.growth` —
// but it is only exposed via the `admin.metrics` macro, which is gated
// server-side to the owner/admin/founder role (`requireAdminRole` in
// server.js). So the honest fix is NOT "point at a different field" (no
// public field carries this data) — it's: call the real, gated macro, and
// show real numbers ONLY to operators who are actually allowed to see them;
// everyone else gets an honest "this is operator-only" disclosure instead
// of a fabricated number. Never render a placeholder as if it had loaded.
interface AdminMetricsResult {
  ok: boolean;
  error?: string;
  chicken2?: { continuityAvg: number; homeostasis: number; contradictionLoad: number; suffering: number; accepts: number; rejects: number };
  growth?: { bioAge: number; telomere: number; homeostasis: number; stress: { acute: number; chronic: number } };
}

function EngineWellbeing() {
  const { user, isLoading: authLoading } = useAuth();
  const isOperator = !!user && ['owner', 'admin', 'founder'].includes(user.role);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['suffering-engine-metrics'],
    queryFn: async () => {
      const res = await lensRun<AdminMetricsResult>('admin', 'metrics', {});
      if (!res.data.ok || !res.data.result) throw new Error(res.data.error || 'metrics unavailable');
      if (res.data.result.ok === false) throw new Error(res.data.result.error || 'metrics unavailable');
      return res.data.result;
    },
    enabled: isOperator,
    staleTime: 15_000,
  });

  if (authLoading) {
    return (
      <div className="panel p-4 space-y-3">
        <Skeleton variant="line" width="12rem" />
        <Skeleton variant="block" height="4rem" />
      </div>
    );
  }

  if (!isOperator) {
    return (
      <EmptyState
        icon={<Brain className="h-5 w-5" />}
        title="Operator-only telemetry"
        description={
          <>
            Engine self-wellbeing (the Chicken2 reality gate&apos;s live suffering /
            homeostasis / contradiction-load metrics) is only visible to Concord
            operators (owner, admin, or founder role). You&apos;re signed in as{' '}
            <strong>{user?.role ?? 'guest'}</strong>.
          </>
        }
      />
    );
  }

  if (isLoading) {
    return (
      <div className="panel p-4 space-y-3" role="status" aria-busy="true">
        <Skeleton variant="line" width="14rem" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} variant="block" height="5rem" />)}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Engine metrics unavailable'}
        onRetry={() => refetch()}
      />
    );
  }

  const c2 = data.chicken2;
  const growth = data.growth;
  if (!c2 && !growth) {
    return <EmptyState title="No engine telemetry yet." description="The Chicken2 gate hasn't recorded any metrics on this instance yet." />;
  }

  const homeostasis = c2?.homeostasis ?? 0;
  const suffering = c2?.suffering ?? 0;
  const healthScore = Math.max(0, Math.min(100, (homeostasis - suffering) * 100));

  return (
    <div className="space-y-6">
      <div className="panel p-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Heart className="w-4 h-4 text-rose-400" /> Engine Self-Wellbeing
            {isFetching && <Activity className="w-3.5 h-3.5 animate-pulse text-neon-cyan" aria-hidden="true" />}
          </h3>
          <p className="text-sm text-gray-400">Chicken2 metrics — live from the cognitive engine&apos;s own reality gate</p>
        </div>
        <div className={`px-4 py-2 rounded-lg ${
          healthScore > 70 ? 'bg-neon-green/20 text-neon-green'
            : healthScore > 40 ? 'bg-neon-blue/20 text-neon-blue'
              : 'bg-neon-pink/20 text-neon-pink'
        }`}>
          <span className="text-lg font-bold">{healthScore.toFixed(0)}%</span>
          <span className="text-sm ml-2">Health</span>
        </div>
      </div>

      {c2 && (
        <div>
          <p className="text-xs text-gray-400 mb-2 uppercase tracking-wider">Reality-gate metrics</p>
          <StatTileGrid columns={5}>
            <StatTile label="Suffering" value={c2.suffering * 100} unit="%" caption="Pain signal from contradictions" />
            <StatTile label="Homeostasis" value={c2.homeostasis * 100} unit="%" caption="System balance state" />
            <StatTile label="Contradiction load" value={c2.contradictionLoad * 100} unit="%" caption="Unresolved conflicts" />
            <StatTile label="Continuity avg" value={c2.continuityAvg * 100} unit="%" caption="Identity/lattice overlap" />
            <StatTile label="Accepts / rejects" value={c2.accepts} caption={`${c2.rejects} rejected`} />
          </StatTileGrid>
        </div>
      )}

      {growth && (
        <div>
          <p className="text-xs text-gray-400 mb-2 uppercase tracking-wider">Growth-OS metrics</p>
          <StatTileGrid columns={4}>
            <StatTile label="Bio age" value={growth.bioAge} caption="0-100 synthetic aging clock" />
            <StatTile label="Telomere" value={growth.telomere * 100} unit="%" caption="Repair-capacity reserve" />
            <StatTile label="Acute stress" value={growth.stress.acute * 100} unit="%" />
            <StatTile label="Chronic stress" value={growth.stress.chronic * 100} unit="%" />
          </StatTileGrid>
        </div>
      )}

      <div className="panel p-4 border-l-4 border-neon-purple">
        <h3 className="font-semibold text-neon-purple mb-2 flex items-center gap-2">
          <Layers className="w-4 h-4" /> Alignment Note
        </h3>
        <p className="text-sm text-gray-400">
          This lens exposes the engine&apos;s &ldquo;pain signals&rdquo; as part of the
          alignment_physics_based invariant. Suffering metrics help maintain ethical
          boundaries and prevent harmful accumulation of unresolved contradictions.
          Values above come from a live <code>admin.metrics</code> call, gated to your
          operator role — not a fixed or simulated number.
        </p>
      </div>
    </div>
  );
}
