'use client';

import { useEffect, useState, useCallback } from 'react';
import { callBrowserAgentMacro } from '@/lib/api/browser-agent';
import { Loader2, X, BarChart3, Calendar, ListChecks } from 'lucide-react';

interface DashboardRow { id?: string; title?: string; status?: string; total_cost_cents?: number; total_steps?: number; }
interface DayRow { day: string; tasks: number; cents: number; steps: number; }
interface KindRow { kind: string; count: number; cents: number; }
interface Dashboard {
  days: number;
  totals: { cents: number; tokens: number; steps: number; tasks: number };
  byTask: DashboardRow[];
  byDay: DayRow[];
  byKind: KindRow[];
  budget: { daily_cents_cap: number; monthly_cents_cap: number; per_task_default_cents: number };
}

interface Props { open: boolean; onClose: () => void; }

export function BrowserCostDashboard({ open, onClose }: Props) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await callBrowserAgentMacro<Dashboard>('cost_dashboard', { days });
      if (r.ok) setData(r);
    } finally { setBusy(false); }
  }, [days]);

  useEffect(() => { if (open) load(); }, [open, load]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-lg w-full max-w-3xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-cyan-400" /> Cost dashboard
          </h3>
          <div className="flex items-center gap-2">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="px-2 py-1 text-xs bg-white/5 border border-white/10 rounded text-white">
              <option value={7} className="bg-black">7 days</option>
              <option value={30} className="bg-black">30 days</option>
              <option value={90} className="bg-black">90 days</option>
            </select>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {busy && (
            <div className="flex items-center justify-center py-12 text-white/40"><Loader2 className="w-6 h-6 animate-spin" /></div>
          )}
          {!busy && data && (
            <>
              <div className="grid grid-cols-4 gap-2">
                <Stat label="Spent" value={`$${(data.totals.cents / 100).toFixed(2)}`} />
                <Stat label="Tasks" value={String(data.totals.tasks)} />
                <Stat label="Steps" value={String(data.totals.steps)} />
                <Stat label="Tokens" value={String(data.totals.tokens || 0)} />
              </div>

              <section>
                <h4 className="text-xs uppercase tracking-wide text-white/40 mb-2 flex items-center gap-1"><Calendar className="w-3 h-3" /> By day</h4>
                <div className="space-y-1">
                  {data.byDay.slice(0, 14).map((d) => {
                    const pct = data.totals.cents > 0 ? (d.cents / data.totals.cents) * 100 : 0;
                    return (
                      <div key={d.day} className="flex items-center gap-2 text-xs">
                        <span className="text-white/60 w-20 font-mono">{d.day}</span>
                        <div className="flex-1 h-3 bg-white/5 rounded relative overflow-hidden">
                          <div className="absolute inset-y-0 left-0 bg-cyan-400/60" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                        <span className="text-white/70 w-16 text-right font-mono">${(d.cents / 100).toFixed(2)}</span>
                        <span className="text-white/40 w-12 text-right">{d.tasks}t</span>
                      </div>
                    );
                  })}
                  {data.byDay.length === 0 && <div className="text-xs text-white/30">No spend yet.</div>}
                </div>
              </section>

              <section>
                <h4 className="text-xs uppercase tracking-wide text-white/40 mb-2 flex items-center gap-1"><ListChecks className="w-3 h-3" /> By action kind</h4>
                <div className="grid grid-cols-2 gap-2">
                  {data.byKind.slice(0, 10).map((k) => (
                    <div key={k.kind} className="flex items-center justify-between bg-white/5 rounded px-2 py-1 text-xs">
                      <span className="text-white/80 uppercase">{k.kind}</span>
                      <span className="text-white/60">{k.count}× · {k.cents}¢</span>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h4 className="text-xs uppercase tracking-wide text-white/40 mb-2">Top tasks by cost</h4>
                <div className="space-y-1">
                  {data.byTask.slice(0, 10).map((t) => (
                    <div key={t.id} className="flex items-center gap-2 text-xs bg-white/5 rounded px-2 py-1">
                      <span className="text-white/90 flex-1 truncate">{t.title}</span>
                      <span className="text-white/40 uppercase text-[10px]">{t.status}</span>
                      <span className="text-white/70 font-mono w-16 text-right">{(t.total_cost_cents || 0)}¢</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/10 rounded p-2 text-center">
      <div className="text-xs text-white/40">{label}</div>
      <div className="text-lg text-white font-semibold">{value}</div>
    </div>
  );
}
