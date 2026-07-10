'use client';

/**
 * TravelActionPanel — standalone quick-calculator workbench for the four
 * pure-compute + honest-reference travel macros (tripBudget / packingList /
 * jetlagCalc / visaCheck), plus mint/DM/publish/agent actions that package
 * the results.
 *
 * Field-shape correctness note (fixed 2026-07-09 travel rebuild): this
 * component used to send/read a shared `tripStyle: 'beach'|'business'|…`
 * field and `dailyBudget`/`originTz`/`destTz`/`required`/`type`/`daysValid`
 * that DO NOT EXIST on the real `server/domains/travel.js` handlers — every
 * one of the four quick actions silently "succeeded" while rendering
 * `undefined` for every field, because the backend reads
 * `artifact.data.travelStyle`/`climate`/`purpose`/`timezoneShift`/`direction`
 * and returns `totalEstimate`/`breakdown`/`recoveryDays`/`arrangement`/
 * `visaRequired`/`maxFreeStay` — a completely different vocabulary. Each
 * tool below now sends and reads exactly the real macro's shape (see the
 * handler docblocks in `server/domains/travel.js` for the ground truth).
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
type TravelStyle = 'budget' | 'moderate' | 'luxury';
type Climate = 'tropical' | 'temperate' | 'cold';
type Purpose = 'leisure' | 'business' | 'adventure';
type Direction = 'east' | 'west';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

// Real result shapes — verbatim from server/domains/travel.js.
interface BudgetResult {
  destination: string; days: number; style: string;
  breakdown: { flights: number; accommodation: number; food: number; activities: number; localTransport: number };
  totalEstimate: number; perDay: number; flightCostSource: string; tip: string;
}
interface PackingResult {
  essentials: string[]; clothing: string[]; purposeSpecific: string[]; totalItems: number; tip: string;
}
interface JetlagResult {
  timezoneShift: string; recoveryDays: number; severity: string; tips: string[]; melatoninTiming: string;
}
interface VisaResult {
  passport: string; destination: string; duration: number;
  arrangement: string | null; visaRequired: boolean | null; maxFreeStay: string | null;
  source: string; disclaimer: string;
}

export function TravelActionPanel() {
  // Shared trip-length context
  const [destination, setDestination] = useState('');
  const [days, setDays] = useState('7');

  // Budget-specific
  const [travelStyle, setTravelStyle] = useState<TravelStyle>('moderate');
  const [flightCost, setFlightCost] = useState('');

  // Packing-specific
  const [climate, setClimate] = useState<Climate>('temperate');
  const [purpose, setPurpose] = useState<Purpose>('leisure');

  // Jet lag-specific (real inputs are an hour offset + direction, NOT
  // timezone names — the backend has no timezone database to resolve
  // "America/Chicago" → an offset, so we don't pretend to compute one).
  const [timezoneShift, setTimezoneShift] = useState('6');
  const [direction, setDirection] = useState<Direction>('east');

  // Visa-specific — the real macro compares ISO-2 country codes against
  // built-in Schengen/CTA/USMCA tables, not free-text destination names.
  const [passportCountry, setPassportCountry] = useState('US');
  const [visaDestination, setVisaDestination] = useState('');

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
    try {
      const input: Record<string, unknown> = {
        destination: destination.trim() || undefined,
        days: parseInt(days, 10) || 7,
        travelStyle,
      };
      if (flightCost.trim()) input.flightCost = parseFloat(flightCost);
      const r = await callMacro<BudgetResult>('tripBudget', input);
      if (r.ok && r.result) {
        setBudgetResult(r.result);
        pipe.publish('travel.budget', r.result, { label: `$${r.result.totalEstimate}` });
        ok(`Total: $${r.result.totalEstimate} ($${r.result.perDay}/day).`);
      } else err(r.error ?? 'budget failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPacking() {
    setBusy('packing'); setFeedback(null);
    try {
      const r = await callMacro<PackingResult>('packingList', {
        climate, purpose, days: parseInt(days, 10) || 7,
      });
      if (r.ok && r.result) {
        setPackingResult(r.result);
        pipe.publish('travel.packing', r.result, { label: `${r.result.totalItems} items` });
        ok(`${r.result.totalItems} items.`);
      } else err(r.error ?? 'packing failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actJetlag() {
    setBusy('jetlag'); setFeedback(null);
    try {
      const r = await callMacro<JetlagResult>('jetlagCalc', {
        timezoneShift: parseInt(timezoneShift, 10) || 0, direction,
      });
      if (r.ok && r.result) {
        setJetlagResult(r.result);
        pipe.publish('travel.jetlag', r.result, { label: `${r.result.recoveryDays}d recovery` });
        ok(`${r.result.recoveryDays} day recovery (${r.result.severity}).`);
      } else err(r.error ?? 'jetlag failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actVisa() {
    if (!visaDestination.trim()) { err('Destination ISO-2 country code required (e.g. JP).'); return; }
    setBusy('visa'); setFeedback(null);
    try {
      const r = await callMacro<VisaResult>('visaCheck', {
        passportCountry, destination: visaDestination.trim(), durationDays: parseInt(days, 10) || 14,
      });
      if (r.ok && r.result) {
        setVisaResult(r.result);
        pipe.publish('travel.visa', r.result, { label: r.result.visaRequired ? 'visa required' : 'visa-free' });
        ok(r.result.arrangement
          ? (r.result.visaRequired ? 'Visa required.' : 'Visa-free.')
          : 'No bilateral arrangement on file — consult embassy.');
      } else err(r.error ?? 'visa failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu', name: 'create', input: {
          title: `Trip — ${destination.trim() || 'untitled'}`,
          tags: ['travel', 'trip', travelStyle, destination.trim().toLowerCase()].filter(Boolean),
          source: 'travel:trip:mint',
          meta: {
            visibility: 'private', consent: { allowCitations: false },
            trip: { destination, days, style: travelStyle, budget: budgetResult, packing: packingResult, jetlag: jetlagResult, visa: visaResult },
          },
        },
      });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('travel.mintedDtuId', id, { label: `trip ${id.slice(0, 8)}` }); ok(`Trip DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `✈ Trip: ${destination || 'untitled'} · ${days}d`, '',
      budgetResult ? `Budget: $${budgetResult.totalEstimate} ($${budgetResult.perDay}/d)` : '',
      packingResult ? `Packing: ${packingResult.totalItems} items` : '',
      jetlagResult ? `Jet lag: ${jetlagResult.timezoneShift} · ${jetlagResult.recoveryDays}d recovery` : '',
      visaResult ? `Visa: ${visaResult.visaRequired ? visaResult.arrangement || 'required' : 'not required'}` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
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
        const r = await lensRun({
          domain: 'dtu', name: 'create', input: {
            title: `Travel guide — ${destination.trim() || 'destination'}`,
            tags: ['travel', 'guide', 'public', travelStyle],
            source: 'travel:guide:publish',
            meta: { visibility: 'public', consent: { allowCitations: true }, guide: { destination, style: travelStyle, packingTips: packingResult?.essentials, budget: budgetResult } },
          },
        });
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
      const task = `Trip: ${destination.trim()} for ${days} days (${travelStyle} style). ${budgetResult ? `Budget $${budgetResult.totalEstimate}.` : ''} Suggest the single best off-the-beaten-path experience for this destination + style. Include why it's better than the obvious tourist option. Plain text.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Local tip ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'budget' as ActionId, label: 'Budget', desc: 'tripBudget by style + flight cost', icon: DollarSign, accent: '#22c55e', handler: actBudget },
    { id: 'packing' as ActionId, label: 'Packing', desc: 'packingList by climate + purpose', icon: Briefcase, accent: '#8b5cf6', handler: actPacking },
    { id: 'jetlag' as ActionId, label: 'Jet lag', desc: 'jetlagCalc from hour offset', icon: Clock, accent: '#06b6d4', handler: actJetlag },
    { id: 'visa' as ActionId, label: 'Visa', desc: 'visaCheck bilateral tables', icon: FileBadge, accent: '#f97316', handler: actVisa },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private trip DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send trip brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public travel guide + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Local tip', desc: 'Agent: off-the-beaten-path pick', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-sky-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-sky-500/10 pb-2">
        <Plane className="h-4 w-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-white">Quick tools</h3>
        <span className="text-[10px] text-zinc-500">standalone calculators — not tied to a saved trip</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input type="text" value={destination} onChange={(e) => setDestination(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Destination label (e.g. Tokyo)" />
        <input type="text" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Days" />
        <select value={travelStyle} onChange={(e) => setTravelStyle(e.target.value as TravelStyle)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" aria-label="Budget travel style">
          {(['budget', 'moderate', 'luxury'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input type="text" inputMode="decimal" value={flightCost} onChange={(e) => setFlightCost(e.target.value.replace(/[^\d.]/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Flight cost $ (optional)" />
        <select value={climate} onChange={(e) => setClimate(e.target.value as Climate)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" aria-label="Packing climate">
          {(['tropical', 'temperate', 'cold'] as const).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={purpose} onChange={(e) => setPurpose(e.target.value as Purpose)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" aria-label="Packing purpose">
          {(['leisure', 'business', 'adventure'] as const).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input type="text" inputMode="numeric" value={timezoneShift} onChange={(e) => setTimezoneShift(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Hours offset" />
        <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" aria-label="Jet lag direction">
          {(['east', 'west'] as const).map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input type="text" value={passportCountry} onChange={(e) => setPassportCountry(e.target.value.toUpperCase().slice(0, 2))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono uppercase" placeholder="Passport (US)" maxLength={2} />
        <input type="text" value={visaDestination} onChange={(e) => setVisaDestination(e.target.value.toUpperCase().slice(0, 2))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono uppercase" placeholder="Visa dest. ISO-2 (JP)" maxLength={2} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
        <div className="flex items-center gap-2">
          <RecallSlot ctl={dmRecall} />
          <RecallSlot ctl={publishRecall} />
        </div>
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
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Budget · {budgetResult.style}</div>
            <div className="text-2xl font-bold text-emerald-300">${budgetResult.totalEstimate.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-400">${budgetResult.perDay}/day over {budgetResult.days}d · flight cost {budgetResult.flightCostSource}</div>
            <div className="text-[10px] text-zinc-400 mt-1">{Object.entries(budgetResult.breakdown).map(([k, v]) => `${k}:$${v}`).join(' · ')}</div>
          </div>
        )}
        {packingResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-32 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Packing ({packingResult.totalItems})</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {[...packingResult.essentials, ...packingResult.clothing, ...packingResult.purposeSpecific].slice(0, 20).map((it, i) => <span key={i} className="rounded bg-purple-500/20 text-purple-200 px-1.5 py-0.5 text-[10px]">{it}</span>)}
            </div>
          </div>
        )}
        {jetlagResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Jet lag · {jetlagResult.timezoneShift}</div>
            <div className="text-2xl font-bold text-cyan-300">{jetlagResult.recoveryDays}d</div>
            <div className="text-[10px] text-zinc-400">Severity: {jetlagResult.severity} · {jetlagResult.melatoninTiming}</div>
            <ul className="text-[11px] text-zinc-300 list-disc list-inside mt-1">{jetlagResult.tips.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        )}
        {visaResult && (
          <div className={cn('rounded-md border p-2.5', visaResult.visaRequired ? 'border-amber-500/40 bg-amber-500/5' : visaResult.visaRequired === false ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-zinc-700 bg-zinc-900/40')}>
            <div className={cn('text-[10px] uppercase tracking-wider font-semibold', visaResult.visaRequired ? 'text-amber-300' : visaResult.visaRequired === false ? 'text-emerald-300' : 'text-zinc-400')}>
              {visaResult.passport} → {visaResult.destination}: {visaResult.arrangement ? (visaResult.visaRequired ? 'visa required' : 'visa-free') : 'no bilateral data'}
            </div>
            {visaResult.maxFreeStay && <div className="text-[11px] text-zinc-300">Max stay: {visaResult.maxFreeStay}</div>}
            <div className="text-[11px] text-zinc-400 italic">{visaResult.disclaimer}</div>
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
