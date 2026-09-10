'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Lock, Zap, BarChart3, XCircle, Loader2, Fingerprint, ShieldAlert,
  Waves, AlertTriangle, CheckCircle, MessageSquare, Database, Plus, Trash2, Sparkles,
} from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { TorNetworkStatus } from '@/components/anon/TorNetworkStatus';
import { AnonMessenger } from '@/components/anon/AnonMessenger';
import { PrivacyBudgetPanel } from '@/components/anon/PrivacyBudgetPanel';

interface PrivacyRecord { age: number; zipcode: string; condition: string }

// A canonical HIPAA-Safe-Harbor-style teaching dataset (age/zip/diagnosis
// quasi-identifiers over a small population) — the standard illustration
// used in k-anonymity literature. Clearly an example, not live user data;
// it exists so the privacy-compute actions below have something real to
// operate on before a user pastes in their own rows.
const EXAMPLE_RECORDS: PrivacyRecord[] = [
  { age: 28, zipcode: '94110', condition: 'Flu' },
  { age: 29, zipcode: '94110', condition: 'Flu' },
  { age: 31, zipcode: '94112', condition: 'Migraine' },
  { age: 34, zipcode: '94112', condition: 'Asthma' },
  { age: 42, zipcode: '94115', condition: 'Diabetes' },
  { age: 45, zipcode: '94115', condition: 'Diabetes' },
  { age: 45, zipcode: '94117', condition: 'Hypertension' },
  { age: 61, zipcode: '94117', condition: 'Arthritis' },
  { age: 63, zipcode: '94118', condition: 'Arthritis' },
  { age: 22, zipcode: '94103', condition: 'Flu' },
];

