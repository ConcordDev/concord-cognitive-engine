'use client';

/**
 * RxMedicationsPanel — medication list, dose schedule, today's doses
 * and 30-day adherence. Hydrates via pharmacy.med-list / today-doses /
 * adherence-report.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Pill, Check, X, Clock, Archive } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Medication { id: string; name: string; strength: string | null; form: string; quantity: number; refillsRemaining: number; hasSchedule: boolean }
interface TodayDose { medId: string; medName: string; time: string; doseAmount: string; status: string }
interface AdherenceRow { medId: string; name: string; pct: number | null }

export function RxMedicationsPanel({ onChange }: { onChange: () => void }) {
  const [meds, setMeds] = useState<Medication[]>([]);
  const [doses, setDoses] = useState<TodayDose[]>([]);
  const [adherence, setAdherence] = useState<{ overall: number | null; perMed: AdherenceRow[] }>({ overall: null, perMed: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', strength: '', form: 'tablet', quantity: '', refillsRemaining: '' });
  const [schedFor, setSchedFor] = useState<string | null>(null);
  const [schedTimes, setSchedTimes] = useState('08:00, 20:00');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [m, t, a] = await Promise.all([
      lensRun('pharmacy', 'med-list', {}),
      lensRun('pharmacy', 'today-doses', {}),
      lensRun('pharmacy', 'adherence-report', { days: 30 }),
    ]);
    setMeds(m.data?.result?.medications || []);
    setDoses(t.data?.result?.doses || []);
    setAdherence({ overall: a.data?.result?.overall ?? null, perMed: a.data?.result?.perMed || [] });
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const addMed = async () => {
    if (!form.name.trim()) { setError('Medication name is required.'); return; }
    const r = await lensRun('pharmacy', 'med-add', {
      name: form.name.trim(), strength: form.strength.trim(), form: form.form,
      quantity: Number(form.quantity) || 0, refillsRemaining: Number(form.refillsRemaining) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', strength: '', form: 'tablet', quantity: '', refillsRemaining: '' });
    setShowAdd(false); setError(null);
    await refresh(); onChange();
  };

  const setSchedule = async (medId: string) => {
    const times = schedTimes.split(',').map((t) => t.trim()).filter(Boolean);
    const r = await lensRun('pharmacy', 'schedule-set', { medId, times });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setSchedFor(null); setError(null);
    await refresh(); onChange();
  };

  const logDose = async (d: TodayDose, status: string) => {
    await lensRun('pharmacy', 'dose-log', { medId: d.medId, status, scheduledTime: d.time });
    await refresh(); onChange();
  };
  const archive = async (id: string) => { await lensRun('pharmacy', 'med-archive', { id }); await refresh(); onChange(); };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Today's doses */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Clock className="w-3.5 h-3.5 text-amber-400" /> Today&apos;s doses
          {adherence.overall != null && <span className="text-[10px] text-zinc-400">· {adherence.overall}% adherence (30d)</span>}
        </h3>
        {doses.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No doses scheduled today. Set a schedule on a medication below.</p>
        ) : (
          <ul className="space-y-1">
            {doses.map((d, i) => (
              <li key={`${d.medId}-${d.time}-${i}`}
                className={cn('flex items-center justify-between bg-zinc-900/70 border rounded-lg px-3 py-2',
                  d.status === 'taken' ? 'border-emerald-900/50' : d.status === 'pending' ? 'border-zinc-800' : 'border-zinc-800 opacity-60')}>
                <div>
                  <p className="text-xs text-zinc-200">{d.medName}</p>
                  <p className="text-[10px] text-zinc-400">{d.time} · {d.doseAmount}</p>
                </div>
                {d.status === 'pending' ? (
                  <div className="flex gap-1">
                    <button type="button" onClick={() => logDose(d, 'taken')}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] bg-emerald-700/30 text-emerald-300 rounded-lg">
                      <Check className="w-3 h-3" /> Take
                    </button>
                    <button type="button" onClick={() => logDose(d, 'skipped')}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 text-zinc-400 rounded-lg">
                      <X className="w-3 h-3" /> Skip
                    </button>
                  </div>
                ) : (
                  <span className={cn('text-[10px] capitalize', d.status === 'taken' ? 'text-emerald-400' : 'text-zinc-400')}>{d.status}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Medications */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <Pill className="w-3.5 h-3.5 text-amber-400" /> Medications
          </h3>
          <button type="button" onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {showAdd && (
          <div className="grid grid-cols-3 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 mb-2">
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Strength" value={form.strength} onChange={(e) => setForm({ ...form, strength: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <select value={form.form} onChange={(e) => setForm({ ...form, form: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              {['tablet', 'capsule', 'liquid', 'injection', 'inhaler', 'topical'].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <input placeholder="Qty on hand" inputMode="numeric" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Refills left" inputMode="numeric" value={form.refillsRemaining} onChange={(e) => setForm({ ...form, refillsRemaining: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={addMed}
              className="col-span-3 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Save medication</button>
          </div>
        )}

        {meds.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No medications. Add one to start tracking doses.</p>
        ) : (
          <ul className="space-y-2">
            {meds.map((m) => {
              const adh = adherence.perMed.find((x) => x.medId === m.id);
              return (
                <li key={m.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">
                        {m.name} {m.strength && <span className="text-zinc-400 font-normal">{m.strength}</span>}
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        {m.quantity} {m.form}s on hand · {m.refillsRemaining} refills
                        {adh?.pct != null ? ` · ${adh.pct}% adherence` : ''}
                      </p>
                    </div>
                    <button aria-label="Archive" type="button" onClick={() => archive(m.id)} className="text-zinc-600 hover:text-zinc-400">
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {schedFor === m.id ? (
                    <div className="flex gap-1 mt-2">
                      <input value={schedTimes} onChange={(e) => setSchedTimes(e.target.value)} placeholder="08:00, 20:00"
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                      <button type="button" onClick={() => setSchedule(m.id)}
                        className="px-2.5 py-1 text-[11px] bg-amber-600 hover:bg-amber-500 text-white rounded-lg">Save</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => { setSchedFor(m.id); setSchedTimes('08:00, 20:00'); }}
                      className="mt-1.5 text-[11px] text-amber-400 hover:text-amber-300">
                      {m.hasSchedule ? 'Edit schedule' : '+ Set dose schedule'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
