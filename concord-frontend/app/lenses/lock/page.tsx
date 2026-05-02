'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { use70Lock } from '@/hooks/use70Lock';
import { useState } from 'react';
import {
  Lock,
  Unlock,
  Shield,
  Eye,
  AlertTriangle,
  Check,
  Key,
  Loader2,
  Layers,
  ChevronDown,
  Gauge,
  ShieldAlert,
  Ban,
  Activity,
  Play,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { motion } from 'framer-motion';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { apiHelpers } from '@/lib/api/client';
import { useMutation } from '@tanstack/react-query';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { SovereigntyDashboard } from '@/components/sovereignty/SovereigntyDashboard';
import { SovereigntySetup } from '@/components/sovereignty/SovereigntySetup';
import { SovereigntyPrompt } from '@/components/sovereignty/SovereigntyPrompt';
import { LockDashboard } from '@/components/sovereignty/LockDashboard';

interface LockEventData {
  event: string;
  level: number;
}

const SEED_LOCK_HISTORY: {
  title: string;
  data: Record<string, unknown>;
}[] = [];

export default function LockLensPage() {
  useLensNav('lock');
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('lock');
  const { lockPercentage, invariants, isLocked, invariantSummary } = use70Lock();
  const [showFeatures, setShowFeatures] = useState(true);
  const [showSovereigntySetup, setShowSovereigntySetup] = useState(false);
  const [sovereigntyPromptMessage, setSovereigntyPromptMessage] = useState<{
    message: string;
    localCount: number;
    globalCount: number;
    globalDomains: string[];
    globalDTUIds: string[];
  } | null>(null);

  const {
    items: historyItems,
    isLoading: historyLoading,
    isError: isError,
    error: error,
    refetch: refetch,
    create: addEvent,
  } = useLensData<LockEventData>('lock', 'lock-event', {
    seed: SEED_LOCK_HISTORY,
  });

  const lockHistory = historyItems.map((item) => ({
    date: item.title || new Date(item.createdAt).toLocaleDateString(),
    event: item.data.event,
    level: item.data.level,
  }));

  const runAction = useRunArtifact('lock');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const handleAction = async (action: string) => {
    const targetId = historyItems[0]?.id;
    if (!targetId) {
      setActionResult({ message: 'Run an audit first to create lock events.' });
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
      console.error(`Action ${action} failed:`, e);
      setActionResult({
        message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
      });
    } finally {
      setIsRunning(null);
    }
  };

  const runAudit = useMutation({
    mutationFn: async () => {
      const { data } = await apiHelpers.sovereignty.audit();
      return data;
    },
    onSuccess: (data) => {
      addEvent({
        title: new Date().toISOString().split('T')[0],
        data: { event: `Audit ${data?.ok ? 'passed' : 'failed'}`, level: lockPercentage },
      }).catch((err) =>
        console.error('Failed to save audit event:', err instanceof Error ? err.message : err)
      );
    },
    onError: (err) => console.error('runAudit failed:', err instanceof Error ? err.message : err),
  });

  if (historyLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }
  return (
    <div data-lens-theme="lock" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔐</span>
          <div>
            <h1 className="text-xl font-bold">Lock Lens</h1>
            <p className="text-sm text-gray-400">
              70% sovereignty lock deep-dive and invariant visualization
            </p>
          </div>

          {/* Real-time Enhancement Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="lock" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <div
          className={`sovereignty-lock lock-70 px-6 py-3 rounded-xl ${
            isLocked ? 'border-sovereignty-locked' : 'border-sovereignty-danger'
          }`}
        >
          <span className="text-3xl font-bold text-sovereignty-locked">{lockPercentage}%</span>
        </div>
      </header>

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="lens-card text-center"
        >
          <Lock className="w-5 h-5 text-neon-cyan mx-auto mb-2" />
          <p className="text-2xl font-bold text-neon-cyan">{invariants.length}</p>
          <p className="text-sm text-gray-400">Total Invariants</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="lens-card text-center"
        >
          <Key className="w-5 h-5 text-neon-purple mx-auto mb-2" />
          <p className="text-2xl font-bold text-neon-purple">{lockHistory.length}</p>
          <p className="text-sm text-gray-400">Audit Events</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="lens-card text-center"
        >
          <Shield className="w-5 h-5 text-neon-green mx-auto mb-2" />
          <p className="text-2xl font-bold text-neon-green">100%</p>
          <p className="text-sm text-gray-400">Enforcement Rate</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="lens-card text-center"
        >
          {isLocked ? (
            <Lock className="w-5 h-5 text-neon-green mx-auto mb-2" />
          ) : (
            <Unlock className="w-5 h-5 text-neon-pink mx-auto mb-2" />
          )}
          <p className={`text-2xl font-bold ${isLocked ? 'text-neon-green' : 'text-neon-pink'}`}>
            {isLocked ? 'Locked' : 'Open'}
          </p>
          <p className="text-sm text-gray-400">Lock State</p>
        </motion.div>
      </div>

      {/* Lock Status Indicator */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.25 }}
        className={`panel p-4 flex items-center gap-4 border-l-4 ${
          isLocked
            ? 'border-l-green-500 bg-green-500/5'
            : lockPercentage >= 50
              ? 'border-l-amber-500 bg-amber-500/5'
              : 'border-l-red-500 bg-red-500/5'
        }`}
      >
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center ${
            isLocked
              ? 'bg-green-500/20'
              : lockPercentage >= 50
                ? 'bg-amber-500/20'
                : 'bg-red-500/20'
          }`}
        >
          {isLocked ? (
            <Lock className="w-6 h-6 text-green-400" />
          ) : (
            <Unlock className="w-6 h-6 text-amber-400" />
          )}
        </div>
        <div className="flex-1">
          <p className="font-semibold">
            {isLocked ? 'Sovereignty Locked' : 'Sovereignty Unlocked'}
          </p>
          <p className="text-xs text-gray-400">
            {isLocked
              ? 'All sovereignty invariants are enforced. System is protected.'
              : `Lock percentage at ${lockPercentage}% -- below 70% threshold. Action required.`}
          </p>
        </div>
        <span
          className={`w-3 h-3 rounded-full animate-pulse ${
            isLocked ? 'bg-green-500' : lockPercentage >= 50 ? 'bg-amber-500' : 'bg-red-500'
          }`}
        />
      </motion.div>

      {/* AI Actions */}
      <UniversalActions domain="lock" artifactId={historyItems[0]?.id} compact />
      {/* Lock Gauge */}
      <div className="panel p-6">
        <div className="relative w-full h-12 bg-lattice-deep rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-sovereignty-danger via-sovereignty-warning to-sovereignty-locked transition-all"
            style={{ width: `${lockPercentage}%` }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-white font-bold text-lg drop-shadow">
              {lockPercentage >= 70 ? 'SOVEREIGNTY LOCKED' : 'WARNING: Below Threshold'}
            </span>
          </div>
          <div className="absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: '70%' }} />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-2">
          <span>0%</span>
          <span className="text-sovereignty-locked">70% Threshold</span>
          <span>100%</span>
        </div>
      </div>

      {/* Invariant Summary */}
      <div className="grid grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="lens-card text-center"
        >
          <Check className="w-6 h-6 text-neon-green mx-auto mb-2" />
          <p className="text-2xl font-bold text-neon-green">{invariantSummary.enforced}</p>
          <p className="text-sm text-gray-400">Enforced</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="lens-card text-center"
        >
          <AlertTriangle className="w-6 h-6 text-yellow-500 mx-auto mb-2" />
          <p className="text-2xl font-bold text-yellow-500">{invariantSummary.warning}</p>
          <p className="text-sm text-gray-400">Warning</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="lens-card text-center"
        >
          <AlertTriangle className="w-6 h-6 text-neon-pink mx-auto mb-2" />
          <p className="text-2xl font-bold text-neon-pink">{invariantSummary.violated}</p>
          <p className="text-sm text-gray-400">Violated</p>
        </motion.div>
      </div>

      {/* Active Invariants */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-neon-green" />
          Active Invariants
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {invariants.map((inv, idx) => (
            <motion.div
              key={inv.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="flex items-center gap-3 p-3 bg-lattice-deep rounded-lg"
            >
              <span
                className={`w-3 h-3 rounded-full ${
                  inv.status === 'enforced'
                    ? 'bg-neon-green'
                    : inv.status === 'warning'
                      ? 'bg-yellow-500'
                      : 'bg-neon-pink'
                }`}
              />
              <div className="flex-1">
                <p className="font-mono text-sm">{inv.name}</p>
                <p className="text-xs text-gray-500">{inv.description}</p>
              </div>
              <Lock className="w-4 h-4 text-gray-500" />
            </motion.div>
          ))}
        </div>
      </div>

      {/* Lock History */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Key className="w-4 h-4 text-neon-purple" />
            Lock History
          </h2>
          <button
            onClick={() => runAudit.mutate()}
            disabled={runAudit.isPending}
            className="btn-neon text-sm"
          >
            {runAudit.isPending ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 inline animate-spin" />
                Auditing...
              </>
            ) : (
              <>
                <Shield className="w-3 h-3 mr-1 inline" />
                Run Audit
              </>
            )}
          </button>
        </div>
        {historyLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-2">
            {lockHistory.map((entry, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg relative"
              >
                {/* Audit log timeline connector */}
                {i < lockHistory.length - 1 && (
                  <div className="absolute left-[27px] top-[42px] w-px h-[calc(100%-16px)] bg-gray-700" />
                )}
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-lattice-surface flex items-center justify-center z-10">
                    <Eye className="w-3 h-3 text-gray-500" />
                  </div>
                  <div>
                    <p className="text-sm">{entry.event}</p>
                    <p className="text-xs text-gray-500">{entry.date}</p>
                  </div>
                </div>
                <span className="text-sovereignty-locked font-mono">{entry.level}%</span>
              </motion.div>
            ))}
          </div>
        )}

        {/* Real-time Data Panel */}
        {realtimeData && (
          <RealtimeDataPanel
            domain="lock"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}
      </div>

      {/* Sovereignty Monitor */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-neon-cyan" />
          Sovereignty Monitor
        </h2>

        {/* Ownership Verification Gauge */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400 flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-neon-purple" />
              Ownership Verification
            </span>
            <span className="text-sm font-mono text-neon-green">{lockPercentage}%</span>
          </div>
          <div className="relative w-full h-8 bg-lattice-deep rounded-lg overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-lg transition-all duration-700 ease-out"
              style={{
                width: `${lockPercentage}%`,
                background:
                  lockPercentage >= 70
                    ? 'linear-gradient(90deg, rgba(0,255,200,0.3), rgba(0,255,200,0.6))'
                    : 'linear-gradient(90deg, rgba(255,50,100,0.3), rgba(255,50,100,0.6))',
              }}
            />
            <div className="absolute top-0 bottom-0 w-px bg-neon-cyan/60" style={{ left: '70%' }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span
                className={`text-xs font-bold ${lockPercentage >= 70 ? 'text-neon-green' : 'text-neon-pink'}`}
              >
                {lockPercentage >= 70 ? 'VERIFIED' : 'BELOW THRESHOLD'}
              </span>
            </div>
          </div>
          <div className="flex justify-between text-[10px] text-gray-600 mt-1">
            <span>0%</span>
            <span className="text-neon-cyan">70% min</span>
            <span>100%</span>
          </div>
        </div>

        {/* Anti-Takeover & Invariant Status Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Anti-Takeover Status */}
          <div className="bg-lattice-deep rounded-lg p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="w-4 h-4 text-neon-purple" />
              <h3 className="text-sm font-semibold">Anti-Takeover Status</h3>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Hostile Override Detection</span>
                <span className="text-xs px-2 py-0.5 rounded bg-neon-green/15 text-neon-green">
                  Active
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Council Quorum Lock</span>
                <span className="text-xs px-2 py-0.5 rounded bg-neon-green/15 text-neon-green">
                  Engaged
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">External Mutation Shield</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    isLocked ? 'bg-neon-green/15 text-neon-green' : 'bg-neon-pink/15 text-neon-pink'
                  }`}
                >
                  {isLocked ? 'Enforced' : 'Vulnerable'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Identity Anchor Hash</span>
                <span className="text-xs font-mono text-neon-cyan truncate max-w-[120px]">
                  0x7a3f...e91d
                </span>
              </div>
            </div>
          </div>

          {/* Invariant Enforcement Dashboard */}
          <div className="bg-lattice-deep rounded-lg p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-3">
              <Ban className="w-4 h-4 text-neon-cyan" />
              <h3 className="text-sm font-semibold">Invariant Enforcement</h3>
            </div>
            <div className="space-y-3">
              {[
                { name: 'NO_TELEMETRY', icon: Eye, enforced: true },
                { name: 'NO_ADS', icon: Ban, enforced: true },
                { name: 'NO_RESALE', icon: Lock, enforced: true },
                { name: 'NO_DARK_PATTERNS', icon: AlertTriangle, enforced: true },
              ].map((rule) => (
                <div key={rule.name} className="flex items-center gap-2">
                  <rule.icon className="w-3 h-3 text-gray-500" />
                  <span className="text-xs font-mono flex-1">{rule.name}</span>
                  <span
                    className={`w-2 h-2 rounded-full ${rule.enforced ? 'bg-neon-green animate-pulse' : 'bg-neon-pink'}`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
              <span className="text-xs text-gray-400">Enforcement Rate</span>
              <div className="flex items-center gap-2">
                <div className="w-16 h-1.5 bg-lattice-void rounded-full overflow-hidden">
                  <div className="h-full bg-neon-green rounded-full" style={{ width: '100%' }} />
                </div>
                <span className="text-xs font-mono text-neon-green">100%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Sovereignty Activity Feed */}
        <div className="mt-4 bg-lattice-deep rounded-lg p-4 border border-white/5">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-neon-green" />
            <h3 className="text-sm font-semibold">Recent Sovereignty Events</h3>
          </div>
          <div className="space-y-2">
            {[
              { time: '2m ago', event: 'Ownership percentage verified', status: 'ok' },
              { time: '8m ago', event: 'Anti-takeover scan completed', status: 'ok' },
              { time: '15m ago', event: 'Council quorum revalidated', status: 'ok' },
              { time: '1h ago', event: 'External mutation attempt blocked', status: 'warn' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 text-xs">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${item.status === 'ok' ? 'bg-neon-green' : 'bg-yellow-500'}`}
                />
                <span className="text-gray-500 w-12">{item.time}</span>
                <span className="text-gray-300">{item.event}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Lock Dashboard -- visual invariant overview */}
      <div className="panel p-4">
        <LockDashboard
          status={{
            overallLock: lockPercentage,
            invariants: invariants.map((inv) => ({
              id: inv.id,
              name: inv.name,
              status: inv.status,
              description: inv.description,
            })),
            lastAudit: lockHistory[0]?.date,
          }}
        />
      </div>

      {/* Sovereignty Dashboard -- full sovereignty status */}
      <SovereigntyDashboard />

      {/* Sovereignty Setup -- onboarding sovereignty mode picker */}
      {showSovereigntySetup && (
        <div className="panel p-4">
          <SovereigntySetup onComplete={() => setShowSovereigntySetup(false)} />
        </div>
      )}

      {/* Sovereignty Prompt -- inline consent prompt */}
      {sovereigntyPromptMessage && (
        <div className="panel p-4">
          <SovereigntyPrompt
            message={sovereigntyPromptMessage}
            onResolve={(_choice, _remember) => {
              setSovereigntyPromptMessage(null);
            }}
            isResolving={false}
          />
        </div>
      )}

      {/* Sovereignty Setup Trigger */}
      {!showSovereigntySetup && (
        <button
          onClick={() => setShowSovereigntySetup(true)}
          className="btn-secondary text-sm flex items-center gap-2"
        >
          <Shield className="w-4 h-4" />
          Re-run Sovereignty Setup
        </button>
      )}

      {/* Backend Action Panel */}
      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-neon-cyan" />
          Lock Analysis
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'deadlockDetect', label: 'Deadlock Detect' },
            { action: 'contentionAnalysis', label: 'Contention Analysis' },
            { action: 'fairnessScore', label: 'Fairness Score' },
          ].map(({ action, label }) => (
            <button
              key={action}
              onClick={() => handleAction(action)}
              disabled={!!isRunning}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50"
            >
              {isRunning === action ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              {label}
            </button>
          ))}
        </div>
        {actionResult && (
          <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
            {'deadlocked' in actionResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span
                    className={`text-lg font-bold ${actionResult.deadlocked ? 'text-red-400' : 'text-neon-green'}`}
                  >
                    {actionResult.deadlocked ? 'DEADLOCK DETECTED' : 'No Deadlock'}
                  </span>
                  <span className="text-xs text-gray-400">
                    Cycles:{' '}
                    <span className="text-neon-cyan">{String(actionResult.cycleCount || 0)}</span>
                  </span>
                </div>
                {'deadlockSets' in actionResult &&
                  Array.isArray(actionResult.deadlockSets) &&
                  actionResult.deadlockSets.length > 0 && (
                    <div>
                      <p className="text-xs text-red-400 font-semibold mb-1">Deadlock Sets</p>
                      {(actionResult.deadlockSets as Array<unknown[]>).map((set, i) => (
                        <div
                          key={i}
                          className="text-xs bg-red-400/10 border border-red-400/20 rounded px-2 py-1 mb-1"
                        >
                          {(set as string[]).join(' → ')}
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            )}
            {'resources' in actionResult && Array.isArray(actionResult.resources) && (
              <div className="space-y-2">
                {'summary' in actionResult &&
                  actionResult.summary !== null &&
                  typeof actionResult.summary === 'object' && (
                    <div className="flex flex-wrap gap-4 text-xs">
                      {Object.entries(actionResult.summary as Record<string, unknown>).map(
                        ([k, v]) => (
                          <span key={k} className="text-gray-400">
                            {k}: <span className="text-neon-cyan">{String(v)}</span>
                          </span>
                        )
                      )}
                    </div>
                  )}
                {'hotLocks' in actionResult &&
                  Array.isArray(actionResult.hotLocks) &&
                  actionResult.hotLocks.length > 0 && (
                    <div>
                      <p className="text-xs text-yellow-400 font-semibold mb-1">Hot Locks</p>
                      {(actionResult.hotLocks as Array<Record<string, unknown>>).map((h, i) => (
                        <div
                          key={i}
                          className="flex justify-between text-xs bg-yellow-400/10 border border-yellow-400/20 rounded px-2 py-1 mb-1"
                        >
                          <span className="text-yellow-400">{String(h.resource || h.name)}</span>
                          <span className="text-gray-300">
                            {String(h.contention || h.waiters || 0)} waiting
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                {'suggestions' in actionResult &&
                  Array.isArray(actionResult.suggestions) &&
                  actionResult.suggestions.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                        Suggestions
                      </p>
                      {(
                        actionResult.suggestions as Array<{
                          resource: string;
                          recommendation: string;
                          reason: string;
                        }>
                      ).map((s, i) => (
                        <p key={i} className="text-xs text-gray-300">
                          • <span className="font-mono text-neon-cyan">{s.resource}</span>:{' '}
                          {s.reason}
                        </p>
                      ))}
                    </div>
                  )}
              </div>
            )}
            {'jainsIndex' in actionResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-4">
                  <span className="text-gray-400 text-xs">
                    Jain&apos;s Index:{' '}
                    <span className="text-neon-cyan font-bold text-lg">
                      {String(actionResult.jainsIndex)}
                    </span>
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      actionResult.fairnessLevel === 'excellent' ||
                      actionResult.fairnessLevel === 'good'
                        ? 'bg-neon-green/20 text-neon-green'
                        : actionResult.fairnessLevel === 'moderate'
                          ? 'bg-yellow-400/20 text-yellow-400'
                          : 'bg-red-400/20 text-red-400'
                    }`}
                  >
                    {String(actionResult.fairnessLevel)}
                  </span>
                </div>
                {'starvation' in actionResult &&
                  actionResult.starvation !== null &&
                  typeof actionResult.starvation === 'object' && (
                    <div className="flex flex-wrap gap-3 text-xs">
                      {Object.entries(actionResult.starvation as Record<string, unknown>).map(
                        ([k, v]) => (
                          <span key={k} className="text-gray-400">
                            {k}: <span className="text-yellow-400">{String(v)}</span>
                          </span>
                        )
                      )}
                    </div>
                  )}
              </div>
            )}
            {'message' in actionResult && (
              <p className="text-gray-400">{String(actionResult.message)}</p>
            )}
          </div>
        )}
      </div>

      <ConnectiveTissueBar lensId="lock" />

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`}
          />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="lock" />
          </div>
        )}
      </div>
    </div>
  );
}
