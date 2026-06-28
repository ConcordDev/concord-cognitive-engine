'use client';

/**
 * RevenueRetentionPanel — bespoke revenue + retention dashboard
 * for the services lens. Wires services.revenueByProvider +
 * services.clientRetentionReport against editable appointment +
 * client tables.
 *
 *   • Revenue: editable appointment rows (provider/date/price/status)
 *     + period window → revenue per provider sorted desc + total
 *   • Retention: editable client rows (name/visits/lifetime value/
 *     last visit) → repeat rate, avg LTV, churn-risk segments
 *   • Save-as-DTU captures inputs + both reports
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Briefcase, Loader2, Plus, Trash2, DollarSign, Users } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Appt { provider: string; date: string; price: string; status: 'completed' | 'paid' | 'scheduled' | 'cancelled' }
interface Client { name: string; visits: string; totalRevenue: string; lastVisit: string }
interface RevenueResult { period?: number; summary?: Array<{ provider: string; appointments: number; revenue: number }>; totalRevenue?: number }
interface RetentionResult { totalClients?: number; repeatRate?: number; averageLifetimeValue?: number; totalRevenue?: number; atRiskCount?: number; atRiskClients?: Array<{ name: string; daysSinceVisit: number; churnRisk: string; lifetimeValue: number }> }

async function callSvc<T>(action: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('services', action, { input });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const result = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (result && typeof result === 'object' && 'ok' in result && 'result' in result) {
      return (result as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

const today = new Date();
const dayOffset = (n: number) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);

export function RevenueRetentionPanel() {
  const [appts, setAppts] = useState<Appt[]>([{ provider: '', date: dayOffset(0), price: '', status: 'completed' }]);
  const [clients, setClients] = useState<Client[]>([{ name: '', visits: '0', totalRevenue: '0', lastVisit: dayOffset(0) }]);
  const [period, setPeriod] = useState(30);
  const [revenue, setRevenue] = useState<RevenueResult | null>(null);
  const [retention, setRetention] = useState<RetentionResult | null>(null);

  const analyze = useMutation({
    mutationFn: async () => {
      const apptList = appts.filter((a) => a.provider.trim()).map((a) => ({ provider: a.provider, date: a.date, price: parseFloat(a.price) || 0, status: a.status }));
      const clientList = clients.filter((c) => c.name.trim()).map((c) => ({ name: c.name, visits: parseInt(c.visits) || 0, totalRevenue: parseFloat(c.totalRevenue) || 0, lastVisit: c.lastVisit }));
      const [r, t] = await Promise.all([
        // NOTE: `period` lives INSIDE artifact.data so the body stays a sole-key
        // `{ artifact: { data: {...} } }` shape the dispatch peel unwraps to
        // `{ appointments, period }` — feeding BOTH the handler's
        // `artifact.data.appointments` read AND its `params.period` read. A 2-key
        // `{ artifact:{data}, period }` body is deliberately NOT peeled, which
        // would strand `appointments` inside the un-unwrapped wrapper (dead).
        callSvc<RevenueResult>('revenueByProvider', { artifact: { data: { appointments: apptList, period } } }),
        callSvc<RetentionResult>('clientRetentionReport', { artifact: { data: { clients: clientList } } }),
      ]);
      setRevenue(r);
      setRetention(t);
      // callSvc swallows transport errors to null. If we asked the backend to
      // compute (non-empty input) but BOTH calculators came back null, surface
      // an honest failure instead of silently dropping back to the pre-analyze
      // placeholder (the swallowed-fetch → silent-empty trap).
      if ((apptList.length > 0 || clientList.length > 0) && r === null && t === null) {
        throw new Error('Analysis failed — the services backend did not respond.');
      }
      return { r, t };
    },
  });

  const addAppt = () => setAppts((as) => [...as, { provider: '', date: dayOffset(0), price: '', status: 'completed' }]);
  const updateAppt = <K extends keyof Appt>(i: number, key: K, value: Appt[K]) =>
    setAppts((as) => as.map((a, idx) => (idx === i ? { ...a, [key]: value } : a)));
  const removeAppt = (i: number) => setAppts((as) => as.filter((_, idx) => idx !== i));

  const addClient = () => setClients((cs) => [...cs, { name: '', visits: '0', totalRevenue: '0', lastVisit: dayOffset(0) }]);
  const updateClient = <K extends keyof Client>(i: number, key: K, value: Client[K]) =>
    setClients((cs) => cs.map((c, idx) => (idx === i ? { ...c, [key]: value } : c)));
  const removeClient = (i: number) => setClients((cs) => cs.filter((_, idx) => idx !== i));

  const churnBadge = (risk: string) => {
    if (risk === 'high') return 'bg-rose-500/20 text-rose-200';
    if (risk === 'medium') return 'bg-amber-500/20 text-amber-200';
    return 'bg-zinc-700 text-zinc-300';
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-violet-400" />
          <h2 className="text-sm font-semibold text-white">Revenue + retention</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">services.revenueByProvider + clientRetentionReport</span>
        </div>
        {(revenue || retention) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-services-revenue-retention"
            title={`Services — $${revenue?.totalRevenue ?? 0} · ${retention?.repeatRate ?? 0}% repeat`}
            content={`Period: ${period}d\nTotal revenue: $${revenue?.totalRevenue ?? 0}\nBy provider:\n${(revenue?.summary || []).map((s) => `  ${s.provider}: $${s.revenue} (${s.appointments} appts)`).join('\n')}\n\nRetention:\n  Clients: ${retention?.totalClients} | Repeat: ${retention?.repeatRate}% | Avg LTV: $${retention?.averageLifetimeValue}\n  At-risk: ${retention?.atRiskCount}\n${(retention?.atRiskClients || []).map((c) => `    ${c.name} — ${c.daysSinceVisit}d ago (${c.churnRisk}, $${c.lifetimeValue} LTV)`).join('\n')}`}
            extraTags={['services', 'revenue', 'retention']}
            rawData={{ appts, clients, period, revenue, retention }}
          />
        )}
      </header>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Appointments</div>
          <label className="text-[10px] text-zinc-400">Period (days)
            <input type="number" min={1} max={365} value={period} onChange={(e) => setPeriod(Math.max(1, Math.min(365, Number(e.target.value) || 30)))} className="ml-2 w-16 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-xs text-white font-mono" />
          </label>
        </div>
        <div className="grid grid-cols-[1fr_130px_80px_110px_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-400">
          <span>Provider</span><span>Date</span><span>Price</span><span>Status</span><span></span>
        </div>
        {appts.map((a, i) => (
          <div key={i} className="grid grid-cols-[1fr_130px_80px_110px_30px] gap-1.5">
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Provider" value={a.provider} onChange={(e) => updateAppt(i, 'provider', e.target.value)} />
            <input type="date" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={a.date} onChange={(e) => updateAppt(i, 'date', e.target.value)} />
            <input type="number" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={a.price} onChange={(e) => updateAppt(i, 'price', e.target.value)} />
            <select className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" value={a.status} onChange={(e) => updateAppt(i, 'status', e.target.value as Appt['status'])}>
              <option value="completed">completed</option>
              <option value="paid">paid</option>
              <option value="scheduled">scheduled</option>
              <option value="cancelled">cancelled</option>
            </select>
            <button type="button" onClick={() => removeAppt(i)} className="rounded border border-zinc-800 text-xs text-zinc-400 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <button type="button" onClick={addAppt} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-violet-500/40 hover:text-violet-200"><Plus className="h-3 w-3" />Add appointment</button>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400">Clients</div>
        <div className="grid grid-cols-[1fr_70px_100px_130px_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-400">
          <span>Name</span><span>Visits</span><span>Lifetime $</span><span>Last visit</span><span></span>
        </div>
        {clients.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_100px_130px_30px] gap-1.5">
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Client name" value={c.name} onChange={(e) => updateClient(i, 'name', e.target.value)} />
            <input type="number" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={c.visits} onChange={(e) => updateClient(i, 'visits', e.target.value)} />
            <input type="number" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={c.totalRevenue} onChange={(e) => updateClient(i, 'totalRevenue', e.target.value)} />
            <input type="date" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={c.lastVisit} onChange={(e) => updateClient(i, 'lastVisit', e.target.value)} />
            <button type="button" onClick={() => removeClient(i)} className="rounded border border-zinc-800 text-xs text-zinc-400 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <button type="button" onClick={addClient} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-violet-500/40 hover:text-violet-200"><Plus className="h-3 w-3" />Add client</button>
      </div>

      <button type="button" onClick={() => analyze.mutate()} disabled={analyze.isPending} className="inline-flex items-center gap-1 rounded border border-violet-500/40 bg-violet-500/15 px-3 py-1.5 text-xs font-mono text-violet-200 hover:bg-violet-500/25 disabled:opacity-50">
        {analyze.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Briefcase className="h-3.5 w-3.5" />}
        Analyze
      </button>

      {analyze.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Analysis failed.</div>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><DollarSign className="h-3 w-3" />Revenue by provider</div>
          {!revenue && <div className="text-[11px] text-zinc-400">Analyze to compute.</div>}
          {revenue?.summary && (
            <div className="space-y-1.5 text-[11px]">
              <div className="rounded border border-violet-500/20 bg-zinc-950/40 px-2 py-1">
                <div className="text-[9px] text-zinc-400">Total ({revenue.period}d)</div>
                <div className="font-mono text-xl text-violet-200">${revenue.totalRevenue?.toLocaleString()}</div>
              </div>
              {revenue.summary.map((s, i) => {
                const pct = revenue.totalRevenue ? (s.revenue / revenue.totalRevenue) * 100 : 0;
                return (
                  <div key={i} className="rounded border border-violet-500/15 bg-zinc-950/40 px-2 py-1">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-100">{s.provider}</span>
                      <span className="font-mono text-violet-200">${s.revenue.toLocaleString()}</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full bg-violet-500/60" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-0.5 text-[9px] text-zinc-400">{s.appointments} appts</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Users className="h-3 w-3" />Retention</div>
          {!retention && <div className="text-[11px] text-zinc-400">Analyze to compute.</div>}
          {retention && (
            <div className="space-y-2 text-[11px]">
              <div className="grid grid-cols-2 gap-1.5">
                <div className="rounded border border-sky-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Repeat rate</div><div className="font-mono text-xl text-sky-200">{retention.repeatRate}%</div></div>
                <div className="rounded border border-sky-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Avg LTV</div><div className="font-mono text-xl text-sky-200">${retention.averageLifetimeValue}</div></div>
              </div>
              <div className="text-[10px] text-zinc-400">{retention.totalClients} clients · <span className="text-rose-300">{retention.atRiskCount} at risk</span></div>
              {retention.atRiskClients && retention.atRiskClients.length > 0 && (
                <div className="space-y-0.5">
                  <div className="text-[9px] uppercase text-zinc-400">At-risk clients</div>
                  {retention.atRiskClients.map((c, i) => (
                    <div key={i} className="flex items-center justify-between rounded border border-rose-500/20 bg-zinc-950/40 px-2 py-1">
                      <div>
                        <div className="text-zinc-100">{c.name}</div>
                        <div className="text-[9px] text-zinc-400">{c.daysSinceVisit}d ago · ${c.lifetimeValue} LTV</div>
                      </div>
                      <span className={`rounded px-1.5 py-0.5 text-[9px] ${churnBadge(c.churnRisk)}`}>{c.churnRisk}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
