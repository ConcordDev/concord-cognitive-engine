'use client';

/**
 * PestPanel — pest / disease tracking with treatment scheduling.
 * Wires forestry.pest-report / pest-list / pest-schedule-treatment /
 * pest-complete-treatment.
 */

import { useCallback, useEffect, useState } from 'react';
import { Bug, Loader2, Plus, CheckCircle2, CalendarClock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Treatment {
  id: string;
  method: string;
  scheduledDate: string;
  cost: number;
  completed: boolean;
  completedDate: string | null;
}
interface PestReport {
  id: string;
  agent: string;
  kind: 'pest' | 'disease';
  standId: string | null;
  severity: string;
  affectedAcres: number;
  detectedDate: string;
  status: 'open' | 'resolved';
  treatments: Treatment[];
}
interface UpcomingTreatment extends Treatment { pestId: string; agent: string }
interface PestList { reports: PestReport[]; count: number; openCount: number; upcomingTreatments: UpcomingTreatment[] }

const SEVERITY: { v: string; c: string }[] = [
  { v: 'low', c: 'text-emerald-400' },
  { v: 'moderate', c: 'text-yellow-400' },
  { v: 'high', c: 'text-orange-400' },
  { v: 'severe', c: 'text-rose-400' },
];

export function PestPanel() {
  const [reports, setReports] = useState<PestReport[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingTreatment[]>([]);
  const [agent, setAgent] = useState('');
  const [kind, setKind] = useState<'pest' | 'disease'>('pest');
  const [severity, setSeverity] = useState('low');
  const [affectedAcres, setAffectedAcres] = useState('');
  const [standId, setStandId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [trtMethod, setTrtMethod] = useState<Record<string, string>>({});
  const [trtDate, setTrtDate] = useState<Record<string, string>>({});
  const [trtCost, setTrtCost] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await lensRun<PestList>('forestry', 'pest-list', {});
    if (r.data?.ok && r.data.result) {
      setReports(r.data.result.reports);
      setUpcoming(r.data.result.upcomingTreatments);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const report = useCallback(async () => {
    if (!agent.trim()) { setErr('Pest / disease name required.'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun('forestry', 'pest-report', {
      agent: agent.trim(), kind, severity,
      affectedAcres: Number(affectedAcres) || 0,
      standId: standId.trim() || undefined,
    });
    if (r.data?.ok) { setAgent(''); setAffectedAcres(''); setStandId(''); await load(); }
    else setErr(r.data?.error || 'Report failed.');
    setBusy(false);
  }, [agent, kind, severity, affectedAcres, standId, load]);

  const schedule = useCallback(async (pestId: string) => {
    const method = (trtMethod[pestId] || '').trim();
    if (!method) { setErr('Treatment method required.'); return; }
    setErr(null);
    const r = await lensRun('forestry', 'pest-schedule-treatment', {
      pestId, method,
      scheduledDate: trtDate[pestId] || undefined,
      cost: Number(trtCost[pestId]) || 0,
    });
    if (r.data?.ok) {
      setTrtMethod((m) => ({ ...m, [pestId]: '' }));
      setTrtCost((m) => ({ ...m, [pestId]: '' }));
      await load();
    } else setErr(r.data?.error || 'Schedule failed.');
  }, [trtMethod, trtDate, trtCost, load]);

  const complete = useCallback(async (pestId: string, treatmentId: string, resolveReport: boolean) => {
    const r = await lensRun('forestry', 'pest-complete-treatment', { pestId, treatmentId, resolveReport });
    if (r.data?.ok) await load();
  }, [load]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Bug className="w-4 h-4 text-orange-400" />
        <h3 className="text-sm font-bold text-zinc-100">Pest &amp; Disease Tracking</h3>
        <span className="ml-auto text-[10px] text-zinc-500">
          {reports.filter((r) => r.status === 'open').length} open
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-1.5 mb-2">
        <input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="Pest / disease (e.g. Mountain pine beetle)"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        <div className="flex gap-1.5">
          <select value={kind} onChange={(e) => setKind(e.target.value as 'pest' | 'disease')}
            className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1.5 text-xs text-zinc-200">
            <option value="pest">Pest</option>
            <option value="disease">Disease</option>
          </select>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1.5 text-xs text-zinc-200">
            {SEVERITY.map((s) => <option key={s.v} value={s.v}>{s.v}</option>)}
          </select>
          <input value={affectedAcres} onChange={(e) => setAffectedAcres(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder="acres" className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <input value={standId} onChange={(e) => setStandId(e.target.value)} placeholder="stand id"
            className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        </div>
      </div>
      <button onClick={report} disabled={busy}
        className="px-3 py-1.5 text-xs rounded bg-orange-600 hover:bg-orange-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Report
      </button>
      {err && <p className="text-xs text-rose-400 mt-2">{err}</p>}

      {upcoming.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
          <p className="text-[10px] uppercase tracking-wide text-amber-400 font-semibold mb-1 flex items-center gap-1">
            <CalendarClock className="w-3 h-3" /> Upcoming treatments
          </p>
          {upcoming.map((t) => (
            <p key={t.id} className="text-[11px] text-zinc-300">
              {t.scheduledDate} — {t.method} <span className="text-zinc-500">({t.agent})</span>
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {reports.map((rp) => {
          const sevColor = SEVERITY.find((s) => s.v === rp.severity)?.c || 'text-zinc-400';
          return (
            <div key={rp.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-100">{rp.agent}</span>
                <span className={`text-[10px] font-bold uppercase ${sevColor}`}>{rp.severity}</span>
                <span className="text-[10px] text-zinc-500">{rp.kind}</span>
                {rp.affectedAcres > 0 && <span className="text-[10px] text-zinc-500">{rp.affectedAcres} ac</span>}
                <span className={`ml-auto text-[10px] font-semibold ${rp.status === 'open' ? 'text-orange-400' : 'text-emerald-400'}`}>
                  {rp.status}
                </span>
              </div>
              {rp.treatments.map((t) => (
                <div key={t.id} className="flex items-center gap-2 mt-1 pl-2 border-l border-zinc-800">
                  <span className="text-[11px] text-zinc-300 flex-1">
                    {t.method} · {t.scheduledDate} {t.cost > 0 ? `· $${t.cost.toLocaleString()}` : ''}
                  </span>
                  {t.completed ? (
                    <span className="text-[10px] text-emerald-400 inline-flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> {t.completedDate}
                    </span>
                  ) : (
                    <>
                      <button onClick={() => complete(rp.id, t.id, false)}
                        className="text-[10px] text-zinc-400 hover:text-emerald-400">Done</button>
                      <button onClick={() => complete(rp.id, t.id, true)}
                        className="text-[10px] text-zinc-400 hover:text-emerald-400">Done + resolve</button>
                    </>
                  )}
                </div>
              ))}
              {rp.status === 'open' && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  <input value={trtMethod[rp.id] || ''} onChange={(e) => setTrtMethod((m) => ({ ...m, [rp.id]: e.target.value }))}
                    placeholder="treatment method"
                    className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                  <input type="date" value={trtDate[rp.id] || ''} onChange={(e) => setTrtDate((m) => ({ ...m, [rp.id]: e.target.value }))}
                    className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                  <input value={trtCost[rp.id] || ''} onChange={(e) => setTrtCost((m) => ({ ...m, [rp.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                    placeholder="$ cost" className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                  <button onClick={() => schedule(rp.id)}
                    className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200">Schedule</button>
                </div>
              )}
            </div>
          );
        })}
        {reports.length === 0 && <p className="text-xs text-zinc-500 italic">No pest or disease reports yet.</p>}
      </div>
    </div>
  );
}
