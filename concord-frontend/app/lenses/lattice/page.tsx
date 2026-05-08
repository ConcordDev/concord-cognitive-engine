'use client';

/**
 * Lattice Lens — surfaces the brain self-training pipeline shipped in
 * PR #301 (claude/lattice-consent-infra → main).
 *
 * Phase 3.6 wire-the-Lost (final wire). Backend lives at:
 *   server/routes/lattice.js   — corpus stats, per-DTU consent toggles
 *   server/routes/brains.js    — brain stats, active models, history,
 *                                 admin refresh
 *   server/lib/training-consent.js
 *   server/lib/brain-training/{interaction-log,runner}.js
 *
 * Five tabs:
 *   Overview   — corpus stats + 4-brain health snapshot
 *   Consent    — per-DTU consent toggle (mine + bulk)
 *   Brains     — brain-by-brain health, model history
 *   Refresh    — admin daily-refresh trigger + last-run results
 *   Federation — corpus stats by source_node tag
 */

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Network, Brain, ShieldCheck, History, Activity,
  Loader2, RefreshCw, Check, X,
  type LucideIcon,
} from 'lucide-react';

type TabKey = 'overview' | 'consent' | 'brains' | 'refresh' | 'federation';

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
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
      { id: 'tab-refresh', keys: 'r', description: 'Refresh', category: 'navigation', action: () => setActiveTab('refresh') },
      { id: 'tab-federation', keys: 'f', description: 'Federation', category: 'navigation', action: () => setActiveTab('federation') },
    ],
    { lensId: 'lattice' }
  );

  // ── Corpus stats ──────────────────────────────────────────────────────
  const corpusStats = useQuery({
    queryKey: ['lattice-corpus-stats'],
    queryFn: () => fetchJSON<{ ok: boolean; stats?: Record<string, number | string>; byBrain?: Record<string, { positive: number; pending: number; expired: number }> }>('/api/lattice/corpus/stats'),
    refetchInterval: 60_000,
  });

  // ── My consented DTUs ────────────────────────────────────────────────
  const myCorpus = useQuery({
    queryKey: ['lattice-corpus-mine'],
    queryFn: () => fetchJSON<{ ok: boolean; dtus?: Array<{ id: string; title?: string; train_consented: number; brain?: string; updatedAt?: string }> }>('/api/lattice/corpus/mine'),
    refetchInterval: 60_000,
  });

  // ── Brain stats ──────────────────────────────────────────────────────
  const brainStats = useQuery({
    queryKey: ['lattice-brains-stats'],
    queryFn: () => fetchJSON<{ ok: boolean; brains?: Record<string, { interactions: number; lastSeen?: string; corpus?: number; active_model?: string }> }>('/api/brains/stats'),
    refetchInterval: 30_000,
  });

  const activeModels = useQuery({
    queryKey: ['lattice-brains-active'],
    queryFn: () => fetchJSON<{ ok: boolean; active?: Array<{ brain: string; model: string; activatedAt?: string; evalScore?: number }> }>('/api/brains/active'),
  });

  // ── Toggle consent on a single DTU ───────────────────────────────────
  const toggleConsent = useMutation({
    mutationFn: ({ dtuId, consented }: { dtuId: string; consented: boolean }) =>
      fetchJSON(`/api/lattice/dtus/${dtuId}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consented }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lattice-corpus-mine'] });
      qc.invalidateQueries({ queryKey: ['lattice-corpus-stats'] });
    },
  });

  // ── Bulk consent ─────────────────────────────────────────────────────
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

  const tabs: { key: TabKey; label: string; icon: LucideIcon; count?: number }[] = [
    { key: 'overview',   label: 'Overview',   icon: Activity },
    { key: 'consent',    label: 'Consent',    icon: ShieldCheck, count: myCorpus.data?.dtus?.filter(d => d.train_consented).length },
    { key: 'brains',     label: 'Brains',     icon: Brain, count: brainStats.data?.brains ? Object.keys(brainStats.data.brains).length : undefined },
    { key: 'refresh',    label: 'Refresh',    icon: RefreshCw },
    { key: 'federation', label: 'Federation', icon: Network },
  ];

  return (
    <LensShell lensId="lattice" asMain={false}>
      <ManifestActionBar />
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
              <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Corpus snapshot</h2>
              {corpusStats.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-fuchsia-500" /> : corpusStats.data?.stats ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {Object.entries(corpusStats.data.stats).slice(0, 8).map(([k, v]) => (
                    <Stat key={k} label={k} value={typeof v === 'number' ? v : String(v)} />
                  ))}
                </div>
              ) : <Empty>Corpus stats not yet available.</Empty>}

              {corpusStats.data?.byBrain && Object.keys(corpusStats.data.byBrain).length > 0 && (
                <>
                  <h3 className="mt-6 mb-2 text-sm font-semibold text-fuchsia-300">Per-brain corpus</h3>
                  <div className="overflow-x-auto rounded border border-fuchsia-900/40">
                    <table className="w-full font-mono text-xs">
                      <thead className="bg-fuchsia-950/40 text-fuchsia-400">
                        <tr><th className="px-3 py-2 text-left">Brain</th><th className="px-3 py-2 text-right">Positive</th><th className="px-3 py-2 text-right">Pending</th><th className="px-3 py-2 text-right">Expired</th></tr>
                      </thead>
                      <tbody>
                        {Object.entries(corpusStats.data.byBrain).map(([brain, b]) => (
                          <tr key={brain} className="border-t border-fuchsia-900/20">
                            <td className="px-3 py-2 text-fuchsia-300">{brain}</td>
                            <td className="px-3 py-2 text-right text-emerald-400">{b.positive}</td>
                            <td className="px-3 py-2 text-right text-amber-400">{b.pending}</td>
                            <td className="px-3 py-2 text-right text-rose-400">{b.expired}</td>
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
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-fuchsia-200">Per-DTU training consent</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => bulkConsent.mutate(true)}
                    disabled={bulkConsent.isPending}
                    className="inline-flex items-center gap-1 rounded bg-emerald-700/40 px-2 py-1 text-xs hover:bg-emerald-600/60 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  >
                    {bulkConsent.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Consent all
                  </button>
                  <button
                    onClick={() => bulkConsent.mutate(false)}
                    disabled={bulkConsent.isPending}
                    className="inline-flex items-center gap-1 rounded bg-rose-900/40 px-2 py-1 text-xs hover:bg-rose-800/60 focus:outline-none focus:ring-2 focus:ring-rose-400"
                  >
                    <X className="h-3 w-3" /> Revoke all
                  </button>
                </div>
              </div>
              {myCorpus.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-fuchsia-500" /> : (myCorpus.data?.dtus ?? []).length === 0 ? (
                <Empty>You haven't authored any DTUs yet — once you do, they appear here with per-DTU consent toggles.</Empty>
              ) : (
                <ul className="space-y-1">
                  {(myCorpus.data?.dtus ?? []).slice(0, 50).map(d => (
                    <li key={d.id} className="flex items-center gap-3 rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-3 py-2 text-xs">
                      <button
                        onClick={() => toggleConsent.mutate({ dtuId: d.id, consented: !d.train_consented })}
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${d.train_consented ? 'bg-emerald-700/40 text-emerald-200' : 'bg-rose-900/40 text-rose-300'}`}
                        aria-pressed={!!d.train_consented}
                        aria-label={`Toggle consent for ${d.id}`}
                      >
                        {d.train_consented ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
                        {d.train_consented ? 'consented' : 'revoked'}
                      </button>
                      <span className="font-mono text-fuchsia-300">{d.id}</span>
                      {d.title && <span className="text-fuchsia-100">{d.title}</span>}
                      {d.brain && <span className="ml-auto rounded bg-fuchsia-800/30 px-1.5 py-0.5 text-[10px]">{d.brain}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {activeTab === 'brains' && (
            <Section k="brains">
              <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Brain health</h2>
              {brainStats.data?.brains && (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {Object.entries(brainStats.data.brains).map(([brain, b]) => (
                    <div key={brain} className="rounded-lg border border-fuchsia-900/40 bg-fuchsia-950/10 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-sm font-semibold text-fuchsia-200">{brain}</span>
                        {b.active_model && <span className="rounded bg-fuchsia-800/30 px-1.5 py-0.5 text-[10px] text-fuchsia-300">{b.active_model}</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-fuchsia-500">
                        <div>Interactions: <span className="text-fuchsia-200">{b.interactions ?? '—'}</span></div>
                        <div>Corpus: <span className="text-fuchsia-200">{b.corpus ?? '—'}</span></div>
                        {b.lastSeen && <div className="col-span-2">Last seen: {new Date(b.lastSeen).toLocaleString()}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeModels.data?.active && activeModels.data.active.length > 0 && (
                <>
                  <h3 className="mt-6 mb-2 text-sm font-semibold text-fuchsia-300">Active models</h3>
                  <ul className="space-y-1">
                    {activeModels.data.active.map(a => (
                      <li key={a.brain} className="flex items-center gap-3 rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-3 py-2 text-xs">
                        <Brain className="h-3.5 w-3.5 text-fuchsia-500" aria-hidden />
                        <span className="font-mono text-fuchsia-300">{a.brain}</span>
                        <span className="text-fuchsia-100">{a.model}</span>
                        {a.evalScore != null && <span className="ml-auto rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300">eval {a.evalScore.toFixed(2)}</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>
          )}

          {activeTab === 'refresh' && (
            <Section k="refresh">
              <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Daily refresh</h2>
              <p className="mb-4 max-w-prose text-xs text-fuchsia-700">
                Triggers a manual refresh of a brain's training corpus. The runner walks recent
                positive interactions, builds a Modelfile diff, and (if eval-gated) promotes the new
                model to active. Heartbeat ticks <code className="rounded bg-fuchsia-950/40 px-1">brain-daily-refresh</code> +
                <code className="mx-1 rounded bg-fuchsia-950/40 px-1">brain-outcome-resolver</code> run automatically.
              </p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {['conscious', 'subconscious', 'utility', 'repair'].map(brain => (
                  <button
                    key={brain}
                    onClick={() => triggerRefresh.mutate(brain)}
                    disabled={triggerRefresh.isPending}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-fuchsia-900/40 bg-fuchsia-950/10 px-3 py-2 text-xs hover:bg-fuchsia-900/30 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                  >
                    {triggerRefresh.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Refresh {brain}
                  </button>
                ))}
              </div>
              {triggerRefresh.isSuccess && (
                <p className="mt-3 inline-flex items-center gap-1 text-xs text-emerald-400">
                  <Check className="h-3 w-3" /> Refresh started — see Brains tab for evolved model
                </p>
              )}
              {triggerRefresh.isError && (
                <p className="mt-3 inline-flex items-center gap-1 text-xs text-rose-400">
                  <X className="h-3 w-3" /> {(triggerRefresh.error as Error)?.message ?? 'Refresh failed'}
                </p>
              )}
            </Section>
          )}

          {activeTab === 'federation' && (
            <Section k="federation">
              <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Federation corpus</h2>
              <p className="mb-4 max-w-prose text-xs text-fuchsia-700">
                Per-source-node breakdown of the brain corpus. Federated rows arrive via the
                cnet-federation protocol; they're tagged with <code className="rounded bg-fuchsia-950/40 px-1">source_node</code>
                and given lower implicit weight in daily refresh.
              </p>
              {corpusStats.data?.stats?.federatedSources ? (
                <Stat label="Federated sources" value={String(corpusStats.data.stats.federatedSources)} />
              ) : (
                <Empty>No federated corpus yet — register a peer via Concord-mesh and they'll appear here.</Empty>
              )}
              <div className="mt-6 flex items-center gap-2 text-xs text-fuchsia-700">
                <History className="h-3 w-3" aria-hidden />
                <span>Federation event log surfaces in the Mesh lens (lenses/mesh).</span>
              </div>
            </Section>
          )}
        </AnimatePresence>
      </main>
    </div>
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
