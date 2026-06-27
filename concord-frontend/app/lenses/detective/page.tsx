'use client';

/**
 * /lenses/detective — Phase CA5 deduction board.
 *
 * Obra-Dinn style. Pick an open crime → review evidence → propose
 * (suspect, weapon, motive). 2-of-3 correct WITH a suspect-match solves
 * the case. Otherwise records a deduction attempt and the case stays
 * open for someone else.
 *
 * Wiring (all REST routes registered in server.js, sharing server/lib/detective.js
 * with the detective.* macro surface in server/domains/detective.js):
 *   GET  /api/detective/open/:worldId            → listOpenCrimes
 *   GET  /api/detective/crime/:crimeId/evidence  → listEvidenceForCrime
 *   POST /api/detective/crime/:crimeId/deduce    → lockInDeduction (auth)
 *
 * Four honest UX states: loading (skeleton), error (with retry), empty
 * ("no open cases"), populated.
 */

import { useCallback, useEffect, useState } from 'react';
import { Search, FileText, Check, X, AlertTriangle, RefreshCw } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';

interface Crime { id: string; crime_type: string; location_id: string; victim_id: string | null; occurred_at: number; }
interface Evidence { id: string; evidence_type: string; description: string; links_to_id: string | null; collected_at: number; }

type LoadState = 'loading' | 'error' | 'ready';

