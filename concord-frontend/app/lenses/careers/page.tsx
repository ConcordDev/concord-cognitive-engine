'use client';

import { LensShell } from '@/components/lens/LensShell';

/**
 * Careers lens — the client door into the living-career system (jobs = sports =
 * one engine). Lists the profession taxonomy, lets you PLAY a shift (skill-input
 * → performance → sparks + promotion XP via the floor-gated resolver), and shows
 * your contracts. Calls the `careers` macro domain via /api/lens/run. Behind
 * CONCORD_LIVING_CAREER server-side — when off the macros return
 * { ok:false, reason:'disabled' } and the lens shows the coming-soon note.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Briefcase, RefreshCw, Hammer } from 'lucide-react';

interface Track { id: string; category: string; activity: string; branch: string[] }
interface WorkResult { ok: boolean; trackId?: string; tier?: number; performanceScore?: number; wage?: number; xp?: number; paid?: boolean; reason?: string }
interface Contract { id: string; track_id: string; tier: number; role: string | null; base_wage_sparks: number; status: string; employer_id: string; worker_id: string }

export default function CareersLens() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [disabled, setDisabled] = useState(false);
  const [selected, setSelected] = useState<string>('chef');
  const [skill, setSkill] = useState(0.7);
  const [last, setLast] = useState<WorkResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const t = (await lensRun<{ ok: boolean; reason?: string; tracks?: Track[] }>('careers', 'tracks', {})).data.result;
      if (t?.reason === 'disabled') { setDisabled(true); }
      else { setDisabled(false); setTracks(t?.tracks || []); }
      const c = (await lensRun<{ contracts?: Contract[] }>('careers', 'contracts', {})).data.result;
      setContracts(c?.contracts || []);
    } catch { setNote('Failed to load careers.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const work = useCallback(async () => {
    setNote(null);
    try {
      const r = (await lensRun<WorkResult>('careers', 'work', { trackId: selected, tier: 5, attribute: 0.7, skillInput: skill })).data.result;
      setLast(r);
      if (r?.ok) setNote(`Worked a ${selected} shift — earned ${r.wage} sparks (+${r.xp} XP).`);
      else setNote(`Couldn't work: ${r?.reason || 'failed'}`);
    } catch { setNote('Shift failed.'); }
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
          <Briefcase className="w-5 h-5" /> Careers
        </h1>
        <button onClick={() => void refresh()} className="text-gray-400 hover:text-white" aria-label="refresh"><RefreshCw className="w-4 h-4" /></button>
      </header>

      {disabled ? (
        <p className="text-gray-400 text-sm">The living-career system is coming soon (enable <code>CONCORD_LIVING_CAREER</code>).</p>
      ) : loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : (
        <>
          {/* Work a shift */}
          <section className="mb-6 rounded-lg border border-white/10 bg-black/40 p-4">
            <h2 className="text-sm font-semibold text-amber-100 mb-2 flex items-center gap-1"><Hammer className="w-4 h-4" /> Work a shift</h2>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <select value={selected} onChange={(e) => setSelected(e.target.value)} className="bg-black/60 border border-white/10 rounded px-2 py-1">
                {tracks.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.activity}</option>)}
              </select>
              <label className="flex items-center gap-2">skill
                <input type="range" min={0} max={1} step={0.05} value={skill} onChange={(e) => setSkill(Number(e.target.value))} />
                <span className="tabular-nums">{skill.toFixed(2)}</span>
              </label>
              <button onClick={() => void work()} className="bg-amber-600 hover:bg-amber-500 text-black font-medium rounded px-3 py-1">Play shift</button>
            </div>
            {last?.ok && (
              <p className="mt-2 text-xs text-gray-300">performance {(last.performanceScore ?? 0).toFixed(2)} → <span className="text-amber-200">{last.wage} sparks</span> · +{last.xp} XP</p>
            )}
          </section>

          {/* Taxonomy */}
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-amber-100 mb-2">Professions</h2>
            {Object.entries(byCategory).map(([cat, ts]) => (
              <div key={cat} className="mb-2">
                <div className="text-xs uppercase tracking-wide text-gray-400">{cat}</div>
                <div className="flex flex-wrap gap-2 mt-1">
                  {ts.map((t) => <span key={t.id} className="text-xs bg-white/5 border border-white/10 rounded px-2 py-0.5">{t.id}</span>)}
                </div>
              </div>
            ))}
          </section>

          {/* Contracts */}
          <section>
            <h2 className="text-sm font-semibold text-amber-100 mb-2">My contracts ({contracts.length})</h2>
            {contracts.length === 0 ? (
              <p className="text-gray-400 text-xs">No active contracts. Negotiate one to lock in a wage.</p>
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

      {note && <p className="mt-4 text-xs text-gray-400">{note}</p>}
    </div>
    </LensShell>
  );
}
