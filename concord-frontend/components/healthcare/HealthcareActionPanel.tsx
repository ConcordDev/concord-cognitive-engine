'use client';

/**
 * HealthcareActionPanel — clinician + patient bench.
 * symptom-triage (LLM) / providers-search (CMS NPI registry) /
 * medications-list / rx-price-compare + mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Stethoscope, Search, Pill, DollarSign, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('healthcare', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'triage' | 'find' | 'meds' | 'rx' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface TriageCandidate { condition: string; confidence: number; citations: string[] }
interface TriageResult { severity: string; candidates: TriageCandidate[]; reasoning: string }
interface Provider { id: string; npi: string; name: string; specialty: string; credential?: string; practice?: string; city?: string; state?: string; zip?: string; phone?: string }
interface ProviderResult { providers: Provider[]; count: number; totalMatching?: number; source?: string }
interface Med { id: string; name: string; dose: string; schedule: string; dosesScheduledToday?: number; dosesTakenToday?: number; takenToday?: boolean }
interface MedsResult { medications: Med[] }
interface RxQuote { pharmacy?: string; cashPrice?: number; discountedPrice?: number; coupon?: string }
interface RxResult { drug?: string; cheapest?: RxQuote; quotes?: RxQuote[]; potentialSavings?: number }

const BODY_REGIONS = ['head', 'chest', 'abdomen', 'back', 'arm', 'leg', 'throat', 'eye', 'ear', 'skin'];

export function HealthcareActionPanel() {
  const [regions, setRegions] = useState<string[]>(['head']);
  const [description, setDescription] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'M' | 'F' | 'X'>('F');
  const [specialty, setSpecialty] = useState('');
  const [zip, setZip] = useState('');
  const [drugName, setDrugName] = useState('');
  const [drugDose, setDrugDose] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [providerResult, setProviderResult] = useState<ProviderResult | null>(null);
  const [medsResult, setMedsResult] = useState<MedsResult | null>(null);
  const [rxResult, setRxResult] = useState<RxResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  function toggleRegion(r: string) { setRegions(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]); }

  async function actTriage() {
    if (regions.length === 0 && !description.trim()) { err('Region or description required.'); return; }
    setBusy('triage'); setFeedback(null);
    try { const r = await callMacro<TriageResult>('symptom-triage', { regions, description: description.trim(), age: parseInt(age, 10) || 0, sex }); if (r.ok && r.result) { setTriageResult(r.result); pipe.publish('healthcare.triage', r.result, { label: `Triage ${r.result.severity}` }); ok(`Severity: ${r.result.severity}.`); } else err(r.error ?? 'triage failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actFind() {
    if (!specialty.trim() && !zip.trim()) { err('Specialty or zip required.'); return; }
    setBusy('find'); setFeedback(null);
    try { const r = await callMacro<ProviderResult>('providers-search', { specialty: specialty.trim(), zipCode: zip.trim(), limit: 15 }); if (r.ok && r.result) { setProviderResult(r.result); pipe.publish('healthcare.providers', r.result, { label: `${r.result.count} providers` }); ok(`${r.result.count} providers (NPI registry).`); } else err(r.error ?? 'find failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMeds() {
    setBusy('meds'); setFeedback(null);
    try { const r = await callMacro<MedsResult>('medications-list', {}); if (r.ok && r.result) { setMedsResult(r.result); pipe.publish('healthcare.meds', r.result, { label: `${r.result.medications.length} meds` }); ok(`${r.result.medications.length} medications.`); } else err(r.error ?? 'meds failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRx() {
    if (!drugName.trim()) { err('Drug required.'); return; }
    setBusy('rx'); setFeedback(null);
    try { const r = await callMacro<RxResult>('rx-price-compare', { drug: drugName.trim(), dose: drugDose.trim() }); if (r.ok && r.result) { setRxResult(r.result); pipe.publish('healthcare.rx', r.result, { label: `Rx ${r.result.drug ?? drugName}` }); ok(`Cheapest: ${r.result.cheapest?.pharmacy ?? '-'} $${r.result.cheapest?.discountedPrice ?? r.result.cheapest?.cashPrice ?? '-'}.`); } else err(r.error ?? 'rx failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Health visit prep`, tags: ['healthcare', 'visit', triageResult?.severity].filter((t): t is string => !!t), source: 'healthcare:visit:mint', meta: { visibility: 'private', consent: { allowCitations: false }, health: { triage: triageResult, providers: providerResult, meds: medsResult, rx: rxResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('healthcare.mintedDtuId', id, { label: `Visit DTU ${id.slice(0, 8)}…` }); ok(`Visit DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🩺 Visit prep`, '',
      triageResult ? `Triage: ${triageResult.severity.toUpperCase()} — ${triageResult.reasoning}` : '',
      providerResult ? `Providers: ${providerResult.count} matches in ${zip}` : '',
      medsResult ? `Meds: ${medsResult.medications.length} active${medsResult.medications.slice(0, 3).map(m => ` · ${m.name} ${m.dose}`).join('')}` : '',
      rxResult?.cheapest ? `Rx ${rxResult.drug}: ${rxResult.cheapest.pharmacy} $${rxResult.cheapest.discountedPrice ?? rxResult.cheapest.cashPrice}` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
      '\nNot medical advice.',
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
    if (!providerResult) { err('Run provider search first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Provider directory — ${specialty} ${zip}`, tags: ['healthcare', 'providers', 'public', specialty.toLowerCase().replace(/\s/g, '-')], source: 'healthcare:providers:publish', meta: { visibility: 'public', consent: { allowCitations: true }, providers: providerResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('healthcare.publishedDtuId', id, { label: `Public directory ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Patient visit prep. ${triageResult ? `Triage: ${triageResult.severity}. Candidates: ${triageResult.candidates.map(c => `${c.condition} (${Math.round(c.confidence * 100)}%)`).join(', ')}.` : ''} Patient: age ${age}, sex ${sex}. ${description ? `Sx: ${description}` : ''} ${medsResult ? `Currently on ${medsResult.medications.length} meds.` : ''} List the 3 most important questions to ask the provider in this visit. Plain text. End with: "This is not medical advice."`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Questions ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'triage' as ActionId, label: 'Triage', desc: 'LLM symptom check', icon: Stethoscope, accent: '#ef4444', handler: actTriage },
    { id: 'find' as ActionId, label: 'Find MD', desc: 'CMS NPI registry', icon: Search, accent: '#3b82f6', handler: actFind },
    { id: 'meds' as ActionId, label: 'Meds', desc: 'medications-list', icon: Pill, accent: '#22c55e', handler: actMeds },
    { id: 'rx' as ActionId, label: 'Rx price', desc: 'rx-price-compare', icon: DollarSign, accent: '#f59e0b', handler: actRx },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private visit DTU', icon: Sparkles, accent: '#a855f7', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send to caregiver', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public directory', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Questions', desc: 'Agent: top 3 to ask', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const SEV_COLOR: Record<string, string> = { self_care: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5', see_doctor: 'text-amber-300 border-amber-500/30 bg-amber-500/5', er: 'text-red-300 border-red-500/30 bg-red-500/5' };

  return (
    <div className="rounded-lg border border-red-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-red-500/10 pb-2">
        <Stethoscope className="h-4 w-4 text-red-400" />
        <h3 className="text-sm font-semibold text-white">Healthcare bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">triage · NPI · meds · Rx</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="space-y-1.5 md:col-span-2">
          <div className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Symptoms</div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white mt-1" placeholder="Describe symptoms…" />
          <div className="flex flex-wrap gap-1">
            {BODY_REGIONS.map(r => <button key={r} type="button" onClick={() => toggleRegion(r)} className={cn('text-[10px] px-1.5 py-0.5 rounded font-mono', regions.includes(r) ? 'bg-red-500/30 text-red-200 border border-red-500/50' : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700')}>{r}</button>)}
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Patient + provider</div>
          <div className="grid grid-cols-2 gap-1">
            <input type="text" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, '') || '0')} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Age" />
            <select value={sex} onChange={(e) => setSex(e.target.value as typeof sex)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white">
              <option value="F">F</option><option value="M">M</option><option value="X">X</option>
            </select>
          </div>
          <input type="text" value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="Specialty" />
          <input type="text" value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="ZIP" />
          <div className="grid grid-cols-2 gap-1">
            <input type="text" value={drugName} onChange={(e) => setDrugName(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="Drug" />
            <input type="text" value={drugDose} onChange={(e) => setDrugDose(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Dose" />
          </div>
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="DM recipient" />
          <div className="flex items-center gap-2 flex-wrap">
            <RecallSlot ctl={dmRecall} />
            <RecallSlot ctl={publishRecall} />
          </div>
        </div>
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
        {triageResult && (
          <div className={cn('rounded-md border p-2.5 md:col-span-2 max-h-44 overflow-y-auto', SEV_COLOR[triageResult.severity] ?? SEV_COLOR.see_doctor)}>
            <div className="text-[10px] uppercase tracking-wider font-semibold">Triage · {triageResult.severity.replace('_', ' ').toUpperCase()}</div>
            <div className="text-[11px] text-zinc-200 mt-1">{triageResult.reasoning}</div>
            {triageResult.candidates.map((c, i) => <div key={i} className="text-[10px] text-zinc-300 mt-1.5 flex items-center gap-2"><div className="flex-1"><strong>{c.condition}</strong> {c.citations.length > 0 && <span className="text-zinc-400">[{c.citations.join(', ')}]</span>}</div><div className="w-16 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-current" style={{ width: `${c.confidence * 100}%` }} /></div><span className="font-mono text-[10px]">{Math.round(c.confidence * 100)}%</span></div>)}
            <div className="text-[10px] text-zinc-400 italic mt-2">This is not medical advice. Triage decision-support only.</div>
          </div>
        )}
        {providerResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-60 overflow-y-auto md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Providers ({providerResult.count} of {providerResult.totalMatching})</div>
            {providerResult.providers.slice(0, 6).map((p, i) => <div key={i} className="text-[10px] text-zinc-300 mt-1.5 pb-1.5 border-b border-zinc-800 last:border-0"><strong className="text-blue-200">{p.name}</strong> {p.credential && <span className="font-mono text-zinc-400">{p.credential}</span>} · {p.specialty}<div className="text-zinc-400">{p.practice}, {p.city}, {p.state} {p.zip}{p.phone ? ` · ☎ ${p.phone}` : ''}</div></div>)}
          </div>
        )}
        {medsResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Meds · {medsResult.medications.length}</div>
            {medsResult.medications.length === 0 ? <div className="text-[11px] text-zinc-400 mt-1">No medications. Add via healthcare.medications-add.</div> : medsResult.medications.map((m, i) => <div key={i} className="text-[11px] text-zinc-300 mt-1"><strong className="text-green-200">{m.name}</strong> {m.dose} · {m.schedule}{m.takenToday != null ? ` · ${m.takenToday ? '✓' : '○'} today` : ''}</div>)}
          </div>
        )}
        {rxResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Rx prices · {rxResult.drug}</div>
            {rxResult.cheapest && <div className="text-2xl font-bold text-amber-300">${rxResult.cheapest.discountedPrice ?? rxResult.cheapest.cashPrice}<span className="text-xs text-zinc-400"> · {rxResult.cheapest.pharmacy}</span></div>}
            {rxResult.potentialSavings != null && <div className="text-[10px] text-emerald-300">save up to ${rxResult.potentialSavings}</div>}
            {(rxResult.quotes ?? []).slice(0, 4).map((q, i) => <div key={i} className="text-[10px] text-zinc-400 mt-0.5">{q.pharmacy}: ${q.discountedPrice ?? q.cashPrice}{q.coupon ? ` (${q.coupon})` : ''}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Top 3 questions</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
