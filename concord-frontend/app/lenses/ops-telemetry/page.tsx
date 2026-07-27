'use client';

/**
 * Ops Telemetry Lens (Phase B + C + D + F)
 *
 * Operator surface for the concurrency / threading stack:
 *   - Per-module heartbeat timing (p50/p90/p99 + last run) — Phase B
 *   - Macro pool + heartbeat worker pool utilisation — Phase C
 *   - Brain endpoint inflight + failure counts — Phase D
 *   - Per-world shard status + manual restart — Phase F
 *
 * Reads from /api/admin/heartbeat-stats, /api/admin/worker-stats,
 * /api/admin/brain-endpoints, /api/admin/world-shards (all admin-gated).
 *
 * Auto-refreshes every 5 seconds while the tab is visible.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { LensShell } from '@/components/lens/LensShell';
import { AdminRequiredState } from '@/components/common/EmptyState';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LivenessPanel } from '@/components/admin/LivenessPanel';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useSmartPolling } from '@/hooks/useSmartPolling';
import { lensRun } from '@/lib/api/client';
import { Activity, Cpu, Brain, Globe, RefreshCcw, AlertTriangle, Layers, Radar, ShieldAlert, ArrowUpRight, Share2 } from 'lucide-react';

interface HeartbeatStatRow {
  id: string;
  frequency: number;
  scope: 'global' | 'world';
  serial: boolean;
  worker: boolean;
  sampleCount: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
  lastMs: number;
  lastAt: number;
  totalRuns: number;
}

interface PoolStats {
  poolSize: number;
  ready: boolean;
  busy: number;
  idle: number;
  queueLength: number;
  metrics: {
    dispatched: number;
    completed: number;
    errors: number;
    timeouts?: number;
    queueHighWater: number;
    avgLatencyMs: number;
  };
}

interface BrainEndpointRow {
  url: string;
  inflight: number;
  failures: number;
  lastHealthyAt: number;
}
interface BrainRow {
  brain: string;
  model: string;
  maxConcurrent: number | null;
  endpoints: BrainEndpointRow[];
}

interface WorldShardRow {
  worldId: string;
  status: string;
  pid: number | null;
  startedAt: number;
  lastTickAt: number;
  lastTickCount: number;
  restartCount: number;
}

// Wave E — simulation-scale rollup. Same real shape `worldstate.overview`
// returns (server/domains/world-overview.js), consumed here only as a
// platform-wide aggregate; the full per-world grid + drill-down already
// lives at /lenses/world-observatory (Wave D) — this section deliberately
// does not rebuild that view a second time.
interface WorldSummaryRow {
  worldId: string;
  name: string;
  activeUsers: number;
  factionCount: number;
  realmCount: number;
  districtCount: number;
  stuckFactionSchedulers: number;
}

// Federation mesh (#38) — real shape returned by `fedmesh.peers`
// (server/domains/fedmesh.js -> server/lib/federation-mesh.js#listPeers):
// `SELECT peer_id AS peerId, url, brain_url AS brainUrl, capabilities_json,
// revoked` with `capabilities` added as the parsed JSON array. `revoked`
// comes back as the raw SQLite integer (0/1), not a JS boolean.
interface FedmeshPeerRow {
  peerId: string;
  url: string | null;
  brainUrl: string | null;
  capabilities: string[];
  revoked: number | boolean;
}

export default function OpsTelemetryPage() {
  const [hbStats, setHbStats] = useState<HeartbeatStatRow[]>([]);
  const [macroPool, setMacroPool] = useState<PoolStats | null>(null);
  const [hbPool, setHbPool] = useState<PoolStats | null>(null);
  const [brains, setBrains] = useState<BrainRow[]>([]);
  const [brainActivity, setBrainActivity] = useState<Array<{ brain: string; role: string; model: string; enabled: boolean; requests: number; errors: number; dtusGenerated: number; avgMs: number; idleSeconds: number | null }>>([]);
  const [shards, setShards] = useState<WorldShardRow[]>([]);
  const [sharded, setSharded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  // Wave 7 / D2 — the cost-story telemetry ("a thousand NPCs for the cost of ten").
  const [costs, setCosts] = useState<{ calls: number; tokensIn: number; tokensOut: number; costLabel: string; byBrain: Record<string, { calls: number }> } | null>(null);
  // Wave E — simulation-overview rollup (worldstate.overview). `null` means
  // "not yet fetched successfully" (honest loading/error), distinct from `[]`
  // which means "fetched fine, zero worlds on this instance."
  const [simWorlds, setSimWorlds] = useState<WorldSummaryRow[] | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  // Federation mesh (#38) — `null` means "not yet fetched successfully"
  // (honest loading/error), distinct from `[]` (fetched fine, zero peers
  // registered on this instance).
  const [fedPeers, setFedPeers] = useState<FedmeshPeerRow[] | null>(null);
  const [fedPeersError, setFedPeersError] = useState<string | null>(null);
  // The automatic `fedmesh-sync-cycle` heartbeat drains the inbox on its own
  // clock but its per-run accepted/rejected counts aren't captured anywhere
  // queryable (the heartbeat-timing ring only stores timing, not handler
  // return values — see server/emergent/heartbeat-registry.js `_timingMeta`).
  // A manual drain trigger is the only way to show a REAL accepted/rejected
  // result rather than fabricating a "synced" state.
  const [fedDraining, setFedDraining] = useState(false);
  const [fedDrainResult, setFedDrainResult] = useState<{ accepted: number; rejected: number; at: number } | null>(null);
  const [fedDrainError, setFedDrainError] = useState<string | null>(null);
  // Wave 4 gap-closure — this page's own refresh() and LivenessPanel's
  // internal refresh used to run on two independent, uncoordinated 5s
  // setIntervals (two unjittered network round-trips every 5s). This page
  // now owns the single interval and bumps livenessTick each tick;
  // LivenessPanel refetches off that shared token instead of its own timer.
  const [livenessTick, setLivenessTick] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      // Probe the first admin endpoint status-aware so a 403 renders the friendly
      // admin-gate instead of a stuck spinner / empty tables.
      const hbRes = await fetch('/api/admin/heartbeat-stats', { credentials: 'include' });
      if (hbRes.status === 403) { setForbidden(true); return; }
      const hb = await hbRes.json().catch(() => null);
      const [wp, be, ws, ic, ba] = await Promise.all([
        fetch('/api/admin/worker-stats', { credentials: 'include' }).then(r => r.json()).catch(() => null),
        fetch('/api/admin/brain-endpoints', { credentials: 'include' }).then(r => r.json()).catch(() => null),
        fetch('/api/admin/world-shards', { credentials: 'include' }).then(r => r.json()).catch(() => null),
        fetch('/api/admin/inference-costs?hours=24', { credentials: 'include' }).then(r => r.json()).catch(() => null),
        fetch('/api/admin/brain-activity', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      ]);
      if (hb?.ok) setHbStats(hb.modules || []);
      if (wp?.ok) { setMacroPool(wp.macroPool || null); setHbPool(wp.heartbeatPool || null); }
      if (be?.ok) setBrains(be.brains || []);
      if (ba?.ok) setBrainActivity(ba.brains || []);
      if (ws?.ok) { setShards(ws.shards || []); setSharded(!!ws.sharded); }
      if (ic?.ok) setCosts({ calls: ic.calls, tokensIn: ic.tokensIn, tokensOut: ic.tokensOut, costLabel: ic.costLabel, byBrain: ic.byBrain || {} });

      // Wave E — worldstate.overview is a lens macro (POST /api/lens/run),
      // not one of the /api/admin/* REST endpoints above, so it goes through
      // lensRun rather than fetch. Never fabricate: a failed/empty response
      // clears simWorlds to null (honest "couldn't load") rather than
      // leaving a stale number on screen.
      try {
        const simRes = await lensRun<{ ok: boolean; worlds?: WorldSummaryRow[]; reason?: string }>(
          'worldstate',
          'overview',
          {},
        );
        const simPayload = simRes.data.result;
        if (simRes.data.ok && simPayload?.ok) {
          setSimWorlds(simPayload.worlds || []);
          setSimError(null);
        } else {
          setSimWorlds(null);
          setSimError(simRes.data.error || simPayload?.reason || 'Failed to load simulation overview');
        }
      } catch (e) {
        setSimWorlds(null);
        setSimError(e instanceof Error ? e.message : String(e));
      }

      // Federation mesh (#38) — real peer registry via the `fedmesh.peers`
      // lens macro (POST /api/lens/run), not a REST endpoint, so it goes
      // through lensRun like worldstate.overview above. `includeRevoked:
      // true` so the operator can see revoked peers too, not just active
      // ones. Never fabricate: a failed/empty response clears fedPeers to
      // null (honest "couldn't load") rather than leaving a stale list.
      try {
        const fedRes = await lensRun<{ ok: boolean; peers?: FedmeshPeerRow[]; reason?: string }>(
          'fedmesh',
          'peers',
          { includeRevoked: true },
        );
        const fedPayload = fedRes.data.result;
        if (fedRes.data.ok && fedPayload?.ok) {
          setFedPeers(fedPayload.peers || []);
          setFedPeersError(null);
        } else {
          setFedPeers(null);
          setFedPeersError(fedRes.data.error || fedPayload?.reason || 'Failed to load federation peers');
        }
      } catch (e) {
        setFedPeers(null);
        setFedPeersError(e instanceof Error ? e.message : String(e));
      }

      setLastRefresh(new Date());
      setHasLoadedOnce(true);
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  // Background refresh — tab-visibility-paused + jittered (see
  // hooks/useSmartPolling.ts; it already skips the tick while the tab is
  // hidden, so the manual `document.visibilityState` check the raw interval
  // used to do here is no longer needed). `immediate: false` since the
  // effect above already covers the mount-time call.
  useSmartPolling(() => {
    refresh();
    setLivenessTick((t) => t + 1);
  }, 5000, { immediate: false });

  const restartShard = useCallback(async (worldId: string) => {
    try {
      await fetch(`/api/admin/world-shards/${encodeURIComponent(worldId)}/restart`, {
        method: 'POST',
        credentials: 'include',
      });
      refresh();
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    }
  }, [refresh]);

  // Federation mesh (#38) — operator-triggered drain. `fedmesh.drain` calls
  // the real `drainInbox()` and returns its real { accepted, rejected }
  // counts for THIS call only; it is never auto-fired on the 5s poll
  // interval (that would silently race the automatic fedmesh-sync-cycle
  // heartbeat and make "who drained this" unclear) — it's an explicit
  // operator action with an explicit, honest result.
  const drainFedmeshInbox = useCallback(async () => {
    setFedDraining(true);
    setFedDrainError(null);
    try {
      const res = await lensRun<{ ok: boolean; accepted?: number; rejected?: number; reason?: string }>(
        'fedmesh',
        'drain',
        {},
      );
      const payload = res.data.result;
      if (res.data.ok && payload?.ok) {
        setFedDrainResult({ accepted: payload.accepted ?? 0, rejected: payload.rejected ?? 0, at: Date.now() });
      } else {
        setFedDrainResult(null);
        setFedDrainError(res.data.error || payload?.reason || 'Drain failed');
      }
    } catch (e) {
      setFedDrainResult(null);
      setFedDrainError(e instanceof Error ? e.message : String(e));
    } finally {
      setFedDraining(false);
    }
  }, []);

  // Discoverable keyboard shortcut: "r" forces an immediate refresh instead of
  // waiting for the next 5s tick (Grafana/Datadog convention). Registers in the
  // command palette + help modal via useLensCommand — not just a hidden handler.
  useLensCommand(
    [
      { id: 'refresh', keys: 'r', description: 'Refresh telemetry now', category: 'actions', action: refresh },
    ],
    { lensId: 'ops-telemetry' }
  );

  // Wave E — real client-side rollup over the real per-world array. Every
  // number here is a genuine sum/count of `simWorlds`, never a placeholder —
  // when simWorlds is null (not yet loaded / load failed) the rollup is
  // null too, so the section renders an honest state instead of "0".
  const simTotals = useMemo(() => {
    if (!simWorlds) return null;
    return simWorlds.reduce(
      (acc, w) => ({
        activeUsers: acc.activeUsers + (w.activeUsers || 0),
        factionCount: acc.factionCount + (w.factionCount || 0),
        realmCount: acc.realmCount + (w.realmCount || 0),
        districtCount: acc.districtCount + (w.districtCount || 0),
        worldsWithWarnings: acc.worldsWithWarnings + (w.stuckFactionSchedulers > 0 ? 1 : 0),
        stuckSchedulers: acc.stuckSchedulers + (w.stuckFactionSchedulers || 0),
      }),
      { activeUsers: 0, factionCount: 0, realmCount: 0, districtCount: 0, worldsWithWarnings: 0, stuckSchedulers: 0 },
    );
  }, [simWorlds]);

  // Federation mesh (#38) — the automatic sync cadence is real telemetry
  // already fetched above (hbStats), not new plumbing: find the
  // `fedmesh-sync-cycle` row (server/emergent/fedmesh-sync-cycle.js,
  // frequency 120) by id. `lastAt`/`totalRuns` come straight from the
  // heartbeat-registry's timing ring, so "last ran Ns ago" is genuine.
  const fedSyncModule = useMemo(
    () => hbStats.find((m) => m.id === 'fedmesh-sync-cycle') ?? null,
    [hbStats],
  );
  const fedActivePeers = useMemo(() => (fedPeers ? fedPeers.filter((p) => !p.revoked).length : null), [fedPeers]);
  const fedRevokedPeers = useMemo(() => (fedPeers ? fedPeers.filter((p) => !!p.revoked).length : null), [fedPeers]);

  if (forbidden) return (
    <LensShell lensId="ops-telemetry" asMain={false}>
      {/* requireRole gate on every /api/admin/* route this lens reads is
          owner|admin|sovereign|founder (server.js) — "operator" is not a real
          role in the backend's role enum, so naming it here as sufficient
          access would send an operator chasing a role that can never work. */}
      <AdminRequiredState roles={['owner', 'admin', 'sovereign', 'founder']} />
    </LensShell>
  );

  // Initial load: show a genuine loading state (not stale empty tables) until the
  // first fetch settles.
  if (!hasLoadedOnce && loading && !err) return (
    <LensShell lensId="ops-telemetry" asMain={false}>
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading ops telemetry"
        className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-950 text-slate-300"
      >
        <RefreshCcw className="h-6 w-6 animate-spin text-fuchsia-400" aria-hidden="true" />
        <p className="text-sm">Loading telemetry…</p>
      </div>
    </LensShell>
  );

  // Initial fetch failed outright (network / server down) — show a clear error
  // with a working Retry, rather than empty tables.
  if (!hasLoadedOnce && err) return (
    <LensShell lensId="ops-telemetry" asMain={false}>
      <div
        role="alert"
        aria-label="Ops telemetry failed to load"
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center text-slate-300"
      >
        <AlertTriangle className="h-7 w-7 text-red-400" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-red-200">Telemetry failed to load</p>
          <p className="mt-1 max-w-md text-xs text-slate-400 break-words">{err}</p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-medium text-fuchsia-300 hover:bg-fuchsia-500/20 disabled:opacity-50"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          {loading ? 'retrying…' : 'Retry'}
        </button>
      </div>
    </LensShell>
  );

  return (
    <LensShell lensId="ops-telemetry" asMain={false}>
      <ManifestActionBar />
      <DepthBadge lensId="ops-telemetry" size="sm" className="ml-2" />
      <main aria-label="Ops telemetry dashboard" className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-fuchsia-950/10 text-slate-100">
        <header className="border-b border-fuchsia-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 p-2">
              <Activity className="h-5 w-5 text-fuchsia-400" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Ops Telemetry</h1>
              <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
                Concurrency stack — heartbeat timings, worker pools, brain endpoints, world shards.
              </p>
            </div>
            <button onClick={refresh} disabled={loading} aria-label="Refresh telemetry" className="flex items-center gap-1.5 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-medium text-fuchsia-300 hover:bg-fuchsia-500/20 disabled:opacity-60">
              <RefreshCcw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> {loading ? 'refreshing…' : 'refresh'}
              <kbd className="ml-0.5 rounded border border-fuchsia-500/30 bg-black/30 px-1 text-[9px] font-mono text-fuchsia-300/80">R</kbd>
            </button>
            {loading && <span role="status" aria-live="polite" className="sr-only">Refreshing telemetry</span>}
          </div>
          {err && (
            <div role="alert" className="mx-auto mt-2 flex max-w-screen-2xl items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-200">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> <span className="flex-1 break-words">{err}</span>
              <button onClick={refresh} disabled={loading} className="shrink-0 rounded border border-red-400/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-100 hover:bg-red-500/20 disabled:opacity-50">
                Retry
              </button>
            </div>
          )}
          {lastRefresh && (
            <div className="mx-auto mt-1 max-w-screen-2xl text-[10px] text-slate-500">last refreshed {lastRefresh.toLocaleTimeString()}</div>
          )}
        </header>

        <section className="mx-auto grid max-w-screen-2xl gap-4 px-3 py-4 sm:px-6 sm:py-5">
          {/* F2 — substrate liveness (the moat-mass + funnel/distribution/economy headline) */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <LivenessPanel refreshToken={livenessTick} />
          </div>

          {/* Wave E — Simulation Overview. This lens was infra-health-only
              (heartbeat timing, worker pools, brain endpoints, world shards)
              with zero simulation *content* visibility — the natural "one
              place operators look" didn't cover population/faction/realm/
              district state at all. Rather than re-render the full per-world
              grid + drill-down here (that's /lenses/world-observatory's job,
              Wave D), this is a single honest platform-wide rollup + a
              deep-link — a dashboard-of-dashboards summary, not a duplicate. */}
          <div data-testid="simulation-overview-panel" className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-cyan-300">
                <Radar className="h-4 w-4" /> Simulation overview
                <span className="text-[10px] font-normal normal-case text-slate-400">
                  population / faction / realm / district, platform-wide
                </span>
              </h2>
              <Link
                href="/lenses/world-observatory"
                className="flex shrink-0 items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-300 hover:bg-cyan-500/20"
              >
                Full observatory <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </div>
            {simError && !simTotals && (
              <div role="alert" className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-200">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> <span className="flex-1 break-words">{simError}</span>
              </div>
            )}
            {!simError && simTotals && simWorlds && simWorlds.length === 0 && (
              <p className="text-[11px] text-slate-500">No worlds detected on this instance.</p>
            )}
            {simTotals && simWorlds && simWorlds.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Metric label="worlds" value={String(simWorlds.length)} />
                <Metric label="active users" value={simTotals.activeUsers.toLocaleString()} />
                <Metric label="factions" value={simTotals.factionCount.toLocaleString()} />
                <Metric label="realms" value={simTotals.realmCount.toLocaleString()} />
                <Metric label="districts" value={simTotals.districtCount.toLocaleString()} />
                <div className={`rounded-lg border px-2.5 py-1.5 ${simTotals.worldsWithWarnings > 0 ? 'border-red-500/40 bg-red-500/10' : 'border-zinc-800 bg-zinc-950/40'}`}>
                  <div className={`flex items-center gap-1 text-[10px] uppercase tracking-wider ${simTotals.worldsWithWarnings > 0 ? 'text-red-300' : 'text-slate-500'}`}>
                    {simTotals.worldsWithWarnings > 0 && <ShieldAlert className="h-3 w-3" aria-hidden="true" />} worlds w/ warnings
                  </div>
                  <div className={`mt-0.5 text-sm font-semibold tabular-nums ${simTotals.worldsWithWarnings > 0 ? 'text-red-200' : 'text-slate-100'}`}>
                    {simTotals.worldsWithWarnings}
                    {simTotals.stuckSchedulers > 0 && (
                      <span className="ml-1 text-[10px] font-normal text-red-300/80">
                        ({simTotals.stuckSchedulers} stuck scheduler{simTotals.stuckSchedulers === 1 ? '' : 's'})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
            {!simTotals && !simError && (
              <p className="text-[11px] text-slate-500">no simulation data loaded</p>
            )}
          </div>

          {/* Federation mesh (#38) — server/domains/fedmesh.js + lib/federation-mesh.js
              is a real DB-backed peer registry + consent-gated inbox that, until a
              sibling unit added server/emergent/fedmesh-sync-cycle.js, had zero
              frontend surface anywhere. This card shows the real peer list
              (fedmesh.peers), the real automatic-sync cadence (the
              fedmesh-sync-cycle row already present in hbStats above), and a
              manual drain trigger whose result is the macro's own real
              { accepted, rejected } counts — never a fabricated "Synced ✓". */}
          <div data-testid="fedmesh-panel" className="rounded-xl border border-violet-500/20 bg-violet-500/[0.03] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-violet-300">
                <Share2 className="h-4 w-4" /> Federation mesh
                <span className="text-[10px] font-normal normal-case text-slate-400">
                  peer registry + consent-gated inbox (#38)
                </span>
              </h2>
              <button
                onClick={drainFedmeshInbox}
                disabled={fedDraining}
                className="flex shrink-0 items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-300 hover:bg-violet-500/20 disabled:opacity-50"
              >
                <RefreshCcw className={`h-3 w-3 ${fedDraining ? 'animate-spin' : ''}`} aria-hidden="true" />
                {fedDraining ? 'draining…' : 'Drain inbox now'}
              </button>
            </div>

            {fedPeersError && !fedPeers && (
              <div role="alert" className="mb-2 flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-200">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> <span className="flex-1 break-words">{fedPeersError}</span>
              </div>
            )}
            {!fedPeers && !fedPeersError && (
              <p className="mb-2 text-[11px] text-slate-500">no peer data loaded</p>
            )}
            {fedPeers && fedPeers.length === 0 && (
              <p className="mb-2 text-[11px] text-slate-500">No peers registered.</p>
            )}
            {fedPeers && fedPeers.length > 0 && (
              <div className="mb-2 overflow-x-auto">
                <table className="w-full text-[11px]" aria-label="Federation peers">
                  <caption className="sr-only">Registered federation mesh peers, their endpoints, capabilities, and revoked status</caption>
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-slate-400">
                      <th scope="col" className="px-2 py-1.5">peer</th>
                      <th className="px-2 py-1.5">url</th>
                      <th className="px-2 py-1.5">brain url</th>
                      <th className="px-2 py-1.5">capabilities</th>
                      <th className="px-2 py-1.5">status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fedPeers.map((p) => (
                      <tr key={p.peerId} className="border-b border-zinc-900">
                        <td className="px-2 py-1 font-mono text-slate-200">{p.peerId}</td>
                        <td className="px-2 py-1 font-mono text-slate-400">{p.url || '—'}</td>
                        <td className="px-2 py-1 font-mono text-slate-400">{p.brainUrl || '—'}</td>
                        <td className="px-2 py-1 text-slate-400">{p.capabilities?.length ? p.capabilities.join(', ') : '—'}</td>
                        <td className="px-2 py-1">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] ${p.revoked ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                            {p.revoked ? 'revoked' : 'active'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric label="known peers" value={fedPeers ? String(fedPeers.length) : '—'} />
              <Metric label="active peers" value={fedActivePeers !== null ? String(fedActivePeers) : '—'} />
              <Metric label="revoked peers" value={fedRevokedPeers !== null ? String(fedRevokedPeers) : '—'} />
            </div>

            <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-2.5 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">automatic sync (fedmesh-sync-cycle heartbeat)</div>
              {fedSyncModule ? (
                <p className="mt-0.5 text-[11px] text-slate-300">
                  last ran {fedSyncModule.lastAt ? `${Math.round((Date.now() - fedSyncModule.lastAt) / 1000)}s ago` : 'never'} · {fedSyncModule.totalRuns} run{fedSyncModule.totalRuns === 1 ? '' : 's'} since boot
                </p>
              ) : (
                <p className="mt-0.5 text-[11px] text-slate-500">no heartbeat sample yet (runs every 120 ticks — give it time)</p>
              )}
              <p className="mt-1 text-[10px] text-slate-500">
                The heartbeat&apos;s own per-run accepted/rejected counts aren&apos;t exposed by telemetry (only that it ran) — use &quot;Drain inbox now&quot; for a real, visible result.
              </p>
            </div>

            {fedDrainError && (
              <div role="alert" className="mt-2 flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-200">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> <span className="flex-1 break-words">{fedDrainError}</span>
              </div>
            )}
            {fedDrainResult && (
              <p className="mt-2 text-[11px] text-emerald-300">
                Manual drain at {new Date(fedDrainResult.at).toLocaleTimeString()}: {fedDrainResult.accepted} accepted, {fedDrainResult.rejected} rejected.
              </p>
            )}
          </div>

          {/* Wave 7 / D2 — the cost-story telemetry: LLM calls track SALIENT exchanges,
              not population. "A thousand instinct NPCs for the cost of ten." */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-emerald-300">
              <Brain className="h-4 w-4" /> Inference cost (24h)
              <span className="text-[10px] font-normal text-slate-400">LLM wakes only on salience</span>
            </h2>
            {costs ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="LLM calls" value={costs.calls.toLocaleString()} />
                <Metric label="Tokens in" value={costs.tokensIn.toLocaleString()} />
                <Metric label="Tokens out" value={costs.tokensOut.toLocaleString()} />
                <Metric label="Est. cost" value={costs.costLabel} />
                {Object.entries(costs.byBrain).map(([brain, b]) => (
                  <Metric key={brain} label={brain} value={`${b.calls} calls`} />
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">No inference recorded in the window — the village is living on instinct.</p>
            )}
          </div>

          {/* Worker pools */}
          <div className="grid gap-3 lg:grid-cols-2">
            <PoolCard title="Macro worker pool" icon={Cpu} stats={macroPool} />
            <PoolCard title="Heartbeat worker pool" icon={Cpu} stats={hbPool} />
          </div>

          {/* Heartbeat modules */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-fuchsia-300">
              <Layers className="h-4 w-4" /> Heartbeat modules
              <span className="text-[10px] font-normal text-slate-400">sorted by p99 (slowest first)</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]" aria-label="Heartbeat module timings">
                <caption className="sr-only">Per-module heartbeat timing percentiles, sorted by p99 (slowest first)</caption>
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-slate-400">
                    <th scope="col" className="px-2 py-1.5">module</th>
                    <th className="px-2 py-1.5">freq</th>
                    <th className="px-2 py-1.5">scope</th>
                    <th className="px-2 py-1.5">tags</th>
                    <th className="px-2 py-1.5 text-right">last</th>
                    <th className="px-2 py-1.5 text-right">p50</th>
                    <th className="px-2 py-1.5 text-right">p90</th>
                    <th className="px-2 py-1.5 text-right">p99</th>
                    <th className="px-2 py-1.5 text-right">runs</th>
                  </tr>
                </thead>
                <tbody>
                  {hbStats.length === 0 && (
                    <tr><td colSpan={9} className="px-2 py-4 text-center text-slate-500">no samples yet (tick interval 60s — give it a minute)</td></tr>
                  )}
                  {hbStats.slice(0, 80).map((m) => (
                    <tr key={m.id} className={`border-b border-zinc-900 ${m.p99 > 10000 ? 'bg-red-500/10' : m.p99 > 5000 ? 'bg-amber-500/10' : ''}`}>
                      <td className="px-2 py-1 font-mono text-slate-200">{m.id}</td>
                      <td className="px-2 py-1 text-slate-400">{m.frequency}</td>
                      <td className="px-2 py-1 text-slate-400">{m.scope}</td>
                      <td className="px-2 py-1 text-slate-400">
                        {m.worker && <span className="mr-1 rounded bg-fuchsia-500/20 px-1 text-fuchsia-300">worker</span>}
                        {m.serial && <span className="rounded bg-amber-500/20 px-1 text-amber-300">serial</span>}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-slate-300">{m.lastMs.toFixed(1)}ms</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-400">{m.p50.toFixed(1)}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-400">{m.p90.toFixed(1)}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-200">{m.p99.toFixed(1)}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-500">{m.totalRuns}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hbStats.length > 80 && (
                <p className="mt-1 text-[10px] text-slate-500">
                  showing the 80 slowest of {hbStats.length} modules by p99 — the rest are faster and less actionable
                </p>
              )}
            </div>
          </div>

          {/* Brain endpoints */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-emerald-300">
              <Brain className="h-4 w-4" /> Brain endpoints (Phase D)
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {brains.map((b) => (
                <div key={b.brain} className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[12px] text-emerald-200">{b.brain}</span>
                    <span className="text-[10px] text-emerald-300/70">max={b.maxConcurrent ?? '—'}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-emerald-300/60">{b.model}</p>
                  <ul className="mt-2 space-y-1">
                    {b.endpoints.map((ep) => {
                      const stale = ep.lastHealthyAt > 0 && (Date.now() - ep.lastHealthyAt) > 60_000;
                      const wedged = ep.failures >= 3;
                      return (
                        <li key={ep.url} className={`flex items-center justify-between rounded px-2 py-1 ${wedged ? 'bg-red-500/20' : stale ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}>
                          <span className="truncate font-mono text-[10px] text-emerald-100">{ep.url}</span>
                          <span className="ml-2 shrink-0 font-mono text-[10px] text-emerald-200">
                            inflight={ep.inflight} fail={ep.failures}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {brains.length === 0 && <p className="text-[11px] text-slate-500">no endpoints loaded</p>}
            </div>
          </div>

          {/* Brain activity — per-brain division of labor (aggregate counts only, no content) */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-cyan-300">
              <Activity className="h-4 w-4" /> Brain activity
              <span className="ml-1 text-[10px] font-normal normal-case text-slate-500">who&apos;s pulling their weight (counts only)</span>
            </h2>
            <div className="space-y-1.5">
              {brainActivity.map((b) => {
                const live = b.idleSeconds != null && b.idleSeconds < 120;
                return (
                  <div key={b.brain} className="flex items-center justify-between rounded border border-zinc-800/60 bg-black/20 px-2 py-1 text-[11px]">
                    <div className="min-w-0">
                      <span className="font-mono font-semibold text-slate-200">{b.brain}</span>
                      <span className="ml-2 text-slate-400">{b.role}</span>
                      <div className="text-[10px] text-slate-500">{b.model}{!b.enabled && ' · offline'}</div>
                    </div>
                    <div className="flex items-center gap-3 text-right tabular-nums">
                      <span className="text-cyan-300" title="total requests">{b.requests}<span className="text-slate-500"> req</span></span>
                      {b.errors > 0 && <span className="text-red-400" title="errors">{b.errors} err</span>}
                      <span className="text-slate-400" title="avg latency">{b.avgMs}ms</span>
                      <span className={live ? 'text-emerald-400' : 'text-slate-500'} title="last active">
                        {b.idleSeconds == null ? 'idle' : live ? '● active' : `${b.idleSeconds}s ago`}
                      </span>
                    </div>
                  </div>
                );
              })}
              {brainActivity.length === 0 && <p className="text-[11px] text-slate-500">no brain activity loaded</p>}
            </div>
          </div>

          {/* World shards */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-cyan-300">
              <Globe className="h-4 w-4" /> World shards (Phase F)
              <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${sharded ? 'bg-cyan-500/20 text-cyan-200' : 'bg-slate-500/20 text-slate-300'}`}>
                {sharded ? 'enabled' : 'disabled — in-process'}
              </span>
            </h2>
            {!sharded ? (
              <p className="text-[11px] text-slate-400">
                CONCORD_SHARD_WORLDS=false. Per-world heartbeat modules run in-process on the parent.
                Enable in <code className="rounded bg-slate-800 px-1">.env</code> to shard worlds into child processes.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]" aria-label="World shard status">
                  <caption className="sr-only">Per-world shard process status, last tick, restart count, and restart action</caption>
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-slate-400">
                      <th scope="col" className="px-2 py-1.5">world</th>
                      <th className="px-2 py-1.5">status</th>
                      <th className="px-2 py-1.5">pid</th>
                      <th className="px-2 py-1.5 text-right">last tick</th>
                      <th className="px-2 py-1.5 text-right">restart count</th>
                      <th className="px-2 py-1.5 text-right">action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shards.length === 0 && (
                      <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-500">no shards spawned</td></tr>
                    )}
                    {shards.map((s) => (
                      <tr key={s.worldId} className={`border-b border-zinc-900 ${s.status === 'crashed' ? 'bg-red-500/10' : s.status === 'catching-up' ? 'bg-amber-500/10' : ''}`}>
                        <td className="px-2 py-1 font-mono text-slate-200">{s.worldId}</td>
                        <td className="px-2 py-1 text-slate-300">{s.status}</td>
                        <td className="px-2 py-1 font-mono text-slate-400">{s.pid ?? '—'}</td>
                        <td className="px-2 py-1 text-right font-mono text-slate-400">{s.lastTickAt ? `${Math.round((Date.now() - s.lastTickAt) / 1000)}s ago` : '—'}</td>
                        <td className="px-2 py-1 text-right font-mono text-slate-400">{s.restartCount}</td>
                        <td className="px-2 py-1 text-right">
                          <button onClick={() => restartShard(s.worldId)} aria-label={`Restart shard ${s.worldId}`} className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/20">restart</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>
    </LensShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-100">{value}</div>
    </div>
  );
}

function PoolCard({ title, icon: Icon, stats }: { title: string; icon: React.ComponentType<{ className?: string }>; stats: PoolStats | null }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-fuchsia-300">
        <Icon className="h-4 w-4" /> {title}
      </h2>
      {stats ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="pool size" value={String(stats.poolSize)} />
          <Stat label="busy" value={String(stats.busy)} />
          <Stat label="idle" value={String(stats.idle)} />
          <Stat label="queued" value={String(stats.queueLength)} />
          <Stat label="dispatched" value={String(stats.metrics.dispatched)} />
          <Stat label="completed" value={String(stats.metrics.completed)} />
          <Stat label="errors" value={String(stats.metrics.errors)} />
          <Stat label="avg ms" value={`${stats.metrics.avgLatencyMs}`} />
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">pool stats unavailable</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-fuchsia-500/10 p-2">
      <div className="text-[10px] uppercase tracking-wider text-fuchsia-300/80">{label}</div>
      <div className="font-mono text-[12px] text-fuchsia-100">{value}</div>
    </div>
  );
}
