'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────
 * CONCORD // DETECTIVE BOARD — rebuild (Frontend Rebuild Program, Phase 3)
 * ─────────────────────────────────────────────────────────────────────────
 * Obra-Dinn-style deduction board over the real `crime_events` /
 * `evidence_items` / `trial_records` substrate. Lens-owned, not
 * world-owned: `detective.*` is a standalone macro domain
 * (server/domains/detective.js, a thin delegator to server/lib/detective.js)
 * with its own REST mirror; the only "world" surface reference is a single
 * decorative building-icon glyph in components/world/BuildingInterior.tsx —
 * not a dedicated HUD, so this page is the feature's real home.
 *
 * CAPABILITY MAP (server/domains/detective.js — 6 registered macros):
 *   detective.list      → open cases for a world                  DESIGNED (case browser, left rail)
 *   detective.get       → one case + its evidence, no culprit leak DESIGNED (center dossier + evidence board)
 *   detective.evidence  → evidence list alone                      SUPERSEDED — detective.get already
 *                                                                   returns evidence in the same call;
 *                                                                   calling both would be a redundant
 *                                                                   round-trip for identical data.
 *   detective.deduce    → lock in (suspect, weapon, motive)        DESIGNED (DeductionPanel)
 *   detective.create    → alias of deduce (same handler)           N/A — literally the same function;
 *                                                                   calling it separately would just be
 *                                                                   `deduce` under a second name.
 *   detective.mine      → caller's deduction history                DESIGNED (CaseFileHistory tab) — this
 *                                                                   was the one macro with NO frontend
 *                                                                   caller before this rebuild (0/6
 *                                                                   measured); a player's own verdict
 *                                                                   history existed in `trial_records`
 *                                                                   with nothing surfacing it back.
 *
 * All calls go through `lensRun` (POST /api/lens/run) rather than the
 * REST mirror the previous version used — same backend, but now the
 * macro names are literally what the frontend calls, and `detective.get`
 * + `detective.mine` are actually reachable.
 *
 * Honest states: loading skeletons, retryable errors, and an explicit
 * "no open cases" / "no deductions yet" empty state — never fabricated
 * crimes, evidence, or verdicts. Retired: the generic ManifestActionBar
 * strip (list/get/create/run buttons) — every one of those actions now
 * has a bespoke, real UI surface below.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, MapPin, User, Gauge, CalendarClock, Gavel } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { EmptyState, ErrorState, Skeleton, StatTile, DensityToggle } from '@/components/ui';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import { statusToken, type StatusKind } from '@/lib/design-system';
import { formatRelativeTime, cn } from '@/lib/utils';
import { EvidenceBoard, type DetectiveEvidence } from '@/components/detective/EvidenceBoard';
import { DeductionPanel, type DeductionForm, type DeduceResult } from '@/components/detective/DeductionPanel';
import { CaseFileHistory, type DeductionRecord } from '@/components/detective/CaseFileHistory';

interface Crime {
  id: string;
  crime_type: string;
  location_type?: string;
  location_id: string;
  victim_id: string | null;
  confidence?: number;
  occurred_at: number;
}

interface CrimeDetail extends Crime {
  world_id?: string;
  status: string;
  resolved_at?: number | null;
}

type LoadState = 'loading' | 'error' | 'ready';

// Sub-worlds actually seeded with content (content/world/<id>/) — a real
// pick-list, not invented options. Crimes can occur in any of them since
// world-crime.js runs per-world, not just in the world literally named
// "crime".
const KNOWN_WORLD_IDS = [
  'concordia-hub', 'tunya', 'sovereign-ruins', 'concord-link-frontier',
  'crime', 'cyber', 'superhero', 'fantasy', 'lattice-crucible', 'sere',
];

function formatCrimeType(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function CaseStatusBadge({ status }: { status: string }) {
  const kind: StatusKind = status === 'solved' ? 'success' : status === 'open' ? 'warning' : status === 'unsolved' ? 'error' : 'pending';
  const token = statusToken(kind);
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ ...token.bgStyle, ...token.textStyle, ...token.borderStyle, borderWidth: 1, borderStyle: 'solid' }}
    >
      {status}
    </span>
  );
}

