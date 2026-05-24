'use client';

import { useCallback, useEffect, useState } from 'react';
import { Gauge, Plus, Trash2, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ChartKit } from '@/components/viz/ChartKit';

interface ScoreEntry {
  id: string;
  score: number;
  bureau: string;
  date: string;
  factors: {
    paymentHistoryPct: number | null;
    utilisationPct: number | null;
    creditAgeMonths: number;
    inquiries12mo: number;
    accountMix: number;
  };
}
interface ScoreReport {
  history: ScoreEntry[];
  latest: ScoreEntry | null;
  band: string;
  delta: number;
  deltaFromPrior: number;
  advice: string[];
}

const BAND_COLOR: Record<string, string> = {
  exceptional: 'text-emerald-300',
  'very good': 'text-emerald-300',
  good: 'text-cyan-300',
  fair: 'text-amber-300',
  poor: 'text-rose-300',
};

export function CreditScoreMonitor() {
  const [report, setReport] = useState<ScoreReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ score: '', bureau: 'fico', date: '', utilisationPct: '', paymentHistoryPct: '', inquiries12mo: '' });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('finance', 'credit-score-report', {});
      if (r.data?.ok) setReport(r.data.result as ScoreReport);
    } catch (e) { console.error('[CreditScore] report failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function record() {
    const score = Number(form.score);
    if (!Number.isFinite(score) || score < 300 || score > 850) return;
    setBusy(true);
    try {
      const r = await lensRun('finance', 'credit-score-record', {
        score,
        bureau: form.bureau,
        date: form.date || undefined,
        utilisationPct: form.utilisationPct ? Number(form.utilisationPct) : undefined,
        paymentHistoryPct: form.paymentHistoryPct ? Number(form.paymentHistoryPct) : undefined,
        inquiries12mo: form.inquiries12mo ? Number(form.inquiries12mo) : undefined,
      });
      if (r.data?.ok) {
        setForm({ score: '', bureau: 'fico', date: '', utilisationPct: '', paymentHistoryPct: '', inquiries12mo: '' });
        setAdding(false);
        await refresh();
      }
    } catch (e) { console.error('[CreditScore] record failed', e); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    try {
      const r = await lensRun('finance', 'credit-score-delete', { id });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[CreditScore] delete failed', e); }
  }

  const latest = report?.latest;
  const chartData = (report?.history || []).map((h) => ({ date: h.date, score: h.score }));

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Gauge className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Credit score monitor
        </span>
        <button onClick={() => setAdding((v) => !v)} className="ml-auto p-1 text-gray-400 hover:text-white" aria-label="Add reading">
          <Plus className="w-4 h-4" />
        </button>
      </header>

      <p className="px-4 py-2 text-[10px] text-gray-400 border-b border-white/5">
        Log readings from your bureau or card issuer. Scores are your real reported
        figures — nothing is pulled or invented.
      </p>

      {adding && (
        <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
          <input
            type="number"
            value={form.score}
            onChange={(e) => setForm({ ...form, score: e.target.value })}
            placeholder="Score (300-850)"
            className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <select
            value={form.bureau}
            onChange={(e) => setForm({ ...form, bureau: e.target.value })}
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          >
            {['fico', 'vantagescore', 'equifax', 'experian', 'transunion'].map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            type="number"
            value={form.utilisationPct}
            onChange={(e) => setForm({ ...form, utilisationPct: e.target.value })}
            placeholder="Utilisation %"
            className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            type="number"
            value={form.paymentHistoryPct}
            onChange={(e) => setForm({ ...form, paymentHistoryPct: e.target.value })}
            placeholder="On-time %"
            className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            type="number"
            value={form.inquiries12mo}
            onChange={(e) => setForm({ ...form, inquiries12mo: e.target.value })}
            placeholder="Inquiries / 12mo"
            className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <button
            onClick={record}
            disabled={busy}
            className="col-span-6 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Record reading'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : !latest ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">
          <Gauge className="w-6 h-6 mx-auto mb-2 opacity-30" />
          No credit-score readings logged yet. Click + to add one.
        </div>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-4">
            <div>
              <div className={cn('text-4xl font-bold tabular-nums', BAND_COLOR[report!.band] || 'text-white')}>
                {latest.score}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400">
                {report!.band} · {latest.bureau}
              </div>
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <span className={cn('inline-flex items-center gap-1', report!.delta >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                {report!.delta >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {report!.delta >= 0 ? '+' : ''}{report!.delta} all-time
              </span>
              <span className={cn('inline-flex items-center gap-1', report!.deltaFromPrior >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                {report!.deltaFromPrior >= 0 ? '+' : ''}{report!.deltaFromPrior} vs last reading
              </span>
            </div>
          </div>

          {chartData.length >= 2 && (
            <div className="px-3 py-3 border-b border-white/10">
              <ChartKit
                kind="line"
                data={chartData}
                xKey="date"
                series={[{ key: 'score', label: 'Credit score', color: '#06b6d4' }]}
                height={160}
                showLegend={false}
              />
            </div>
          )}

          {report!.advice.length > 0 && (
            <div className="px-4 py-2 border-b border-white/10 space-y-1">
              {report!.advice.map((a, i) => (
                <p key={i} className="text-[11px] text-amber-300">• {a}</p>
              ))}
            </div>
          )}

          <div className="max-h-48 overflow-y-auto">
            <ul className="divide-y divide-white/5">
              {[...report!.history].reverse().map((h) => (
                <li key={h.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3 text-xs">
                  <span className="text-[10px] text-gray-400 font-mono w-20">{h.date}</span>
                  <span className="font-mono text-sm text-white tabular-nums">{h.score}</span>
                  <span className="text-[10px] text-gray-400 uppercase">{h.bureau}</span>
                  <span className="flex-1" />
                  {h.factors.utilisationPct != null && (
                    <span className="text-[10px] text-gray-400">util {h.factors.utilisationPct}%</span>
                  )}
                  <button
                    onClick={() => remove(h.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-400"
                    aria-label="Delete reading"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export default CreditScoreMonitor;
