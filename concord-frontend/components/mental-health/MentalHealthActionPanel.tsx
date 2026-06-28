'use client';

/**
 * MentalHealthActionPanel — wellness companion bench.
 * crisis-hotlines (988 + intl) / cdc-mental-health-stats (BRFSS) /
 * moodTracker / journalPrompt + mint/DM/publish/agent.
 *
 * Domain name is "mental-health" (hyphen) — registered in
 * server/domains/mentalhealth.js as `mental-health`.
 */

import { useState } from 'react';
import { Heart, Phone, BarChart3, BookOpen, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('mental-health', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'hotline' | 'stats' | 'mood' | 'prompt' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface HotlineEntry { name: string; phone?: string; text?: string; chat?: string; availability?: string; languages?: string[] }
interface HotlineResult { country: string; available: boolean; hotlines?: Record<string, HotlineEntry>; fallback?: string; disclaimer?: string }
interface StatMeasure { measure: string; value: number; confidenceLow: number; confidenceHigh: number; stateName?: string }
interface StatsResult { year: number; stateAbbr: string; measures: StatMeasure[]; count: number; disclaimer?: string }
interface MoodEntryIn { mood: number; date?: string }
interface MoodResult { entries: number; avgMood: number; trend: string; lowest: number; highest: number; variance: number }
interface PromptResult { mood: string; prompts: string[]; instruction: string; reminder?: string }

// No seeded mood csv — enter real values.
export function MentalHealthActionPanel() {
  const [country, setCountry] = useState<'US' | 'UK' | 'CA' | 'AU'>('US');
  const [stateAbbr, setStateAbbr] = useState('');
  const [year, setYear] = useState('');
  const [moodCsv, setMoodCsv] = useState('');
  const [currentMood, setCurrentMood] = useState<'happy' | 'sad' | 'anxious' | 'neutral' | 'angry'>('neutral');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [hotlineResult, setHotlineResult] = useState<HotlineResult | null>(null);
  const [statsResult, setStatsResult] = useState<StatsResult | null>(null);
  const [moodResult, setMoodResult] = useState<MoodResult | null>(null);
  const [promptResult, setPromptResult] = useState<PromptResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actHotline() {
    setBusy('hotline'); setFeedback(null);
    try {
      const r = await callMacro<HotlineResult>('crisis-hotlines', { country });
      if (r.ok && r.result) { setHotlineResult(r.result); pipe.publish('mh.hotline', r.result, { label: `Hotlines ${country}` }); ok(`${country} hotlines loaded.`); } else err(r.error ?? 'hotline failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actStats() {
    const y = parseInt(year, 10);
    if (!Number.isFinite(y) || !stateAbbr.trim()) { err('Year + state abbr required.'); return; }
    setBusy('stats'); setFeedback(null);
    try {
      const r = await callMacro<StatsResult>('cdc-mental-health-stats', { year: y, locationAbbr: stateAbbr.toUpperCase() });
      if (r.ok && r.result) { setStatsResult(r.result); pipe.publish('mh.stats', r.result, { label: `CDC ${r.result.stateAbbr} ${r.result.year}` }); ok(`${r.result.count} measures.`); } else err(r.error ?? 'stats failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMood() {
    if (!moodCsv.trim()) { err('Mood csv required.'); return; }
    const entries: MoodEntryIn[] = moodCsv.split(',').map(s => s.trim()).filter(Boolean).map((m, i) => ({ mood: parseInt(m, 10), date: new Date(Date.now() - (10 - i) * 86400000).toISOString().split('T')[0] }));
    if (entries.length === 0) { err('Mood entries required.'); return; }
    setBusy('mood'); setFeedback(null);
    try {
      const r = await callMacro<MoodResult>('moodTracker', { entries });
      if (r.ok && r.result) { setMoodResult(r.result); pipe.publish('mh.mood', r.result, { label: `Mood ${r.result.avgMood} (${r.result.trend})` }); ok(`Avg ${r.result.avgMood} (${r.result.trend}).`); } else err(r.error ?? 'mood failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPrompt() {
    setBusy('prompt'); setFeedback(null);
    try {
      const r = await callMacro<PromptResult>('journalPrompt', { currentMood });
      if (r.ok && r.result) { setPromptResult(r.result); pipe.publish('mh.prompt', r.result, { label: `Prompts (${currentMood})` }); ok(`${r.result.prompts.length} prompts for ${currentMood}.`); } else err(r.error ?? 'prompt failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Wellness — ${currentMood}`, tags: ['mentalhealth', 'wellness', currentMood], source: 'mentalhealth:wellness:mint', meta: { visibility: 'private', consent: { allowCitations: false }, mh: { country, mood: moodResult, prompt: promptResult, currentMood } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('mh.mintedDtuId', id, { label: `Wellness DTU ${id.slice(0, 8)}…` }); ok(`Wellness DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const primary = hotlineResult?.hotlines?.primary;
    const body = [`💗 Wellness check`, '',
      primary ? `If you need help: ${primary.name} — ${primary.phone}${primary.text ? ` (text: ${primary.text})` : ''}` : '',
      moodResult ? `Mood trend: ${moodResult.trend} (avg ${moodResult.avgMood}/10)` : '',
      promptResult ? `Prompt: ${promptResult.prompts[0]}` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
      '\nThis is not medical advice.',
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
    if (!statsResult) { err('Load CDC stats first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Mental health stats — ${statsResult.stateAbbr} ${statsResult.year}`, tags: ['mentalhealth', 'cdc', 'stats', 'public'], source: 'mentalhealth:stats:publish', meta: { visibility: 'public', consent: { allowCitations: true }, stats: statsResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('mh.publishedDtuId', id, { label: `Public CDC stats ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Wellness companion. Current mood: ${currentMood}. ${moodResult ? `10-day trend: ${moodResult.trend} (avg ${moodResult.avgMood}, var ${moodResult.variance}).` : ''} ${statsResult ? `Regional ${statsResult.stateAbbr} mental distress prevalence: ${statsResult.measures.map(m => `${m.measure} ${m.value}%`).join(', ')}.` : ''} Offer one small, concrete, evidence-based action for today (under 10 minutes). Plain text, 2-3 sentences. End with: "This is not medical advice. If you are in crisis, call/text 988."`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Action ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'hotline' as ActionId, label: 'Hotlines', desc: 'crisis lines by country', icon: Phone, accent: '#ef4444', handler: actHotline },
    { id: 'stats' as ActionId, label: 'CDC stats', desc: 'BRFSS prevalence', icon: BarChart3, accent: '#06b6d4', handler: actStats },
    { id: 'mood' as ActionId, label: 'Mood', desc: 'moodTracker trend', icon: Heart, accent: '#ec4899', handler: actMood },
    { id: 'prompt' as ActionId, label: 'Journal', desc: 'journalPrompt seed', icon: BookOpen, accent: '#a855f7', handler: actPrompt },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private wellness DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send wellness check', icon: Send, accent: '#f59e0b', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public stats card', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Action', desc: 'Agent: 10-min action', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-pink-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-pink-500/10 pb-2">
        <Heart className="h-4 w-4 text-pink-400" />
        <h3 className="text-sm font-semibold text-white">Wellness companion</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">988 · CDC BRFSS · mood · journal</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <select value={country} onChange={(e) => setCountry(e.target.value as typeof country)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white">
          <option value="US">US</option>
          <option value="UK">UK</option>
          <option value="CA">CA</option>
          <option value="AU">AU</option>
        </select>
        <input type="text" value={stateAbbr} onChange={(e) => setStateAbbr(e.target.value.toUpperCase().slice(0, 2))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="State (CA, US)" />
        <input type="text" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Year" />
        <select value={currentMood} onChange={(e) => setCurrentMood(e.target.value as typeof currentMood)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white">
          <option value="happy">happy</option><option value="sad">sad</option><option value="anxious">anxious</option><option value="neutral">neutral</option><option value="angry">angry</option>
        </select>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
        <input type="text" value={moodCsv} onChange={(e) => setMoodCsv(e.target.value)} className="md:col-span-5 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Mood 1-10 csv (10 days)" />
        <div className="md:col-span-5 flex items-center gap-2 flex-wrap">
          <RecallSlot ctl={dmRecall} />
          <RecallSlot ctl={publishRecall} />
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
        {hotlineResult?.hotlines && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5 md:col-span-2 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">{hotlineResult.country} crisis lines</div>
            {Object.entries(hotlineResult.hotlines).slice(0, 6).map(([k, h]) => <div key={k} className="text-[11px] text-zinc-200 mt-1"><strong className="text-red-300">{h.name}</strong> · <span className="font-mono">{h.phone}</span>{h.text ? ` · text: ${h.text}` : ''}{h.availability ? ` · ${h.availability}` : ''}</div>)}
            {hotlineResult.disclaimer && <div className="text-[10px] text-zinc-400 italic mt-2">{hotlineResult.disclaimer}</div>}
          </div>
        )}
        {statsResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">CDC · {statsResult.stateAbbr} {statsResult.year}</div>
            {statsResult.measures.slice(0, 4).map((m, i) => <div key={i} className="mt-1"><div className="text-[10px] text-zinc-400">{m.measure}</div><div className="text-2xl font-bold text-cyan-300">{m.value}%</div><div className="text-[10px] text-zinc-400">CI {m.confidenceLow}-{m.confidenceHigh}</div></div>)}
          </div>
        )}
        {moodResult && (
          <div className="rounded-md border border-pink-500/30 bg-pink-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-pink-300 font-semibold">Mood · {moodResult.trend}</div>
            <div className="text-2xl font-bold text-pink-300">{moodResult.avgMood}<span className="text-xs text-zinc-400">/10 avg</span></div>
            <div className="text-[10px] text-zinc-400">range {moodResult.lowest}-{moodResult.highest} · variance {moodResult.variance}</div>
          </div>
        )}
        {promptResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Journal prompts · {promptResult.mood}</div>
            {promptResult.prompts.map((p, i) => <div key={i} className="text-[12px] text-zinc-200 mt-1.5 leading-snug">• {p}</div>)}
            <div className="text-[10px] text-zinc-400 italic mt-1.5">{promptResult.instruction} · {promptResult.reminder}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> 10-minute action</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
