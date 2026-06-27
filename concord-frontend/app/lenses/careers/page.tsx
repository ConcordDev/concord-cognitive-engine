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
 * Four UX states, all genuine: loading (initial fetch), error (fetch threw),
 * empty (career system enabled but no tracks resolved), populated.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Briefcase, RefreshCw, Hammer, AlertTriangle } from 'lucide-react';

interface Track { id: string; category: string; activity: string; branch: string[] }
interface WorkResult { ok: boolean; trackId?: string; tier?: number; performanceScore?: number; wage?: number; xp?: number; paid?: boolean; reason?: string }
interface Contract { id: string; track_id: string; tier: number; role: string | null; base_wage_sparks: number; status: string; employer_id: string; worker_id: string }

type LoadState = 'loading' | 'error' | 'disabled' | 'ready';

export default function CareersLens() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('chef');
  const [skill, setSkill] = useState(0.7);
  const [last, setLast] = useState<WorkResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    setState('loading');
    setErrMsg(null);
    try {
      const t = (await lensRun<{ ok: boolean; reason?: string; tracks?: Track[] }>('careers', 'tracks', {})).data.result;
      if (t?.reason === 'disabled') { setState('disabled'); return; }
      const list = t?.tracks || [];
      setTracks(list);
      const c = (await lensRun<{ ok: boolean; contracts?: Contract[] }>('careers', 'contracts', {})).data.result;
      setContracts(c?.contracts || []);
      setState('ready');
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Failed to load careers.');
      setState('error');
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const work = useCallback(async () => {
    setNote(null);
    setWorking(true);
    try {
      const r = (await lensRun<WorkResult>('careers', 'work', { trackId: selected, tier: 5, attribute: 0.7, skillInput: skill })).data.result;
      setLast(r);
      if (r?.ok) {
        setNote(`Worked a ${selected} shift — earned ${r.wage} sparks (+${r.xp} XP).`);
        // a completed shift may have produced a contract-relevant state change; refresh contracts.
        try {
          const c = (await lensRun<{ contracts?: Contract[] }>('careers', 'contracts', {})).data.result;
          setContracts(c?.contracts || []);
        } catch { /* non-fatal */ }
      } else {
        setNote(`Couldn't work: ${r?.reason || 'failed'}`);
      }
    } catch {
      setNote('Shift failed.');
    } finally {
      setWorking(false);
    }
  }, [selected, skill]);

  const byCategory = useMemo(() => {
    const m: Record<string, Track[]> = {};
    for (const t of tracks) (m[t.category] ||= []).push(t);
    return m;
  }, [tracks]);

  return (
    <LensShell lensId="careers">
    <div className="max-w-3xl mx-auto p-6 text-gray-100">
      <header className="flex items-center justify-between mb-4">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-amber-200">
          <Briefcase className="w-5 h-5" aria-hidden="true" /> Careers
        </h1>
        <button onClick={() => void refresh()} className="text-gray-400 hover:text-white" aria-label="Refresh careers" title="Refresh">
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
        </button>
      </header>

      {state === 'disabled' ? (
        <p role="status" className="text-gray-400 text-sm">
          The living-career system is disabled on this server (<code>CONCORD_LIVING_CAREER=0</code>). It is enabled by default — unset that variable to turn it back on.
        </p>
      ) : state === 'loading' ? (
        <div role="status" aria-live="polite" aria-busy="true" className="text-gray-400 text-sm flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading careers…
        </div>
      ) : state === 'error' ? (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-950/30 p-4">
          <p className="flex items-center gap-2 text-sm text-red-300">
            <AlertTriangle className="w-4 h-4" aria-hidden="true" /> {errMsg || 'Failed to load careers.'}
          </p>
          <button onClick={() => void refresh()} className="mt-3 bg-red-600/80 hover:bg-red-500 text-white text-xs rounded px-3 py-1">
            Retry
          </button>
        </div>
      ) : tracks.length === 0 ? (
        <div role="status" className="rounded-lg border border-white/10 bg-black/40 p-6 text-center">
          <Briefcase className="w-8 h-8 mx-auto mb-2 text-gray-600" aria-hidden="true" />
          <p className="text-gray-300 text-sm font-medium">No professions available yet.</p>
          <p className="text-gray-500 text-xs mt-1">The profession taxonomy is empty. Refresh once the career substrate is seeded.</p>
          <button onClick={() => void refresh()} className="mt-3 bg-amber-600 hover:bg-amber-500 text-black text-xs font-medium rounded px-3 py-1">
            Refresh
          </button>
        </div>
      ) : (
        <>
          {/* Work a shift */}
          <section className="mb-6 rounded-lg border border-white/10 bg-black/40 p-4" aria-label="Work a shift">
            <h2 className="text-sm font-semibold text-amber-100 mb-2 flex items-center gap-1"><Hammer className="w-4 h-4" aria-hidden="true" /> Work a shift</h2>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="sr-only" htmlFor="career-track">Profession track</label>
              <select id="career-track" value={selected} onChange={(e) => setSelected(e.target.value)} className="bg-black/60 border border-white/10 rounded px-2 py-1">
                {tracks.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.activity}</option>)}
              </select>
              <label className="flex items-center gap-2" htmlFor="career-skill">skill
                <input id="career-skill" type="range" min={0} max={1} step={0.05} value={skill} onChange={(e) => setSkill(Number(e.target.value))} aria-valuetext={skill.toFixed(2)} />
                <span className="tabular-nums">{skill.toFixed(2)}</span>
              </label>
              <button onClick={() => void work()} disabled={working} className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-black font-medium rounded px-3 py-1">
                {working ? 'Working…' : 'Play shift'}
              </button>
            </div>
            {last?.ok && (
              <p className="mt-2 text-xs text-gray-300">performance {(last.performanceScore ?? 0).toFixed(2)} → <span className="text-amber-200">{last.wage} sparks</span> · +{last.xp} XP</p>
            )}
          </section>

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
              <ul className="space-y-1 text-xs">
                {contracts.map((c) => (
                  <li key={c.id} className="flex justify-between bg-black/40 border border-white/10 rounded px-2 py-1">
                    <span>{c.track_id} · tier {c.tier} · {c.role || '—'}</span>
                    <span className="text-amber-200">{c.base_wage_sparks} sparks · {c.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {note && <p role="status" aria-live="polite" className="mt-4 text-xs text-gray-400">{note}</p>}
    </div>
    </LensShell>
  );
}
