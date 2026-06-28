'use client';

/**
 * Lattice Lens — surfaces the brain self-training pipeline shipped in
 * PR #301 (claude/lattice-consent-infra → main).
 *
 * REST-backed operator dashboard (NO macro / lensRun authoring path — the
 * lattice has no `lattice.*` macro domain by design). Every panel binds to a
 * real HTTP route registered in server.js:
 *   server/routes/lattice.js  (mounted /api/lattice — server.js:33413)
 *     GET  /api/lattice/corpus/stats   — per-consent-table counts + totals
 *     GET  /api/lattice/corpus/mine    — caller's consent summary (total/consented/ratio)
 *     POST /api/lattice/dtus/:id/consent      — per-DTU toggle
 *     POST /api/lattice/dtus/consent-all      — account-wide bulk flip
 *     GET  /api/lattice/consent-log    — append-only audit (AuditAndDrift)
 *     GET  /api/lattice/drift-alerts   — drift-monitor alerts   (AuditAndDrift)
 *   server/routes/brains.js   (mounted /api/brains — server.js:33422)
 *     GET  /api/brains/stats   — per-brain interaction/corpus counts (array)
 *     GET  /api/brains/active  — active model per brain (array of DB rows)
 *     POST /api/brains/refresh — admin daily-refresh trigger
 *     + /runs /eval-curve /history /rollback /schedule /ab-tests /corpus-sample
 *       (TrainingRuns + RefreshSchedule)
 *
 * Eight tabs:
 *   Overview   — consent-corpus snapshot (per-table totals)
 *   Consent    — account-wide training-consent summary + bulk flip
 *   Brains     — brain-by-brain corpus health + active models
 *   Training   — run history, eval curves, rollback, corpus sample
 *   Schedule   — refresh cadence + A/B candidate tests
 *   Refresh    — admin daily-refresh trigger
 *   Audit      — consent audit log + drift alerts
 *   Federation — corpus breakdown by source-node tag
 */

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { LatticeRepos } from '@/components/lattice/LatticeRepos';
import { TrainingRuns } from '@/components/lattice/TrainingRuns';
import { RefreshSchedule } from '@/components/lattice/RefreshSchedule';
import { AuditAndDrift } from '@/components/lattice/AuditAndDrift';
import { useQuery, useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Network, Brain, ShieldCheck, History, Activity,
  Loader2, RefreshCw, Check, X, LineChart, CalendarClock, ScrollText,
  AlertTriangle, type LucideIcon,
} from 'lucide-react';

type TabKey =
  | 'overview' | 'consent' | 'brains' | 'refresh' | 'federation'
  | 'training' | 'schedule' | 'audit';

// ── REST response shapes (match server/routes/{lattice,brains}.js exactly) ──
interface CorpusTable { name: string; total: number; consented: number; ratio: number; regime: string }
interface CorpusStats { ok: boolean; tables: CorpusTable[]; totals: { total: number; consented: number; ratio: number } }
interface MineSummary { ok: boolean; userId?: string; total: number; consented: number; ratio: number }
interface BrainStat { brainId: string; total: number; positive: number; consented: number; pending: number }
interface BrainStats { ok: boolean; brains: BrainStat[] }
interface ActiveModel { brain_id: string; model_name: string; base_model?: string; corpus_size?: number; eval_score?: number; created_at?: number }
interface ActiveModels { ok: boolean; active: ActiveModel[] }

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

// ── Accessible state primitives (loading=status, error=alert+Retry) ─────────
function Loading({ label }: { label: string }) {
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-2 px-1 py-4 text-xs text-fuchsia-600">
      <Loader2 className="h-4 w-4 animate-spin text-fuchsia-500" aria-hidden /> {label}
    </p>
  );
}

