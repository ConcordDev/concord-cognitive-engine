'use client';

/**
 * /lenses/detective — Phase CA5 deduction board.
 *
 * Obra-Dinn style. Pick an open crime → review evidence → propose
 * (suspect, weapon, motive). 2-of-3 correct with suspect-match solves
 * the case. Otherwise records a deduction attempt and the case stays
 * open for someone else.
 */

import { useCallback, useEffect, useState } from 'react';
import { Search, FileText, Check, X } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';

interface Crime { id: string; crime_type: string; location_id: string; victim_id: string | null; occurred_at: number; }
interface Evidence { id: string; evidence_type: string; description: string; links_to_id: string | null; collected_at: number; }

export default function DetectiveLensPage() {
  const [worldId, setWorldId] = useState('tunya');
  const [crimes, setCrimes] = useState<Crime[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [form, setForm] = useState({ suspectId: '', weapon: '', motive: '' });
  const [result, setResult] = useState<{ correctCount: number; solved: boolean; reasons: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshCrimes = useCallback(() => {
    fetch(`/api/detective/open/${encodeURIComponent(worldId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.ok) setCrimes(d.crimes || []); })
      .catch(() => {});
  }, [worldId]);

  useEffect(() => { refreshCrimes(); }, [refreshCrimes]);

  useEffect(() => {
    if (!selected) { setEvidence([]); return; }
    fetch(`/api/detective/crime/${selected}/evidence`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.ok) setEvidence(d.evidence || []); })
      .catch(() => {});
  }, [selected]);

  const submit = useCallback(async () => {
    if (!selected || !form.suspectId.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/detective/crime/${selected}/deduce`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (j?.ok) {
        setResult({ correctCount: j.correctCount, solved: j.solved, reasons: j.reasons });
        if (j.solved) refreshCrimes();
      }
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
            <input value={worldId} onChange={(e) => setWorldId(e.target.value)}
              className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
          </div>
        </header>

        <section className="mx-auto grid max-w-screen-2xl grid-cols-1 gap-4 px-4 py-5 sm:px-6 lg:grid-cols-3">
          <aside className="rounded-xl border border-amber-500/20 bg-zinc-950/60 p-3">
            <h2 className="mb-2 text-[11px] uppercase tracking-wider text-amber-300/60">Open cases</h2>
            {crimes.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-slate-500">No open cases.</p>
            ) : (
              <ul className="space-y-1">
                {crimes.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => { setSelected(c.id); setResult(null); }}
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
                {evidence.length === 0 ? (
                  <p className="text-[12px] text-slate-500">No evidence collected yet.</p>
                ) : (
                  <ul className="mb-4 space-y-1.5">
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
                  <input value={form.suspectId} onChange={(e) => setForm({ ...form, suspectId: e.target.value })}
                    placeholder="Suspect ID" className="block w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
                  <input value={form.weapon} onChange={(e) => setForm({ ...form, weapon: e.target.value })}
                    placeholder="Weapon / crime kind (e.g. 'theft')" className="block w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
                  <input value={form.motive} onChange={(e) => setForm({ ...form, motive: e.target.value })}
                    placeholder="Motive (freeform)" className="block w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
                  <button onClick={submit} disabled={!form.suspectId.trim() || busy}
                    className="w-full rounded bg-amber-500/30 px-3 py-1.5 text-[12px] text-amber-100 hover:bg-amber-500/40 disabled:opacity-40">
                    <FileText className="mr-1 inline h-3 w-3" /> Submit deduction
                  </button>
                </div>

                {result && (
                  <div className={`mt-3 rounded border p-2 text-[12px] ${result.solved ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'}`}>
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
