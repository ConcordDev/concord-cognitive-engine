'use client';

/**
 * EnergyActionStack — Sense / PG&E / Tesla-shape action surface for
 * the energy lens. Pulls live EIA electricity rates for a state, then
 * exposes 5 real-backend actions on top of the rate snapshot.
 *
 *   1. Mint usage snapshot  → dtu.create with rate + bill estimate
 *                             (private; tags=[energy,bill,state:XX])
 *   2. DM household member  → /api/social/dm with this month's
 *                             estimated bill + YoY change
 *   3. Publish efficiency tips → dtu.create public + cite + flag
 *                             published (federation pickup)
 *   4. Agent — optimize     → chat_agent.do "given my appliances:
 *                             {list}, what schedule cuts the bill?"
 *   5. Copy CSV             → clipboard write of monthlySeries rows
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Zap, Send, Globe, Wand2, FileDown, Sparkles,
  Loader2, Check, AlertTriangle, TrendingUp, TrendingDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface RateResult {
  state: string; sector: string;
  latest: { period: string; priceCentsPerKwh: number } | null;
  yearOverYearChangePct: number | null;
  monthlySeries: Array<{ period: string; priceCentsPerKwh: number }>;
}
interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('energy', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const STATES = ['CA', 'NY', 'TX', 'FL', 'WA', 'MA', 'IL', 'CO', 'OR', 'GA'];

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'mint' | 'dm' | 'publish' | 'agent' | 'csv';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

export function EnergyActionStack() {
  const [state, setState] = useState('CA');
  const [sector, setSector] = useState<'RES' | 'COM' | 'IND'>('RES');
  const [monthlyKwh, setMonthlyKwh] = useState('800');
  const [rate, setRate] = useState<RateResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [snapshotDtuId, setSnapshotDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [dmRecipient, setDmRecipient] = useState('');
  const [appliances, setAppliances] = useState('');
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: async () => callMacro<RateResult>('eia-electricity-rates', { state, sector }),
    onSuccess: (env) => {
      if (env.ok && env.result) {
        setRate(env.result); setLoadError(null);
        setSnapshotDtuId(null); setPublishedDtuId(null); setAgentReply(null);
      } else { setRate(null); setLoadError(env.error || 'no rate data'); }
    },
    onError: (e) => { setRate(null); setLoadError(pickMessage(e)); },
  });

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  const kwh = parseFloat(monthlyKwh) || 0;
  const billUsd = rate?.latest ? (rate.latest.priceCentsPerKwh / 100) * kwh : 0;
  const billText = billUsd > 0 ? `$${billUsd.toFixed(2)}` : '—';
  const yoy = rate?.yearOverYearChangePct;
  const yoyText = yoy != null ? `${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%` : '—';

  async function actMint() {
    if (!rate?.latest) { err('Load a rate first.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: {
          title: `Energy snapshot — ${state} ${sector} — ${rate.latest.period}`,
          tags: ['energy', 'eia', 'bill', `state:${state}`, `sector:${sector}`],
          source: 'energy:bill:snapshot',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            energy: {
              state, sector,
              period: rate.latest.period,
              priceCentsPerKwh: rate.latest.priceCentsPerKwh,
              monthlyKwh: kwh,
              estimatedBillUsd: Math.round(billUsd * 100) / 100,
              yearOverYearChangePct: yoy,
              monthlySeries: rate.monthlySeries,
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setSnapshotDtuId(id); ok(`Snapshot saved as DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!rate?.latest) { err('Load a rate first.'); return; }
    if (!dmRecipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const trend = yoy == null ? '' : yoy >= 5 ? ` (rates are up ${yoyText} YoY — worth optimizing)` : yoy <= -3 ? ` (rates dropped ${yoyText} YoY)` : '';
    const body = `⚡ ${state} ${sector === 'RES' ? 'residential' : sector === 'COM' ? 'commercial' : 'industrial'} energy snapshot\n\nLatest EIA rate: ${rate.latest.priceCentsPerKwh.toFixed(2)} ¢/kWh (${rate.latest.period})\nAt ${kwh} kWh/month → est. bill ${billText}${trend}`;
    try {
      const r = await api.post('/api/social/dm', { toUserId: dmRecipient.trim(), content: body });
      if (r.data?.ok !== false) { ok(`Snapshot DMed to ${dmRecipient.trim()}.`); setDmRecipient(''); }
      else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    if (!rate?.latest) { err('Load a rate first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: {
          title: `${state} efficiency tips — ${new Date().toISOString().slice(0, 10)}`,
          tags: ['energy', 'eia', 'efficiency-tips', 'public', `state:${state}`],
          source: 'energy:tips:public',
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            energy: {
              state, sector,
              priceCentsPerKwh: rate.latest.priceCentsPerKwh,
              period: rate.latest.period,
              yearOverYearChangePct: yoy,
            },
            tipsStructure: ['HVAC schedule', 'water heater', 'lighting', 'standby loads', 'peak shifting'],
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Tips published ${id.slice(0, 8)}…`); }
      else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    if (!rate?.latest) { err('Load a rate first.'); return; }
    if (!appliances.trim()) { err('List your major appliances.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `${state} ${sector} electricity rate is ${rate.latest.priceCentsPerKwh.toFixed(2)} ¢/kWh (${rate.latest.period}).`,
        yoy != null ? `Year-over-year change: ${yoyText}.` : '',
        `My monthly usage: ~${kwh} kWh.`,
        `Major appliances: ${appliances.trim()}.`,
        ``,
        'Return a short plaintext schedule + the 3 biggest wins (peak/off-peak shifts,',
        'standby load kills, swap candidates). Concrete and actionable.',
      ].filter(Boolean).join(' ');
      const r = await lensRun({
        domain: 'chat_agent', name: 'do',
        input: { task, maxTurns: 4 },
      });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) {
        setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Optimization brief ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actCsv() {
    if (!rate?.monthlySeries?.length) { err('Load a rate first.'); return; }
    setBusy('csv'); setFeedback(null);
    try {
      const header = 'period,priceCentsPerKwh';
      const rows = rate.monthlySeries.map(m => `${m.period},${m.priceCentsPerKwh}`);
      await navigator.clipboard.writeText([header, ...rows].join('\n'));
      ok(`${rate.monthlySeries.length} months copied as CSV.`);
    } catch { err('Clipboard write blocked.'); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'mint',    label: snapshotDtuId  ? 'Snapshot saved' : 'Mint snapshot',    desc: snapshotDtuId  ? `DTU ${snapshotDtuId.slice(0, 8)}…`  : 'Private DTU with rate + bill estimate',           icon: Sparkles, accent: '#06b6d4', handler: actMint,    disabled: !rate?.latest || !!snapshotDtuId },
    { id: 'dm',      label: 'DM household',                                          desc: rate?.latest ? `${billText} bill + YoY trend`     : 'Load rate first',                                  icon: Send,     accent: '#ec4899', handler: actDm,      disabled: !rate?.latest },
    { id: 'publish', label: publishedDtuId ? 'Tips published' : 'Publish tips',     desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public efficiency tips DTU + federation',         icon: Globe,    accent: '#22c55e', handler: actPublish, disabled: !rate?.latest || !!publishedDtuId },
    { id: 'agent',   label: 'Optimize (agent)',                                      desc: 'Agent schedules appliances against the rate',                                                          icon: Wand2,    accent: '#eab308', handler: actAgent,   disabled: !rate?.latest },
    { id: 'csv',     label: 'Copy CSV',                                              desc: rate?.monthlySeries.length ? `${rate.monthlySeries.length} months → clipboard` : '—',                  icon: FileDown, accent: '#3b82f6', handler: actCsv,     disabled: !rate?.monthlySeries.length },
  ];

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 pb-2">
        <Zap className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Energy actions</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          eia · live
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">State</label>
        <select value={state} onChange={(e) => setState(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono uppercase">
          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Sector</label>
        <select value={sector} onChange={(e) => setSector(e.target.value as typeof sector)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
          <option value="RES">Residential</option>
          <option value="COM">Commercial</option>
          <option value="IND">Industrial</option>
        </select>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">kWh/mo</label>
        <input type="text" value={monthlyKwh} onChange={(e) => setMonthlyKwh(e.target.value.replace(/\D/g, ''))} className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-400/40" />
        <button type="button" onClick={() => load.mutate()} disabled={load.isPending} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-200 hover:bg-amber-500/20 disabled:opacity-50">
          {load.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Load rate'}
        </button>
      </div>

      {loadError && (
        <div className="px-2 py-1.5 rounded bg-red-500/10 border border-red-500/30 text-[11px] text-red-300">{loadError}</div>
      )}

      {rate?.latest && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border-2 border-amber-500/40 bg-zinc-900/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Rate</div>
            <div className="text-2xl font-bold text-amber-300">{rate.latest.priceCentsPerKwh.toFixed(2)}<span className="text-sm ml-1">¢/kWh</span></div>
            <div className="text-[11px] text-zinc-500 font-mono">{rate.latest.period}</div>
          </div>
          <div className="rounded-lg border border-emerald-500/30 bg-zinc-900/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Est. monthly bill</div>
            <div className="text-2xl font-bold text-emerald-300">{billText}</div>
            <div className="text-[11px] text-zinc-500">at {kwh} kWh</div>
          </div>
          <div className={cn('rounded-lg border bg-zinc-900/60 p-3', yoy == null ? 'border-zinc-700' : yoy >= 0 ? 'border-rose-500/30' : 'border-emerald-500/30')}>
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">YoY change</div>
            <div className={cn('text-2xl font-bold flex items-center gap-1', yoy == null ? 'text-zinc-300' : yoy >= 0 ? 'text-rose-300' : 'text-emerald-300')}>
              {yoy == null ? '—' : (yoy >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />)}
              {yoyText}
            </div>
            <div className="text-[11px] text-zinc-500 font-mono">vs. last year</div>
          </div>
        </div>
      )}

      {rate?.latest && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">DM recipient (for snapshot)</label>
            <input type="text" value={dmRecipient} onChange={(e) => setDmRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40" placeholder="household member user id" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Appliances (for agent)</label>
            <input type="text" value={appliances} onChange={(e) => setAppliances(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-yellow-400/40" placeholder="HVAC, dryer, EV, water heater, dishwasher…" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button
              key={a.id} type="button"
              disabled={a.disabled || !!busy}
              onClick={a.handler}
              className={cn(
                'group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all',
                'bg-zinc-900/40 border-zinc-800',
                'hover:bg-zinc-800/60 hover:border-zinc-700',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/40 disabled:hover:border-zinc-800',
                'focus:outline-none focus:ring-2 focus:ring-amber-400/40',
              )}
            >
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[12px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      {agentReply && (
        <div className="px-3 py-2 rounded-lg bg-yellow-500/5 border border-yellow-500/30 text-[11px] text-zinc-200 max-h-56 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
            <Wand2 className="h-3 w-3" />
            Optimization brief
          </div>
          <pre className="whitespace-pre-wrap font-sans leading-relaxed">{agentReply}</pre>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div
            key={feedback.text}
            initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn(
              'px-3 py-2 rounded text-[11px] flex items-start gap-2 border',
              feedback.kind === 'ok'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-red-500/10 text-red-300 border-red-500/30',
            )}
          >
            {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
