'use client';

/**
 * Cartograph-backed System lens panels (overview / heartbeats / gaps /
 * coverage / drift). Extracted from system/page.tsx.
 */

import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Database, Globe, Heart, Layers, BookOpen, Zap, AlertTriangle,
  CheckCircle2, Loader2, RefreshCw,
} from 'lucide-react';
import {
  useSystemCartograph, StatCard, GapCard, CoverageBadge, EmptyHint, intervalLabel,
} from '@/components/system/cartographShared';

function CartographGate({ children }: { children: (ctx: ReturnType<typeof useSystemCartograph> & { data: NonNullable<ReturnType<typeof useSystemCartograph>['data']> }) => ReactNode }) {
  const ctx = useSystemCartograph();
  const { data, isLoading, isError, error, handleRefresh } = ctx;

  if (isLoading && !data) {
    return (
      <div
        data-testid="system-overview-loading"
        role="status"
        aria-busy="true"
        className="flex min-h-[40vh] items-center justify-center text-cyan-400"
      >
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}>
          <Loader2 className="h-8 w-8" aria-label="Loading cartographer data" />
        </motion.div>
        <span className="ml-3 font-mono text-sm">Reading SYSTEMS.json…</span>
      </div>
    );
  }

  if (isError || !data) {
    const reason = (error as Error)?.message ?? 'cartograph_unavailable';
    const isStale = reason === 'cartograph_not_run';
    return (
      <div className="flex min-h-[40vh] items-center justify-center px-6">
        <motion.div
          data-testid="system-overview-error"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-lg rounded-lg border border-yellow-500/40 bg-yellow-950/20 p-6 text-yellow-200"
          role="alert"
        >
          <AlertTriangle className="mb-3 h-6 w-6" aria-hidden />
          <h2 className="mb-2 text-lg font-semibold">
            {isStale ? 'Cartographer not yet run' : 'Cartograph unavailable'}
          </h2>
          <p className="mb-4 text-sm text-yellow-300/80">
            {isStale
              ? 'Run npm run cartograph:static from the server directory to generate audit/cartograph/SYSTEMS.json. The System Lens reads from that file.'
              : `Reason: ${reason}`}
          </p>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-2 rounded border border-yellow-500/50 bg-yellow-500/10 px-3 py-1.5 text-sm font-medium hover:bg-yellow-500/20 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry
          </button>
        </motion.div>
      </div>
    );
  }

  return <>{children({ ...ctx, data })}</>;
}

export function OverviewPanel() {
  return (
    <CartographGate>
      {({ data, coveragePct }) => (
        <section aria-labelledby="overview-heading">
          <h2 id="overview-heading" className="sr-only">Overview</h2>
          {data.stats.tableCount === 0
            && data.stats.routeCount === 0
            && data.stats.macroCount === 0
            && data.stats.lensCount === 0 ? (
            <div
              data-testid="system-overview-empty"
              className="rounded-lg border border-cyan-900/30 bg-cyan-950/10 px-4 py-10 text-center text-sm text-cyan-600"
            >
              No cartograph data yet. Run <code className="text-cyan-400">npm run cartograph:static</code> to inventory the monolith.
            </div>
          ) : (
          <>
          <div data-testid="system-overview-grid" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            <StatCard label="Tables" value={data.stats.tableCount} sub={`${data.stats.deadTableCount} dead`} icon={Database} />
            <StatCard label="Routes" value={data.stats.routeCount} icon={Globe} />
            <StatCard label="Macros" value={data.stats.macroCount} sub={`${data.stats.macroDomainCount} domains`} icon={Zap} />
            <StatCard label="Heartbeats" value={data.stats.heartbeatCount} icon={Heart} />
            <StatCard label="Lenses" value={data.stats.lensCount} icon={BookOpen} />
            <StatCard label="Modules" value={data.stats.moduleCount} icon={Layers} />
            <StatCard label="Dormant" value={data.stats.dormantModuleCount} sub="modules without heartbeat or macros" icon={AlertTriangle} tone={data.stats.dormantModuleCount > 0 ? 'warn' : 'ok'} />
            <StatCard label="Coverage" value={`${coveragePct}%`} sub={`${data.stats.coveragePresent}/${data.stats.coverageInScope} categories`} icon={CheckCircle2} tone={coveragePct >= 90 ? 'ok' : coveragePct >= 70 ? 'warn' : 'bad'} />
          </div>

          <div className="mt-6 rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-4">
            <h3 className="mb-2 text-sm font-semibold text-cyan-300">Cartographer status</h3>
            <dl className="grid grid-cols-1 gap-1 text-xs text-cyan-500 md:grid-cols-2">
              <div><dt className="inline text-cyan-700">Runtime introspect:</dt> <dd className="inline">{data.runtime.booted ? <span className="text-emerald-400">booted</span> : <span className="text-yellow-400">{data.runtime.reason ?? 'static-only'}</span>}</dd></div>
              <div><dt className="inline text-cyan-700">Headless backends:</dt> <dd className="inline">{data.crossRef.headlessBackends.length}</dd></div>
              <div><dt className="inline text-cyan-700">Orphan lenses:</dt> <dd className="inline">{data.crossRef.orphanLenses.length}</dd></div>
              <div><dt className="inline text-cyan-700">Drift entries:</dt> <dd className="inline">{data.drift.length}</dd></div>
            </dl>
          </div>
          </>
          )}
        </section>
      )}
    </CartographGate>
  );
}

