'use client';

/**
 * TravelActionPanel — TripIt + Google Travel-shape trip workbench.
 * Surfaces tripBudget / packingList / jetlagCalc / visaCheck + mint/DM/
 * publish/agent.
 */

import { useState } from 'react';
import {
  Plane, DollarSign, Briefcase, Clock, FileBadge,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle, MapPin,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('travel', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'budget' | 'packing' | 'jetlag' | 'visa' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface BudgetResult { dailyAverage?: number; total?: number; categories?: Record<string, number> }
interface PackingResult { items?: string[]; categories?: Record<string, string[]> }
interface JetlagResult { hoursOffset?: number; daysToAdjust?: number; strategy?: string[] }
interface VisaResult { required?: boolean; type?: string; daysValid?: number; notes?: string }

export function TravelActionPanel() {
  const [destination, setDestination] = useState('');
  const [originTz, setOriginTz] = useState('');
  const [destTz, setDestTz] = useState('');
  const [tripDays, setTripDays] = useState('');
  const [dailyBudget, setDailyBudget] = useState('');
  const [tripStyle, setTripStyle] = useState<'beach' | 'business' | 'adventure' | 'city' | 'cold-weather'>('city');
  const [passportCountry, setPassportCountry] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [budgetResult, setBudgetResult] = useState<BudgetResult | null>(null);
  const [packingResult, setPackingResult] = useState<PackingResult | null>(null);
  const [jetlagResult, setJetlagResult] = useState<JetlagResult | null>(null);
  const [visaResult, setVisaResult] = useState<VisaResult | null>(null);
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

  async function actBudget() {
    setBusy('budget'); setFeedback(null);
    try { const r = await callMacro<BudgetResult>('tripBudget', { destination: destination.trim(), days: parseInt(tripDays, 10), dailyBudget: parseFloat(dailyBudget) }); if (r.ok && r.result) { setBudgetResult(r.result); pipe.publish('travel.budget', r.result, { label: `$${r.result.total ?? 0}` }); ok(`Total: $${r.result.total ?? 0}.`); } else err(r.error ?? 'budget failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPacking() {
    setBusy('packing'); setFeedback(null);
    try { const r = await callMacro<PackingResult>('packingList', { destination: destination.trim(), days: parseInt(tripDays, 10), tripStyle }); if (r.ok && r.result) { setPackingResult(r.result); pipe.publish('travel.packing', r.result, { label: `${r.result.items?.length ?? 0} items` }); ok(`${r.result.items?.length ?? 0} items.`); } else err(r.error ?? 'packing failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actJetlag() {
    setBusy('jetlag'); setFeedback(null);
    try { const r = await callMacro<JetlagResult>('jetlagCalc', { originTimezone: originTz, destinationTimezone: destTz }); if (r.ok && r.result) { setJetlagResult(r.result); pipe.publish('travel.jetlag', r.result, { label: `${r.result.hoursOffset}h offset` }); ok(`${r.result.hoursOffset}h offset.`); } else err(r.error ?? 'jetlag failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actVisa() {
    if (!destination.trim()) { err('Destination required.'); return; }
    setBusy('visa'); setFeedback(null);
    try { const r = await callMacro<VisaResult>('visaCheck', { destination: destination.trim(), passportCountry, days: parseInt(tripDays, 10) }); if (r.ok && r.result) { setVisaResult(r.result); pipe.publish('travel.visa', r.result, { label: r.result.required ? r.result.type ?? 'visa' : 'no visa' }); ok(r.result.required ? `${r.result.type} required` : 'No visa needed.'); } else err(r.error ?? 'visa failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Trip — ${destination.trim() || 'untitled'}`, tags: ['travel', 'trip', tripStyle, destination.trim().toLowerCase()], source: 'travel:trip:mint', meta: { visibility: 'private', consent: { allowCitations: false }, trip: { destination, days: parseInt(tripDays, 10), style: tripStyle, budget: budgetResult, packing: packingResult, jetlag: jetlagResult, visa: visaResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('travel.mintedDtuId', id, { label: `trip ${id.slice(0, 8)}` }); ok(`Trip DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`✈ Trip: ${destination || 'untitled'} · ${tripDays}d`, '', budgetResult ? `Budget: $${budgetResult.total} ($${budgetResult.dailyAverage}/d)` : '', packingResult ? `Packing: ${packingResult.items?.length} items` : '', jetlagResult ? `Jet lag: ${jetlagResult.hoursOffset}h · ${jetlagResult.daysToAdjust}d adjust` : '', visaResult ? `Visa: ${visaResult.required ? visaResult.type : 'not required'}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
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
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Travel guide — ${destination.trim() || 'destination'}`, tags: ['travel', 'guide', 'public', tripStyle], source: 'travel:guide:publish', meta: { visibility: 'public', consent: { allowCitations: true }, guide: { destination, style: tripStyle, packingTips: packingResult?.items, budget: budgetResult } } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('travel.publishedDtuId', id, { label: `guide ${id.slice(0, 8)}` }); ok(`Guide published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    if (!destination.trim()) { err('Destination required.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Trip: ${destination.trim()} for ${tripDays} days (${tripStyle}). ${budgetResult ? `Budget $${budgetResult.total}.` : ''} Suggest the single best off-the-beaten-path experience for this destination + style. Include why it's better than the obvious tourist option. Plain text.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Local tip ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'budget' as ActionId, label: 'Budget', desc: 'tripBudget total + daily', icon: DollarSign, accent: '#22c55e', handler: actBudget },
    { id: 'packing' as ActionId, label: 'Packing', desc: 'packingList by style', icon: Briefcase, accent: '#8b5cf6', handler: actPacking },
    { id: 'jetlag' as ActionId, label: 'Jet lag', desc: 'jetlagCalc offset + strategy', icon: Clock, accent: '#06b6d4', handler: actJetlag },
    { id: 'visa' as ActionId, label: 'Visa', desc: 'visaCheck by passport', icon: FileBadge, accent: '#f97316', handler: actVisa },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private trip DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send trip brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public travel guide + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Local tip', desc: 'Agent: off-the-beaten-path pick', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-sky-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-sky-500/10 pb-2">
        <Plane className="h-4 w-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-white">Travel workbench</h3>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input type="text" value={destination} onChange={(e) => setDestination(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Destination (e.g. Tokyo)" />
        <input type="text" value={tripDays} onChange={(e) => setTripDays(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Days" />
        <input type="text" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value.replace(/[^\d.]/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="$/day" />
        <select value={tripStyle} onChange={(e) => setTripStyle(e.target.value as typeof tripStyle)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          {(['beach', 'business', 'adventure', 'city', 'cold-weather'] as const).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="text" value={originTz} onChange={(e) => setOriginTz(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Origin TZ" />
        <input type="text" value={destTz} onChange={(e) => setDestTz(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Dest TZ" />
        <input type="text" value={passportCountry} onChange={(e) => setPassportCountry(e.target.value.toUpperCase())} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono uppercase" placeholder="Passport (US)" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {budgetResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Budget</div>
            <div className="text-2xl font-bold text-emerald-300">${budgetResult.total?.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-400">${budgetResult.dailyAverage}/day</div>
            {budgetResult.categories && <div className="text-[10px] text-zinc-400 mt-1">{Object.entries(budgetResult.categories).map(([k, v]) => `${k}:$${v}`).join(' · ')}</div>}
          </div>
        )}
        {packingResult?.items && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-32 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Packing ({packingResult.items.length})</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {packingResult.items.slice(0, 20).map((it, i) => <span key={i} className="rounded bg-purple-500/20 text-purple-200 px-1.5 py-0.5 text-[10px]">{it}</span>)}
            </div>
          </div>
        )}
        {jetlagResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Jet lag</div>
            <div className="text-2xl font-bold text-cyan-300">{jetlagResult.hoursOffset}h</div>
            <div className="text-[10px] text-zinc-400">~{jetlagResult.daysToAdjust} days to adjust</div>
            {jetlagResult.strategy && <ul className="text-[11px] text-zinc-300 list-disc list-inside mt-1">{jetlagResult.strategy.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}</ul>}
          </div>
        )}
        {visaResult && (
          <div className={cn('rounded-md border p-2.5', visaResult.required ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/40 bg-emerald-500/5')}>
            <div className={cn('text-[10px] uppercase tracking-wider font-semibold', visaResult.required ? 'text-amber-300' : 'text-emerald-300')}>Visa: {visaResult.required ? visaResult.type : 'not required'}</div>
            {visaResult.daysValid && <div className="text-[11px] text-zinc-300">Valid: {visaResult.daysValid} days</div>}
            {visaResult.notes && <div className="text-[11px] text-zinc-400 italic">{visaResult.notes}</div>}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><MapPin className="w-3 h-3" /> Local tip</div>
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