export default function DetectiveLensPage() {
  const [worldId, setWorldId] = useState('tunya');
  const [crimes, setCrimes] = useState<Crime[]>([]);
  const [crimesState, setCrimesState] = useState<LoadState>('loading');
  const [selected, setSelected] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [evidenceState, setEvidenceState] = useState<LoadState>('ready');
  const [form, setForm] = useState({ suspectId: '', weapon: '', motive: '' });
  const [result, setResult] = useState<{ correctCount: number; solved: boolean; reasons: string[] } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshCrimes = useCallback(() => {
    setCrimesState('loading');
    fetch(`/api/detective/open/${encodeURIComponent(worldId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (d?.ok) { setCrimes(d.crimes || []); setCrimesState('ready'); }
        else throw new Error(d?.error || 'Unexpected response');
      })
      .catch(() => { setCrimes([]); setCrimesState('error'); });
  }, [worldId]);

  useEffect(() => { refreshCrimes(); }, [refreshCrimes]);

  const loadEvidence = useCallback((crimeId: string) => {
    setEvidenceState('loading');
    fetch(`/api/detective/crime/${encodeURIComponent(crimeId)}/evidence`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (d?.ok) { setEvidence(d.evidence || []); setEvidenceState('ready'); }
        else throw new Error(d?.error || 'Unexpected response');
      })
      .catch(() => { setEvidence([]); setEvidenceState('error'); });
  }, []);

  useEffect(() => {
    if (!selected) { setEvidence([]); setEvidenceState('ready'); return; }
    loadEvidence(selected);
  }, [selected, loadEvidence]);

  const submit = useCallback(async () => {
    if (!selected || !form.suspectId.trim()) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const r = await fetch(`/api/detective/crime/${encodeURIComponent(selected)}/deduce`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await r.json().catch(() => null);
      if (j?.ok) {
        setResult({ correctCount: j.correctCount, solved: j.solved, reasons: j.reasons });
        if (j.solved) refreshCrimes();
      } else {
        setSubmitError(j?.error || j?.reason || `Could not submit (HTTP ${r.status})`);
      }
    } catch {
      setSubmitError('Network error — your deduction was not submitted.');
    } finally { setBusy(false); }
  }, [selected, form, refreshCrimes]);

  return (
    <LensShell lensId="detective" asMain={false}>
      <ManifestActionBar />
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-amber-950/10 text-slate-100">
        <header className="border-b border-amber-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
              <Search className="h-5 w-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Deduction board</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">Open cases. Lock in three facts. Solve.</p>
            </div>
            <label className="sr-only" htmlFor="detective-world">World</label>
            <input id="detective-world" value={worldId} onChange={(e) => setWorldId(e.target.value)}
              aria-label="World"
              className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
          </div>
        </header>

        <section className="mx-auto grid max-w-screen-2xl grid-cols-1 gap-4 px-4 py-5 sm:px-6 lg:grid-cols-3">
          <aside className="rounded-xl border border-amber-500/20 bg-zinc-950/60 p-3" aria-label="Open cases">
            <h2 className="mb-2 text-[11px] uppercase tracking-wider text-amber-300/60">Open cases</h2>

            {crimesState === 'loading' ? (
              <div data-testid="cases-loading" aria-busy="true" className="space-y-1.5" role="status">
                <span className="sr-only">Loading open cases…</span>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-9 animate-pulse rounded bg-slate-800/50" />
                ))}
              </div>
            ) : crimesState === 'error' ? (
              <div data-testid="cases-error" role="alert" className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-center">
                <AlertTriangle className="mx-auto mb-1 h-4 w-4 text-rose-300" />
                <p className="text-[12px] text-rose-200">Couldn&apos;t load cases.</p>
                <button onClick={refreshCrimes}
                  className="mt-2 inline-flex items-center gap-1 rounded bg-rose-500/20 px-2 py-1 text-[11px] text-rose-100 hover:bg-rose-500/30">
                  <RefreshCw className="h-3 w-3" /> Retry
                </button>
              </div>
            ) : crimes.length === 0 ? (
              <p data-testid="cases-empty" className="py-4 text-center text-[12px] text-slate-500">
                No open cases in this world.
              </p>
            ) : (
              <ul data-testid="cases-list" className="space-y-1">
                {crimes.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => { setSelected(c.id); setResult(null); setSubmitError(null); }}
                      aria-pressed={selected === c.id}
                      className={`w-full rounded px-2 py-1 text-left text-[12px] ${selected === c.id ? 'bg-amber-500/20 text-amber-100' : 'text-slate-300 hover:bg-slate-800/50'}`}>
                      <div className="font-medium">{c.crime_type}</div>
                      <div className="text-[10px] text-slate-500">@ {c.location_id}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <div className="lg:col-span-2 rounded-xl border border-amber-500/20 bg-zinc-950/60 p-4">
            {!selected ? (
              <p className="py-12 text-center text-[12px] text-slate-500">Select a case from the left.</p>
            ) : (
              <>
                <h2 className="mb-3 text-sm font-semibold text-amber-100">Evidence</h2>

                {evidenceState === 'loading' ? (
                  <div data-testid="evidence-loading" aria-busy="true" role="status" className="mb-4 space-y-1.5">
                    <span className="sr-only">Loading evidence…</span>
                    {[0, 1].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-amber-500/10" />)}
                  </div>
                ) : evidenceState === 'error' ? (
                  <div data-testid="evidence-error" role="alert" className="mb-4 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-[12px] text-rose-200">
                    <AlertTriangle className="mr-1 inline h-3 w-3" /> Couldn&apos;t load evidence.{' '}
                    <button onClick={() => selected && loadEvidence(selected)}
                      className="underline hover:text-rose-100">Retry</button>
                  </div>
                ) : evidence.length === 0 ? (
                  <p data-testid="evidence-empty" className="mb-4 text-[12px] text-slate-500">No evidence collected yet.</p>
                ) : (
                  <ul data-testid="evidence-list" className="mb-4 space-y-1.5">
                    {evidence.map((e) => (
                      <li key={e.id} className="rounded border border-amber-500/15 bg-amber-500/5 p-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-amber-200">{e.evidence_type}</span>
                          {e.links_to_id && (
                            <span className="text-[10px] text-amber-300/60">→ {e.links_to_id}</span>
                          )}
                        </div>
                        <div className="mt-1 text-[12px] text-slate-200">{e.description}</div>
                      </li>
                    ))}
                  </ul>
                )}

                <h3 className="mb-2 text-[11px] uppercase tracking-wider text-amber-300/60">Lock in</h3>
                <div className="space-y-2">
                  <label className="sr-only" htmlFor="detective-suspect">Suspect ID</label>
                  <input id="detective-suspect" value={form.suspectId} onChange={(e) => setForm({ ...form, suspectId: e.target.value })}
                    placeholder="Suspect ID" className="block w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
                  <label className="sr-only" htmlFor="detective-weapon">Weapon or crime kind</label>
                  <input id="detective-weapon" value={form.weapon} onChange={(e) => setForm({ ...form, weapon: e.target.value })}
                    placeholder="Weapon / crime kind (e.g. 'theft')" className="block w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
                  <label className="sr-only" htmlFor="detective-motive">Motive</label>
                  <input id="detective-motive" value={form.motive} onChange={(e) => setForm({ ...form, motive: e.target.value })}
                    placeholder="Motive (freeform)" className="block w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
                  <button onClick={submit} disabled={!form.suspectId.trim() || busy}
                    aria-busy={busy}
                    className="w-full rounded bg-amber-500/30 px-3 py-1.5 text-[12px] text-amber-100 hover:bg-amber-500/40 disabled:opacity-40">
                    <FileText className="mr-1 inline h-3 w-3" /> {busy ? 'Submitting…' : 'Submit deduction'}
                  </button>
                </div>

                {submitError && (
                  <div data-testid="submit-error" role="alert" className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 p-2 text-[12px] text-rose-200">
                    <AlertTriangle className="mr-1 inline h-3 w-3" /> {submitError}
                  </div>
                )}

                {result && (
                  <div data-testid="deduce-result" role="status"
                    className={`mt-3 rounded border p-2 text-[12px] ${result.solved ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'}`}>
                    {result.solved ? <Check className="inline h-3 w-3" /> : <X className="inline h-3 w-3" />}
                    {result.solved ? ' Case solved' : ' Not yet'} — {result.correctCount}/3 correct ({result.reasons.join(', ') || 'no matches'})
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>
    </LensShell>
  );
}
