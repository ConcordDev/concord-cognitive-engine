'use client';

import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

/**
 * Careers lens — the client door into the living-career system (jobs = sports =
 * one engine). Lists the profession taxonomy, lets you PLAY a shift (skill-input
 * → performance → sparks + promotion XP via the floor-gated resolver), and shows
 * your contracts. Calls the `careers` macro domain via /api/lens/run (real
 * DB-backed persistence — sparks credited, contracts persisted; NO mock data).
 * Behind CONCORD_LIVING_CAREER server-side (ENABLED by default — off only when
 * an operator sets =0) — when off the macros return { ok:false, reason:'disabled' }
 * and the lens shows an honest disabled-by-config note.
 *
 * Five genuine UX states (pinned by tests/careers-lens-states.test.tsx):
 *   LOADING  — the profession taxonomy is in flight (role=status, aria-busy)
 *   ERROR    — a tracks/contracts fetch threw (role=alert) + a working Retry
 *   DISABLED — the career system is off by config (honest note)
 *   EMPTY    — system enabled but no tracks resolved yet
 *   READY    — real tracks + contracts + a playable shift
 * a11y: the track select + skill slider + every button carry accessible names.
 * Responsive: mobile-first Tailwind (single column → sm: row). Toasts surface
 * success (shift earned) + failure (load/shift error) via the global UI store.
 *
 * Employer discovery + reputation (closes the two remaining GENUINELY MISSING
 * checklist items in docs/lens-specs/careers-capability-map.md), each its own
 * tested component (see tests/components/EmployerBrowser.test.tsx and
 * tests/components/ReputationGate.test.tsx):
 *   `<EmployerBrowser>`  — real NPCs (`careers.employers` →
 *                          server/lib/career-employers.js, a READ-ONLY
 *                          archetype→track derivation over world_npcs;
 *                          never fabricated) hiring for the selected track,
 *                          with a "Propose contract" flow that calls the
 *                          real `careers.offer` macro.
 *   `<ReputationGate>`   — the player's real reputation for the selected
 *                          track (`careers.myReputation`), computed
 *                          server-side from actual career_contracts +
 *                          worked-shift history, and the SAME
 *                          reputationGateTier/wageMultiplier functions
 *                          offerContract enforces — so what's shown here is
 *                          guaranteed consistent with what actually gates a
 *                          contract offer. Reports gated tiers up so the
 *                          ladder below can mark them locked.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Briefcase, RefreshCw, Hammer, AlertTriangle, Loader2, Check, X, ArrowLeftRight, ListOrdered, Star, GitBranch, Lock } from 'lucide-react';
import { useUIStore } from '@/store/ui';
import { EmployerBrowser } from '@/components/careers/EmployerBrowser';
import { ReputationGate, type ReputationInfo } from '@/components/careers/ReputationGate';
import { CareerLadderPath } from '@/components/careers/CareerLadderPath';

interface Track { id: string; category: string; activity: string; branch: string[] }
interface CareerProgress { tier: number; xp: number; highestTier: number; shifts: number }
interface WorkResult {
  ok: boolean; trackId?: string; tier?: number; performanceScore?: number; wage?: number; xp?: number; paid?: boolean; reason?: string;
  progress?: CareerProgress; promotion?: { tier: number; title: string } | null; nextTierXp?: number | null;
  retryAt?: number;
}
// server/lib/professions.js#tierInfo — one rung of a track's 10-tier ladder.
interface TierInfo {
  tier: number; title: string; skillGate: number; wageBase: number;
  isBranchPoint: boolean; isMastery: boolean;
}
interface Contract {
  id: string; track_id: string; tier: number; role: string | null; base_wage_sparks: number;
  status: string; employer_id: string; worker_id: string; signing_bonus_sparks?: number;
}
// Contracts in 'offered' or 'countered' status are still being negotiated — the
// other party (whoever did NOT make the standing offer) may accept, counter, or
// reject. The client doesn't know the exact last_offer_by encoding, so every
// negotiable contract gets the three actions; the backend is the source of
// truth (career-contracts.js#acceptContract rejects "cannot_accept_own_offer").
const NEGOTIABLE = new Set(['offered', 'countered']);

type LoadState = 'loading' | 'error' | 'disabled' | 'ready';

export default function CareersLens() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('chef');
  const [progress, setProgress] = useState<CareerProgress | null>(null);
  // Shift timing check: a marker sweeps the bar; stopping it near the centre
  // is the shift's skill input. Position is a pure function of elapsed time.
  const [timingStart, setTimingStart] = useState<number | null>(null);
  const [markerPos, setMarkerPos] = useState(0);
  const [lastAccuracy, setLastAccuracy] = useState<number | null>(null);
  const [last, setLast] = useState<WorkResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [negBusy, setNegBusy] = useState<string | null>(null);
  const [counterWage, setCounterWage] = useState<Record<string, string>>({});
  const [ladder, setLadder] = useState<TierInfo[]>([]);
  const [ladderLoading, setLadderLoading] = useState(false);
  const [reputation, setReputation] = useState<ReputationInfo | null>(null);
  const addToast = useUIStore((s) => s.addToast);

  const refresh = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const t = (await lensRun<{ ok: boolean; reason?: string; tracks?: Track[] }>('careers', 'tracks', {})).data.result;
      if (t?.reason === 'disabled') { setState('disabled'); return; }
      const list = t?.tracks || [];
      setTracks(list);
      const c = (await lensRun<{ ok: boolean; contracts?: Contract[] }>('careers', 'contracts', {})).data.result;
      setContracts(c?.contracts || []);
      setState('ready');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load careers.';
      setError(msg);
      setState('error');
      addToast({ type: 'error', message: 'Could not load careers — the career service is unreachable.' });
    }
  }, [addToast]);
  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);

  // careers.ladder — the selected track's full 10-tier wage/rank progression,
  // so a player can see what they're committing to before they play a shift.
  const loadLadder = useCallback(async (trackId: string) => {
    setLadderLoading(true);
    try {
      const r = (await lensRun<{ ok: boolean; ladder?: TierInfo[] }>('careers', 'ladder', { trackId })).data.result;
      setLadder(r?.ladder || []);
    } catch {
      setLadder([]);
    } finally {
      setLadderLoading(false);
    }
  }, []);
  useEffect(() => { if (state === 'ready' && selected) void Promise.resolve().then(() => loadLadder(selected)); }, [state, selected, loadLadder]);

  const loadProgress = useCallback(async (trackId: string) => {
    try {
      const r = (await lensRun<{ ok: boolean; progress?: CareerProgress }>('careers', 'progress', { trackId })).data.result;
      setProgress(r?.ok && r.progress ? r.progress : null);
    } catch { setProgress(null); }
  }, []);
  useEffect(() => { if (state === 'ready' && selected) void Promise.resolve().then(() => loadProgress(selected)); }, [state, selected, loadProgress]);

  const markerAt = (ms: number) => (Math.sin(ms / 260) + 1) / 2;
  useEffect(() => {
    if (timingStart === null) return;
    let raf = 0;
    const tick = () => { setMarkerPos(markerAt(performance.now() - timingStart)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [timingStart]);

  const work = useCallback(async (skillInput: number) => {
    setNote(null);
    setWorking(true);
    try {
      const r = (await lensRun<WorkResult>('careers', 'work', { trackId: selected, skillInput })).data.result;
      setLast(r);
      if (r?.ok) {
        if (r.progress) setProgress(r.progress);
        setNote(`Worked a ${selected} shift — earned ${r.wage} sparks (+${r.xp} XP).`);
        addToast({ type: 'success', message: `Shift complete — earned ${r.wage} sparks (+${r.xp} XP).`, duration: 2500 });
        if (r.promotion) addToast({ type: 'success', message: `Promoted to tier ${r.promotion.tier}: ${r.promotion.title}`, duration: 4000 });
        // a completed shift may have produced a contract-relevant state change; refresh contracts.
        try {
          const c = (await lensRun<{ contracts?: Contract[] }>('careers', 'contracts', {})).data.result;
          setContracts(c?.contracts || []);
        } catch { /* non-fatal */ }
      } else if (r?.reason === 'shift_cooldown' && r.retryAt) {
        const at = new Date(r.retryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        setNote(`You've already worked a paid shift. Next one opens at ${at}.`);
        addToast({ type: 'info', message: `Next paid shift opens at ${at}.` });
      } else {
        setNote(`Couldn't work: ${r?.reason || 'failed'}`);
        addToast({ type: 'error', message: `Shift could not be worked: ${r?.reason || 'failed'}.` });
      }
    } catch {
      setNote('Shift failed.');
      addToast({ type: 'error', message: 'Shift request failed — please try again.' });
    } finally {
      setWorking(false);
    }
  }, [selected, addToast]);

  const onShiftButton = useCallback(() => {
    if (working) return;
    if (timingStart === null) {
      setTimingStart(performance.now());
      return;
    }
    const pos = markerAt(performance.now() - timingStart);
    const accuracy = Math.max(0, 1 - Math.abs(pos - 0.5) * 2);
    setMarkerPos(pos);
    setTimingStart(null);
    setLastAccuracy(accuracy);
    void work(Math.round(accuracy * 100) / 100);
  }, [working, timingStart, work]);

  const refreshContracts = useCallback(async () => {
    try {
      const c = (await lensRun<{ ok: boolean; contracts?: Contract[] }>('careers', 'contracts', {})).data.result;
      setContracts(c?.contracts || []);
    } catch { /* non-fatal — the list just stays stale until next manual refresh */ }
  }, []);

  const negotiate = useCallback(async (action: 'accept' | 'counter' | 'reject', contractId: string, terms?: Record<string, unknown>) => {
    setNegBusy(contractId);
    try {
      const r = (await lensRun<{ ok: boolean; reason?: string; status?: string }>('careers', action, { contractId, terms })).data.result;
      if (r?.ok) {
        addToast({ type: 'success', message: action === 'accept' ? 'Contract accepted — signing bonus paid.' : action === 'reject' ? 'Contract rejected.' : 'Counter-offer sent.', duration: 2500 });
      } else {
        addToast({ type: 'error', message: `Couldn't ${action} contract: ${r?.reason || 'failed'}.` });
      }
      await refreshContracts();
    } catch {
      addToast({ type: 'error', message: `${action} request failed — please try again.` });
    } finally {
      setNegBusy(null);
    }
  }, [addToast, refreshContracts]);

  const byCategory = useMemo(() => {
    const m: Record<string, Track[]> = {};
    for (const t of tracks) (m[t.category] ||= []).push(t);
    return m;
  }, [tracks]);

  return (
    <LensShell lensId="careers">
    <NorthStarFrame
      lensId="careers"
      crumb="Careers"
      title={`Pick a trade${who ? `, ${who}` : ''}`}
      subtitle="Jobs and sports run on one engine: play a shift, climb a ten-tier ladder, and negotiate contracts with real employers."
      actions={
        <button onClick={() => void refresh()} className="rounded-full border border-white/10 p-2 text-zinc-400 transition-colors hover:text-white" aria-label="Refresh careers" title="Refresh">
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
        </button>
      }
      cta={state === 'ready' && tracks.length > 0 ? { label: working ? 'Working…' : timingStart === null ? 'Clock in' : 'Stop', icon: Hammer, onClick: onShiftButton, disabled: working, title: 'Start a shift, then stop the marker' } : undefined}
    >
    <div className="w-full">
      {state === 'disabled' ? (
        <p role="status" className="text-gray-400 text-sm">
          The living-career system is disabled on this server (<code>CONCORD_LIVING_CAREER=0</code>). It is enabled by default — unset that variable to turn it back on.
        </p>
      ) : state === 'loading' ? (
        <div role="status" aria-live="polite" aria-busy="true" className="text-gray-400 text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading careers…
        </div>
      ) : state === 'error' ? (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-950/30 p-4 animate-in fade-in duration-200 motion-reduce:animate-none">
          <p className="flex items-center gap-2 text-sm text-red-300">
            <AlertTriangle className="w-4 h-4" aria-hidden="true" /> {error ? `Couldn't load careers — ${error}` : 'Failed to load careers.'}
          </p>
          <button onClick={() => void refresh()} aria-label="Retry loading careers" className="mt-3 bg-red-600/80 hover:bg-red-500 transition-colors text-white text-xs rounded px-3 py-1">
            Retry
          </button>
        </div>
      ) : tracks.length === 0 ? (
        <div role="status" className="rounded-lg border border-white/10 bg-black/40 p-6 text-center animate-in fade-in duration-200 motion-reduce:animate-none">
          <Briefcase className="w-8 h-8 mx-auto mb-2 text-gray-600" aria-hidden="true" />
          <p className="text-gray-300 text-sm font-medium">No professions available yet.</p>
          <p className="text-gray-500 text-xs mt-1">The profession taxonomy is empty. Refresh once the career substrate is seeded.</p>
          <button onClick={() => void refresh()} aria-label="Refresh professions" className="mt-3 bg-amber-600 hover:bg-amber-500 transition-colors text-black text-xs font-medium rounded px-3 py-1">
            Refresh
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 animate-in fade-in duration-200 motion-reduce:animate-none">
          {/* Work a shift */}
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4" aria-label="Work a shift">
            <h2 className="text-sm font-semibold text-amber-100 mb-2 flex items-center gap-1"><Hammer className="w-4 h-4" aria-hidden="true" /> Work a shift</h2>
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 text-sm">
              <label className="sr-only" htmlFor="career-track">Profession track</label>
              <select id="career-track" value={selected} onChange={(e) => setSelected(e.target.value)} className="bg-black/60 border border-white/10 rounded px-2 py-1">
                {tracks.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.activity}</option>)}
              </select>
              <button
                onClick={onShiftButton}
                disabled={working}
                aria-label={timingStart === null ? 'Play a work shift' : 'Stop the marker'}
                className="bg-amber-600 hover:bg-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-black font-medium rounded px-3 py-1"
              >
                {working ? 'Working…' : timingStart === null ? 'Play shift' : 'Stop'}
              </button>
              {progress && (
                <span className="text-xs text-gray-400 tabular-nums">
                  Tier {progress.tier} · {progress.xp} XP{progress.tier < 10 ? ` / ${progress.tier * 100} to promote` : ' · top tier'} · {progress.shifts} shifts
                </span>
              )}
            </div>
            <div className="mt-3">
              <div
                role="meter"
                aria-label="Shift timing"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(markerPos * 100)}
                className="relative h-3 rounded-full bg-black/60 border border-white/10 overflow-hidden"
              >
                <div className="absolute inset-y-0 left-[40%] w-[20%] bg-amber-500/25" />
                <div className="absolute inset-y-0 w-1 rounded bg-amber-200" style={{ left: `calc(${(markerPos * 100).toFixed(2)}% - 2px)` }} />
              </div>
              <p className="mt-1 text-[11px] text-gray-500">
                {timingStart !== null
                  ? 'Stop the marker inside the shaded zone. Closer to the centre is a better shift.'
                  : 'Start a shift, then stop the marker in the centre. Accuracy is your shift skill.'}
              </p>
            </div>
            {last?.ok && (
              <p className="mt-2 text-xs text-gray-300">
                {lastAccuracy !== null && <>accuracy {lastAccuracy.toFixed(2)} → </>}performance {(last.performanceScore ?? 0).toFixed(2)} → <span className="text-amber-200">{last.wage} sparks</span> · +{last.xp} XP
                {last.promotion && <span className="ml-1 text-emerald-300">· promoted to {last.promotion.title}</span>}
              </p>
            )}
          </section>

          {/* Tier ladder — careers.ladder for the selected track. Tiers the
              player's real reputation currently gates them out of (reported
              up by <ReputationGate>) render locked. */}
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4" aria-label="Tier ladder">
            <h2 className="text-sm font-semibold text-amber-100 mb-2 flex items-center gap-1">
              <ListOrdered className="w-4 h-4" aria-hidden="true" /> {selected} ladder
            </h2>
            {ladderLoading ? (
              <div role="status" aria-live="polite" aria-busy="true" className="text-gray-400 text-xs flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading ladder…
              </div>
            ) : ladder.length === 0 ? (
              <p className="text-gray-500 text-xs">No ladder data for this track.</p>
            ) : (
              <>
              <CareerLadderPath ladder={ladder} currentTier={progress?.tier ?? 1} gatedTiers={reputation?.gatedTiers ?? []} />
              <ol className="space-y-1 text-xs">
                {ladder.map((t) => {
                  const gated = !!reputation && reputation.gatedTiers.includes(t.tier);
                  return (
                    <li key={t.tier} className={`flex items-center justify-between gap-2 bg-black/30 border rounded px-2 py-1 ${gated ? 'border-red-500/20 opacity-60' : 'border-white/5'}`}>
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="text-gray-500 tabular-nums w-5 shrink-0">{t.tier}.</span>
                        <span className="text-gray-100 truncate">{t.title}</span>
                        {t.isBranchPoint && <GitBranch className="w-3 h-3 text-sky-300 shrink-0" aria-label="Branch point" />}
                        {t.isMastery && <Star className="w-3 h-3 text-amber-300 shrink-0" aria-label="Mastery tier" />}
                        {gated && <Lock className="w-3 h-3 text-red-400 shrink-0" aria-label={`Gated by reputation — requires more than ${reputation?.reputation} reputation`} />}
                      </span>
                      <span className="text-gray-400 shrink-0 tabular-nums">gate {t.skillGate} · {t.wageBase} sparks/shift</span>
                    </li>
                  );
                })}
              </ol>
              </>
            )}
          </section>

          {/* Reputation (checklist item 7) + Employer discovery (checklist item 6) */}
          <ReputationGate trackId={selected} onLoaded={setReputation} />
          <EmployerBrowser trackId={selected} onContractProposed={() => void refreshContracts()} />

          {/* Taxonomy */}
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4" aria-label="Professions">
            <h2 className="text-sm font-semibold text-amber-100 mb-2">Professions</h2>
            {Object.entries(byCategory).map(([cat, ts]) => (
              <div key={cat} className="mb-2">
                <div className="text-xs uppercase tracking-wide text-gray-500">{cat}</div>
                <div className="flex flex-wrap gap-2 mt-1">
                  {ts.map((t) => <span key={t.id} className="text-xs bg-white/5 border border-white/10 rounded px-2 py-0.5">{t.id}</span>)}
                </div>
              </div>
            ))}
          </section>

          {/* Contracts */}
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4" aria-label="My contracts">
            <h2 className="text-sm font-semibold text-amber-100 mb-2">My contracts ({contracts.length})</h2>
            {contracts.length === 0 ? (
              <p className="text-gray-500 text-xs">No active contracts. Negotiate one to lock in a wage.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {contracts.map((c) => (
                  <li key={c.id} className="bg-black/40 border border-white/10 rounded px-2 py-1.5">
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                      <span>{c.track_id} · tier {c.tier} · {c.role || '—'}</span>
                      <span className="text-amber-200">{c.base_wage_sparks} sparks · {c.status}</span>
                    </div>
                    {NEGOTIABLE.has(c.status) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-1.5">
                        <span className="text-gray-500">Awaiting response —</span>
                        <button
                          onClick={() => negotiate('accept', c.id)}
                          disabled={negBusy === c.id}
                          aria-label={`Accept contract ${c.id}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600/70 hover:bg-emerald-600 text-emerald-50 disabled:opacity-50"
                        ><Check className="w-3 h-3" aria-hidden="true" /> accept</button>
                        <input
                          type="number" min={0}
                          aria-label={`Counter wage for contract ${c.id}`}
                          placeholder={String(c.base_wage_sparks)}
                          value={counterWage[c.id] ?? ''}
                          onChange={(e) => setCounterWage((m) => ({ ...m, [c.id]: e.target.value }))}
                          className="w-16 px-1.5 py-0.5 rounded bg-black/60 border border-white/10 text-gray-100"
                        />
                        <button
                          onClick={() => {
                            const wage = Number(counterWage[c.id]);
                            void negotiate('counter', c.id, { baseWage: Number.isFinite(wage) && wage > 0 ? wage : undefined });
                          }}
                          disabled={negBusy === c.id}
                          aria-label={`Send counter-offer for contract ${c.id}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-600/70 hover:bg-amber-600 text-amber-50 disabled:opacity-50"
                        ><ArrowLeftRight className="w-3 h-3" aria-hidden="true" /> counter</button>
                        <button
                          onClick={() => negotiate('reject', c.id)}
                          disabled={negBusy === c.id}
                          aria-label={`Reject contract ${c.id}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-700/60 hover:bg-red-700 text-red-50 disabled:opacity-50"
                        ><X className="w-3 h-3" aria-hidden="true" /> reject</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {note && <p role="status" aria-live="polite" className="mt-4 text-xs text-gray-400">{note}</p>}
    </div>
    </NorthStarFrame>
    </LensShell>
  );
}
