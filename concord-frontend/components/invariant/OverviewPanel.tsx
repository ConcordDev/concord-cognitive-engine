'use client';

/**
 * OverviewPanel — enforcement meters + live verification activity
 * (listMonitors / violationHistory). Extracted from invariant/page.tsx.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, CheckCircle2, AlertTriangle, BarChart3, Gauge, Layers, Lock, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import type { Invariant } from './invariant-types';

export function OverviewPanel() {
  const { items: invariantItems } = useLensData<Invariant>('invariant', 'invariant', { seed: [] });
  const invariants: Invariant[] = invariantItems.map((item) => {
    const d = item.data as unknown as Invariant;
    return {
      id: item.id,
      name: d.name ?? item.title,
      description: d.description ?? '',
      status: d.status ?? 'enforced',
      category: d.category ?? 'ethos',
      frozen: d.frozen ?? true,
    };
  });
  const enforcedCount = invariants.filter((i) => i.status === 'enforced').length;

  const [wbSummary, setWbSummary] = useState<{ monitorsActive: number; monitorsTotal: number; violationsOpen: number; violationsCritHigh: number } | null>(null);
  const [wbSummaryLoading, setWbSummaryLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [monRes, vioRes] = await Promise.all([
          lensRun<{ summary?: { total: number; active: number; violating: number } }>('invariant', 'listMonitors', {}),
          lensRun<{ summary?: { open: number; critical: number; high: number } }>('invariant', 'violationHistory', { resolved: false }),
        ]);
        if (cancelled) return;
        const mon = monRes.data?.result?.summary;
        const vio = vioRes.data?.result?.summary;
        if (mon || vio) {
          setWbSummary({
            monitorsActive: mon?.active ?? 0,
            monitorsTotal: mon?.total ?? 0,
            violationsOpen: vio?.open ?? 0,
            violationsCritHigh: (vio?.critical ?? 0) + (vio?.high ?? 0),
          });
        }
      } catch (e) {
        console.error('[Invariant] Failed to load verification activity summary:', e);
      } finally {
        if (!cancelled) setWbSummaryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <div className="sovereignty-lock lock-70 px-4 py-2 rounded-lg">
          <span className="text-lg font-bold text-sovereignty-locked">
            {enforcedCount}/{invariants.length}
          </span>
          <span className="text-sm ml-2 text-gray-400">Enforced</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Shield className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">{invariants.length}</p>
            <p className="text-xs text-gray-400">Rules Total</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-neon-cyan" />
          <div>
            <p className="text-lg font-bold">{enforcedCount}</p>
            <p className="text-xs text-gray-400">Passing</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-500" />
          <div>
            <p className="text-lg font-bold">{invariants.filter(i => i.status === 'violated').length}</p>
            <p className="text-xs text-gray-400">Violations</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-neon-purple" />
          <div>
            <p className="text-lg font-bold">{invariants.length > 0 ? `${((invariants.filter(i => i.status === 'violated').length / invariants.length) * 100).toFixed(1)}%` : '0%'}</p>
            <p className="text-xs text-gray-400">Violation Rate</p>
          </div>
        </motion.div>
      </div>

      <div className="panel p-4 border-l-4 border-sovereignty-locked">
        <h3 className="font-semibold text-sovereignty-locked mb-2 flex items-center gap-2">
          <Lock className="w-4 h-4" />
          Sovereignty Lock Active
        </h3>
        <p className="text-sm text-gray-400">
          All invariants are frozen at 70% sovereignty lock. They cannot be disabled
          or modified without full council approval and structural verification.
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
              <h3 className="text-sm font-semibold">Enforcement Rate</h3>
            </div>
            <div className="flex items-center justify-center my-4">
              <div className="relative w-28 h-28">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-lattice-void" />
                  <circle
                    cx="50" cy="50" r="42" fill="none" strokeWidth="6"
                    className="text-neon-green"
                    stroke="currentColor"
                    strokeDasharray={`${(enforcedCount / Math.max(invariants.length, 1)) * 264} 264`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-neon-green">
                    {invariants.length > 0 ? `${Math.round((enforcedCount / invariants.length) * 100)}%` : '—'}
                  </span>
                  <span className="text-[10px] text-gray-400">{invariants.length > 0 ? 'enforced' : 'no invariants yet'}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <p className="text-neon-green font-bold">{enforcedCount}</p>
                <p className="text-gray-400">Active</p>
              </div>
              <div>
                <p className="text-yellow-500 font-bold">{invariants.filter(i => i.status === 'warning').length}</p>
                <p className="text-gray-400">Warning</p>
              </div>
              <div>
                <p className="text-neon-pink font-bold">{invariants.filter(i => i.status === 'violated').length}</p>
                <p className="text-gray-400">Violated</p>
              </div>
            </div>
          </div>

          <div className="bg-lattice-deep rounded-lg p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-3">
              <Layers className="w-4 h-4 text-neon-purple" />
              <h3 className="text-sm font-semibold">By Category</h3>
            </div>
            {invariants.length === 0 ? (
              <p className="text-xs text-gray-400">No invariants authored yet — categories populate once one exists.</p>
            ) : (
              <div className="space-y-3">
                {(['ethos', 'structural', 'capability'] as const).map((cat) => {
                  const total = invariants.filter((i) => i.category === cat).length;
                  const pct = Math.round((total / invariants.length) * 100);
                  return (
                    <div key={cat}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-400 capitalize">{cat}</span>
                        <span className="text-xs font-mono text-gray-300">{total} ({pct}%)</span>
                      </div>
                      <div className="h-1 bg-lattice-void rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-neon-purple" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs">
                  <span className="text-gray-400">Frozen (locked)</span>
                  <span className="font-mono text-gray-300">{invariants.filter((i) => i.frozen).length} / {invariants.length}</span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-lattice-deep rounded-lg p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-3">
              <Gauge className="w-4 h-4 text-neon-cyan" />
              <h3 className="text-sm font-semibold">Live Verification Activity</h3>
            </div>
            {wbSummaryLoading ? (
              <p className="text-xs text-gray-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</p>
            ) : wbSummary ? (
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Continuous monitors</span>
                  <span className="font-mono text-gray-200">{wbSummary.monitorsActive} active / {wbSummary.monitorsTotal} total</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Open violations</span>
                  <span className={`font-mono ${wbSummary.violationsOpen > 0 ? 'text-neon-pink' : 'text-neon-green'}`}>{wbSummary.violationsOpen}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Critical / high</span>
                  <span className={`font-mono ${wbSummary.violationsCritHigh > 0 ? 'text-red-400' : 'text-neon-green'}`}>{wbSummary.violationsCritHigh}</span>
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
