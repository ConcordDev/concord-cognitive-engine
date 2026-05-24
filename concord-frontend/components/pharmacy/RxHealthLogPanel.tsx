'use client';

/**
 * RxHealthLogPanel — health measurements (BP, weight, glucose, …)
 * with a trend chart, plus a symptom / health journal.
 */

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Loader2, Plus, HeartPulse, NotebookPen } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Measurement { id: string; kind: string; value: number; value2: number | null; date: string; note: string | null }
interface JournalEntry { id: string; note: string; mood: string | null; symptoms: string[]; date: string }

const KINDS = ['blood_pressure', 'weight', 'glucose', 'heart_rate', 'temperature', 'oxygen'];

export function RxHealthLogPanel() {
  const [kind, setKind] = useState('weight');
  const [series, setSeries] = useState<Measurement[]>([]);
  const [trend, setTrend] = useState('no_data');
  const [loggedKinds, setLoggedKinds] = useState<string[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mForm, setMForm] = useState({ value: '', value2: '', note: '' });
  const [jForm, setJForm] = useState({ note: '', mood: '', symptoms: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [m, j] = await Promise.all([
      lensRun('pharmacy', 'measurement-history', { kind }),
      lensRun('pharmacy', 'journal-list', {}),
    ]);
    setSeries(m.data?.result?.series || []);
    setTrend(m.data?.result?.trend || 'no_data');
    setLoggedKinds(m.data?.result?.kinds || []);
    setJournal(j.data?.result?.entries || []);
    setLoading(false);
  }, [kind]);

  useEffect(() => { void refresh(); }, [refresh]);

  const logMeasurement = async () => {
    if (!(Number(mForm.value) > 0)) { setError('Enter a value greater than zero.'); return; }
    const r = await lensRun('pharmacy', 'measurement-log', {
      kind, value: Number(mForm.value),
      value2: mForm.value2 ? Number(mForm.value2) : undefined,
      note: mForm.note.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setMForm({ value: '', value2: '', note: '' });
    setError(null);
    await refresh();
  };

  const addJournal = async () => {
    if (!jForm.note.trim()) { setError('Journal note is required.'); return; }
    const r = await lensRun('pharmacy', 'journal-add', {
      note: jForm.note.trim(), mood: jForm.mood.trim(),
      symptoms: jForm.symptoms.split(',').map((x) => x.trim()).filter(Boolean),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setJForm({ note: '', mood: '', symptoms: '' });
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const isBP = kind === 'blood_pressure';
  const chartData = series.map((m) => ({ date: m.date.slice(5), value: m.value, value2: m.value2 ?? undefined }));

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Measurements */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <HeartPulse className="w-3.5 h-3.5 text-amber-400" /> Health measurements
        </h3>
        <div className="flex flex-wrap gap-1 mb-2">
          {KINDS.map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={cn('text-[11px] px-2 py-0.5 rounded-full border capitalize',
                kind === k ? 'border-amber-700/50 bg-amber-950/40 text-amber-300' : 'border-zinc-700 text-zinc-400',
                loggedKinds.includes(k) && kind !== k && 'text-zinc-200')}>
              {k.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} />
                <YAxis tick={{ fontSize: 9, fill: '#71717a' }} width={30} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="value" stroke="#fbbf24" strokeWidth={2} dot={{ r: 2 }} name={isBP ? 'Systolic' : kind} />
                {isBP && <Line type="monotone" dataKey="value2" stroke="#60a5fa" strokeWidth={2} dot={{ r: 2 }} name="Diastolic" />}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-[11px] text-zinc-400 italic py-6 text-center">
              Log at least two {kind.replace(/_/g, ' ')} readings to see a trend.
            </p>
          )}
          {trend !== 'no_data' && (
            <p className="text-[10px] text-zinc-400 mt-1">Recent trend: <span className="text-zinc-300 capitalize">{trend}</span></p>
          )}
          <div className="grid grid-cols-3 gap-2 mt-2">
            <input placeholder={isBP ? 'Systolic' : 'Value'} inputMode="decimal" value={mForm.value}
              onChange={(e) => setMForm({ ...mForm, value: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            {isBP ? (
              <input placeholder="Diastolic" inputMode="decimal" value={mForm.value2}
                onChange={(e) => setMForm({ ...mForm, value2: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            ) : (
              <input placeholder="Note" value={mForm.note} onChange={(e) => setMForm({ ...mForm, note: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            )}
            <button type="button" onClick={logMeasurement}
              className="flex items-center justify-center gap-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg">
              <Plus className="w-3.5 h-3.5" /> Log
            </button>
          </div>
        </div>
      </section>

      {/* Journal */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <NotebookPen className="w-3.5 h-3.5 text-amber-400" /> Health journal
        </h3>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <input placeholder="How are you feeling?" value={jForm.note} onChange={(e) => setJForm({ ...jForm, note: e.target.value })}
            className="col-span-3 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Mood" value={jForm.mood} onChange={(e) => setJForm({ ...jForm, mood: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Symptoms (comma-separated)" value={jForm.symptoms} onChange={(e) => setJForm({ ...jForm, symptoms: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addJournal}
            className="flex items-center justify-center gap-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {journal.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No journal entries.</p>
        ) : (
          <ul className="space-y-1">
            {journal.slice(0, 8).map((j) => (
              <li key={j.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-200">{j.note}</span>
                  <span className="text-[10px] text-zinc-400">{j.date}</span>
                </div>
                {(j.mood || j.symptoms.length > 0) && (
                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    {j.mood ? `Mood: ${j.mood}` : ''}
                    {j.symptoms.length > 0 ? `${j.mood ? ' · ' : ''}${j.symptoms.join(', ')}` : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
