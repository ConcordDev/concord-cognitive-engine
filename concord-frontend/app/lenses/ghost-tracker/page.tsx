'use client';

/**
 * /lenses/ghost-tracker — Phase V ghost-hunt game mode.
 *
 * Wires the full ghost-hunt domain surface:
 *   residues     — list + filter + sort spectral drift residues
 *   detail       — full investigation view (ResidueDetail modal)
 *   advance      — multi-stage hunt progression (track → investigate → confront)
 *   confront     — resolve a haunting, award rewards
 *   history      — confront outcome ledger (ConfrontHistory)
 *   leaderboard  — hunter ranks (HunterLeaderboard)
 *
 * Residues are plotted on the spectral plane via ResidueMap and scoped to
 * the active world (concordia:activeWorldId).
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';
import { HauntingsFeed } from '@/components/ghost-tracker/HauntingsFeed';
import { ResidueDetail } from '@/components/ghost-tracker/ResidueDetail';
import { ResidueMap } from '@/components/ghost-tracker/ResidueMap';
import { HunterLeaderboard } from '@/components/ghost-tracker/HunterLeaderboard';
import { ConfrontHistory } from '@/components/ghost-tracker/ConfrontHistory';
import { ActiveHunts } from '@/components/ghost-tracker/ActiveHunts';

interface Residue {
  id: string;
  drift_type: string;
  severity: string;
  signature: string;
  context_json: string;
  detected_at: number;
  stage: string;
  confronted: boolean;
  coords: { x: number; z: number };
}

interface ResiduesResult {
  ok: boolean;
  residues?: Residue[];
  count?: number;
  driftTypes?: string[];
  severities?: string[];
}

const ACTIVE_WORLD_KEY = 'concordia:activeWorldId';
const SORTS = [
  { id: 'recent', label: 'Most recent' },
  { id: 'severity', label: 'Severity' },
  { id: 'type', label: 'Drift type' },
] as const;

const STAGE_TONE: Record<string, string> = {
  track: 'text-sky-300 border-sky-500/40 bg-sky-900/15',
  investigate: 'text-amber-300 border-amber-500/40 bg-amber-900/15',
  confront: 'text-rose-300 border-rose-500/40 bg-rose-900/15',
  extinguished: 'text-emerald-300 border-emerald-500/40 bg-emerald-900/15',
};

export default function GhostTrackerPage() {
  const [residues, setResidues] = useState<Residue[]>([]);
  const [driftTypes, setDriftTypes] = useState<string[]>([]);
  const [severities, setSeverities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [sort, setSort] = useState<string>('recent');
  const [refreshKey, setRefreshKey] = useState(0);

  // Saved Spectral Dossiers — real artifact-backed persistence (no mock seed).
  // The canonical dossier DTU is minted by ghost-hunt.create from ResidueDetail;
  // this index pins them per-user so they survive a reload + are listable here.
  const {
    items: dossiers,
    isLoading: dossiersLoading,
    isError: dossiersError,
  } = useLensData<{ residueId?: string; drift_type?: string; severity?: string }>(
    'ghost-tracker',
    'spectral_dossier',
    { noSeed: true, limit: 20 },
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    const worldId = (typeof window !== 'undefined' && localStorage.getItem(ACTIVE_WORLD_KEY)) || 'concordia-hub';
    const r = await lensRun<ResiduesResult>('ghost-hunt', 'residues', {
      worldId,
      severity: severityFilter || null,
      driftType: typeFilter || null,
      sort,
      limit: 60,
    });
    setResidues(r.data.result?.residues ?? []);
    setDriftTypes(r.data.result?.driftTypes ?? []);
    setSeverities(r.data.result?.severities ?? []);
    setLoading(false);
  }, [severityFilter, typeFilter, sort]);

  useEffect(() => { refresh(); }, [refresh]);

  const bumpDependents = useCallback(() => {
    setRefreshKey((k) => k + 1);
    refresh();
  }, [refresh]);

  useLensCommand([
    { id: 'refresh', keys: 'r', description: 'Refresh', category: 'navigation', action: () => refresh() },
  ], { lensId: 'ghost-tracker' });

  const active = residues.filter((r) => !r.confronted);
  const extinguished = residues.filter((r) => r.confronted);

  return (
    <LensShell lensId="ghost-tracker" asMain={false}>
      <FirstRunTour lensId="ghost-tracker" />
      <ManifestActionBar />
      <DepthBadge lensId="ghost-tracker" size="sm" className="ml-2" />
      <div className="min-h-screen bg-[#0b0f17] text-gray-100 p-6">
        <header className="mb-5">
          <h1 className="text-3xl font-semibold text-violet-300">Ghost Tracker</h1>
          <p className="mt-1 text-gray-400">
            Spectral residues left by drift events. Track, investigate, then confront one to extinguish it.
          </p>
        </header>

        {/* filter + sort bar */}
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
          >
            <option value="">All drift types</option>
            {driftTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
          >
            <option value="">All severities</option>
            {severities.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {(typeFilter || severityFilter) && (
            <button
              type="button"
              onClick={() => { setTypeFilter(''); setSeverityFilter(''); }}
              className="rounded border border-zinc-700 px-2 py-1.5 text-xs text-gray-400 hover:text-gray-100"
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-gray-400">
            {active.length} active · {extinguished.length} extinguished
          </span>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* residue list */}
          <div className="lg:col-span-2">
            {loading && <p className="text-gray-400">Loading residues…</p>}
            {!loading && residues.length === 0 && (
              <div className="rounded border border-white/10 bg-white/5 p-6 text-center text-gray-400">
                No spectral residues match. The world reads true.
              </div>
            )}
            {!loading && residues.length > 0 && (
              <ul className="space-y-3">
                {residues.map((r) => (
                  <li
                    key={r.id}
                    className={`rounded border p-4 ${
                      r.id === selected
                        ? 'border-violet-400/60 bg-violet-900/20'
                        : 'border-violet-700/30 bg-violet-900/10'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm uppercase tracking-wide text-violet-400">{r.drift_type}</h2>
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${STAGE_TONE[r.stage] || ''}`}>
                            {r.stage}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-gray-400">
                          severity {r.severity} · cell x{r.coords.x} z{r.coords.z} ·{' '}
                          {new Date(r.detected_at * 1000).toLocaleString()}
                        </p>
                        <p className="mt-2 break-all font-mono text-xs text-gray-400">{r.signature}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelected(r.id)}
                        className="ml-3 shrink-0 rounded border border-violet-500/40 bg-violet-600/30 px-3 py-2 text-sm text-violet-100 hover:bg-violet-600/50"
                      >
                        {r.confronted ? 'Review' : 'Investigate'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* map + hunts + leaderboard rail */}
          <div className="space-y-6">
            <ResidueMap residues={residues} selectedId={selected} onSelect={setSelected} />
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <h3 className="mb-2 text-xs uppercase tracking-wide text-violet-400">My active hunts</h3>
              <ActiveHunts refreshKey={refreshKey} onOpen={setSelected} />
            </section>
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <HunterLeaderboard refreshKey={refreshKey} />
            </section>
          </div>
        </div>

        <section
          className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4"
          aria-label="Saved Spectral Dossiers"
        >
          <h3 className="mb-2 text-xs uppercase tracking-wide text-violet-400">Saved dossiers</h3>
          {dossiersLoading && (
            <p role="status" className="text-xs text-gray-400">Loading dossiers…</p>
          )}
          {!dossiersLoading && dossiersError && (
            <p role="alert" className="text-xs text-rose-300">
              Dossier index unreachable.
            </p>
          )}
          {!dossiersLoading && !dossiersError && dossiers.length === 0 && (
            <p className="text-xs text-gray-400">
              No dossiers yet. Confront a residue, then save its case file.
            </p>
          )}
          {!dossiersLoading && !dossiersError && dossiers.length > 0 && (
            <ul className="space-y-1.5">
              {dossiers.map((d) => (
                <li
                  key={d.id}
                  className="rounded border border-violet-700/30 bg-violet-900/10 px-3 py-2 text-xs text-gray-200"
                >
                  <span className="font-medium text-violet-200">{d.title}</span>
                  {d.data?.drift_type && (
                    <span className="ml-2 text-gray-400">
                      {d.data.drift_type} · {d.data.severity}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <ConfrontHistory refreshKey={refreshKey} />
        </section>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <HauntingsFeed />
        </section>
      </div>

      {selected && (
        <ResidueDetail
          residueId={selected}
          onClose={() => setSelected(null)}
          onChanged={bumpDependents}
        />
      )}

      <RecentMineCard domain="ghost-tracker" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="ghost-tracker" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="ghost-tracker" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