export default function AnonLensPage() {
  useLensNav('anon');
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } =
    useRealtimeLens('anon');

  // Privacy-compute dataset. anonymize/privacyRisk/differentialPrivacy need
  // structured record data — driven by a small real table editor here and
  // run directly via lensRun (the input becomes the macro's artifact.data),
  // rather than round-tripping through the unrelated generic artifact store.
  const [records, setRecords] = useState<PrivacyRecord[]>([]);
  const [newRecord, setNewRecord] = useState({ age: '', zipcode: '', condition: '' });
  const [epsilon, setEpsilon] = useState(1.0);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  // Bumped after every differentialPrivacy call so PrivacyBudgetPanel
  // re-fetches the real cross-session cumulative spend instead of showing a
  // stale snapshot from before the call.
  const [budgetRefreshKey, setBudgetRefreshKey] = useState(0);

  const addRecord = () => {
    const age = Number(newRecord.age);
    if (!Number.isFinite(age) || !newRecord.zipcode.trim()) return;
    setRecords((prev) => [...prev, { age, zipcode: newRecord.zipcode.trim(), condition: newRecord.condition.trim() || 'unspecified' }]);
    setNewRecord({ age: '', zipcode: '', condition: '' });
  };
  const loadExample = () => setRecords(EXAMPLE_RECORDS);
  const clearRecords = () => setRecords([]);

  // Lens-scoped keyboard commands.
  useLensCommand(
    [
      {
        id: 'run-anonymize',
        keys: 'mod+k',
        description: 'Run anonymize on the current dataset',
        category: 'actions',
        action: () => handleAnonAction('anonymize'),
      },
    ],
    { lensId: 'anon' },
  );

  const handleAnonAction = async (action: 'anonymize' | 'privacyRisk' | 'differentialPrivacy') => {
    if (records.length === 0) {
      setActionResult({ message: 'No records yet — load the example dataset or add a few rows first.' });
      return;
    }
    setIsRunning(action);
    try {
      const input = action === 'differentialPrivacy'
        ? { values: records.map((r) => r.age) }
        : { records, quasiIdentifiers: ['age', 'zipcode'], sensitiveFields: ['condition'] };
      const params = action === 'differentialPrivacy' ? { epsilon } : {};
      const res = await lensRun('anon', action, { ...input, ...params });
      if (res.data.ok === false) {
        setActionResult({ message: `Action failed: ${res.data.error || 'Unknown error'}` });
      } else {
        setActionResult(res.data.result as Record<string, unknown>);
      }
    } catch (e) {
      setActionResult({
        message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
      });
    }
    if (action === 'differentialPrivacy') {
      // Real budget was just spent (or a real short-circuit happened) —
      // tell the panel to refetch its real cumulative total.
      setBudgetRefreshKey((k) => k + 1);
    }
    setIsRunning(null);
  };

  return (
    <LensShell lensId="anon" asMain={false}>
      <FirstRunTour lensId="anon" />      <DepthBadge lensId="anon" size="sm" className="ml-2" />
      <LensVerticalHero lensId="anon" className="mx-6 mt-4" />
      <div data-lens-theme="anon" className="space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">👤</span>
            <div>
              <h1 className="text-xl font-bold">Anon Lens</h1>
              <p className="text-sm text-gray-400">
                X25519 + AES-256-GCM end-to-end encrypted pseudonymous messaging
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="anon" data={realtimeData || {}} compact />
            <span className="flex items-center gap-1 rounded bg-neon-green/10 px-2 py-1 text-sm text-neon-green">
              <Lock className="h-4 w-4" /> E2E Encrypted
            </span>
          </div>
        </header>

        {/* ── Real E2E messenger ── */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <MessageSquare className="h-4 w-4 text-neon-blue" /> Secure Messenger
          </h2>
          <AnonMessenger />
        </section>

        {/* ── Privacy-compute analytics ── */}
        <div className="panel p-4 space-y-3">
          <h3 className="flex items-center gap-2 font-semibold">
            <Zap className="h-4 w-4 text-neon-green" />
            Privacy Compute Actions
          </h3>
          <p className="text-xs text-gray-400">
            Run k-anonymity generalization, re-identification risk (prosecutor / journalist /
            marketer attack models), and Laplace-mechanism differential privacy against a real
            dataset below.
          </p>

          {/* Dataset editor */}
          <div className="rounded-lg border border-lattice-border bg-lattice-deep p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-300">
                <Database className="h-3.5 w-3.5 text-neon-cyan" /> Dataset ({records.length} records)
              </h4>
              <div className="flex items-center gap-2">
                <button onClick={loadExample} className="flex items-center gap-1 rounded bg-neon-cyan/10 px-2 py-1 text-[11px] text-neon-cyan hover:bg-neon-cyan/20">
                  <Sparkles className="h-3 w-3" /> Load example dataset
                </button>
                {records.length > 0 && (
                  <button onClick={clearRecords} className="flex items-center gap-1 rounded bg-white/5 px-2 py-1 text-[11px] text-gray-400 hover:text-red-400">
                    <Trash2 className="h-3 w-3" /> Clear
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-[11px] text-gray-400">
                <span>Age</span>
                <input type="number" value={newRecord.age} onChange={(e) => setNewRecord((p) => ({ ...p, age: e.target.value }))} placeholder="34" className="input-lattice w-20 text-xs" />
              </label>
              <label className="space-y-1 text-[11px] text-gray-400">
                <span>Zipcode</span>
                <input value={newRecord.zipcode} onChange={(e) => setNewRecord((p) => ({ ...p, zipcode: e.target.value }))} placeholder="94110" className="input-lattice w-24 text-xs" />
              </label>
              <label className="space-y-1 text-[11px] text-gray-400">
                <span>Condition (sensitive)</span>
                <input value={newRecord.condition} onChange={(e) => setNewRecord((p) => ({ ...p, condition: e.target.value }))} placeholder="Flu" className="input-lattice w-32 text-xs" />
              </label>
              <button onClick={addRecord} disabled={!newRecord.age || !newRecord.zipcode} className="flex items-center gap-1 rounded bg-neon-green/10 px-2 py-1.5 text-xs text-neon-green hover:bg-neon-green/20 disabled:opacity-40">
                <Plus className="h-3.5 w-3.5" /> Add row
              </button>
            </div>
            {records.length > 0 && (
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {records.map((r, i) => (
                  <div key={i} className="flex items-center justify-between rounded bg-lattice-surface px-2 py-1 text-[11px] text-gray-300">
                    <span>age {r.age} · zip {r.zipcode} · {r.condition}</span>
                    <button onClick={() => setRecords((p) => p.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-400">×</button>
                  </div>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2 text-[11px] text-gray-400">
              <span>Differential-privacy epsilon (ε)</span>
              <input type="number" min={0.01} max={10} step={0.1} value={epsilon} onChange={(e) => setEpsilon(Math.max(0.01, Math.min(10, Number(e.target.value) || 1)))} className="input-lattice w-20 text-xs" />
              <span className="text-gray-500">lower = stronger privacy, more noise</span>
            </label>
          </div>

          {/* Real cross-session epsilon-budget tracking — every differentialPrivacy
              call spends against this identity's real accumulated ledger, not just
              the current call. See server/domains/anon.js privacyBudgetStatus. */}
          <PrivacyBudgetPanel refreshKey={budgetRefreshKey} />

          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => handleAnonAction('anonymize')}
              disabled={isRunning !== null}
              className="flex flex-col items-center gap-2 rounded-lg border border-lattice-border bg-lattice-deep p-3 transition-colors hover:border-neon-green/50 disabled:opacity-50"
            >
              {isRunning === 'anonymize' ? (
                <Loader2 className="h-5 w-5 animate-spin text-neon-green" />
              ) : (
                <Fingerprint className="h-5 w-5 text-neon-green" />
              )}
              <span className="text-xs text-gray-300">Anonymize Data</span>
            </button>
            <button
              onClick={() => handleAnonAction('privacyRisk')}
              disabled={isRunning !== null}
              className="flex flex-col items-center gap-2 rounded-lg border border-lattice-border bg-lattice-deep p-3 transition-colors hover:border-red-400/50 disabled:opacity-50"
            >
              {isRunning === 'privacyRisk' ? (
                <Loader2 className="h-5 w-5 animate-spin text-red-400" />
              ) : (
                <ShieldAlert className="h-5 w-5 text-red-400" />
              )}
              <span className="text-xs text-gray-300">Privacy Risk</span>
            </button>
            <button
              onClick={() => handleAnonAction('differentialPrivacy')}
              disabled={isRunning !== null}
              className="flex flex-col items-center gap-2 rounded-lg border border-lattice-border bg-lattice-deep p-3 transition-colors hover:border-neon-purple/50 disabled:opacity-50"
            >
              {isRunning === 'differentialPrivacy' ? (
                <Loader2 className="h-5 w-5 animate-spin text-neon-purple" />
              ) : (
                <Waves className="h-5 w-5 text-neon-purple" />
              )}
              <span className="text-xs text-gray-300">Differential Privacy</span>
            </button>
          </div>

          {actionResult && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 rounded-lg border border-lattice-border bg-lattice-deep p-3"
            >
              <div className="mb-3 flex items-center justify-between">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <BarChart3 className="h-4 w-4 text-neon-green" /> Result
                </h4>
                <button
                  onClick={() => setActionResult(null)}
                  className="text-gray-400 hover:text-white"
                  aria-label="Dismiss result"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              </div>

              {/* Anonymize result */}
              {actionResult.k !== undefined && actionResult.generalizationLevel !== undefined && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div className="rounded bg-lattice-surface p-2 text-center">
                      <p className="text-sm font-bold text-neon-green">{actionResult.k as number}</p>
                      <p className="text-[10px] text-gray-400">K-Anonymity</p>
                    </div>
                    <div className="rounded bg-lattice-surface p-2 text-center">
                      <p className="text-sm font-bold text-neon-cyan">
                        {actionResult.generalizationLevel as number}
                      </p>
                      <p className="text-[10px] text-gray-400">Gen Level</p>
                    </div>
                    <div className="rounded bg-lattice-surface p-2 text-center">
                      <p className="text-sm font-bold text-neon-purple">
                        {actionResult.equivalenceClasses as number}
                      </p>
                      <p className="text-[10px] text-gray-400">Equiv Classes</p>
                    </div>
                    <div className="rounded bg-lattice-surface p-2 text-center">
                      <p className="text-sm font-bold text-white">
                        {(actionResult.informationLoss as number).toFixed(1)}%
                      </p>
                      <p className="text-[10px] text-gray-400">Info Loss</p>
                    </div>
                  </div>
                  {(actionResult.quasiIdentifiers as string[])?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(actionResult.quasiIdentifiers as string[]).map((qi) => (
                        <span
                          key={qi}
                          className="rounded bg-neon-green/10 px-1.5 py-0.5 text-[10px] text-neon-green"
                        >
                          {qi}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs">
                    {(actionResult.kAchieved as boolean) ? (
                      <span className="flex items-center gap-1 text-neon-green">
                        <CheckCircle className="h-3 w-3" /> K-anonymity satisfied
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-400">
                        <AlertTriangle className="h-3 w-3" /> K-anonymity NOT satisfied
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Privacy-risk result */}
              {actionResult.overallRiskLevel !== undefined &&
                actionResult.attackModels !== undefined && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`text-3xl font-bold ${
                          (actionResult.overallRiskLevel as string) === 'critical' ||
                          (actionResult.overallRiskLevel as string) === 'high'
                            ? 'text-red-400'
                            : (actionResult.overallRiskLevel as string) === 'moderate'
                            ? 'text-yellow-400'
                            : 'text-green-400'
                        }`}
                      >
                        {
                          (actionResult.attackModels as Record<string, Record<string, unknown>>)
                            ?.prosecutor?.risk as number
                        }
                        %
                      </div>
                      <span className="rounded px-2 py-0.5 text-xs font-medium uppercase">
                        {actionResult.overallRiskLevel as string} risk
                      </span>
                    </div>
                    {(actionResult.recommendations as string[])?.length > 0 && (
                      <div className="space-y-1">
                        {(actionResult.recommendations as string[]).map((v, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 rounded bg-red-500/10 p-1.5 text-xs text-red-400"
                          >
                            <AlertTriangle className="h-3 w-3 flex-shrink-0" /> {v}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              {/* Differential-privacy result */}
              {(actionResult.privacyParameters as Record<string, unknown>)?.epsilon !==
                undefined && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div className="rounded bg-lattice-surface p-2 text-center">
                      <p className="text-sm font-bold text-neon-purple">
                        {
                          (actionResult.privacyParameters as Record<string, unknown>)
                            ?.epsilon as number
                        }
                      </p>
                      <p className="text-[10px] text-gray-400">Epsilon (ε)</p>
                    </div>
                    <div className="rounded bg-lattice-surface p-2 text-center">
                      <p className="text-sm font-bold text-neon-cyan">
                        {
                          (actionResult.privacyParameters as Record<string, unknown>)
                            ?.privacyLevel as string
                        }
                      </p>
                      <p className="text-[10px] text-gray-400">Privacy Level</p>
                    </div>
                    <div className="rounded bg-lattice-surface p-2 text-center">
                      <p className="text-sm font-bold text-neon-green">
                        {
                          (actionResult.budgetTracking as Record<string, unknown>)
                            ?.cumulative as number
                        }
                      </p>
                      <p className="text-[10px] text-gray-400">Budget Used</p>
                    </div>
                    <div className="rounded bg-lattice-surface p-2 text-center">
                      <p className="text-sm font-bold text-white">
                        {
                          (actionResult.privacyParameters as Record<string, unknown>)
                            ?.queriesProcessed as number
                        }
                      </p>
                      <p className="text-[10px] text-gray-400">Queries</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Fallback message */}
              {!!actionResult.message &&
                !actionResult.k &&
                !actionResult.overallRiskLevel &&
                !(actionResult.privacyParameters as Record<string, unknown>)?.epsilon && (
                  <p className="text-sm text-gray-400">{actionResult.message as string}</p>
                )}
            </motion.div>
          )}
        </div>

        {realtimeData && (
          <RealtimeDataPanel
            domain="anon"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <TorNetworkStatus />
        </section>
      </div>

      {/* Accessibility sentinel — never visually displayed */}
      <a
        href="#anon-skip"
        className="sr-only focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-amber-500"
      >
        Skip to anon content
      </a>      <CrossLensRecentsPanel lensId="anon" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
