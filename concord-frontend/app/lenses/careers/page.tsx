'use client';

import { LensShell } from '@/components/lens/LensShell';

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

interface Track { id: string; category: string; activity: string; branch: string[] }
interface WorkResult { ok: boolean; trackId?: string; tier?: number; performanceScore?: number; wage?: number; xp?: number; paid?: boolean; reason?: string }
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
  const [tracks, setTracks] = useState<Track[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('chef');
  const [skill, setSkill] = useState(0.7);
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
  useEffect(() => { void refresh(); }, [refresh]);

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
  useEffect(() => { if (state === 'ready' && selected) void loadLadder(selected); }, [state, selected, loadLadder]);

  const work = useCallback(async () => {
    setNote(null);
    setWorking(true);
    try {
      const r = (await lensRun<WorkResult>('careers', 'work', { trackId: selected, tier: 5, attribute: 0.7, skillInput: skill })).data.result;
      setLast(r);
      if (r?.ok) {
        setNote(`Worked a ${selected} shift — earned ${r.wage} sparks (+${r.xp} XP).`);
        addToast({ type: 'success', message: `Shift complete — earned ${r.wage} sparks (+${r.xp} XP).`, duration: 2500 });
        // a completed shift may have produced a contract-relevant state change; refresh contracts.
        try {
          const c = (await lensRun<{ contracts?: Contract[] }>('careers', 'contracts', {})).data.result;
          setContracts(c?.contracts || []);
        } catch { /* non-fatal */ }
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
  }, [selected, skill, addToast]);

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
    <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-6 text-gray-100">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-amber-200">
          <Briefcase className="w-5 h-5" aria-hidden="true" /> Careers
        </h1>
        <button onClick={() => void refresh()} className="self-start sm:self-auto text-gray-400 hover:text-white transition-colors" aria-label="Refresh careers" title="Refresh">
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
        </button>
      </header>

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
        <div className="animate-in fade-in duration-200 motion-reduce:animate-none">
          {/* Work a shift */}
          <section className="mb-6 rounded-lg border border-white/10 bg-black/40 p-4" aria-label="Work a shift">
            <h2 className="text-sm font-semibold text-amber-100 mb-2 flex items-center gap-1"><Hammer className="w-4 h-4" aria-hidden="true" /> Work a shift</h2>
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 text-sm">
              <label className="sr-only" htmlFor="career-track">Profession track</label>
              <select id="career-track" value={selected} onChange={(e) => setSelected(e.target.value)} className="bg-black/60 border border-white/10 rounded px-2 py-1">
                {tracks.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.activity}</option>)}
              </select>
              <label className="flex items-center gap-2" htmlFor="career-skill">skill
                <input id="career-skill" type="range" min={0} max={1} step={0.05} value={skill} onChange={(e) => setSkill(Number(e.target.value))} aria-valuetext={skill.toFixed(2)} />
                <span className="tabular-nums">{skill.toFixed(2)}</span>
              </label>
              <button onClick={() => void work()} disabled={working} aria-label="Play a work shift" className="bg-amber-600 hover:bg-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-black font-medium rounded px-3 py-1">
                {working ? 'Working…' : 'Play shift'}
              </button>
            </div>
            {last?.ok && (
              <p className="mt-2 text-xs text-gray-300">performance {(last.performanceScore ?? 0).toFixed(2)} → <span className="text-amber-200">{last.wage} sparks</span> · +{last.xp} XP</p>
            )}
          </section>

          {/* Tier ladder — careers.ladder for the selected track. Tiers the
              player's real reputation currently gates them out of (reported
              up by <ReputationGate>) render locked. */}
          <section className="mb-6 rounded-lg border border-white/10 bg-black/40 p-4" aria-label="Tier ladder">
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
            )}
          </section>

          {/* Reputation (checklist item 7) + Employer discovery (checklist item 6) */}
          <ReputationGate trackId={selected} onLoaded={setReputation} />
          <EmployerBrowser trackId={selected} onContractProposed={() => void refreshContracts()} />

          {/* Taxonomy */}
          <section className="mb-6" aria-label="Professions">
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
          <section aria-label="My contracts">
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
    </LensShell>
  );
}