export function HeartbeatsInventoryPanel() {
  return (
    <CartographGate>
      {({ heartbeats }) => (
        <section aria-labelledby="heartbeats-heading">
          <h2 id="heartbeats-heading" className="mb-3 text-base font-semibold text-cyan-200">
            Heartbeat-registered modules
          </h2>
          {heartbeats.length === 0 ? (
            <EmptyHint text="No heartbeats found. Cartographer may need a fresh run." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-cyan-900/40">
              <table className="w-full font-mono text-xs">
                <thead className="bg-cyan-950/40 text-cyan-400">
                  <tr>
                    <th className="px-3 py-2 text-left">ID</th>
                    <th className="px-3 py-2 text-right">Frequency</th>
                    <th className="px-3 py-2 text-right">Approx interval</th>
                  </tr>
                </thead>
                <tbody>
                  {heartbeats.map(hb => (
                    <tr key={hb.id} className="border-t border-cyan-900/20 hover:bg-cyan-950/20">
                      <td className="px-3 py-2 text-cyan-200">{hb.id}</td>
                      <td className="px-3 py-2 text-right text-cyan-500">{hb.frequency}</td>
                      <td className="px-3 py-2 text-right text-cyan-700">{intervalLabel(hb.frequency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </CartographGate>
  );
}

export function GapsPanel() {
  return (
    <CartographGate>
      {({ data }) => (
        <section>
          <h2 className="mb-3 text-base font-semibold text-cyan-200">Wire-the-Lost candidates</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <GapCard
              title="Dormant modules"
              count={data.crossRef.dormantModules.length}
              rows={data.crossRef.dormantModules.slice(0, 20).map(m => ({ key: m.id, primary: m.id, secondary: `${m.subsystem ?? '-'} · importedBy ${m.importedBy}` }))}
            />
            <GapCard
              title="Headless backend domains"
              count={data.crossRef.headlessBackends.length}
              rows={data.crossRef.headlessBackends.slice(0, 20).map(h => ({ key: h.domain, primary: h.domain, secondary: `${h.macroCount} macros — needs UI lens` }))}
            />
            <GapCard
              title="Orphan lens dirs"
              count={data.crossRef.orphanLenses.length}
              rows={data.crossRef.orphanLenses.slice(0, 20).map(o => ({ key: o.frontendDir, primary: o.frontendDir, secondary: o.reason }))}
            />
            <GapCard
              title="Dead tables"
              count={data.crossRef.deadTables.length}
              rows={data.crossRef.deadTables.slice(0, 20).map(d => ({ key: d.name, primary: d.name, secondary: d.migration }))}
            />
          </div>
        </section>
      )}
    </CartographGate>
  );
}

export function CoveragePanel() {
  const [coverageFilter, setCoverageFilter] = useState<'all' | 'present' | 'partial' | 'missing'>('all');
  return (
    <CartographGate>
      {({ data }) => {
        const filteredCoverage = data.coverage.filter(c => {
          if (c.scope !== 'in') return false;
          if (coverageFilter !== 'all' && c.status !== coverageFilter) return false;
          return true;
        });
        return (
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-cyan-200">Software-universe coverage</h2>
              <div className="flex gap-1 rounded border border-cyan-900/40 bg-cyan-950/20 p-0.5 text-xs">
                {(['all', 'present', 'partial', 'missing'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setCoverageFilter(f)}
                    className={`rounded px-2 py-1 ${coverageFilter === f ? 'bg-cyan-700/30 text-cyan-200' : 'text-cyan-600 hover:text-cyan-400'}`}
                    aria-pressed={coverageFilter === f}
                  >{f}</button>
                ))}
              </div>
            </div>
            {filteredCoverage.length === 0 ? (
              <EmptyHint text="No categories match the current filter." />
            ) : (
              <ul className="space-y-1.5">
                {filteredCoverage.map(c => (
                  <li key={c.category} className="flex items-center gap-3 rounded border border-cyan-900/30 bg-cyan-950/10 px-3 py-2 text-sm">
                    <CoverageBadge status={c.status} />
                    <span className="font-mono text-cyan-200">{c.category}</span>
                    {c.priority != null && <span className="rounded bg-cyan-700/20 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300">P{c.priority}</span>}
                    <span className="ml-auto text-xs text-cyan-600">
                      {c.proposedTargetLens ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      }}
    </CartographGate>
  );
}

export function DriftPanelView() {
  return (
    <CartographGate>
      {({ data }) => (
        <section>
          <h2 className="mb-3 text-base font-semibold text-cyan-200">Comment-vs-truth drift</h2>
          {data.drift.length === 0 ? (
            <EmptyHint text="✓ No comment drifts detected. Documentation matches reality." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-yellow-700/40">
              <table className="w-full font-mono text-xs">
                <thead className="bg-yellow-950/30 text-yellow-300">
                  <tr>
                    <th className="px-3 py-2 text-left">File</th>
                    <th className="px-3 py-2 text-right">Line</th>
                    <th className="px-3 py-2 text-left">Claim</th>
                    <th className="px-3 py-2 text-right">Actual</th>
                    <th className="px-3 py-2 text-right">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.drift.map((d, i) => (
                    <tr key={`${d.file}:${d.line}:${i}`} className="border-t border-yellow-900/20 hover:bg-yellow-950/15">
                      <td className="px-3 py-2 text-cyan-300">{d.file}</td>
                      <td className="px-3 py-2 text-right text-cyan-600">{d.line}</td>
                      <td className="px-3 py-2 text-yellow-400">{d.claim}</td>
                      <td className="px-3 py-2 text-right text-emerald-400">{d.actual}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        <span className={d.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {d.delta > 0 ? '+' : ''}{d.delta}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </CartographGate>
  );
}
