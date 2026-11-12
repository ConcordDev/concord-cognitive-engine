'use client';

/**
 * OverviewPanel — S-INV-1: every figure on this panel derives from the
 * MONITOR store (listMonitors + violationHistory) at read time. The
 * previous version computed its headlines over the authored ethos sets,
 * so deleting a monitor left the dashboard reporting it as enforced and
 * passing — figures describing a system that no longer exists.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, CheckCircle2, AlertTriangle, BarChart3, Gauge, Layers, Lock, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface MonitorSummary { total: number; active: number; violating: number }
interface ViolationSummary { total: number; open: number; resolved: number; critical: number; high: number; medium: number; low: number }

export function OverviewPanel() {
  const [mon, setMon] = useState<MonitorSummary | null>(null);
  const [vio, setVio] = useState<ViolationSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [monRes, vioRes] = await Promise.all([
          lensRun<{ summary?: MonitorSummary }>('invariant', 'listMonitors', {}),
          lensRun<{ summary?: ViolationSummary }>('invariant', 'violationHistory', {}),
        ]);
        if (cancelled) return;
        setMon(monRes.data?.result?.summary ?? null);
        setVio(vioRes.data?.result?.summary ?? null);
      } catch (e) {
        console.error('[Invariant] Failed to load overview:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const total = mon?.total ?? 0;
  const active = mon?.active ?? 0;
  const violating = mon?.violating ?? 0;
  const open = vio?.open ?? 0;
  const activePct = total > 0 ? Math.round((active / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <div className="sovereignty-lock lock-70 px-4 py-2 rounded-lg">
          <span className="text-lg font-bold text-sovereignty-locked">
            {active}/{total}
          </span>
          <span className="text-sm ml-2 text-gray-400">Monitors active</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Shield, cls: 'text-neon-green', value: total, label: 'Monitors' },
          { icon: CheckCircle2, cls: 'text-neon-cyan', value: active, label: 'Active' },
          { icon: AlertTriangle, cls: 'text-yellow-500', value: violating, label: 'Violating at last check' },
          { icon: BarChart3, cls: 'text-neon-purple', value: open, label: 'Open violations' },
        ].map((tile, i) => (
          <motion.div key={tile.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="panel p-3 flex items-center gap-3">
            <tile.icon className={`w-5 h-5 ${tile.cls}`} />
            <div>
              <p className="text-lg font-bold">{loading ? '—' : tile.value}</p>
              <p className="text-xs text-gray-400">{tile.label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* S-INV-3 interim honesty: the lock the banner used to claim does
          not exist. Until an approval mechanism actually guards monitor
          changes, the banner states the actual behaviour. */}
      <div className="panel p-4 border-l-4 border-yellow-500/60">
        <h2 className="font-semibold text-yellow-200/90 mb-2 flex items-center gap-2">
          <Lock className="w-4 h-4" />
          Sovereignty Lock — not in force
        </h2>
        <p className="text-sm text-gray-400">
          This panel previously claimed invariants cannot be disabled or modified without full council
          approval and structural verification. No such gate exists: your monitors are yours to pause,
          edit, and remove (removal asks first, and says what happens to their violations). When an
          approval mechanism actually guards them, this banner will say so — and not before.
        </p>
      </div>

      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-neon-cyan" />
          System Invariants Dashboard
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="bg-lattice-deep rounded-lg p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-neon-green" />
              <h3 className="text-sm font-semibold">Monitors Active</h3>
            </div>
            <div className="flex items-center justify-center my-4">
              <div className="relative w-28 h-28">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-lattice-void" />
                  <circle
                    cx="50" cy="50" r="42" fill="none" strokeWidth="6"
                    className="text-neon-green"
                    stroke="currentColor"
                    strokeDasharray={`${(activePct / 100) * 264} 264`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-neon-green">
                    {total > 0 ? `${activePct}%` : '—'}
                  </span>
                  <span className="text-[10px] text-gray-400">{total > 0 ? 'of monitors active' : 'no monitors yet'}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <p className="text-neon-green font-bold">{active}</p>
                <p className="text-gray-400">Active</p>
              </div>
              <div>
                <p className="text-yellow-500 font-bold">{total - active}</p>
                <p className="text-gray-400">Paused</p>
              </div>
              <div>
                <p className="text-neon-pink font-bold">{violating}</p>
                <p className="text-gray-400">Violating</p>
              </div>
            </div>
          </div>

          <div className="bg-lattice-deep rounded-lg p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-3">
              <Layers className="w-4 h-4 text-neon-purple" />
              <h3 className="text-sm font-semibold">Open Violations by Severity</h3>
            </div>
            {open === 0 ? (
              <p className="text-xs text-gray-400">No open violations — severity counts populate when a check fails.</p>
            ) : (
              <div className="space-y-3">
                {([
                  ['critical', vio?.critical ?? 0],
                  ['high', vio?.high ?? 0],
                  ['medium', vio?.medium ?? 0],
                  ['low', vio?.low ?? 0],
                ] as const).map(([sev, count]) => {
                  const pct = open > 0 ? Math.round((count / open) * 100) : 0;
                  return (
                    <div key={sev}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-400 capitalize">{sev}</span>
                        <span className="text-xs font-mono text-gray-300">{count} ({pct}%)</span>
                      </div>
                      <div className="h-1 bg-lattice-void rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-neon-purple" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs">
                  <span className="text-gray-400">Resolved violations</span>
                  <span className="font-mono text-gray-300">{vio?.resolved ?? 0} / {vio?.total ?? 0}</span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-lattice-deep rounded-lg p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-3">
              <Gauge className="w-4 h-4 text-neon-cyan" />
              <h3 className="text-sm font-semibold">Live Verification Activity</h3>
            </div>
            {loading ? (
              <p className="text-xs text-gray-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</p>
            ) : mon ? (
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Continuous monitors</span>
                  <span className="font-mono text-gray-200">{active} active / {total} total</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Open violations</span>
                  <span className={`font-mono ${open > 0 ? 'text-neon-pink' : 'text-neon-green'}`}>{open}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Critical / high</span>
                  <span className={`font-mono ${((vio?.critical ?? 0) + (vio?.high ?? 0)) > 0 ? 'text-red-400' : 'text-neon-green'}`}>{(vio?.critical ?? 0) + (vio?.high ?? 0)}</span>
                </div>
                <p className="pt-2 border-t border-white/5 text-[10px] text-gray-500">
                  Register monitors + inspect history in the Formal Verification Workbench.
                </p>
              </div>
            ) : (
              <p className="text-xs text-gray-400">No monitors registered yet — start one in the Formal Verification Workbench.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
