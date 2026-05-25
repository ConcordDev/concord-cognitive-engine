'use client';

/**
 * PoetryActionPanel — Poetry Foundation + Poets.org-shape workbench.
 * Surfaces meterAnalysis / rhymeScheme / formGuide / wordFrequency +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Feather, Hash, Music2, BookOpen, ScanSearch,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('poetry', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'meter' | 'rhyme' | 'form' | 'frequency' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface MeterResult { lines?: number; syllablesPerLine?: number[]; avgSyllables?: number; meterConsistency?: string; possibleForm?: string }
interface RhymeResult { lines?: number; scheme?: string; endWords?: string[]; form?: string; rhyming?: boolean }
interface FormResult { form?: string; lines?: number | string; meter?: string; rhyme?: string; structure?: string; tip?: string }
interface FreqResult { totalWords?: number; uniqueWords?: number; topWords?: Array<{ word: string; count: number }>; keyImages?: string[]; lexicalDensity?: number }

export function PoetryActionPanel() {
  const [poemTitle, setPoemTitle] = useState('');
  const [poemText, setPoemText] = useState('');
  const [formType, setFormType] = useState<'sonnet' | 'haiku' | 'limerick' | 'villanelle' | 'free-verse'>('sonnet');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [meterResult, setMeterResult] = useState<MeterResult | null>(null);
  const [rhymeResult, setRhymeResult] = useState<RhymeResult | null>(null);
  const [formResult, setFormResult] = useState<FormResult | null>(null);
  const [freqResult, setFreqResult] = useState<FreqResult | null>(null);
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

  async function actMeter() {
    if (!poemText.trim()) { err('Add poem text.'); return; }
    setBusy('meter'); setFeedback(null);
    try { const r = await callMacro<MeterResult>('meterAnalysis', { text: poemText }); if (r.ok && r.result) { setMeterResult(r.result); pipe.publish('poetry.meter', r.result, { label: r.result.possibleForm ?? 'meter' }); ok(`Avg ${r.result.avgSyllables} syll · ${r.result.possibleForm}.`); } else err(r.error ?? 'meter failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRhyme() {
    if (!poemText.trim()) { err('Add poem text.'); return; }
    setBusy('rhyme'); setFeedback(null);
    try { const r = await callMacro<RhymeResult>('rhymeScheme', { text: poemText }); if (r.ok && r.result) { setRhymeResult(r.result); pipe.publish('poetry.rhyme', r.result, { label: r.result.scheme ?? 'scheme' }); ok(`Scheme: ${r.result.scheme}.`); } else err(r.error ?? 'rhyme failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actForm() {
    setBusy('form'); setFeedback(null);
    try { const r = await callMacro<FormResult>('formGuide', { form: formType }); if (r.ok && r.result) { setFormResult(r.result); pipe.publish('poetry.form', r.result, { label: r.result.form ?? formType }); ok(`Form: ${r.result.form}.`); } else err(r.error ?? 'form failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actFreq() {
    if (!poemText.trim()) { err('Add poem text.'); return; }
    setBusy('frequency'); setFeedback(null);
    try { const r = await callMacro<FreqResult>('wordFrequency', { text: poemText }); if (r.ok && r.result) { setFreqResult(r.result); pipe.publish('poetry.frequency', r.result, { label: `${r.result.uniqueWords} unique` }); ok(`${r.result.uniqueWords} unique words · density ${r.result.lexicalDensity}%.`); } else err(r.error ?? 'freq failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Poem — ${poemTitle.trim() || 'untitled'}`, tags: ['poetry', meterResult?.possibleForm ?? 'unknown'], source: 'poetry:poem:mint', meta: { visibility: 'private', consent: { allowCitations: false }, poem: { title: poemTitle, text: poemText, meter: meterResult, rhyme: rhymeResult, form: formResult, frequency: freqResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('poetry.mintedDtuId', id, { label: `poem ${id.slice(0, 8)}` }); ok(`Poem DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📜 Poem: ${poemTitle || 'untitled'}`, '', poemText, '', meterResult ? `\nMeter: ${meterResult.possibleForm} · avg ${meterResult.avgSyllables} syll` : '', rhymeResult ? `Rhyme: ${rhymeResult.scheme} (${rhymeResult.form})` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
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
    if (!poemText.trim()) { err('Add poem text.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Published poem — ${poemTitle.trim() || 'untitled'}`, tags: ['poetry', 'public', meterResult?.possibleForm ?? 'free-verse'], source: 'poetry:poem:publish', meta: { visibility: 'public', consent: { allowCitations: true }, poem: { title: poemTitle, text: poemText, form: meterResult?.possibleForm, scheme: rhymeResult?.scheme } } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('poetry.publishedDtuId', id, { label: `poem ${id.slice(0, 8)}` }); ok(`Poem published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    if (!poemText.trim()) { err('Add poem text.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Poem: "${poemTitle || 'untitled'}" (${meterResult?.possibleForm ?? 'unknown form'}, ${rhymeResult?.scheme ?? '?'} rhyme). Text:\n${poemText.slice(0, 800)}\n\nProvide a one-paragraph close reading: image, sound, structure, and one suggested edit. Plain text.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Close reading ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'meter' as ActionId, label: 'Meter', desc: 'meterAnalysis syllables + form', icon: Hash, accent: '#06b6d4', handler: actMeter },
    { id: 'rhyme' as ActionId, label: 'Rhyme', desc: 'rhymeScheme + end words', icon: Music2, accent: '#8b5cf6', handler: actRhyme },
    { id: 'form' as ActionId, label: 'Form guide', desc: 'formGuide structure rules', icon: BookOpen, accent: '#22c55e', handler: actForm },
    { id: 'frequency' as ActionId, label: 'Words', desc: 'wordFrequency key images', icon: ScanSearch, accent: '#f97316', handler: actFreq },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private poem DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send poem to reader', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public poem DTU + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Reading', desc: 'Agent: one-paragraph close reading', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-violet-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-violet-500/10 pb-2">
        <Feather className="h-4 w-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-white">Poetry workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">poetry foundation · poets.org</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input type="text" value={poemTitle} onChange={(e) => setPoemTitle(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Poem title" />
        <select value={formType} onChange={(e) => setFormType(e.target.value as typeof formType)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          {(['sonnet', 'haiku', 'limerick', 'villanelle', 'free-verse'] as const).map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Poem text</label>
        <textarea value={poemText} onChange={(e) => setPoemText(e.target.value)} rows={8} className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-400/40 resize-y leading-relaxed italic" />
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
        {meterResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Meter ({meterResult.lines} lines)</div>
            <div className="text-sm text-zinc-100">avg <span className="font-mono text-cyan-300">{meterResult.avgSyllables}</span> syll · <span className="capitalize">{meterResult.meterConsistency}</span> · <span className="text-violet-300 font-semibold">{meterResult.possibleForm}</span></div>
            {meterResult.syllablesPerLine && <div className="text-[10px] text-zinc-400 font-mono mt-1">{meterResult.syllablesPerLine.slice(0, 8).join(' · ')}</div>}
          </div>
        )}
        {rhymeResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Rhyme</div>
            <div className="text-lg font-bold font-mono text-purple-300">{rhymeResult.scheme}</div>
            <div className="text-[11px] text-zinc-300">{rhymeResult.form} · {rhymeResult.rhyming ? 'rhyming' : 'unrhymed'}</div>
            {rhymeResult.endWords && <div className="text-[10px] text-zinc-400 font-mono">end: {rhymeResult.endWords.slice(0, 8).join(', ')}</div>}
          </div>
        )}
        {formResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Form: {formResult.form}</div>
            <div className="text-[11px] text-zinc-300">Lines: <span className="font-mono">{formResult.lines}</span> · Meter: {formResult.meter}</div>
            <div className="text-[11px] text-zinc-300">Rhyme: <span className="font-mono">{formResult.rhyme}</span></div>
            {formResult.structure && <div className="text-[11px] text-zinc-400 italic">{formResult.structure}</div>}
            {formResult.tip && <div className="text-[11px] text-emerald-300 mt-1">💡 {formResult.tip}</div>}
          </div>
        )}
        {freqResult && (
          <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold">Words ({freqResult.totalWords} · {freqResult.lexicalDensity}% density)</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {freqResult.topWords?.slice(0, 8).map((w, i) => <span key={i} className="rounded bg-orange-500/20 text-orange-200 px-1.5 py-0.5 text-[10px] font-mono">{w.word} {w.count}</span>)}
            </div>
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Close reading</div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed italic">{agentReply}</pre>
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
