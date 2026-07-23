'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Wrench, Zap, Activity, Lock, ShieldAlert, HeartPulse, ClipboardCheck } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';

// Repair Cortex is a SYSTEM-level surface (one loop for the whole server,
// not per-user) — reading status is safe for anyone, but forcing a cycle
// is a mutating admin action. Gate it the same way `isLensVisible` gates
// the admin/command-center lenses (`lib/lens-registry.ts`): real role
// synced from `/api/auth/me` into `useUIStore.userRole` (Providers.tsx),
// fail-closed to 'user' when unauthenticated/unknown.
function isRepairAdmin(role: string): boolean {
  return role === 'admin' || role === 'sovereign';
}

interface RepairStatus {
  ok: boolean;
  loopRunning: boolean;
  cycleCount: number;
  lastCycleResult: { patternsChecked: number; fixesApplied: number } | null;
  errorAccumulator: { size: number };
  executors: Record<string, { canApply: boolean }>;
  repairNetwork?: { enabled: boolean; lastPush: string | null; lastPull: string | null };
}

// ── OP1 (R7 self-host proof) — operator console additions ───────────────────
// Detections: real detector-suite findings (`globalThis.__CONCORD_DETECTORS__.
// latestReport`), grouped by severity/consumer. Health strip: real per-module
// heartbeat timing (`/api/admin/heartbeat-stats`, already existed — reused,
// not duplicated). Governed remediations: the ONE real propose→approve→apply
// flow currently wired (`lib/repair-remediation.js` — restarting a heartbeat
// module a detector flagged as failing/stale), via `runHeartbeatModuleNow`.
// These three reads are gated the same way `/api/admin/heartbeat-stats` /
// `/api/admin/worker-stats` already are — operator roles only, even for
// reads — so they're only fetched when the viewer already passes
// `isRepairAdmin`; a non-operator sees an honest "operator access required"
// note instead of a spray of 403s.

interface DetectionFinding {
  detectorId: string;
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  message: string;
  location: string | null;
  subject: { kind: string; id: string } | null;
  fixHint: string | null;
}

interface DetectionsResponse {
  ok: boolean;
  available: boolean;
  reason?: string;
  sweepInFlight?: boolean;
  generatedAt?: string | null;
  latestRunAt?: number | null;
  totals?: Record<string, number>;
  bySeverity?: Record<string, number>;
  byConsumer?: Record<string, number>;
  detectorCount?: number;
  findingCount?: number;
  findings?: DetectionFinding[];
}

interface HeartbeatModuleStat {
  id: string;
  frequency: number;
  scope: string;
  worker: boolean;
  sampleCount: number;
  p50: number;
  p90: number;
  p99: number;
  lastAt: number;
  totalRuns: number;
  totalErrors: number;
}

interface RemediationEntry {
  id: string;
  action: string;
  moduleId: string;
  detectorId: string;
  findingId: string;
  severity: string;
  message: string;
  status: 'proposed' | 'approved' | 'rejected' | 'applied' | 'apply_failed';
  proposedAt: string;
  approvedBy?: string | null;
  rejectReason?: string | null;
  appliedResult?: { ok: boolean; error?: string } | null;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'text-red-400 border-red-500/40 bg-red-500/10',
  high: 'text-orange-400 border-orange-500/40 bg-orange-500/10',
  medium: 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10',
  low: 'text-blue-400 border-blue-500/40 bg-blue-500/10',
  info: 'text-gray-400 border-gray-500/40 bg-gray-500/10',
};

function timeAgo(ms: number | null | undefined): string {
  if (!ms) return 'never';
  const deltaS = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (deltaS < 60) return `${deltaS}s ago`;
  if (deltaS < 3600) return `${Math.round(deltaS / 60)}m ago`;
  return `${Math.round(deltaS / 3600)}h ago`;
}

