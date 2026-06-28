'use client';

/**
 * PharmacyActionPanel — pharmacist's bench.
 * drug-label (OpenFDA) / drugInteractionCheck (FDA SPL cross-mention) /
 * adverse-events (FAERS) / dosageCalculator + mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Pill, BookOpen, AlertOctagon, Calculator, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('pharmacy', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'label' | 'inter' | 'adverse' | 'dose' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface LabelResult { genericName?: string; brandName?: string; manufacturer?: string; productType?: string; route?: string; rxOtc?: string; indications?: string; dosageAndAdministration?: string; warnings?: string; contraindications?: string; adverseReactions?: string; drugInteractions?: string }
interface InterPair { drug1: string; drug2: string; aMentionsB?: boolean; bMentionsA?: boolean; severity?: string }
interface InterLabel { name: string; found: boolean; genericName?: string; brandName?: string; manufacturer?: string }
interface InterResult { medications: string[]; labels: InterLabel[]; interactionsFound: number; coMentions: InterPair[]; disclaimer?: string }
// Matches the real pharmacy.adverse-events contract: { drug, reportCount,
// topReactions: [{ term, count }], source, disclaimer }. The earlier shape
// (total / reaction) was a phantom — the panel rendered blanks in production.
interface AdverseReaction { term?: string; count?: number }
interface AdverseResult { drug?: string; reportCount?: number; topReactions?: AdverseReaction[]; source?: string; disclaimer?: string }
interface DoseResult { weightKg: number; dosePerKg: number; singleDose: string; frequency: string; dailyDose: string; maxDailyDose: string; capped: boolean; disclaimer: string }

export function PharmacyActionPanel() {
  const [drugName, setDrugName] = useState('');
  const [drug2Name, setDrug2Name] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [dosePerKg, setDosePerKg] = useState('');
  const [freq, setFreq] = useState('');
  const [maxDaily, setMaxDaily] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [labelResult, setLabelResult] = useState<LabelResult | null>(null);
  const [interResult, setInterResult] = useState<InterResult | null>(null);
  const [adverseResult, setAdverseResult] = useState<AdverseResult | null>(null);
  const [doseResult, setDoseResult] = useState<DoseResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

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

  async function actLabel() {
    if (!drugName.trim()) { err('Drug required.'); return; }
    setBusy('label'); setFeedback(null);
    try { const r = await callMacro<LabelResult>('drug-label', { drug: drugName.trim() }); if (r.ok && r.result) { setLabelResult(r.result); pipe.publish('pharmacy.label', r.result, { label: r.result.brandName ?? r.result.genericName ?? drugName }); ok(`${r.result.brandName ?? r.result.genericName ?? drugName} loaded.`); } else err(r.error ?? 'label failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actInter() {
    if (!drugName.trim() || !drug2Name.trim()) { err('Two drugs required.'); return; }
    setBusy('inter'); setFeedback(null);
    try { const r = await callMacro<InterResult>('drugInteractionCheck', { artifact: { data: { medications: [drugName.trim(), drug2Name.trim()] } } }); if (r.ok && r.result) { setInterResult(r.result); pipe.publish('pharmacy.interactions', r.result, { label: `${r.result.interactionsFound} co-mentions` }); ok(`${r.result.interactionsFound} co-mentions.`); } else err(r.error ?? 'interaction failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAdverse() {
    if (!drugName.trim()) { err('Drug required.'); return; }
    setBusy('adverse'); setFeedback(null);
    try { const r = await callMacro<AdverseResult>('adverse-events', { drug: drugName.trim() }); if (r.ok && r.result) { setAdverseResult(r.result); pipe.publish('pharmacy.adverse', r.result, { label: `${r.result.reportCount ?? 0} FAERS` }); ok(`${r.result.reportCount ?? 0} FAERS reports.`); } else err(r.error ?? 'adverse failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDose() {
    setBusy('dose'); setFeedback(null);
    try { const r = await callMacro<DoseResult>('dosageCalculator', { artifact: { data: { weightKg: parseFloat(weightKg), dosePerKg: parseFloat(dosePerKg), frequencyPerDay: parseInt(freq, 10), maxDailyDose: parseFloat(maxDaily) } } }); if (r.ok && r.result) { setDoseResult(r.result); pipe.publish('pharmacy.dose', r.result, { label: `${r.result.singleDose}` }); ok(`${r.result.singleDose}, ${r.result.dailyDose}/day.`); } else err(r.error ?? 'dose failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Rx — ${drugName}`, tags: ['pharmacy', 'rx', labelResult?.rxOtc].filter((t): t is string => !!t), source: 'pharmacy:rx:mint', meta: { visibility: 'private', consent: { allowCitations: false }, pharmacy: { label: labelResult, inter: interResult, adverse: adverseResult, dose: doseResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('pharmacy.mintedDtuId', id, { label: `rx ${id.slice(0, 8)}` }); ok(`Rx DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`💊 Rx note`, '', labelResult ? `${labelResult.brandName ?? labelResult.genericName} (${labelResult.route ?? '-'}, ${labelResult.rxOtc ?? '-'})` : '', interResult ? `Interaction screen: ${interResult.interactionsFound} co-mentions across ${interResult.medications.join(' + ')}` : '', adverseResult ? `FAERS: ${adverseResult.reportCount} reports` : '', doseResult ? `Dose: ${doseResult.singleDose} ${doseResult.frequency} → ${doseResult.dailyDose} daily` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
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
    if (!labelResult) { err('Load a drug label first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Drug brief — ${labelResult.brandName ?? labelResult.genericName ?? drugName}`, tags: ['pharmacy', 'drug', 'public'], source: 'pharmacy:drug:publish', meta: { visibility: 'public', consent: { allowCitations: true }, label: labelResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('pharmacy.publishedDtuId', id, { label: `brief ${id.slice(0, 8)}` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Pharmacy review of ${drugName}. ${labelResult ? `${labelResult.brandName ?? labelResult.genericName} (${labelResult.rxOtc}, ${labelResult.route}).` : ''} ${interResult ? `Interaction screen vs ${drug2Name}: ${interResult.interactionsFound} co-mentions.` : ''} ${doseResult ? `Dose: ${doseResult.singleDose} ${doseResult.frequency}.` : ''} Identify the single most important counseling point for the patient + one monitoring parameter. Plain text, 3 sentences max. End with: "This is not medical advice."`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Counsel ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'label' as ActionId, label: 'Label', desc: 'OpenFDA drug label', icon: BookOpen, accent: '#3b82f6', handler: actLabel },
    { id: 'inter' as ActionId, label: 'Interactions', desc: 'SPL cross-mention', icon: AlertOctagon, accent: '#ef4444', handler: actInter },
    { id: 'adverse' as ActionId, label: 'FAERS', desc: 'adverse events', icon: AlertTriangle, accent: '#f97316', handler: actAdverse },
    { id: 'dose' as ActionId, label: 'Dose', desc: 'mg/kg calculator', icon: Calculator, accent: '#22c55e', handler: actDose },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private Rx DTU', icon: Sparkles, accent: '#8b5cf6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send Rx note', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public drug brief', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Counsel', desc: 'Agent: pt counseling', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-rose-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-rose-500/10 pb-2">
        <Pill className="h-4 w-4 text-rose-400" />
        <h3 className="text-sm font-semibold text-white">Pharmacy bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">OpenFDA · SPL · FAERS</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input type="text" value={drugName} onChange={(e) => setDrugName(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Drug A" />
        <input type="text" value={drug2Name} onChange={(e) => setDrug2Name(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Drug B for interaction" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
        <div className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-zinc-400">Dose calc:</div>
        <input type="text" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Weight kg" />
        <input type="text" value={dosePerKg} onChange={(e) => setDosePerKg(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="mg/kg" />
        <input type="text" value={freq} onChange={(e) => setFreq(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="freq/day" />
        <input type="text" value={maxDaily} onChange={(e) => setMaxDaily(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="max mg/day" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(act => {
          const Icon = act.icon; const isBusy = busy === act.id;
          return (
            <button key={act.id} type="button" disabled={!!busy} onClick={act.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: act.accent + '20', color: act.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{act.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {labelResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 md:col-span-2 max-h-72 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">{labelResult.brandName ?? labelResult.genericName} · {labelResult.rxOtc} · {labelResult.route}</div>
            {labelResult.indications && <div className="text-[11px] text-zinc-300 mt-1.5"><strong className="text-blue-300">Indications:</strong> {labelResult.indications.slice(0, 400)}{labelResult.indications.length > 400 ? '…' : ''}</div>}
            {labelResult.warnings && <div className="text-[11px] text-amber-300 mt-1.5"><strong>Warnings:</strong> {labelResult.warnings.slice(0, 300)}…</div>}
            {labelResult.contraindications && <div className="text-[11px] text-red-300 mt-1.5"><strong>Contraindications:</strong> {labelResult.contraindications.slice(0, 250)}…</div>}
            {labelResult.dosageAndAdministration && <div className="text-[11px] text-zinc-300 mt-1.5"><strong className="text-blue-300">Dosing:</strong> {labelResult.dosageAndAdministration.slice(0, 250)}…</div>}
          </div>
        )}
        {interResult && (
          <div className={cn('rounded-md border p-2.5', interResult.interactionsFound > 0 ? 'border-red-500/30 bg-red-500/5' : 'border-green-500/30 bg-green-500/5')}>
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: interResult.interactionsFound > 0 ? '#fca5a5' : '#86efac' }}>Interaction screen</div>
            <div className="text-2xl font-bold" style={{ color: interResult.interactionsFound > 0 ? '#f87171' : '#34d399' }}>{interResult.interactionsFound}</div>
            <div className="text-[10px] text-zinc-400">{interResult.medications.join(' + ')}</div>
            {interResult.coMentions.map((p, i) => <div key={i} className="text-[10px] text-red-200 mt-0.5">{p.drug1} → {p.drug2}: {p.severity}</div>)}
          </div>
        )}
        {adverseResult && (
          <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold">FAERS · {adverseResult.drug}</div>
            <div className="text-2xl font-bold text-orange-300">{adverseResult.reportCount ?? 0}</div>
            <div className="text-[10px] text-zinc-400">reports</div>
            {(adverseResult.topReactions ?? []).slice(0, 4).map((e, i) => <div key={i} className="text-[10px] text-orange-200 mt-0.5">{e.term} <span className="text-zinc-400">×{e.count}</span></div>)}
          </div>
        )}
        {doseResult && (
          <div className={cn('rounded-md border p-2.5', doseResult.capped ? 'border-amber-500/30 bg-amber-500/5' : 'border-green-500/30 bg-green-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Dose · {doseResult.weightKg} kg @ {doseResult.dosePerKg} mg/kg</div>
            <div className="text-2xl font-bold text-green-300">{doseResult.singleDose}</div>
            <div className="text-[10px] text-zinc-400">{doseResult.frequency} → {doseResult.dailyDose} / day</div>
            <div className="text-[10px] text-zinc-400">cap {doseResult.maxDailyDose}{doseResult.capped ? ' (capped!)' : ''}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Patient counseling</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
