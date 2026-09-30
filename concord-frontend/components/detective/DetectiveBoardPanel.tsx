'use client';

/**
 * DetectiveBoardPanel — Obra-Dinn deduction board.
 * Extracted from lenses/detective/page.tsx. Preserves detective.list/get/deduce/mine.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, MapPin, User, Gauge, CalendarClock, Gavel } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton, StatTile, DensityToggle } from '@/components/ui';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import { formatRelativeTime, cn } from '@/lib/utils';
import { EvidenceBoard, type DetectiveEvidence } from '@/components/detective/EvidenceBoard';
import { DeductionPanel, type DeductionForm, type DeduceResult } from '@/components/detective/DeductionPanel';
import { CaseFileHistory, type DeductionRecord } from '@/components/detective/CaseFileHistory';
import {
  type Crime, type CrimeDetail, type LoadState,
  KNOWN_WORLD_IDS, formatCrimeType, CaseStatusBadge,
} from '@/components/detective/detective-shared';

export type DetectiveView = 'open' | 'mine';

export function DetectiveBoardPanel({
  active,
  onActiveChange,
}: {
  active: DetectiveView;
  onActiveChange: (v: DetectiveView) => void;
}) {
  const [worldId, setWorldId] = useState('concordia-hub');

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
      setDeductionsError(r.data.error || 'Could not load your case file.');
      setDeductionsState('error');
    }
  }, []);

  useEffect(() => { refreshCrimes(); }, [refreshCrimes]);
  useEffect(() => { if (active === 'mine') refreshMine(); }, [active, refreshMine]);

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

  const refreshDetailSilently = useCallback(async (crimeId: string) => {
    const r = await lensRun<{ crime: CrimeDetail; evidence: DetectiveEvidence[] }>('detective', 'get', { crimeId });
    if (r.data.ok && r.data.result) {
      setDetail(r.data.result.crime);
      setEvidence(r.data.result.evidence || []);
    }
  }, []);

  const selectFromHistory = useCallback((crimeId: string) => {
    onActiveChange('open');
    loadDetail(crimeId);
  }, [loadDetail, onActiveChange]);

  const onSolved = useCallback((_result: DeduceResult) => {
    refreshCrimes();
    if (selectedId) refreshDetailSilently(selectedId);
  }, [refreshCrimes, selectedId, refreshDetailSilently]);

  const onSubmitted = useCallback(() => {
    if (active === 'mine') refreshMine();
  }, [active, refreshMine]);

  const suggestedSuspects = useMemo(
    () => Array.from(new Set(evidence.map((e) => e.links_to_id).filter(Boolean))) as string[],
    [evidence],
  );

  useLensCommand([
    { id: 'refresh', keys: 'r', description: 'Refresh the active tab', action: () => (active === 'open' ? refreshCrimes() : refreshMine()) },
    { id: 'tab-open', keys: '1', description: 'Open cases tab', action: () => onActiveChange('open') },
    { id: 'tab-mine', keys: '2', description: 'My case file tab', action: () => onActiveChange('mine') },
  ], { lensId: 'detective' });

  const isOpenCase = detail?.status === 'open';

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
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

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <aside className="rounded-xl border border-amber-500/20 bg-zinc-950/60 p-3 lg:col-span-1" aria-label="Case browser">
          {active === 'open' ? (
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
                <EmptyState icon={<Search className="h-8 w-8" />} title="No open cases."
                  description={`No unsolved crimes are on record for "${worldId}" right now.`} compact />
              ) : (
                <ul data-testid="cases-list" className="space-y-1">
                  {crimes.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => loadDetail(c.id)} aria-pressed={selectedId === c.id}
                        className={cn(
                          'w-full rounded px-2 py-1.5 text-left text-[12px] transition-colors',
                          selectedId === c.id ? 'bg-amber-500/20 text-amber-100' : 'text-slate-300 hover:bg-slate-800/50',
                        )}>
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
            <EmptyState icon={<Search className="h-10 w-10" />} title="Select a case."
              description="Pick an open case at left, or a past deduction from your case file, to review the evidence." />
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
                <StatTile label="Confidence" value={typeof detail.confidence === 'number' ? Math.round(detail.confidence * 100) : 0} unit="%" icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />} size="sm" />
                <StatTile label="Location" value={detail.location_id} icon={<MapPin className="h-3.5 w-3.5" aria-hidden="true" />} size="sm" />
                <StatTile label="Victim" value={detail.victim_id || '—'} icon={<User className="h-3.5 w-3.5" aria-hidden="true" />} size="sm" />
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
                  <EvidenceBoard evidence={evidence} activeSuspectId={form.suspectId}
                    onNameSuspect={(id) => setForm((f) => ({ ...f, suspectId: id }))} />
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
    </>
  );
}