function RepairPanel() {
  const [status, setStatus] = useState<RepairStatus | null>(null);
  const [forcing, setForcing] = useState(false);
  const userRole = useUIStore((s) => s.userRole);
  const canForceCycle = isRepairAdmin(userRole);

  const [detections, setDetections] = useState<DetectionsResponse | null>(null);
  const [heartbeats, setHeartbeats] = useState<HeartbeatModuleStat[]>([]);
  const [remediations, setRemediations] = useState<RemediationEntry[] | null>(null);
  const [consoleLoading, setConsoleLoading] = useState(false);
  const [triggeringSweep, setTriggeringSweep] = useState(false);
  const [busyRemediationId, setBusyRemediationId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadConsole = useCallback(async () => {
    if (!canForceCycle) return;
    setConsoleLoading(true);
    try {
      const [det, hb, rem] = await Promise.all([
        apiHelpers.repairExtended.detections(),
        apiHelpers.repairExtended.heartbeatStats(),
        apiHelpers.repairExtended.remediations.list(),
      ]);
      setDetections(det.data);
      setHeartbeats(hb.data?.modules || []);
      setRemediations(rem.data?.queue || []);
    } catch (e) {
      console.error('[RepairPanel] Failed to load operator console:', e);
    }
    setConsoleLoading(false);
  }, [canForceCycle]);

  useEffect(() => {
    loadConsole();
  }, [loadConsole]);

  // While a manually-triggered sweep is in flight, poll the honestly-reported
  // `sweepInFlight`/`available` state instead of assuming the click finished
  // anything — the real sweep can take minutes on a repo this size.
  useEffect(() => {
    if (detections?.sweepInFlight) {
      if (!pollRef.current) {
        pollRef.current = setInterval(() => { loadConsole(); }, 8000);
      }
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [detections?.sweepInFlight, loadConsole]);

  const loadStatus = async () => {
    try {
      const resp = await apiHelpers.repairExtended.fullStatus();
      setStatus(resp.data);
    } catch (e) {
      console.error('[RepairPanel] Failed to load status:', e);
    }
  };

  const forceCycle = async () => {
    setForcing(true);
    try {
      await apiHelpers.repairExtended.forceCycle();
      await loadStatus();
    } catch (e) {
      console.error('[RepairPanel] Failed to force repair cycle:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to force repair cycle' });
    }
    setForcing(false);
  };

  const runDetectorSweep = async () => {
    setTriggeringSweep(true);
    try {
      const r = await apiHelpers.repairExtended.runDetectorSweep();
      if (r.data?.alreadyRunning) {
        useUIStore.getState().addToast({ type: 'info', message: 'A detector sweep is already running' });
      }
      await loadConsole();
    } catch (e) {
      console.error('[RepairPanel] Failed to trigger detector sweep:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to trigger detector sweep' });
    }
    setTriggeringSweep(false);
  };

  const approveRemediation = async (id: string) => {
    setBusyRemediationId(id);
    try {
      await apiHelpers.repairExtended.remediations.approve(id);
      await loadConsole();
    } catch (e) {
      console.error('[RepairPanel] Failed to approve remediation:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to approve remediation' });
    }
    setBusyRemediationId(null);
  };

  const applyRemediation = async (id: string) => {
    setBusyRemediationId(id);
    try {
      const r = await apiHelpers.repairExtended.remediations.apply(id);
      if (r.data?.entry?.status === 'applied') {
        useUIStore.getState().addToast({ type: 'success', message: 'Remediation applied — module re-run' });
      } else if (r.data?.entry?.status === 'apply_failed') {
        useUIStore.getState().addToast({ type: 'error', message: 'Remediation apply reported a real failure' });
      }
      await loadConsole();
    } catch (e) {
      console.error('[RepairPanel] Failed to apply remediation:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to apply remediation' });
    }
    setBusyRemediationId(null);
  };

  const rejectRemediation = async (id: string) => {
    setBusyRemediationId(id);
    try {
      await apiHelpers.repairExtended.remediations.reject(id, 'dismissed from operator console');
      await loadConsole();
    } catch (e) {
      console.error('[RepairPanel] Failed to reject remediation:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to reject remediation' });
    }
    setBusyRemediationId(null);
  };

  const bySeverity = detections?.bySeverity || {};
  const byConsumer = detections?.byConsumer || {};
  const topHeartbeats = heartbeats.slice(0, 5);

  return (
    <div className="panel p-4 space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <Wrench className="w-4 h-4 text-orange-400" />
        Repair Cortex
      </h3>

      {status ? (
        <>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="bg-lattice-deep rounded p-2 text-center">
              <p className="text-gray-400">Cycles</p>
              <p className="text-lg font-mono text-gray-200">{status.cycleCount || 0}</p>
            </div>
            <div className="bg-lattice-deep rounded p-2 text-center">
              <p className="text-gray-400">Errors</p>
              <p className="text-lg font-mono text-gray-200">
                {status.errorAccumulator?.size || 0}
              </p>
            </div>
            <div className="bg-lattice-deep rounded p-2 text-center">
              <p className="text-gray-400">Fixes</p>
              <p className="text-lg font-mono text-gray-200">
                {status.lastCycleResult?.fixesApplied || 0}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${status.loopRunning ? 'bg-green-400' : 'bg-red-400'}`}
            />
            <span className="text-gray-400">
              {status.loopRunning ? 'Loop active (30s)' : 'Loop stopped'}
            </span>
          </div>

          {/* Executor Status */}
          {status.executors && (
            <div className="text-xs text-gray-400">
              {Object.entries(status.executors).filter(([, v]) => v.canApply).length} executors
              ready
            </div>
          )}

          {/* Network Status */}
          {status.repairNetwork?.enabled && (
            <div className="bg-lattice-deep rounded p-2 text-xs flex items-center gap-2">
              <Activity className="w-3 h-3 text-neon-cyan" />
              <span className="text-gray-400">Repair Network: connected</span>
            </div>
          )}

          {canForceCycle ? (
            <button
              onClick={forceCycle}
              disabled={forcing}
              className="w-full bg-orange-500/10 border border-orange-500/30 rounded py-1.5 text-xs text-orange-400 hover:bg-orange-500/20 disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <Zap className="w-3 h-3" /> {forcing ? 'Running...' : 'Force Repair Cycle'}
            </button>
          ) : (
            <button
              disabled
              title="Forcing a repair cycle is a system-wide action, restricted to admin/sovereign roles"
              className="w-full bg-lattice-deep border border-lattice-border rounded py-1.5 text-xs text-gray-500 opacity-60 cursor-not-allowed flex items-center justify-center gap-1"
            >
              <Lock className="w-3 h-3" /> Force Repair Cycle (admin only)
            </button>
          )}
        </>
      ) : (
        <p className="text-xs text-gray-400">Loading...</p>
      )}

      {/* ── Operator console (OP1) ─────────────────────────────────────── */}
      {!canForceCycle ? (
        <div className="border-t border-lattice-border pt-3 mt-1">
          <p className="text-[11px] text-gray-500 flex items-center gap-1">
            <Lock className="w-3 h-3" /> Detections, heartbeat health, and governed
            remediations are operator-only (admin/sovereign).
          </p>
        </div>
      ) : (
        <div className="border-t border-lattice-border pt-3 mt-1 space-y-4">
          {/* Detections */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold flex items-center gap-1.5 text-gray-300">
                <ShieldAlert className="w-3.5 h-3.5 text-red-400" /> Detections
              </h4>
              <button
                onClick={runDetectorSweep}
                disabled={triggeringSweep || !!detections?.sweepInFlight}
                className="text-[11px] px-2 py-1 rounded border border-lattice-border text-gray-300 hover:bg-white/5 disabled:opacity-50"
              >
                {detections?.sweepInFlight ? 'Sweep running…' : triggeringSweep ? 'Starting…' : 'Run sweep now'}
              </button>
            </div>

            {consoleLoading && !detections ? (
              <p className="text-xs text-gray-500">Loading detections…</p>
            ) : !detections?.available ? (
              <p className="text-xs text-gray-500">
                {detections?.sweepInFlight
                  ? 'No sweep has completed yet — one is running now, this will update automatically.'
                  : 'No detector sweep has run yet on this server. Click "Run sweep now" for a real reading.'}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(['critical', 'high', 'medium', 'low', 'info'] as const).map((sev) => (
                    <span
                      key={sev}
                      className={`text-[11px] px-2 py-0.5 rounded border ${SEVERITY_COLOR[sev]}`}
                    >
                      {sev}: {bySeverity[sev] ?? 0}
                    </span>
                  ))}
                </div>
                {Object.keys(byConsumer).length > 0 && (
                  <div className="text-[11px] text-gray-500 mb-2">
                    By consumer:{' '}
                    {Object.entries(byConsumer).map(([c, n], i) => (
                      <span key={c}>
                        {i > 0 ? ', ' : ''}
                        {c} ({n})
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-gray-500 mb-1">
                  Last swept {timeAgo(detections.latestRunAt)} · {detections.detectorCount ?? 0} detectors
                </p>
                {(detections.findings || []).length > 0 && (
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {(detections.findings || []).slice(0, 20).map((f) => (
                      <div
                        key={`${f.detectorId}:${f.id}:${f.location || ''}`}
                        className="text-[11px] bg-lattice-deep rounded px-2 py-1 flex items-start gap-1.5"
                      >
                        <span className={`shrink-0 px-1 rounded border ${SEVERITY_COLOR[f.severity]}`}>
                          {f.severity}
                        </span>
                        <span className="text-gray-300">
                          <span className="text-gray-500">[{f.detectorId}]</span> {f.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Heartbeat health strip */}
          <div>
            <h4 className="text-xs font-semibold flex items-center gap-1.5 text-gray-300 mb-2">
              <HeartPulse className="w-3.5 h-3.5 text-neon-cyan" /> Heartbeat health (slowest 5)
            </h4>
            {topHeartbeats.length === 0 ? (
              <p className="text-xs text-gray-500">No heartbeat timing samples yet.</p>
            ) : (
              <div className="space-y-1">
                {topHeartbeats.map((m) => (
                  <div
                    key={m.id}
                    className="text-[11px] bg-lattice-deep rounded px-2 py-1 flex items-center justify-between gap-2"
                  >
                    <span className="text-gray-300 truncate">{m.id}</span>
                    <span className="text-gray-500 font-mono shrink-0">
                      p99 {Math.round(m.p99)}ms · runs {m.totalRuns}
                      {m.totalErrors > 0 && (
                        <span className="text-red-400"> · {m.totalErrors} err</span>
                      )}
                      {' · '}
                      {timeAgo(m.lastAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Governed remediations */}
          <div>
            <h4 className="text-xs font-semibold flex items-center gap-1.5 text-gray-300 mb-2">
              <ClipboardCheck className="w-3.5 h-3.5 text-green-400" /> Governed remediations
            </h4>
            {!remediations || remediations.length === 0 ? (
              <p className="text-xs text-gray-500">
                No governed actions available yet — nothing currently requires operator
                remediation.
              </p>
            ) : (
              <div className="space-y-1.5">
                {remediations.map((r) => (
                  <div key={r.id} className="text-[11px] bg-lattice-deep rounded px-2 py-1.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-300">
                        Restart heartbeat module <span className="font-mono">{r.moduleId}</span>
                      </span>
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded border ${
                          r.status === 'applied'
                            ? 'text-green-400 border-green-500/40'
                            : r.status === 'apply_failed'
                              ? 'text-red-400 border-red-500/40'
                              : r.status === 'rejected'
                                ? 'text-gray-500 border-gray-500/40'
                                : r.status === 'approved'
                                  ? 'text-blue-400 border-blue-500/40'
                                  : 'text-yellow-400 border-yellow-500/40'
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                    <p className="text-gray-500">{r.message}</p>
                    {(r.status === 'proposed' || r.status === 'approved') && (
                      <div className="flex gap-1.5 pt-0.5">
                        {r.status === 'proposed' && (
                          <button
                            onClick={() => approveRemediation(r.id)}
                            disabled={busyRemediationId === r.id}
                            className="px-2 py-0.5 rounded border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 disabled:opacity-50"
                          >
                            Approve
                          </button>
                        )}
                        {r.status === 'approved' && (
                          <button
                            onClick={() => applyRemediation(r.id)}
                            disabled={busyRemediationId === r.id}
                            className="px-2 py-0.5 rounded border border-green-500/40 text-green-400 hover:bg-green-500/10 disabled:opacity-50"
                          >
                            Apply
                          </button>
                        )}
                        <button
                          onClick={() => rejectRemediation(r.id)}
                          disabled={busyRemediationId === r.id}
                          className="px-2 py-0.5 rounded border border-lattice-border text-gray-400 hover:bg-white/5 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                    {r.status === 'apply_failed' && r.appliedResult?.error && (
                      <p className="text-red-400/80">{r.appliedResult.error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedRepairPanel = withErrorBoundary(RepairPanel);
export { _WrappedRepairPanel as RepairPanel };
