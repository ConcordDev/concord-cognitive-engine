'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Lock, Zap, BarChart3, XCircle, Loader2, Fingerprint, ShieldAlert,
  Waves, AlertTriangle, CheckCircle, MessageSquare,
} from 'lucide-react';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { TorNetworkStatus } from '@/components/anon/TorNetworkStatus';
import { AnonMessenger } from '@/components/anon/AnonMessenger';

export default function AnonLensPage() {
  useLensNav('anon');
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } =
    useRealtimeLens('anon');

  // Privacy-compute artifact store (anonymize / privacyRisk / differentialPrivacy).
  const { items: privacyItems } = useLensData<Record<string, unknown>>('anon', 'privacy-set', {
    seed: [],
  });
  const runAction = useRunArtifact('anon');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  // Lens-scoped keyboard commands.
  useLensCommand(
    [
      {
        id: 'run-anonymize',
        keys: 'mod+k',
        description: 'Run anonymize on first artifact',
        category: 'actions',
        action: () => handleAnonAction('anonymize'),
      },
    ],
    { lensId: 'anon' },
  );

  const handleAnonAction = async (action: string) => {
    const targetId = privacyItems[0]?.id;
    if (!targetId) {
      setActionResult({ message: 'No privacy dataset artifact found. Create one to run analytics.' });
      return;
    }
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) {
        setActionResult({
          message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}`,
        });
      } else {
        setActionResult(res.result as Record<string, unknown>);
      }
    } catch (e) {
      setActionResult({
        message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
      });
    }
    setIsRunning(null);
  };

  return (
    <LensShell lensId="anon" asMain={false}>
      <FirstRunTour lensId="anon" />
      <ManifestActionBar />
      <DepthBadge lensId="anon" size="sm" className="ml-2" />
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

        {/* AI actions on the privacy-set artifact */}
        <UniversalActions domain="anon" artifactId={privacyItems[0]?.id} compact />

        {/* ── Privacy-compute analytics ── */}
        <div className="panel p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <Zap className="h-4 w-4 text-neon-green" />
            Privacy Compute Actions
          </h3>
          <p className="mb-3 text-xs text-gray-400">
            Run k-anonymity, re-identification risk and differential-privacy analytics on the
            first stored privacy dataset artifact.
          </p>
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
      </a>
      <RecentMineCard domain="anon" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="anon" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="anon" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
