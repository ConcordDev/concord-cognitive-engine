'use client';

/**
 * Worldmodel Lens — surfaces the counterfactual simulation engine
 * (16 macros, registered via Ghost Fleet, no UI until now).
 *
 * Phase 3.3 wire-the-Lost: market parallel = Anaplan / Tableau Forecasting /
 * Splunk ITSI. Concord's `worldmodel.simulate` + `.counterfactual` already
 * exists; this lens makes it driveable from the browser.
 *
 * Five tabs:
 *   - Status — counts of entities/relations/simulations/snapshots + config + invariants
 *   - Entities — list/create/inspect entities with attached relations
 *   - Relations — list relations
 *   - Simulate — run a forward simulation; counterfactual variants
 *   - Snapshots — capture/list world-state snapshots
 */
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe2, Loader2, Plus, Play, Camera,
  Network, Boxes, GitFork,
  type LucideIcon,
} from 'lucide-react';

type TabKey = 'status' | 'entities' | 'relations' | 'simulate' | 'snapshots';

export default function WorldmodelLensPage() {
  useLensNav('worldmodel');
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('status');


  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-status', keys: 's', description: 'Status', category: 'navigation', action: () => setActiveTab('status') },
      { id: 'tab-entities', keys: 'e', description: 'Entities', category: 'navigation', action: () => setActiveTab('entities') },
      { id: 'tab-relations', keys: 'r', description: 'Relations', category: 'navigation', action: () => setActiveTab('relations') },
      { id: 'tab-simulate', keys: 'i', description: 'Simulate', category: 'navigation', action: () => setActiveTab('simulate') },
      { id: 'tab-snapshots', keys: 'n', description: 'Snapshots', category: 'navigation', action: () => setActiveTab('snapshots') },
    ],
    { lensId: 'worldmodel' }
  );
  // ── Status ─────────────────────────────────────────────────────────────
  const status = useQuery({
    queryKey: ['worldmodel-status'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('worldmodel', 'status', {});
      return (r.data?.result ?? r.data) as {
        ok: boolean; entities?: number; relations?: number;
        simulations?: number; snapshots?: number;
        stats?: Record<string, unknown>; config?: Record<string, unknown>;
        invariants?: unknown[];
      };
    },
    refetchInterval: 30_000,
  });

  // ── Entities ──────────────────────────────────────────────────────────
  const entities = useQuery({
    queryKey: ['worldmodel-entities'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('worldmodel', 'list_entities', { limit: 100 });
      return (r.data?.result ?? r.data) as { entities?: Array<{ id: string; type?: string; name?: string }> };
    },
  });

  const [newEntityName, setNewEntityName] = useState('');
  const [newEntityType, setNewEntityType] = useState('concept');
  const createEntity = useMutation({
    mutationFn: async () => {
      const r = await apiHelpers.lens.runDomain('worldmodel', 'create_entity', {
        name: newEntityName, type: newEntityType,
      });
      return r.data?.result ?? r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worldmodel-entities'] });
      qc.invalidateQueries({ queryKey: ['worldmodel-status'] });
      setNewEntityName('');
    },
  });

  // ── Relations ─────────────────────────────────────────────────────────
  const relations = useQuery({
    queryKey: ['worldmodel-relations'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('worldmodel', 'list_relations', { limit: 100 });
      return (r.data?.result ?? r.data) as { relations?: Array<{ id: string; from: string; to: string; type: string }> };
    },
  });

  // ── Simulate / Counterfactual ─────────────────────────────────────────
  const [simulateInput, setSimulateInput] = useState('{\n  "scenario": "growth",\n  "steps": 5\n}');
  const [simulateResult, setSimulateResult] = useState<unknown>(null);
  const [simulateMode, setSimulateMode] = useState<'simulate' | 'counterfactual'>('simulate');

  const runSimulate = useMutation({
    mutationFn: async () => {
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(simulateInput); }
      catch { throw new Error('Invalid JSON'); }
      const r = await apiHelpers.lens.runDomain('worldmodel', simulateMode, parsed);
      return r.data?.result ?? r.data;
    },
    onSuccess: (data) => setSimulateResult(data),
    onError: (err) => setSimulateResult({ error: (err as Error).message }),
  });

  const simulations = useQuery({
    queryKey: ['worldmodel-sims'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('worldmodel', 'list_simulations', { limit: 20 });
      return (r.data?.result ?? r.data) as { simulations?: Array<{ id: string; mode?: string; createdAt?: string }> };
    },
  });

  // ── Snapshots ─────────────────────────────────────────────────────────
  const snapshots = useQuery({
    queryKey: ['worldmodel-snapshots'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('worldmodel', 'list_snapshots', {});
      return (r.data?.result ?? r.data) as { snapshots?: Array<{ id: string; capturedAt?: string; entityCount?: number }> };
    },
  });

  const captureSnapshot = useMutation({
    mutationFn: async () => {
      const r = await apiHelpers.lens.runDomain('worldmodel', 'snapshot', { label: `manual-${Date.now()}` });
      return r.data?.result ?? r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['worldmodel-snapshots'] }),
  });

  const tabs: { key: TabKey; label: string; icon: LucideIcon; count?: number }[] = [
    { key: 'status', label: 'Status', icon: Globe2 },
    { key: 'entities', label: 'Entities', icon: Boxes, count: entities.data?.entities?.length },
    { key: 'relations', label: 'Relations', icon: Network, count: relations.data?.relations?.length },
    { key: 'simulate', label: 'Simulate', icon: Play, count: simulations.data?.simulations?.length },
    { key: 'snapshots', label: 'Snapshots', icon: Camera, count: snapshots.data?.snapshots?.length },
  ];

  return (
    <LensShell lensId="worldmodel" asMain={false}>
      <ManifestActionBar />
    <div className="min-h-screen bg-black pb-12 text-emerald-50">
      <header className="sticky top-0 z-10 border-b border-emerald-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Globe2 className="h-6 w-6 text-emerald-400" aria-hidden />
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-wide">Worldmodel</h1>
            <p className="text-xs text-emerald-700">Counterfactual simulation engine · entities, relations, snapshots, what-ifs</p>
          </div>
        </div>
      </header>

      <nav className="border-b border-emerald-900/30 px-4 md:px-8" aria-label="Worldmodel sections">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400 ${
                activeTab === key ? 'border-emerald-400 text-emerald-200' : 'border-transparent text-emerald-700 hover:text-emerald-400'
              }`}
              aria-pressed={activeTab === key}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              {count != null && <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300">{count}</span>}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <AnimatePresence mode="wait">
          {activeTab === 'status' && (
            <motion.section key="status" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              {status.isLoading && <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />}
              {status.data && (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Stat label="Entities" value={status.data.entities ?? 0} icon={Boxes} />
                    <Stat label="Relations" value={status.data.relations ?? 0} icon={Network} />
                    <Stat label="Simulations" value={status.data.simulations ?? 0} icon={Play} />
                    <Stat label="Snapshots" value={status.data.snapshots ?? 0} icon={Camera} />
                  </div>
                  {status.data.invariants && Array.isArray(status.data.invariants) && status.data.invariants.length > 0 && (
                    <div className="mt-6 rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-4">
                      <h3 className="mb-2 text-sm font-semibold text-emerald-300">Invariants</h3>
                      <ul className="space-y-1 text-xs text-emerald-500">
                        {status.data.invariants.map((inv, i) => (
                          <li key={i} className="font-mono">{typeof inv === 'string' ? inv : JSON.stringify(inv)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {status.data.config && (
                    <details className="mt-4 rounded border border-emerald-900/30 bg-emerald-950/10">
                      <summary className="cursor-pointer px-3 py-2 text-xs text-emerald-400">Config</summary>
                      <pre className="overflow-auto p-3 font-mono text-[11px] text-emerald-500">{JSON.stringify(status.data.config, null, 2)}</pre>
                    </details>
                  )}
                </>
              )}
            </motion.section>
          )}

          {activeTab === 'entities' && (
            <motion.section key="entities" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <div className="mb-4 rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-4">
                <h3 className="mb-2 text-sm font-semibold text-emerald-300">Create entity</h3>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={newEntityName}
                    onChange={(e) => setNewEntityName(e.target.value)}
                    placeholder="Entity name"
                    className="flex-1 min-w-32 rounded border border-emerald-900/40 bg-black/40 px-2 py-1.5 font-mono text-sm text-emerald-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    aria-label="New entity name"
                  />
                  <input
                    type="text"
                    value={newEntityType}
                    onChange={(e) => setNewEntityType(e.target.value)}
                    placeholder="type"
                    className="w-24 rounded border border-emerald-900/40 bg-black/40 px-2 py-1.5 font-mono text-sm text-emerald-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    aria-label="Entity type"
                  />
                  <button
                    onClick={() => createEntity.mutate()}
                    disabled={!newEntityName || createEntity.isPending}
                    className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  >
                    {createEntity.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Create
                  </button>
                </div>
                {createEntity.isError && <p className="mt-2 text-xs text-rose-400">{(createEntity.error as Error).message}</p>}
              </div>

              {entities.isLoading && <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />}
              {(entities.data?.entities ?? []).length === 0 && !entities.isLoading && (
                <p className="text-xs text-emerald-700">No entities yet — create one above.</p>
              )}
              <ul className="space-y-1">
                {(entities.data?.entities ?? []).slice(0, 50).map(e => (
                  <li key={e.id} className="flex items-center gap-3 rounded border border-emerald-900/30 bg-emerald-950/10 px-3 py-2 text-xs">
                    <Boxes className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                    <span className="font-mono text-emerald-300">{e.id}</span>
                    {e.name && <span className="text-emerald-100">{e.name}</span>}
                    {e.type && <span className="ml-auto rounded bg-emerald-800/30 px-1.5 py-0.5 text-[10px] text-emerald-300">{e.type}</span>}
                  </li>
                ))}
              </ul>
            </motion.section>
          )}

          {activeTab === 'relations' && (
            <motion.section key="relations" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              {relations.isLoading && <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />}
              {(relations.data?.relations ?? []).length === 0 && !relations.isLoading && (
                <p className="text-xs text-emerald-700">No relations yet. Use entities tab to create entities, then relate them via the API.</p>
              )}
              <ul className="space-y-1">
                {(relations.data?.relations ?? []).slice(0, 50).map(r => (
                  <li key={r.id} className="flex items-center gap-3 rounded border border-emerald-900/30 bg-emerald-950/10 px-3 py-2 text-xs">
                    <GitFork className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                    <span className="font-mono text-emerald-300">{r.from}</span>
                    <span className="rounded bg-emerald-700/30 px-1.5 py-0.5 text-[10px]">{r.type}</span>
                    <span className="font-mono text-emerald-300">{r.to}</span>
                  </li>
                ))}
              </ul>
            </motion.section>
          )}

          {activeTab === 'simulate' && (
            <motion.section key="simulate" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-emerald-300">Run a {simulateMode === 'simulate' ? 'forward simulation' : 'counterfactual branch'}</h3>
                  <div className="ml-auto flex gap-1 rounded border border-emerald-900/40 bg-emerald-950/30 p-0.5 text-xs">
                    <button onClick={() => setSimulateMode('simulate')} aria-pressed={simulateMode === 'simulate'} className={`rounded px-2 py-1 ${simulateMode === 'simulate' ? 'bg-emerald-700/40 text-emerald-100' : 'text-emerald-600 hover:text-emerald-400'}`}>simulate</button>
                    <button onClick={() => setSimulateMode('counterfactual')} aria-pressed={simulateMode === 'counterfactual'} className={`rounded px-2 py-1 ${simulateMode === 'counterfactual' ? 'bg-emerald-700/40 text-emerald-100' : 'text-emerald-600 hover:text-emerald-400'}`}>counterfactual</button>
                  </div>
                </div>
                <label className="block text-xs uppercase tracking-wider text-emerald-700" htmlFor="sim-input">Input JSON</label>
                <textarea
                  id="sim-input"
                  value={simulateInput}
                  onChange={(e) => setSimulateInput(e.target.value)}
                  className="mt-1.5 h-32 w-full rounded border border-emerald-900/40 bg-black/40 p-2 font-mono text-xs text-emerald-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => runSimulate.mutate()}
                    disabled={runSimulate.isPending}
                    className="inline-flex items-center gap-2 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  >
                    {runSimulate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run
                  </button>
                </div>
                {simulateResult != null && (
                  <motion.pre initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 max-h-80 overflow-auto rounded border border-emerald-900/40 bg-black/60 p-3 font-mono text-[11px] text-emerald-300">
                    {JSON.stringify(simulateResult, null, 2)}
                  </motion.pre>
                )}
              </div>

              <h3 className="mt-6 mb-2 text-sm font-semibold text-emerald-300">Recent simulations</h3>
              {(simulations.data?.simulations ?? []).length === 0 ? (
                <p className="text-xs text-emerald-700">No simulations yet.</p>
              ) : (
                <ul className="space-y-1">
                  {(simulations.data?.simulations ?? []).slice(0, 20).map(s => (
                    <li key={s.id} className="flex items-center gap-3 rounded border border-emerald-900/30 bg-emerald-950/10 px-3 py-2 text-xs">
                      <Play className="h-3 w-3 text-emerald-500" aria-hidden />
                      <span className="font-mono text-emerald-300">{s.id}</span>
                      {s.mode && <span className="rounded bg-emerald-800/30 px-1.5 py-0.5 text-[10px] text-emerald-300">{s.mode}</span>}
                      {s.createdAt && <span className="ml-auto text-[10px] text-emerald-700">{new Date(s.createdAt).toLocaleString()}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </motion.section>
          )}

          {activeTab === 'snapshots' && (
            <motion.section key="snapshots" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-emerald-300">World-state snapshots</h3>
                <button
                  onClick={() => captureSnapshot.mutate()}
                  disabled={captureSnapshot.isPending}
                  className="inline-flex items-center gap-2 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                >
                  {captureSnapshot.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />} Capture now
                </button>
              </div>
              {(snapshots.data?.snapshots ?? []).length === 0 ? (
                <p className="text-xs text-emerald-700">No snapshots yet — capture one above to seed.</p>
              ) : (
                <ul className="space-y-1">
                  {(snapshots.data?.snapshots ?? []).map(s => (
                    <li key={s.id} className="flex items-center gap-3 rounded border border-emerald-900/30 bg-emerald-950/10 px-3 py-2 text-xs">
                      <Camera className="h-3 w-3 text-emerald-500" aria-hidden />
                      <span className="font-mono text-emerald-300">{s.id}</span>
                      {s.entityCount != null && <span className="text-emerald-500">{s.entityCount} entities</span>}
                      {s.capturedAt && <span className="ml-auto text-[10px] text-emerald-700">{new Date(s.capturedAt).toLocaleString()}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
    
      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
    </LensShell>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number | string; icon: LucideIcon }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className="rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3 text-emerald-200"
    >
      <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-emerald-700">
        <span>{label}</span><Icon className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </motion.div>
  );
}
