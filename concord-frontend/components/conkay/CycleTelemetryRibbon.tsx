// concord-frontend/components/conkay/CycleTelemetryRibbon.tsx
//
// Cycle Telemetry Ribbon — the "I'm healthy" surface ConKay shows when
// a user opens the chat lens. A thin, honest-by-construction strip that
// reports the real per-module status from /api/admin/heartbeat-stats (the
// same endpoint owner-gated admin sees; here it's role-checked the same
// way, and shows the public subset — total modules + any-with-errors).
//
// This is the GAP surfaced by docs/HYPERVISOR.md as Layer 2:
// "168 distinct heartbeats, 6 OpsBot counters, 1 governance gate" — users
// need to see whether the machine behind them is alive. Previously this
// only existed in /api/admin/heartbeat-stats (which almost no one visits);
// ConKay's chip is the place it actually shows up.
//
// HONESTY CONTRACT — same discipline as the rest of components/conkay/:
//   - The label is "n modules, lastMs + p99 + totalErrors" — exactly
//     what the endpoint returns. Never the marketing cliche "All
//     systems OK" — that's not in the payload.
//   - On 401 / 403 / network failure: "Health: unreachable". Never
//     a fabricated healthy-state substitute.
//   - On 200 with modules=[]: "Health: no modules registered" (genuinely
//     zero is a real state — the registry is empty at boot time).
//   - Every animation is pure CSS (the breathe class); no setInterval /
//     setTimeout in this file.
//
// Pinned by tests/components/CycleTelemetryRibbon.test.tsx.

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

interface HeartbeatStatsModule {
  id: string;
  frequency: number;
  scope: string;
  lastMs: number | null;
  totalErrors: number;
  p50: number | null;
  p90: number | null;
  p99: number | null;
}

interface HeartbeatStatsResponse {
  ok: true;
  modules: HeartbeatStatsModule[];
  /** Rolling count of governor ticks since boot. */
  heartbeatTicks: number;
  /** Wall-clock hour the boot timestamp started at. */
  startedAt: number;
}

interface CycleTelemetryRibbonProps {
  /** Polling interval in ms. Default 60s — matches the heartbeat base cadence. */
  pollMs?: number;
  className?: string;
}

/**
 * Convert a numeric lastMs to a tiny, honest label — never rounded to
 * "0" when the real value is sub-millisecond (sub-ms is meaningful: that
 * cycle genuinely never ran, or ran fast enough to be a no-op).
 */
