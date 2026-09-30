'use client';

/**
 * World Observatory Lens
 *
 * Concord's first large-scale simulation-observability surface. Before this,
 * `/lenses/ops-telemetry` showed infra health only (heartbeat timing, worker
 * pools, brain endpoints) — zero simulation *content*. Nothing let anyone
 * see population/faction/realm/district state across the whole platform at
 * a glance. This lens reads the two real, tested `worldstate.*` macros
 * (`server/domains/world-overview.js`) and renders them as a dense,
 * real-time-feeling "mission control" board — matching this repo's own
 * Bloomberg-terminal admin density (see `docs/UI_QUALITY_RUBRIC.md` §3 and
 * `/lenses/ops-telemetry` as the closest sibling reference) rather than a
 * generic dashboard-template look.
 *
 * Two macros, both read-only, no new tables, no mutation:
 *   worldstate.overview      -> lightweight per-world summary grid
 *   worldstate.world_detail  -> per-world deep-dive on click/select
 *
 * Every section renders an HONEST empty state when the underlying data is
 * genuinely absent (a world with zero realms shows "No realms have formed"
 * — never a fabricated realm card). Faction relation scores, realm
 * legitimacy/treasury, and district building density are rendered exactly
 * as the backend reports them — no invented rounding, no placeholder
 * numbers standing in for missing data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import {
  Radar,
  Users,
  Flag,
  Crown,
  Building2,
  AlertTriangle,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  Coins,
} from 'lucide-react';

// ── Real macro response shapes (server/domains/world-overview.js) ──────────

interface WorldSummary {
  worldId: string;
  name: string;
  activeUsers: number;
  factionCount: number;
  realmCount: number;
  districtCount: number;
  stuckFactionSchedulers: number;
}

interface FactionState {
  factionId: string;
  stance: string;
  target: string | null;
  momentum: number;
  phase: string | null;
}

interface FactionRelation {
  a: string;
  b: string;
  score: number;
  kind: string;
}

interface RealmCitizens {
  avg: number;
  count: number;
  low: number;
  high: number;
}

interface Realm {
  id: string;
  name: string;
  factionId: string | null;
  rulerKind: string | null;
  rulerId: string | null;
  legitimacy: number;
  treasury: number;
  taxRate: number;
  citizens: RealmCitizens;
}

interface District {
  id: string;
  name: string;
  areaM2: number | null;
  buildingCount: number | null;
  lightingTag: string | null;
}

interface HealthFinding {
  pathology: string;
  category: string;
  subjectId: string;
  disposition: string;
  detail?: { overdue_s?: number };
}

interface WorldDetail {
  worldId: string;
  population: { activeUsers: number };
  factions: { count: number; states: FactionState[]; relations: FactionRelation[] };
  realms: Realm[];
  districts: District[];
  health: { platformWideChecked: number; factionSchedulerFindings: HealthFinding[] };
}

const REFRESH_MS = 15_000;

const RELATION_TONE: Record<string, string> = {
  war: 'border-red-500/40 bg-red-500/10 text-red-200',
  tension: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  truce: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  alliance: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  tribute: 'border-violet-500/40 bg-violet-500/10 text-violet-200',
  neutral: 'border-zinc-600/40 bg-zinc-500/10 text-zinc-300',
};

function relationTone(kind: string): string {
  return RELATION_TONE[kind] || RELATION_TONE.neutral;
}

/** Formats a real fractional tax rate (e.g. 0.15) as a percentage without
 * inventing precision beyond what the backend stores (max 2 decimals). */
function formatTaxRate(taxRate: number): string {
  const pct = Number((taxRate * 100).toFixed(2));
  return `${pct}%`;
}

function formatOverdue(overdueS: number | undefined): string {
  if (overdueS == null || !Number.isFinite(overdueS)) return '';
  const h = Math.floor(overdueS / 3600);
  const m = Math.floor((overdueS % 3600) / 60);
  if (h > 0) return `${h}h ${m}m overdue`;
  return `${m}m overdue`;
}