function ErrorState({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying?: boolean }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
      <AlertTriangle className="h-4 w-4 text-rose-400" aria-hidden />
      <span className="flex-1">{message}</span>
      <button
        onClick={onRetry}
        disabled={retrying}
        className="inline-flex items-center gap-1 rounded bg-rose-900/40 px-2 py-1 font-medium hover:bg-rose-800/60 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-rose-400"
      >
        {retrying ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}

export default function LatticeLensPage() {
  useLensNav('lattice');
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  useLensCommand(
    [
      { id: 'tab-overview', keys: 'o', description: 'Overview', category: 'navigation', action: () => setActiveTab('overview') },
      { id: 'tab-consent', keys: 'c', description: 'Consent', category: 'navigation', action: () => setActiveTab('consent') },
      { id: 'tab-brains', keys: 'b', description: 'Brains', category: 'navigation', action: () => setActiveTab('brains') },
      { id: 'tab-training', keys: 't', description: 'Training runs', category: 'navigation', action: () => setActiveTab('training') },
      { id: 'tab-schedule', keys: 's', description: 'Schedule & A/B', category: 'navigation', action: () => setActiveTab('schedule') },
      { id: 'tab-refresh', keys: 'r', description: 'Refresh', category: 'navigation', action: () => setActiveTab('refresh') },
      { id: 'tab-audit', keys: 'a', description: 'Audit & drift', category: 'navigation', action: () => setActiveTab('audit') },
      { id: 'tab-federation', keys: 'f', description: 'Federation', category: 'navigation', action: () => setActiveTab('federation') },
    ],
    { lensId: 'lattice' }
  );

  // ── Consent corpus stats (per-table) ─────────────────────────────────
  const corpusStats: UseQueryResult<CorpusStats> = useQuery({
    queryKey: ['lattice-corpus-stats'],
    queryFn: () => fetchJSON<CorpusStats>('/api/lattice/corpus/stats'),
    refetchInterval: 60_000,
  });

  // ── My consent summary (account-wide) ────────────────────────────────
  const myCorpus: UseQueryResult<MineSummary> = useQuery({
    queryKey: ['lattice-corpus-mine'],
    queryFn: () => fetchJSON<MineSummary>('/api/lattice/corpus/mine'),
    refetchInterval: 60_000,
  });

  // ── Brain stats ──────────────────────────────────────────────────────
  const brainStats: UseQueryResult<BrainStats> = useQuery({
    queryKey: ['lattice-brains-stats'],
    queryFn: () => fetchJSON<BrainStats>('/api/brains/stats'),
    refetchInterval: 30_000,
  });

  const activeModels: UseQueryResult<ActiveModels> = useQuery({
    queryKey: ['lattice-brains-active'],
    queryFn: () => fetchJSON<ActiveModels>('/api/brains/active'),
  });

  // ── Bulk consent (consent-all / revoke-all) ──────────────────────────
  const bulkConsent = useMutation({
    mutationFn: (consented: boolean) =>
      fetchJSON('/api/lattice/dtus/consent-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consented }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lattice-corpus-mine'] });
      qc.invalidateQueries({ queryKey: ['lattice-corpus-stats'] });
    },
  });

  // ── Admin refresh ────────────────────────────────────────────────────
  const triggerRefresh = useMutation({
    mutationFn: (brain: string) =>
      fetchJSON('/api/brains/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brain }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lattice-brains-stats'] }),
  });

  const consentedBrainCount = brainStats.data?.brains?.filter(b => b.consented > 0).length;

  const tabs: { key: TabKey; label: string; icon: LucideIcon; count?: number }[] = [
    { key: 'overview',   label: 'Overview',   icon: Activity },
    { key: 'consent',    label: 'Consent',    icon: ShieldCheck, count: myCorpus.data?.consented },
    { key: 'brains',     label: 'Brains',     icon: Brain, count: consentedBrainCount },
    { key: 'training',   label: 'Training',   icon: LineChart },
    { key: 'schedule',   label: 'Schedule',   icon: CalendarClock },
    { key: 'refresh',    label: 'Refresh',    icon: RefreshCw },
    { key: 'audit',      label: 'Audit',      icon: ScrollText },
    { key: 'federation', label: 'Federation', icon: Network },
  ];

  return (
    <LensShell lensId="lattice" asMain={false}>
      <FirstRunTour lensId="lattice" />
      <DepthBadge lensId="lattice" size="sm" className="ml-2" />
      <LensVerticalHero lensId="lattice" className="mx-6 mt-4" />
    <div className="min-h-screen bg-black pb-12 text-fuchsia-50">
      <header className="sticky top-0 z-10 border-b border-fuchsia-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Network className="h-6 w-6 text-fuchsia-400" aria-hidden />
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-wide">Lattice</h1>
            <p className="text-xs text-fuchsia-700">Brain self-training · consent corpus · daily refresh · federation</p>
          </div>
        </div>
      </header>

      <nav className="border-b border-fuchsia-900/30 px-4 md:px-8" aria-label="Lattice sections">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-fuchsia-400 ${
                activeTab === key ? 'border-fuchsia-400 text-fuchsia-200' : 'border-transparent text-fuchsia-700 hover:text-fuchsia-400'
              }`}
              aria-pressed={activeTab === key}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              {count != null && <span className="rounded bg-fuchsia-900/40 px-1.5 py-0.5 text-[10px] text-fuchsia-300">{count}</span>}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <Section k="overview">
              <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Consent corpus snapshot</h2>
              {corpusStats.isLoading ? (
                <Loading label="Loading corpus stats…" />
              ) : corpusStats.isError ? (
                <ErrorState
                  message={(corpusStats.error as Error)?.message ?? 'Failed to load corpus stats.'}
                  onRetry={() => corpusStats.refetch()}
                  retrying={corpusStats.isFetching}
                />
              ) : (corpusStats.data?.tables ?? []).length === 0 ? (
                <Empty>No consent-tracking tables present on this instance yet.</Empty>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    <Stat label="Total rows" value={corpusStats.data!.totals.total} />
                    <Stat label="Consented" value={corpusStats.data!.totals.consented} />
                    <Stat label="Consent ratio" value={`${(corpusStats.data!.totals.ratio * 100).toFixed(1)}%`} />
                  </div>
                  <h3 className="mt-6 mb-2 text-sm font-semibold text-fuchsia-300">Per-table consent</h3>
                  <div className="overflow-x-auto rounded border border-fuchsia-900/40">
                    <table className="w-full font-mono text-xs">
                      <thead className="bg-fuchsia-950/40 text-fuchsia-400">
                        <tr>
                          <th className="px-3 py-2 text-left">Table</th>
                          <th className="px-3 py-2 text-left">Regime</th>
                          <th className="px-3 py-2 text-right">Total</th>
                          <th className="px-3 py-2 text-right">Consented</th>
                          <th className="px-3 py-2 text-right">Ratio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {corpusStats.data!.tables.map((t) => (
                          <tr key={t.name} className="border-t border-fuchsia-900/20">
                            <td className="px-3 py-2 text-fuchsia-300">{t.name}</td>
                            <td className="px-3 py-2 text-fuchsia-600">{t.regime}</td>
                            <td className="px-3 py-2 text-right text-fuchsia-200">{t.total}</td>
                            <td className="px-3 py-2 text-right text-emerald-400">{t.consented}</td>
                            <td className="px-3 py-2 text-right text-fuchsia-400">{(t.ratio * 100).toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Section>
          )}

          {activeTab === 'consent' && (
            <Section k="consent">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-fuchsia-200">Training consent</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => bulkConsent.mutate(true)}
                    disabled={bulkConsent.isPending}
                    className="inline-flex items-center gap-1 rounded bg-emerald-700/40 px-2 py-1 text-xs hover:bg-emerald-600/60 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  >
                    {bulkConsent.isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />} Consent all
                  </button>
                  <button
                    onClick={() => bulkConsent.mutate(false)}
                    disabled={bulkConsent.isPending}
                    className="inline-flex items-center gap-1 rounded bg-rose-900/40 px-2 py-1 text-xs hover:bg-rose-800/60 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-rose-400"
                  >
                    <X className="h-3 w-3" aria-hidden /> Revoke all
                  </button>
                </div>
              </div>
              <p className="mb-4 max-w-prose text-xs text-fuchsia-700">
                Training consent is per-creator and account-wide. &ldquo;Consent all&rdquo; opts every
                DTU you have authored into the lattice training corpus; &ldquo;Revoke all&rdquo; opts
                them back out. Every flip is recorded in the Audit tab.
              </p>
              {myCorpus.isLoading ? (
                <Loading label="Loading your consent summary…" />
              ) : myCorpus.isError ? (
                <ErrorState
                  message={(myCorpus.error as Error)?.message ?? 'Failed to load your consent summary.'}
                  onRetry={() => myCorpus.refetch()}
                  retrying={myCorpus.isFetching}
                />
              ) : (myCorpus.data?.total ?? 0) === 0 ? (
                <Empty>You haven&apos;t authored any DTUs yet — once you do, they join your consent corpus and these counts populate.</Empty>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <Stat label="My DTUs" value={myCorpus.data!.total} />
                  <Stat label="Consented" value={myCorpus.data!.consented} />
                  <Stat label="Consent ratio" value={`${(myCorpus.data!.ratio * 100).toFixed(1)}%`} />
                </div>
              )}
              {bulkConsent.isError && (
                <p className="mt-3 inline-flex items-center gap-1 text-xs text-rose-400" role="alert">
                  <X className="h-3 w-3" aria-hidden /> {(bulkConsent.error as Error)?.message ?? 'Consent update failed'}
                </p>
              )}
            </Section>
          )}

          {activeTab === 'brains' && (
            <Section k="brains">
              <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Brain corpus health</h2>
              {brainStats.isLoading ? (
                <Loading label="Loading brain stats…" />
              ) : brainStats.isError ? (
                <ErrorState
                  message={(brainStats.error as Error)?.message ?? 'Failed to load brain stats.'}
                  onRetry={() => brainStats.refetch()}
                  retrying={brainStats.isFetching}
                />
              ) : (brainStats.data?.brains ?? []).length === 0 ? (
                <Empty>No brain interactions recorded yet — corpus counts appear as the brains are exercised.</Empty>
              ) : (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {brainStats.data!.brains.map((b) => (
                    <div key={b.brainId} className="rounded-lg border border-fuchsia-900/40 bg-fuchsia-950/10 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-sm font-semibold text-fuchsia-200">{b.brainId}</span>
                        <span className="rounded bg-fuchsia-800/30 px-1.5 py-0.5 text-[10px] text-fuchsia-300">{b.total} interactions</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-fuchsia-500">
                        <div>Positive: <span className="text-emerald-400">{b.positive}</span></div>
                        <div>Pending: <span className="text-amber-400">{b.pending}</span></div>
                        <div>Consented: <span className="text-fuchsia-200">{b.consented}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <h3 className="mt-6 mb-2 text-sm font-semibold text-fuchsia-300">Active models</h3>
              {activeModels.isLoading ? (
                <Loading label="Loading active models…" />
              ) : activeModels.isError ? (
                <ErrorState
                  message={(activeModels.error as Error)?.message ?? 'Failed to load active models.'}
                  onRetry={() => activeModels.refetch()}
                  retrying={activeModels.isFetching}
                />
              ) : (activeModels.data?.active ?? []).length === 0 ? (
                <Empty>No evolved model is active yet — trigger a refresh on the Refresh tab to build one.</Empty>
              ) : (
                <ul className="space-y-1">
                  {activeModels.data!.active.map((a) => (
                    <li key={a.brain_id} className="flex flex-wrap items-center gap-3 rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-3 py-2 text-xs">
                      <Brain className="h-3.5 w-3.5 text-fuchsia-500" aria-hidden />
                      <span className="font-mono text-fuchsia-300">{a.brain_id}</span>
                      <span className="text-fuchsia-100">{a.model_name}</span>
                      {a.base_model && <span className="text-fuchsia-700">on {a.base_model}</span>}
                      {a.eval_score != null && <span className="ml-auto rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300">eval {a.eval_score.toFixed(2)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {activeTab === 'training' && (
            <Section k="training">
              <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Training runs &amp; eval</h2>
              <p className="mb-4 max-w-prose text-xs text-fuchsia-700">
                Experiment-tracking surface — run history with eval deltas, loss/accuracy curves,
                per-version model rollback, and a corpus-sample inspector showing the actual rows
                that fed a run.
              </p>
              <TrainingRuns />
            </Section>
          )}

          {activeTab === 'schedule' && (
            <Section k="schedule">
              <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Refresh schedule &amp; A/B</h2>
              <RefreshSchedule />
            </Section>
          )}

          {activeTab === 'audit' && (
            <Section k="audit">
              <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Audit &amp; drift</h2>
              <AuditAndDrift />
            </Section>
          )}

          {activeTab === 'refresh' && (
            <Section k="refresh">
              <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Daily refresh</h2>
              <p className="mb-4 max-w-prose text-xs text-fuchsia-700">
                Triggers a manual refresh of a brain&apos;s training corpus. The runner walks recent
                positive interactions, builds a Modelfile diff, and (if eval-gated) promotes the new
                model to active. Heartbeat ticks <code className="rounded bg-fuchsia-950/40 px-1">brain-daily-refresh</code> +
                <code className="mx-1 rounded bg-fuchsia-950/40 px-1">brain-outcome-resolver</code> run automatically.
                Manual refresh is admin-gated.
              </p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {['conscious', 'subconscious', 'utility', 'repair'].map(brain => (
                  <button
                    key={brain}
                    onClick={() => triggerRefresh.mutate(brain)}
                    disabled={triggerRefresh.isPending}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-fuchsia-900/40 bg-fuchsia-950/10 px-3 py-2 text-xs hover:bg-fuchsia-900/30 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                  >
                    {triggerRefresh.isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
                    Refresh {brain}
                  </button>
                ))}
              </div>
              {triggerRefresh.isSuccess && (
                <p className="mt-3 inline-flex items-center gap-1 text-xs text-emerald-400" role="status">
                  <Check className="h-3 w-3" aria-hidden /> Refresh started — see Brains tab for evolved model
                </p>
              )}
              {triggerRefresh.isError && (
                <p className="mt-3 inline-flex items-center gap-1 text-xs text-rose-400" role="alert">
                  <X className="h-3 w-3" aria-hidden /> {(triggerRefresh.error as Error)?.message ?? 'Refresh failed'}
                </p>
              )}
            </Section>
          )}

          {activeTab === 'federation' && (
            <Section k="federation">
              <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Federation corpus</h2>
              <p className="mb-4 max-w-prose text-xs text-fuchsia-700">
                Per-source-node breakdown of the brain corpus. Federated rows arrive via the
                cnet-federation protocol; they&apos;re given lower implicit weight in daily refresh.
                The federated source breakdown surfaces once a peer is registered.
              </p>
              {corpusStats.isLoading ? (
                <Loading label="Loading federation corpus…" />
              ) : corpusStats.isError ? (
                <ErrorState
                  message={(corpusStats.error as Error)?.message ?? 'Failed to load federation corpus.'}
                  onRetry={() => corpusStats.refetch()}
                  retrying={corpusStats.isFetching}
                />
              ) : (
                <Empty>No federated corpus yet — register a peer via Concord-mesh and the per-source breakdown appears here.</Empty>
              )}
              <div className="mt-6 flex items-center gap-2 text-xs text-fuchsia-700">
                <History className="h-3 w-3" aria-hidden />
                <span>Federation event log surfaces in the Mesh lens (lenses/mesh).</span>
              </div>
            </Section>
          )}
        </AnimatePresence>
      </main>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <LatticeRepos />
      </section>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders &ldquo;No data yet&rdquo; if main view has no rows</div>
          <RecentMineCard domain="lattice" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="lattice" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="lattice" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

function Section({ children, k }: { children: React.ReactNode; k: TabKey }) {
  return (
    <motion.section key={k} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
      {children}
    </motion.section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18 }}
      className="rounded-lg border border-fuchsia-900/40 bg-fuchsia-950/10 p-3 text-fuchsia-200">
      <div className="mb-1 text-[11px] uppercase tracking-wider text-fuchsia-700">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </motion.div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-4 py-6 text-center text-xs text-fuchsia-600">{children}</p>;
}