export default function DetectiveLensPage() {
  const [worldId, setWorldId] = useState('concordia-hub');
  const [tab, setTab] = useState<'open' | 'mine'>('open');

  const [crimes, setCrimes] = useState<Crime[]>([]);
  const [crimesState, setCrimesState] = useState<LoadState>('loading');
  const [crimesError, setCrimesError] = useState<string | null>(null);

  const [deductions, setDeductions] = useState<DeductionRecord[]>([]);
  const [deductionsState, setDeductionsState] = useState<LoadState>('loading');
  const [deductionsError, setDeductionsError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CrimeDetail | null>(null);
  const [evidence, setEvidence] = useState<DetectiveEvidence[]>([]);
  const [detailState, setDetailState] = useState<LoadState>('ready');
  const [detailError, setDetailError] = useState<string | null>(null);

  const [form, setForm] = useState<DeductionForm>({ suspectId: '', weapon: '', motive: '' });

  const refreshCrimes = useCallback(async () => {
    setCrimesState('loading');
    setCrimesError(null);
    const r = await lensRun<{ crimes: Crime[] }>('detective', 'list', { worldId, limit: 50 });
    if (r.data.ok && r.data.result) {
      setCrimes(r.data.result.crimes || []);
      setCrimesState('ready');
    } else {
      setCrimes([]);
      setCrimesError(r.data.error || 'Could not load open cases.');
      setCrimesState('error');
    }
  }, [worldId]);

  const refreshMine = useCallback(async () => {
    setDeductionsState('loading');
    setDeductionsError(null);
    const r = await lensRun<{ deductions: DeductionRecord[] }>('detective', 'mine', { limit: 30 });
    if (r.data.ok && r.data.result) {
      setDeductions(r.data.result.deductions || []);
      setDeductionsState('ready');
    } else {
      setDeductions([]);
      // An unauthenticated caller gets a real "no_user" reason here — surface
      // it honestly rather than pretending the tab is just empty.
      setDeductionsError(r.data.error || 'Could not load your case file.');
      setDeductionsState('error');
    }
  }, []);

  useEffect(() => { refreshCrimes(); }, [refreshCrimes]);
  useEffect(() => { if (tab === 'mine') refreshMine(); }, [tab, refreshMine]);

  const loadDetail = useCallback(async (crimeId: string) => {
    setSelectedId(crimeId);
    setDetailState('loading');
    setDetailError(null);
    setForm({ suspectId: '', weapon: '', motive: '' });
    const r = await lensRun<{ crime: CrimeDetail; evidence: DetectiveEvidence[] }>('detective', 'get', { crimeId });
    if (r.data.ok && r.data.result) {
      setDetail(r.data.result.crime);
      setEvidence(r.data.result.evidence || []);
      setDetailState('ready');
    } else {
      setDetail(null);
      setEvidence([]);
      setDetailError(r.data.error || 'Could not load this case.');
      setDetailState('error');
    }
  }, []);

  // Re-fetches the case in place — no loading skeleton, no form reset.
  // Used after a successful deduction: `loadDetail`'s full loading state
  // would unmount + remount DeductionPanel mid-flight (it lives inside the
  // `detailState === 'ready'` branch), which would wipe the "Case solved"
  // result banner it just rendered before anyone could read it.
  const refreshDetailSilently = useCallback(async (crimeId: string) => {
    const r = await lensRun<{ crime: CrimeDetail; evidence: DetectiveEvidence[] }>('detective', 'get', { crimeId });
    if (r.data.ok && r.data.result) {
      setDetail(r.data.result.crime);
      setEvidence(r.data.result.evidence || []);
    }
  }, []);

  // Selecting from "My Case File" jumps to the case dossier and switches
  // tabs so the reader lands on the board, not a still-visible table.
  const selectFromHistory = useCallback((crimeId: string) => {
    setTab('open');
    loadDetail(crimeId);
  }, [loadDetail]);

  const onSolved = useCallback((_result: DeduceResult) => {
    refreshCrimes();
    if (selectedId) refreshDetailSilently(selectedId);
  }, [refreshCrimes, selectedId, refreshDetailSilently]);

  const onSubmitted = useCallback(() => {
    // A deduction — solved or not — always lands in trial_records; refresh
    // the case file so it's there the next time the tab is opened.
    if (tab === 'mine') refreshMine();
  }, [tab, refreshMine]);

  // Suspect ids evidence actually points to, for the quick-fill chip row.
  const suggestedSuspects = useMemo(
    () => Array.from(new Set(evidence.map((e) => e.links_to_id).filter(Boolean))) as string[],
    [evidence],
  );

  useLensCommand([
    { id: 'refresh', keys: 'r', description: 'Refresh the active tab', action: () => (tab === 'open' ? refreshCrimes() : refreshMine()) },
    { id: 'tab-open', keys: '1', description: 'Open cases tab', action: () => setTab('open') },
    { id: 'tab-mine', keys: '2', description: 'My case file tab', action: () => setTab('mine') },
  ], { lensId: 'detective' });

  const isOpenCase = detail?.status === 'open';

  return (
    <LensShell lensId="detective" asMain={false}>
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-amber-950/10 text-slate-100">
        <header className="border-b border-amber-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-3">
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
              <Search className="h-5 w-5 text-amber-400" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Detective board</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">Open cases. Collect evidence. Lock in three facts.</p>
            </div>

            <label className="sr-only" htmlFor="detective-world">World</label>
            <input
              id="detective-world"
              list="detective-world-ids"
              value={worldId}
              onChange={(e) => setWorldId(e.target.value)}
              aria-label="World"
              className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100"
            />
            <datalist id="detective-world-ids">
              {KNOWN_WORLD_IDS.map((w) => <option key={w} value={w} />)}
            </datalist>
            <DensityToggle variant="dropdown" showLabels={false} />
          </div>

          <nav className="mx-auto mt-3 flex max-w-screen-2xl gap-1" aria-label="Detective board sections">
            {([
              { id: 'open' as const, label: 'Open cases', key: '1' },
              { id: 'mine' as const, label: 'My case file', key: '2' },
            ]).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={cn(
                  'rounded px-2.5 py-1 text-[11px] font-medium transition-colors',
                  tab === t.id ? 'bg-amber-500/20 text-amber-100' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
                )}
              >
                {t.label} <span className="ml-1 text-[9px] text-slate-500">{t.key}</span>
              </button>
            ))}
          </nav>
        </header>

        <section className="mx-auto grid max-w-screen-2xl grid-cols-1 gap-4 px-4 py-5 sm:px-6 lg:grid-cols-3">
          <aside className="rounded-xl border border-amber-500/20 bg-zinc-950/60 p-3 lg:col-span-1" aria-label="Case browser">
            {tab === 'open' ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-[11px] uppercase tracking-wider text-amber-300/60">Open cases · {worldId}</h2>
                  <button onClick={refreshCrimes} aria-label="Refresh open cases" className="rounded p-1 text-slate-400 hover:bg-slate-800/60 hover:text-amber-200">
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>

                {crimesState === 'loading' ? (
                  <div data-testid="cases-loading" aria-busy="true" role="status" className="space-y-1.5">
                    <span className="sr-only">Loading open cases…</span>
                    {[0, 1, 2].map((i) => <Skeleton key={i} variant="block" height={36} className="rounded" />)}
                  </div>
                ) : crimesState === 'error' ? (
                  <ErrorState message={crimesError || 'Could not load cases.'} onRetry={refreshCrimes} variant="inline" />
                ) : crimes.length === 0 ? (
                  <EmptyState
                    icon={<Search className="h-8 w-8" />}
                    title="No open cases."
                    description={`No unsolved crimes are on record for "${worldId}" right now.`}
                    compact
                  />
                ) : (
                  <ul data-testid="cases-list" className="space-y-1">
                    {crimes.map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => loadDetail(c.id)}
                          aria-pressed={selectedId === c.id}
                          className={cn(
                            'w-full rounded px-2 py-1.5 text-left text-[12px] transition-colors',
                            selectedId === c.id ? 'bg-amber-500/20 text-amber-100' : 'text-slate-300 hover:bg-slate-800/50',
                          )}
                        >
                          <div className="font-medium">{formatCrimeType(c.crime_type)}</div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-500">
                            <span className="inline-flex items-center gap-0.5"><MapPin className="h-2.5 w-2.5" aria-hidden="true" />{c.location_id}</span>
                            <span>{formatRelativeTime(c.occurred_at * 1000)}</span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-[11px] uppercase tracking-wider text-amber-300/60">My case file</h2>
                  <button onClick={refreshMine} aria-label="Refresh my case file" className="rounded p-1 text-slate-400 hover:bg-slate-800/60 hover:text-amber-200">
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
                {deductionsState === 'loading' ? (
                  <div data-testid="mine-loading" aria-busy="true" role="status" className="space-y-1.5">
                    <span className="sr-only">Loading your case file…</span>
                    {[0, 1, 2].map((i) => <Skeleton key={i} variant="block" height={36} className="rounded" />)}
                  </div>
                ) : deductionsState === 'error' ? (
                  <ErrorState message={deductionsError || 'Could not load your case file.'} onRetry={refreshMine} variant="inline" />
                ) : (
                  <CaseFileHistory deductions={deductions} onSelectCase={selectFromHistory} />
                )}
              </>
            )}
          </aside>

          <div className="rounded-xl border border-amber-500/20 bg-zinc-950/60 p-4 lg:col-span-2">
            {!selectedId ? (
              <EmptyState
                icon={<Search className="h-10 w-10" />}
                title="Select a case."
                description="Pick an open case at left, or a past deduction from your case file, to review the evidence."
              />
            ) : detailState === 'loading' ? (
              <div aria-busy="true" role="status" className="space-y-3">
                <span className="sr-only">Loading case…</span>
                <Skeleton variant="line" width="40%" height={18} />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} variant="block" height={56} className="rounded" />)}
                </div>
                <Skeleton variant="block" height={120} className="rounded" />
              </div>
            ) : detailState === 'error' ? (
              <ErrorState message={detailError || 'Could not load this case.'} onRetry={() => selectedId && loadDetail(selectedId)} />
            ) : detail ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-amber-100">{formatCrimeType(detail.crime_type)}</h2>
                  <CaseStatusBadge status={detail.status} />
                </div>

                <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatTile
                    label="Confidence"
                    value={typeof detail.confidence === 'number' ? Math.round(detail.confidence * 100) : 0}
                    unit="%"
                    icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
                    size="sm"
                  />
                  <StatTile
                    label="Location"
                    value={detail.location_id}
                    icon={<MapPin className="h-3.5 w-3.5" aria-hidden="true" />}
                    size="sm"
                  />
                  <StatTile
                    label="Victim"
                    value={detail.victim_id || '—'}
                    icon={<User className="h-3.5 w-3.5" aria-hidden="true" />}
                    size="sm"
                  />
                  <StatTile
                    label={detail.status === 'solved' ? 'Resolved' : 'Occurred'}
                    value={formatRelativeTime((detail.status === 'solved' && detail.resolved_at ? detail.resolved_at : detail.occurred_at) * 1000)}
                    icon={detail.status === 'solved' ? <Gavel className="h-3.5 w-3.5" aria-hidden="true" /> : <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />}
                    size="sm"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-[11px] uppercase tracking-wider text-amber-300/60">Evidence</h3>
                    <EvidenceBoard
                      evidence={evidence}
                      activeSuspectId={form.suspectId}
                      onNameSuspect={(id) => setForm((f) => ({ ...f, suspectId: id }))}
                    />
                    {suggestedSuspects.length > 1 && (
                      <p className="mt-2 text-[10px] text-slate-500">
                        {suggestedSuspects.length} distinct suspect ids named by evidence at this scene.
                      </p>
                    )}
                  </div>

                  <div>
                    <DeductionPanel
                      crimeId={detail.id}
                      form={form}
                      onChangeForm={setForm}
                      disabled={!isOpenCase}
                      disabledReason={detail.status === 'solved' ? 'This case is already solved.' : `This case is ${detail.status} — deductions are only accepted on open cases.`}
                      onSolved={onSolved}
                      onSubmitted={onSubmitted}
                    />
                  </div>
                </div>
              </>
            ) : (
              <ErrorState message="Case not found." variant="inline" />
            )}
          </div>
        </section>
      </main>
    </LensShell>
  );
}