export default function WorldObservatoryPage() {
  const [overview, setOverview] = useState<WorldSummary[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const [selectedWorldId, setSelectedWorldId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorldDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Tracks the in-flight worldId so a slow response for a since-deselected
  // world can't clobber the currently-selected world's detail panel.
  const inflightWorldId = useRef<string | null>(null);

  const refreshOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const res = await lensRun<{ ok: boolean; worlds?: WorldSummary[]; reason?: string }>(
        'worldstate',
        'overview',
        {},
      );
      const payload = res.data.result;
      if (res.data.ok && payload?.ok) {
        setOverview(payload.worlds || []);
        setHasLoadedOnce(true);
      } else {
        setOverviewError(res.data.error || payload?.reason || 'Failed to load world overview');
      }
      setLastRefresh(new Date());
    } catch (e) {
      setOverviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (worldId: string) => {
    inflightWorldId.current = worldId;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await lensRun<WorldDetail & { ok: boolean; reason?: string }>(
        'worldstate',
        'world_detail',
        { worldId },
      );
      // A newer selection superseded this in-flight request — drop it.
      if (inflightWorldId.current !== worldId) return;
      const payload = res.data.result;
      if (res.data.ok && payload?.ok) {
        setDetail(payload);
      } else {
        setDetail(null);
        setDetailError(res.data.error || payload?.reason || 'Failed to load world detail');
      }
    } catch (e) {
      if (inflightWorldId.current !== worldId) return;
      setDetail(null);
      setDetailError(e instanceof Error ? e.message : String(e));
    } finally {
      if (inflightWorldId.current === worldId) setDetailLoading(false);
    }
  }, []);

  const selectWorld = useCallback(
    (worldId: string) => {
      setSelectedWorldId(worldId);
      loadDetail(worldId);
    },
    [loadDetail],
  );

  const refreshAll = useCallback(() => {
    refreshOverview();
    if (selectedWorldId) loadDetail(selectedWorldId);
  }, [refreshOverview, selectedWorldId, loadDetail]);

  useEffect(() => {
    refreshOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refreshAll();
      }
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshAll]);

  useLensCommand(
    [
      { id: 'refresh', keys: 'r', description: 'Refresh the observatory now', category: 'actions', action: refreshAll },
    ],
    { lensId: 'world-observatory' },
  );

  const totalStuck = useMemo(
    () => overview.reduce((sum, w) => sum + (w.stuckFactionSchedulers || 0), 0),
    [overview],
  );
  const totalActiveUsers = useMemo(
    () => overview.reduce((sum, w) => sum + (w.activeUsers || 0), 0),
    [overview],
  );

  if (!hasLoadedOnce && overviewLoading && !overviewError) {
    return (
      <LensShell lensId="world-observatory" asMain={false}>
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading world observatory"
          className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-950 text-slate-300"
        >
          <RefreshCcw className="h-6 w-6 animate-spin text-cyan-400" aria-hidden="true" />
          <p className="text-sm">Scanning worlds…</p>
        </div>
      </LensShell>
    );
  }

  if (!hasLoadedOnce && overviewError) {
    return (
      <LensShell lensId="world-observatory" asMain={false}>
        <div
          role="alert"
          aria-label="World observatory failed to load"
          className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center text-slate-300"
        >
          <AlertTriangle className="h-7 w-7 text-red-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-red-200">{overviewError}</p>
          </div>
          <button
            onClick={refreshOverview}
            disabled={overviewLoading}
            className="flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${overviewLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            {overviewLoading ? 'retrying…' : 'Retry'}
          </button>
        </div>
      </LensShell>
    );
  }

  return (
    <LensShell lensId="world-observatory" asMain={false}>      <DepthBadge lensId="world-observatory" size="sm" className="ml-2" />
      <main
        aria-label="World Observatory"
        className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-cyan-950/10 text-slate-100"
      >
        <header className="border-b border-cyan-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-2">
              <Radar className="h-5 w-5 text-cyan-400" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">World Observatory</h1>
              <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
                Population, faction, realm, and district state across every world — read-only mission control.
              </p>
            </div>
            {totalStuck > 0 && (
              <span className="hidden items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-200 sm:flex">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                {totalStuck} stuck scheduler{totalStuck === 1 ? '' : 's'} platform-wide
              </span>
            )}
            <button
              onClick={refreshAll}
              disabled={overviewLoading}
              aria-label="Refresh the observatory"
              className="flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-60"
            >
              <RefreshCcw className={`h-3 w-3 ${overviewLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {overviewLoading ? 'refreshing…' : 'refresh'}
              <kbd className="ml-0.5 rounded border border-cyan-500/30 bg-black/30 px-1 text-[9px] font-mono text-cyan-300/80">R</kbd>
            </button>
          </div>
          {overviewError && (
            <div role="alert" className="mx-auto mt-2 flex max-w-screen-2xl items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-200">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> <span className="flex-1 break-words">{overviewError}</span>
              <button onClick={refreshOverview} disabled={overviewLoading} className="shrink-0 rounded border border-red-400/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-100 hover:bg-red-500/20 disabled:opacity-50">
                Retry
              </button>
            </div>
          )}
          <div className="mx-auto mt-1 flex max-w-screen-2xl items-center gap-3 text-[10px] text-slate-500">
            {lastRefresh && <span>last scanned {lastRefresh.toLocaleTimeString()}</span>}
            <span aria-hidden="true">·</span>
            <span>{overview.length} world{overview.length === 1 ? '' : 's'} tracked</span>
            <span aria-hidden="true">·</span>
            <span>{totalActiveUsers} active user{totalActiveUsers === 1 ? '' : 's'} platform-wide</span>
          </div>
        </header>

        <section className="mx-auto grid max-w-screen-2xl gap-4 px-3 py-4 sm:px-6 sm:py-5">
          {/* World grid */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-cyan-300">
              <Radar className="h-4 w-4" /> Worlds
            </h2>
            {overview.length === 0 ? (
              <p className="text-[11px] text-slate-500">No worlds detected on this instance.</p>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" role="list" aria-label="World summary grid">
                {overview.map((w) => {
                  const selected = w.worldId === selectedWorldId;
                  const stuck = w.stuckFactionSchedulers > 0;
                  return (
                    <button
                      key={w.worldId}
                      onClick={() => selectWorld(w.worldId)}
                      aria-pressed={selected}
                      aria-label={`Drill into ${w.name}`}
                      className={`flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors ${
                        selected
                          ? 'border-cyan-400/70 bg-cyan-500/10 ring-1 ring-cyan-400/40'
                          : stuck
                            ? 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
                            : 'border-zinc-800 bg-black/20 hover:border-cyan-500/30 hover:bg-cyan-500/5'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-slate-100">{w.name}</span>
                        {stuck ? (
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-500/20 px-1.5 py-0.5 text-[9px] font-medium text-red-200">
                            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                            {w.stuckFactionSchedulers}
                          </span>
                        ) : (
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300">
                            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                            nominal
                          </span>
                        )}
                      </div>
                      <p className="truncate font-mono text-[10px] text-slate-500">{w.worldId}</p>
                      <div className="grid grid-cols-4 gap-1.5 text-center">
                        <MiniStat icon={Users} value={w.activeUsers} label="users" />
                        <MiniStat icon={Flag} value={w.factionCount} label="factions" />
                        <MiniStat icon={Crown} value={w.realmCount} label="realms" />
                        <MiniStat icon={Building2} value={w.districtCount} label="districts" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Detail panel */}
          {selectedWorldId && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
              <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-cyan-300">
                <Radar className="h-4 w-4" /> World detail
                <span className="font-mono text-[11px] font-normal normal-case text-slate-400">{selectedWorldId}</span>
                {detailLoading && <RefreshCcw className="h-3 w-3 animate-spin text-cyan-400" aria-hidden="true" />}
              </h2>

              {detailError && (
                <div role="alert" className="mb-3 flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-200">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> <span className="flex-1 break-words">{detailError}</span>
                </div>
              )}

              {detail && detail.worldId === selectedWorldId && (
                <div className="space-y-4">
                  {/* Population strip */}
                  <div className="flex flex-wrap gap-3">
                    <Metric label="active users" value={String(detail.population.activeUsers)} />
                    <Metric label="scanned platform-wide" value={String(detail.health.platformWideChecked)} />
                  </div>

                  {/* Faction relations + states */}
                  <div>
                    <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fuchsia-300">
                      <Flag className="h-3.5 w-3.5" /> Factions
                    </h3>
                    {detail.factions.count === 0 ? (
                      <p className="text-[11px] text-slate-500">No factions have a living presence in this world.</p>
                    ) : (
                      <div className="space-y-2">
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {detail.factions.states.map((s) => (
                            <div key={s.factionId} className="rounded border border-fuchsia-500/20 bg-fuchsia-500/5 px-2.5 py-1.5 text-[11px]">
                              <div className="flex items-center justify-between">
                                <span className="font-mono font-semibold text-fuchsia-200">{s.factionId}</span>
                                <span className="rounded bg-fuchsia-500/20 px-1.5 py-0.5 text-[10px] text-fuchsia-100">{s.stance}</span>
                              </div>
                              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                                <span>momentum {s.momentum}</span>
                                {s.phase && <span>{s.phase}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                        {detail.factions.relations.length === 0 ? (
                          <p className="text-[11px] text-slate-500">No tracked relations between these factions yet.</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {detail.factions.relations.map((r) => (
                              <span
                                key={`${r.a}:${r.b}`}
                                className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] ${relationTone(r.kind)}`}
                              >
                                <span className="font-mono">{r.a}</span>
                                <span aria-hidden="true">⇄</span>
                                <span className="font-mono">{r.b}</span>
                                <span className="opacity-70">·</span>
                                <span className="font-semibold uppercase">{r.kind}</span>
                                <span className="font-mono opacity-80">{r.score}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Realms */}
                  <div>
                    <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                      <Crown className="h-3.5 w-3.5" /> Realms
                    </h3>
                    {detail.realms.length === 0 ? (
                      <p className="text-[11px] text-slate-500">No realms have formed in this world yet.</p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {detail.realms.map((r) => (
                          <div key={r.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-[11px]">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-amber-100">{r.name}</span>
                              <span className="font-mono text-[9px] text-amber-300/60">{r.id}</span>
                            </div>
                            <p className="mt-0.5 text-[10px] text-amber-300/70">
                              {r.rulerKind ?? 'unknown ruler'}{r.rulerId ? ` · ${r.rulerId}` : ''}
                            </p>
                            <div className="mt-2 grid grid-cols-3 gap-1.5">
                              <SmallStat label="legitimacy" value={String(r.legitimacy)} />
                              <SmallStat
                                label="treasury"
                                value={r.treasury.toLocaleString()}
                                icon={Coins}
                              />
                              <SmallStat label="tax rate" value={formatTaxRate(r.taxRate)} />
                            </div>
                            <div className="mt-2 border-t border-amber-500/10 pt-1.5 text-[10px] text-amber-300/70">
                              {r.citizens.count === 0 ? (
                                <span>no citizens tracked</span>
                              ) : (
                                <span>
                                  {r.citizens.count} citizen{r.citizens.count === 1 ? '' : 's'} · loyalty avg {r.citizens.avg} (range {r.citizens.low}–{r.citizens.high})
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Districts */}
                  <div>
                    <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                      <Building2 className="h-3.5 w-3.5" /> Districts
                    </h3>
                    {detail.districts.length === 0 ? (
                      <p className="text-[11px] text-slate-500">No districts platted in this world yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px]" aria-label="District density">
                          <caption className="sr-only">Per-district area, building count, and lighting tag</caption>
                          <thead>
                            <tr className="border-b border-zinc-800 text-left text-slate-400">
                              <th scope="col" className="px-2 py-1">district</th>
                              <th className="px-2 py-1 text-right">area (m²)</th>
                              <th className="px-2 py-1 text-right">buildings</th>
                              <th className="px-2 py-1">lighting</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.districts.map((d) => (
                              <tr key={d.id} className="border-b border-zinc-900">
                                <td className="px-2 py-1 text-slate-200">{d.name}</td>
                                <td className="px-2 py-1 text-right font-mono text-slate-300">
                                  {d.areaM2 == null ? '—' : d.areaM2.toLocaleString()}
                                </td>
                                <td className="px-2 py-1 text-right font-mono text-slate-300">
                                  {d.buildingCount == null ? '—' : d.buildingCount}
                                </td>
                                <td className="px-2 py-1 text-slate-400">{d.lightingTag ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Liveness findings */}
                  <div>
                    <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-300">
                      <ShieldAlert className="h-3.5 w-3.5" /> Faction scheduler liveness
                    </h3>
                    {detail.health.factionSchedulerFindings.length === 0 ? (
                      <p className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                        <ShieldCheck className="h-3.5 w-3.5" /> No stuck faction schedulers detected.
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {detail.health.factionSchedulerFindings.map((f) => (
                          <div key={f.subjectId} className="flex items-center justify-between rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-100">
                            <span className="font-mono">{f.subjectId}</span>
                            <span>{f.pathology}{f.detail?.overdue_s != null ? ` · ${formatOverdue(f.detail.overdue_s)}` : ''}</span>
                            <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] uppercase">{f.disposition}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </LensShell>
  );
}

function MiniStat({ icon: Icon, value, label }: { icon: React.ComponentType<{ className?: string }>; value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded bg-black/20 py-1">
      <Icon className="h-3 w-3 text-slate-400" aria-hidden="true" />
      <span className="font-mono text-[11px] font-semibold text-slate-100">{value}</span>
      <span className="text-[8px] uppercase tracking-wide text-slate-500">{label}</span>
    </div>
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

function SmallStat({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded bg-amber-500/10 px-1.5 py-1">
      <div className="flex items-center gap-0.5 text-[8px] uppercase tracking-wide text-amber-300/70">
        {Icon && <Icon className="h-2.5 w-2.5" aria-hidden="true" />} {label}
      </div>
      <div className="font-mono text-[11px] text-amber-100">{value}</div>
    </div>
  );
}