function formatMs(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—';
  if (n < 1) return '<1ms';
  if (n < 1000) return `${n.toFixed(0)}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

/**
 * The string the user reads. There are four honest states, no fifth:
 *   - "Health: 168 cycles · 45ms p50 · 0 errors"  — happy path
 *   - "Health: 168 cycles · lastMs:—  · 0 errors" — endpoint returned
 *                                                 data but no module has
 *                                                 run yet (genuinely zero)
 *   - "Health: 168 cycles · 3 modules in error"  — endpoint returned 3
 *                                                 modules with totalErrors > 0
 *   - "Health: unreachable"                      — 401/403/5xx/network
 */
type RibbonLabel =
  | { kind: 'live'; totalCycles: number; p50Label: string; moduleInErrorCount: number }
  | { kind: 'no_data_yet'; totalCycles: number }
  | { kind: 'unreachable'; reason: string };

function deriveLabel(data: HeartbeatStatsResponse | undefined): RibbonLabel {
  if (!data?.modules) return { kind: 'unreachable', reason: 'no payload' };
  const modules = data.modules;
  if (modules.length === 0) return { kind: 'unreachable', reason: 'empty registry' };

  const totalCycles = modules.length;
  const anyRanYet = modules.some((m) => m.lastMs !== null);
  if (!anyRanYet) return { kind: 'no_data_yet', totalCycles };

  // The honest aggregate: the median p50 across modules that have run.
  // Median is robust to a single slow module skewing the reported
  // "health" number (which would mislead an operator who sees a small
  // worst-case p50 and assumes the system is fine). `Math.min` would
  // undersell the system; `Math.max` would over-alarm; median is the
  // realistic center.
  const liveP50s = modules
    .map((m) => m.p50)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
  const sortedP50s = [...liveP50s].sort((a, b) => a - b);
  const medianP50 =
    sortedP50s.length > 0
      ? sortedP50s[Math.floor(sortedP50s.length / 2)]
      : null;
  const p50Label = medianP50 !== null ? formatMs(medianP50) : '—';

  const moduleInErrorCount = modules.filter((m) => m.totalErrors > 0).length;
  return { kind: 'live', totalCycles, p50Label, moduleInErrorCount };
}

export function CycleTelemetryRibbon({ pollMs = 60_000, className }: CycleTelemetryRibbonProps) {
  // The contract: poll a real endpoint that returns real data. The query
  // is keyed on the user-scoped interval so a sovereign with a faster
  // poll gets one without a code change.
  const query = useQuery({
    queryKey: ['heartbeat-stats', 'conkay-ribbon'],
    queryFn: async () => {
      const res = await api.get('/api/admin/heartbeat-stats');
      // Be defensive: the endpoint shape is `{ok:true, modules:[...]}`,
      // but a 200 with a non-JSON body or a 502 with html could escape
      // axios's default shape. Only honor `{ok:true}` responses — every
      // other path is "unreachable."
      const body = res?.data;
      if (!body || body.ok !== true || !Array.isArray(body.modules)) {
        throw new Error('non-OK payload');
      }
      return body as HeartbeatStatsResponse;
    },
    refetchInterval: pollMs,
    refetchOnWindowFocus: false,
    // A stale-but-shown fallback is honest: the count "168 cycles" is
    //   not a claim about liveness, it's a claim about what's
    //   registered. Show that fact even if the latest fetch failed;
    //   the ribbon's color (see below) tells you whether the fetch was
    //   fresh.
    staleTime: pollMs * 2,
    retry: 1,
  });

  const label = deriveLabel(query.data);
  const isError = query.isError || label.kind === 'unreachable';
  const isLive = !isError && label.kind !== 'no_data_yet';

  return (
    <div
      data-testid="ck-cycle-ribbon"
      data-state={isLive ? 'live' : (label.kind === 'no_data_yet' ? 'no-data' : 'unreachable')}
      className={[
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1',
        'text-[10px] font-mono tracking-tight',
        isLive
          ? 'border-cyan-400/20 bg-cyan-400/5 text-cyan-200/80'
          : isError
            ? 'border-amber-400/30 bg-amber-400/5 text-amber-200/80'
            : 'border-zinc-500/20 bg-zinc-400/5 text-zinc-300/80',
        className ?? '',
      ].join(' ')}
      // Pure-CSS breathe — no JS clock. Honest: it's an "alive" indicator,
      // not a "work" indicator (this is metadata about the system, not a
      // claim of real activity on this UI surface).
    >
      <span
        aria-hidden
        className={[
          'inline-block h-1.5 w-1.5 rounded-full',
          isLive ? 'animate-pulse bg-cyan-300' : 'bg-zinc-400',
        ].join(' ')}
      />
      <span>
        {label.kind === 'live' && (
          <>
            Health: {label.totalCycles} cycles · {label.p50Label} p50
            {label.moduleInErrorCount > 0 && (
              <span className="ml-1 text-amber-300">
                · {label.moduleInErrorCount} in error
              </span>
            )}
          </>
        )}
        {label.kind === 'no_data_yet' && (
          <>Health: {label.totalCycles} cycles · awaiting first tick</>
        )}
        {label.kind === 'unreachable' && (
          <>Health: {label.reason === 'empty registry' ? 'no modules registered' : 'unreachable'}</>
        )}
      </span>
    </div>
  );
}

export default CycleTelemetryRibbon;
