'use client';

/**
 * RealEstateActionPanel — Zillow + Redfin + Stessa-shape investor
 * workbench. Surfaces capRate / calc-mortgage / calc-affordability /
 * calc-rent-vs-buy + mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Home, Percent, Calculator, Wallet, Scale,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('realestate', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'cap' | 'mortgage' | 'afford' | 'rentBuy' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface CapResult { capRatePct?: number; band?: string; noi?: number }
interface MortgageResult { monthlyPayment?: number; totalInterest?: number; payoffYears?: number }
interface AffordResult { maxPrice?: number; maxMonthlyPayment?: number; dtiRatio?: number }
interface RentBuyResult { breakEvenYears?: number; recommendation?: string; netDifference?: number }

export function RealEstateActionPanel() {
  const [address, setAddress] = useState('');
  const [price, setPrice] = useState('');
  const [rentAnnual, setRentAnnual] = useState('');
  const [expensesAnnual, setExpensesAnnual] = useState('');
  const [downPct, setDownPct] = useState('');
  const [rateApr, setRateApr] = useState('');
  const [termYears, setTermYears] = useState('');
  const [income, setIncome] = useState('');
  const [debts, setDebts] = useState('');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [capResult, setCapResult] = useState<CapResult | null>(null);
  const [mortgageResult, setMortgageResult] = useState<MortgageResult | null>(null);
  const [affordResult, setAffordResult] = useState<AffordResult | null>(null);
  const [rentBuyResult, setRentBuyResult] = useState<RentBuyResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({
    label: 'DM',
    windowMs: 60_000,
    onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); },
  });
  const publishRecall = useRecallableAction({
    label: 'publish',
    windowMs: 30_000,
    onUndo: async (id) => {
      await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`);
      setPublishedDtuId(null);
    },
  });

  async function actCap() {
    setBusy('cap'); setFeedback(null);
    try { const r = await callMacro<CapResult>('capRate', { propertyValue: parseFloat(price), annualRent: parseFloat(rentAnnual), annualExpenses: parseFloat(expensesAnnual) }); if (r.ok && r.result) { setCapResult(r.result); pipe.publish('realestate.cap', r.result, { label: `${r.result.capRatePct?.toFixed(2)}%` }); ok(`Cap rate: ${r.result.capRatePct?.toFixed(2)}%.`); } else err(r.error ?? 'cap failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMortgage() {
    setBusy('mortgage'); setFeedback(null);
    try { const r = await callMacro<MortgageResult>('calc-mortgage', { price: parseFloat(price), downPaymentPct: parseFloat(downPct), interestRate: parseFloat(rateApr) / 100, termYears: parseInt(termYears, 10) }); if (r.ok && r.result) { setMortgageResult(r.result); pipe.publish('realestate.mortgage', r.result, { label: `$${r.result.monthlyPayment?.toFixed(0)}/mo` }); ok(`$${r.result.monthlyPayment?.toFixed(0)}/mo.`); } else err(r.error ?? 'mortgage failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAfford() {
    setBusy('afford'); setFeedback(null);
    try { const r = await callMacro<AffordResult>('calc-affordability', { annualIncome: parseFloat(income), monthlyDebts: parseFloat(debts), downPaymentAvailable: parseFloat(price) * (parseFloat(downPct) / 100), interestRate: parseFloat(rateApr) / 100 }); if (r.ok && r.result) { setAffordResult(r.result); pipe.publish('realestate.afford', r.result, { label: `$${r.result.maxPrice?.toLocaleString()}` }); ok(`Max: $${r.result.maxPrice?.toLocaleString()}.`); } else err(r.error ?? 'afford failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRentBuy() {
    setBusy('rentBuy'); setFeedback(null);
    try { const r = await callMacro<RentBuyResult>('calc-rent-vs-buy', { homePrice: parseFloat(price), monthlyRent: parseFloat(monthlyRent), downPaymentPct: parseFloat(downPct), interestRate: parseFloat(rateApr) / 100 }); if (r.ok && r.result) { setRentBuyResult(r.result); pipe.publish('realestate.rentVsBuy', r.result, { label: r.result.recommendation ?? 'rent-vs-buy' }); ok(`${r.result.recommendation}.`); } else err(r.error ?? 'rent-vs-buy failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Property — ${address.trim() || 'analysis'}`, tags: ['realestate', 'property', `price:${price}`], source: 'realestate:property:mint', meta: { visibility: 'private', consent: { allowCitations: false }, property: { address, price: parseFloat(price), cap: capResult, mortgage: mortgageResult, afford: affordResult, rentBuy: rentBuyResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('realestate.mintedDtuId', id, { label: `property ${id.slice(0, 8)}` }); ok(`Property DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🏠 Property: ${address || price}`, '', `Asking: $${parseFloat(price).toLocaleString()}`, capResult ? `Cap rate: ${capResult.capRatePct?.toFixed(2)}% (${capResult.band})` : '', mortgageResult ? `Mortgage: $${mortgageResult.monthlyPayment?.toFixed(0)}/mo` : '', rentBuyResult ? `Rent-vs-buy: ${rentBuyResult.recommendation}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Investor analysis — ${address || price}`, tags: ['realestate', 'analysis', 'public'], source: 'realestate:analysis:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anonymized: true, analysis: { price, capRate: capResult?.capRatePct, monthlyPayment: mortgageResult?.monthlyPayment, rentBuy: rentBuyResult?.recommendation } } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('realestate.publishedDtuId', id, { label: `analysis ${id.slice(0, 8)}` }); ok(`Analysis published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Property: ${address || 'unnamed'} at $${price}. ${capResult ? `Cap rate ${capResult.capRatePct?.toFixed(2)}%.` : ''} ${mortgageResult ? `Mortgage $${mortgageResult.monthlyPayment?.toFixed(0)}/mo.` : ''} ${rentBuyResult ? `Rent-vs-buy: ${rentBuyResult.recommendation}.` : ''} Suggest the single best negotiation lever for this deal (price, repair credit, closing date, financing contingency). Plain text.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Negotiation lever ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'cap' as ActionId, label: 'Cap rate', desc: 'capRate + NOI', icon: Percent, accent: '#22c55e', handler: actCap },
    { id: 'mortgage' as ActionId, label: 'Mortgage', desc: 'calc-mortgage P&I', icon: Calculator, accent: '#06b6d4', handler: actMortgage },
    { id: 'afford' as ActionId, label: 'Afford', desc: 'calc-affordability max price', icon: Wallet, accent: '#8b5cf6', handler: actAfford },
    { id: 'rentBuy' as ActionId, label: 'Rent v buy', desc: 'calc-rent-vs-buy break-even', icon: Scale, accent: '#f97316', handler: actRentBuy },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private property DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send property analysis', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anonymized analysis + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Negotiate', desc: 'Agent: best negotiation lever', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <Home className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Property workbench</h3>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="md:col-span-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Address" />
        <input type="text" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Price $" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
        <input type="text" value={rentAnnual} onChange={(e) => setRentAnnual(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Annual rent $" />
        <input type="text" value={expensesAnnual} onChange={(e) => setExpensesAnnual(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Annual expenses $" />
        <input type="text" value={downPct} onChange={(e) => setDownPct(e.target.value.replace(/[^\d.]/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Down %" />
        <input type="text" value={rateApr} onChange={(e) => setRateApr(e.target.value.replace(/[^\d.]/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="APR %" />
        <input type="text" value={termYears} onChange={(e) => setTermYears(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Term yrs" />
        <input type="text" value={income} onChange={(e) => setIncome(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Income $/yr" />
        <input type="text" value={debts} onChange={(e) => setDebts(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Debts $/mo" />
        <input type="text" value={monthlyRent} onChange={(e) => setMonthlyRent(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Comp rent $/mo" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(a => {
          const Icon = a.icon; const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={!!busy} onClick={a.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
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
        {capResult && <Tile label="Cap rate" big={`${capResult.capRatePct?.toFixed(2)}%`} sub={`${capResult.band} · NOI $${capResult.noi?.toLocaleString()}`} accent="#22c55e" />}
        {mortgageResult && <Tile label="Mortgage" big={`$${mortgageResult.monthlyPayment?.toFixed(0)}`} sub={`/mo · int $${mortgageResult.totalInterest?.toLocaleString()}`} accent="#06b6d4" />}
        {affordResult && <Tile label="Afford max" big={`$${affordResult.maxPrice?.toLocaleString()}`} sub={`DTI ${(affordResult.dtiRatio ?? 0).toFixed(2)}`} accent="#8b5cf6" />}
        {rentBuyResult && <Tile label="Break-even" big={`${rentBuyResult.breakEvenYears?.toFixed(1)}y`} sub={rentBuyResult.recommendation} accent="#f97316" />}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Negotiation lever</div>
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

function Tile({ label, big, sub, accent }: { label: string; big: string; sub?: string; accent: string }) {
  return (
    <div className="rounded-md border p-2.5" style={{ borderColor: accent + '60', backgroundColor: accent + '10' }}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">{label}</div>
      <div className="text-xl font-bold truncate" style={{ color: accent }}>{big}</div>
      {sub && <div className="text-[10px] text-zinc-400 truncate">{sub}</div>}
    </div>
  );
}
