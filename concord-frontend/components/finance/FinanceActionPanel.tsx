'use client';

/**
 * FinanceActionPanel — a money workbench.
 * Surfaces budget / envelopes / net-worth / investment / tax /
 * retirement-monte-carlo macros plus mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  DollarSign, PiggyBank, TrendingUp, Calculator, Briefcase,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string; reason?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('finance', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'snapshot' | 'envelope' | 'tax' | 'mc' | 'subs' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface NetWorthResult { netWorth?: number; assetsTotal?: number; liabilitiesTotal?: number; snapshotId?: string; date?: string }
interface TaxResult { totalIncome?: number; estimatedTax?: number; effectiveRate?: number; bracket?: string }
interface MonteCarloResult { successRate?: number; medianFinal?: number; p10Final?: number; p90Final?: number; yearsSimulated?: number }
interface SubsResult { subscriptions?: Array<{ name: string; monthlyAmount: number; flagged?: boolean }>; monthlyTotal?: number }

export function FinanceActionPanel() {
  const [assets, setAssets] = useState('');
  const [liabilities, setLiabilities] = useState('');
  const [envName, setEnvName] = useState('');
  const [envAmount, setEnvAmount] = useState('');
  const [taxIncome, setTaxIncome] = useState('');
  const [taxStatus, setTaxStatus] = useState<'single' | 'married' | 'head'>('single');
  const [mcCurrentAge, setMcCurrentAge] = useState('');
  const [mcRetireAge, setMcRetireAge] = useState('');
  const [mcCurrentBalance, setMcCurrentBalance] = useState('');
  const [mcMonthlyContrib, setMcMonthlyContrib] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [netWorthResult, setNetWorthResult] = useState<NetWorthResult | null>(null);
  const [taxResult, setTaxResult] = useState<TaxResult | null>(null);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [subsResult, setSubsResult] = useState<SubsResult | null>(null);
  const [envCreated, setEnvCreated] = useState<string | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  function parseKvLines(text: string) {
    return text.split('\n').map(l => {
      const m = l.trim().match(/^(\S+)\s+([\d.]+)$/);
      return m ? { name: m[1], amount: parseFloat(m[2]) } : null;
    }).filter(Boolean) as { name: string; amount: number }[];
  }

  async function actSnapshot() {
    const a = parseKvLines(assets);
    const l = parseKvLines(liabilities);
    if (!a.length) { err('Add asset lines.'); return; }
    setBusy('snapshot'); setFeedback(null);
    try {
      const r = await callMacro<NetWorthResult>('net-worth-snapshot', { assets: a, liabilities: l });
      if (r.ok && r.result) { setNetWorthResult(r.result); pipe.publish('finance.netWorth', r.result, { label: `Net worth $${(r.result.netWorth ?? 0).toLocaleString()}` }); ok(`Net worth $${(r.result.netWorth ?? 0).toLocaleString()}.`); }
      else err(r.error ?? 'snapshot failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actEnvelope() {
    if (!envName.trim()) { err('Envelope name required.'); return; }
    setBusy('envelope'); setFeedback(null);
    try {
      const r = await callMacro<{ envelope?: { id: string } }>('envelopes-create', { name: envName.trim(), monthlyBudget: parseFloat(envAmount) });
      if (r.ok && r.result?.envelope) { setEnvCreated(r.result.envelope.id); pipe.publish('finance.envelope', r.result.envelope, { label: `Env: ${envName.trim()}` }); ok(`Envelope: ${envName.trim()}.`); setEnvName(''); }
      else err(r.error ?? 'envelope failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actTax() {
    setBusy('tax'); setFeedback(null);
    try {
      const r = await callMacro<TaxResult>('tax-estimate', { income: parseFloat(taxIncome), filingStatus: taxStatus, year: new Date().getFullYear() });
      if (r.ok && r.result) { setTaxResult(r.result); pipe.publish('finance.tax', r.result, { label: `Tax $${(r.result.estimatedTax ?? 0).toLocaleString()}` }); ok(`Tax: $${(r.result.estimatedTax ?? 0).toLocaleString()}.`); }
      else err(r.error ?? 'tax failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actMc() {
    setBusy('mc'); setFeedback(null);
    try {
      const r = await callMacro<MonteCarloResult>('retirement-monte-carlo', {
        currentAge: parseInt(mcCurrentAge, 10),
        retirementAge: parseInt(mcRetireAge, 10),
        currentBalance: parseFloat(mcCurrentBalance),
        monthlyContribution: parseFloat(mcMonthlyContrib),
      });
      if (r.ok && r.result) { setMcResult(r.result); pipe.publish('finance.mc', r.result, { label: `MC ${r.result.successRate}% success` }); ok(`MC success rate: ${r.result.successRate}%.`); }
      else err(r.error ?? 'monte carlo failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actSubs() {
    setBusy('subs'); setFeedback(null);
    try {
      const r = await callMacro<SubsResult>('subscriptions-detect', {});
      if (r.ok && r.result) { setSubsResult(r.result); pipe.publish('finance.subs', r.result, { label: `${r.result.subscriptions?.length ?? 0} subs` }); ok(`${r.result.subscriptions?.length ?? 0} subscriptions detected.`); }
      else err(r.error ?? 'subs failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: {
          title: `Finance snapshot — ${new Date().toISOString().slice(0, 10)}`,
          tags: ['finance', 'snapshot', netWorthResult?.netWorth != null ? `nw:${Math.round(netWorthResult.netWorth)}` : ''],
          source: 'finance:snapshot:mint',
          meta: { visibility: 'private', consent: { allowCitations: false }, finance: { netWorth: netWorthResult, tax: taxResult, monteCarlo: mcResult, subscriptions: subsResult, envCreated } },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintedDtuId(id); pipe.publish('finance.mintedDtuId', id, { label: `Finance DTU ${id.slice(0, 8)}…` }); ok(`Finance DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `💰 Finance summary — ${new Date().toLocaleDateString()}`, '',
      netWorthResult ? `Net worth: $${netWorthResult.netWorth?.toLocaleString()} (assets $${netWorthResult.assetsTotal?.toLocaleString()} − liabilities $${netWorthResult.liabilitiesTotal?.toLocaleString()})` : '',
      taxResult ? `Est. tax: $${taxResult.estimatedTax?.toLocaleString()} (effective ${taxResult.effectiveRate}%)` : '',
      mcResult ? `Retirement MC: ${mcResult.successRate}% success at age ${mcRetireAge}` : '',
      mintedDtuId ? `\n[Finance DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok(`Sent to ${recipient.trim()}. 60s to recall.`); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actPublish() {
    if (!mcResult) { err('Run monte-carlo first (only anonymized retirement scenarios publish).'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({
          domain: 'dtu', name: 'create',
          input: {
            title: `Retirement scenario — ${mcCurrentAge}→${mcRetireAge}, ${mcResult.successRate}% success`,
            tags: ['finance', 'retirement', 'public', `success:${mcResult.successRate}`],
            source: 'finance:retirement:publish',
            meta: { visibility: 'public', consent: { allowCitations: true }, anonymized: true, scenario: { currentAge: parseInt(mcCurrentAge, 10), retirementAge: parseInt(mcRetireAge, 10), monthlyContrib: parseFloat(mcMonthlyContrib), result: mcResult } },
          },
        });
        const dtu = r.data?.result?.dtu ?? r.data?.result;
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('finance.publishedDtuId', id, { label: `Public scenario ${id.slice(0, 8)}…` }); ok(`Scenario published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Finance state:`,
        netWorthResult ? `net worth $${netWorthResult.netWorth?.toLocaleString()}.` : '',
        taxResult ? `est. tax $${taxResult.estimatedTax?.toLocaleString()} (effective ${taxResult.effectiveRate}%).` : '',
        mcResult ? `retirement MC: ${mcResult.successRate}% success.` : '',
        subsResult ? `${subsResult.subscriptions?.length} subscriptions ($${subsResult.monthlyTotal}/mo).` : '',
        '',
        'Identify the single highest-leverage move this month. Concrete, with dollar figures. Plain text.',
      ].filter(Boolean).join(' ');
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 4 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Move ready.'); }
      else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'snapshot', label: 'Net worth',  desc: 'net-worth-snapshot from assets/liabs',        icon: TrendingUp,  accent: '#22c55e', handler: actSnapshot },
    { id: 'envelope', label: '+ Envelope', desc: 'envelopes-create budget bucket',              icon: PiggyBank,   accent: '#06b6d4', handler: actEnvelope },
    { id: 'tax',      label: 'Tax est',    desc: 'tax-estimate income + status',                icon: Calculator,  accent: '#eab308', handler: actTax },
    { id: 'mc',       label: 'Retire MC',  desc: 'retirement-monte-carlo 10k runs',             icon: Briefcase,   accent: '#8b5cf6', handler: actMc },
    { id: 'subs',     label: 'Subs',       desc: 'subscriptions-detect monthly drain',          icon: DollarSign,  accent: '#f97316', handler: actSubs },
    { id: 'mint',     label: mintedDtuId      ? 'Saved'     : 'Mint',         desc: mintedDtuId      ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private finance DTU',                       icon: Sparkles,    accent: '#3b82f6', handler: actMint },
    { id: 'dm',       label: 'DM',         desc: 'Send finance summary',                        icon: Send,        accent: '#ec4899', handler: actDm },
    { id: 'publish',  label: publishedDtuId ? 'Published' : 'Publish MC',    desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Anonymized retirement scenario DTU',           icon: Globe,       accent: '#15803d', handler: actPublish, disabled: !mcResult },
    { id: 'agent',    label: 'Top move',   desc: 'Agent: highest-leverage move this month',     icon: Wand2,       accent: '#a855f7', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <DollarSign className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Money workbench</h3>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Assets (name amount, one per line)</label>
            <textarea value={assets} onChange={(e) => setAssets(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-emerald-200 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400/40 resize-none" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Liabilities (name amount, one per line)</label>
            <textarea value={liabilities} onChange={(e) => setLiabilities(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-rose-200 font-mono focus:outline-none focus:ring-2 focus:ring-rose-400/40 resize-none" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Envelope</label><input type="text" value={envName} onChange={(e) => setEnvName(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="e.g. Groceries" /></div>
            <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Monthly $</label><input type="text" value={envAmount} onChange={(e) => setEnvAmount(e.target.value.replace(/[^\d.]/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Tax income $</label><input type="text" value={taxIncome} onChange={(e) => setTaxIncome(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" /></div>
            <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Status</label><select value={taxStatus} onChange={(e) => setTaxStatus(e.target.value as typeof taxStatus)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white">{(['single', 'married', 'head'] as const).map(s => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Age</label><input type="text" value={mcCurrentAge} onChange={(e) => setMcCurrentAge(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" /></div>
            <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Retire</label><input type="text" value={mcRetireAge} onChange={(e) => setMcRetireAge(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" /></div>
            <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Bal $</label><input type="text" value={mcCurrentBalance} onChange={(e) => setMcCurrentBalance(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" /></div>
            <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">$/mo</label><input type="text" value={mcMonthlyContrib} onChange={(e) => setMcMonthlyContrib(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" /></div>
          </div>
          <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">DM recipient</label><input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="accountant / advisor user id" /><div className="flex items-center gap-2 flex-wrap mt-1"><RecallSlot ctl={dmRecall} /><RecallSlot ctl={publishRecall} /></div></div>
        </div>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={a.disabled || !!busy} onClick={a.handler}
              className={cn('group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {netWorthResult && (
          <div className={cn('rounded-md border p-2.5', (netWorthResult.netWorth ?? 0) >= 0 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-rose-500/40 bg-rose-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold flex items-center gap-1.5"><TrendingUp className="w-3 h-3" /> Net worth</div>
            <div className="text-xl font-bold text-zinc-100 mt-1">${netWorthResult.netWorth?.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-400">A ${netWorthResult.assetsTotal?.toLocaleString()} · L ${netWorthResult.liabilitiesTotal?.toLocaleString()}</div>
          </div>
        )}
        {taxResult && (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-yellow-300 font-semibold flex items-center gap-1.5"><Calculator className="w-3 h-3" /> Tax est.</div>
            <div className="text-xl font-bold text-zinc-100 mt-1">${taxResult.estimatedTax?.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-400">{taxResult.effectiveRate}% effective · {taxResult.bracket}</div>
          </div>
        )}
        {mcResult && (
          <div className={cn('rounded-md border p-2.5', (mcResult.successRate ?? 0) >= 80 ? 'border-emerald-500/40 bg-emerald-500/5' : (mcResult.successRate ?? 0) >= 60 ? 'border-amber-500/40 bg-amber-500/5' : 'border-rose-500/40 bg-rose-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold flex items-center gap-1.5"><Briefcase className="w-3 h-3" /> Retirement MC</div>
            <div className="text-xl font-bold text-zinc-100 mt-1">{mcResult.successRate}%</div>
            <div className="text-[10px] text-zinc-400">median $${mcResult.medianFinal?.toLocaleString()}</div>
          </div>
        )}
        {subsResult && (
          <div className="rounded-md border border-orange-500/40 bg-orange-500/5 p-2.5 max-h-32 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold flex items-center gap-1.5"><DollarSign className="w-3 h-3" /> Subscriptions ${subsResult.monthlyTotal}/mo</div>
            {subsResult.subscriptions?.slice(0, 6).map((s, i) => (
              <div key={i} className="text-[11px] text-zinc-300 flex justify-between"><span className={cn(s.flagged && 'text-rose-300')}>{s.name}</span><span className="font-mono">${s.monthlyAmount}</span></div>
            ))}
          </div>
        )}
      </div>

      {envCreated && (
        <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 text-[11px] text-zinc-300">
          <PiggyBank className="w-3 h-3 inline text-cyan-300" /> Envelope created: <span className="font-mono">{envCreated.slice(0, 8)}</span>
        </div>
      )}

      {agentReply && (
        <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-purple-300 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Top move</div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>
            {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
