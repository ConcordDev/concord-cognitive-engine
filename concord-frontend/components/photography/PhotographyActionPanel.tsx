'use client';

/**
 * PhotographyActionPanel — photographer's bench.
 * exposureCalc / compositionAnalysis / gearRecommend / printSize +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Camera, Sliders, Eye, Frame, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('photography', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'exp' | 'comp' | 'gear' | 'print' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface ExposureResult { iso: number; aperture: string; ev: number; shutterSpeed: string; depthOfField: string; motionBlur: string; handheld: string }
interface CompResult { rulesApplied: string[]; score: number; allRules: string[]; suggestions: string[]; strength: string }
interface GearResult { genre: string; budget: string; recommendation: { lens: string; lighting: string; accessory: string }; tip: string }
interface PrintResult { resolution: string; megapixels: number; maxPrintAt300DPI: string; maxPrintAt150DPI: string; quality: string }

const COMP_RULES = ['rule-of-thirds', 'leading-lines', 'symmetry', 'framing', 'depth', 'negative-space', 'golden-ratio', 'patterns'];

export function PhotographyActionPanel() {
  const [iso, setIso] = useState('');
  const [aperture, setAperture] = useState('');
  const [ev, setEv] = useState('');
  const [appliedRules, setAppliedRules] = useState<string[]>([]);
  const [genre, setGenre] = useState<'portrait' | 'landscape' | 'street' | 'macro' | 'sports' | 'general'>('portrait');
  const [budget, setBudget] = useState<'low' | 'medium' | 'high'>('medium');
  const [widthPx, setWidthPx] = useState('');
  const [heightPx, setHeightPx] = useState('');
  const [dpi, setDpi] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [expResult, setExpResult] = useState<ExposureResult | null>(null);
  const [compResult, setCompResult] = useState<CompResult | null>(null);
  const [gearResult, setGearResult] = useState<GearResult | null>(null);
  const [printResult, setPrintResult] = useState<PrintResult | null>(null);
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

  function toggleRule(rule: string) {
    setAppliedRules(prev => prev.includes(rule) ? prev.filter(r => r !== rule) : [...prev, rule]);
  }

  async function actExp() {
    setBusy('exp'); setFeedback(null);
    try { const r = await callMacro<ExposureResult>('exposureCalc', { artifact: { data: { iso: parseInt(iso, 10), aperture: parseFloat(aperture), ev: parseFloat(ev) } } }); if (r.ok && r.result) { setExpResult(r.result); pipe.publish('photography.exposure', r.result, { label: r.result.shutterSpeed }); ok(`${r.result.shutterSpeed} · DoF ${r.result.depthOfField}.`); } else err(r.error ?? 'exp failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actComp() {
    setBusy('comp'); setFeedback(null);
    try { const r = await callMacro<CompResult>('compositionAnalysis', { artifact: { data: { compositionRules: appliedRules } } }); if (r.ok && r.result) { setCompResult(r.result); pipe.publish('photography.composition', r.result, { label: `${r.result.score}/100` }); ok(`Score ${r.result.score} · ${r.result.strength}.`); } else err(r.error ?? 'comp failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actGear() {
    setBusy('gear'); setFeedback(null);
    try { const r = await callMacro<GearResult>('gearRecommend', { artifact: { data: { genre, budget } } }); if (r.ok && r.result) { setGearResult(r.result); pipe.publish('photography.gear', r.result, { label: r.result.recommendation.lens }); ok(`Lens: ${r.result.recommendation.lens}.`); } else err(r.error ?? 'gear failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPrint() {
    setBusy('print'); setFeedback(null);
    try { const r = await callMacro<PrintResult>('printSize', { artifact: { data: { widthPixels: parseInt(widthPx, 10), heightPixels: parseInt(heightPx, 10), dpi: parseInt(dpi, 10) } } }); if (r.ok && r.result) { setPrintResult(r.result); pipe.publish('photography.print', r.result, { label: `${r.result.megapixels}MP` }); ok(`${r.result.megapixels} MP · max ${r.result.maxPrintAt300DPI}.`); } else err(r.error ?? 'print failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Photo — ${genre}`, tags: ['photography', genre, 'shoot'], source: 'photography:shoot:mint', meta: { visibility: 'private', consent: { allowCitations: false }, photo: { exp: expResult, comp: compResult, gear: gearResult, print: printResult, genre, budget } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('photography.mintedDtuId', id, { label: `shoot ${id.slice(0, 8)}` }); ok(`Shoot DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📸 Photo brief`, '', expResult ? `Exposure: ISO ${expResult.iso} · ${expResult.aperture} · ${expResult.shutterSpeed} · DoF ${expResult.depthOfField}` : '', compResult ? `Composition: ${compResult.score}/100 (${compResult.strength}) · ${compResult.rulesApplied.join(', ')}` : '', gearResult ? `Gear: ${gearResult.recommendation.lens} · ${gearResult.recommendation.lighting}` : '', printResult ? `Print: ${printResult.megapixels} MP → max ${printResult.maxPrintAt300DPI}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
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
    if (!compResult && !gearResult) { err('Run a calc first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Shoot template — ${genre}`, tags: ['photography', genre, 'public', 'template'], source: 'photography:template:publish', meta: { visibility: 'public', consent: { allowCitations: true }, exp: expResult, comp: compResult, gear: gearResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('photography.publishedDtuId', id, { label: `template ${id.slice(0, 8)}` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Photo shoot brief — ${genre}. ${expResult ? `Exposure: ISO ${expResult.iso}, ${expResult.aperture}, ${expResult.shutterSpeed}, DoF ${expResult.depthOfField}, ${expResult.handheld}.` : ''} ${compResult ? `Composition: ${compResult.score}/100 (${compResult.rulesApplied.join(', ')}).` : ''} ${gearResult ? `Gear: ${gearResult.recommendation.lens}.` : ''} Suggest one concrete creative direction + one technical fix. Plain text, 3 sentences max.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'exp' as ActionId, label: 'Exposure', desc: 'EV → shutter speed', icon: Sliders, accent: '#f59e0b', handler: actExp },
    { id: 'comp' as ActionId, label: 'Composition', desc: 'rule scoring', icon: Frame, accent: '#22c55e', handler: actComp },
    { id: 'gear' as ActionId, label: 'Gear', desc: 'lens + light reco', icon: Camera, accent: '#06b6d4', handler: actGear },
    { id: 'print' as ActionId, label: 'Print size', desc: 'DPI → inches', icon: Eye, accent: '#a855f7', handler: actPrint },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private shoot DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send shoot brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public template', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Direction', desc: 'Agent: creative + fix', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-amber-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-500/10 pb-2">
        <Camera className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Photography bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">exposure · composition · gear · print</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Exposure</div>
          <input type="text" value={iso} onChange={(e) => setIso(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="ISO" />
          <input type="text" value={aperture} onChange={(e) => setAperture(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="f/" />
          <input type="text" value={ev} onChange={(e) => setEv(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="EV (12=sunny)" />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <div className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Composition rules</div>
          <div className="flex flex-wrap gap-1">
            {COMP_RULES.map(rule => <button key={rule} type="button" onClick={() => toggleRule(rule)} className={cn('text-[10px] px-1.5 py-0.5 rounded font-mono', appliedRules.includes(rule) ? 'bg-green-500/30 text-green-200 border border-green-500/50' : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700')}>{rule}</button>)}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <select value={genre} onChange={(e) => setGenre(e.target.value as typeof genre)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white">
              <option value="portrait">portrait</option><option value="landscape">landscape</option><option value="street">street</option><option value="macro">macro</option><option value="sports">sports</option><option value="general">general</option>
            </select>
            <select value={budget} onChange={(e) => setBudget(e.target.value as typeof budget)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white">
              <option value="low">budget low</option><option value="medium">budget med</option><option value="high">budget high</option>
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Print</div>
          <input type="text" value={widthPx} onChange={(e) => setWidthPx(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="Width px" />
          <input type="text" value={heightPx} onChange={(e) => setHeightPx(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="Height px" />
          <input type="text" value={dpi} onChange={(e) => setDpi(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="DPI" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-4 bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="DM recipient" />
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {expResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Exposure · EV {expResult.ev}</div>
            <div className="text-2xl font-bold text-amber-300">{expResult.shutterSpeed}</div>
            <div className="text-[10px] text-zinc-400">ISO {expResult.iso} · {expResult.aperture}</div>
            <div className="text-[10px] text-zinc-400">DoF: {expResult.depthOfField} · {expResult.motionBlur}</div>
            <div className="text-[10px] text-amber-200">handheld: {expResult.handheld}</div>
          </div>
        )}
        {compResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Composition · {compResult.strength}</div>
            <div className="text-2xl font-bold text-green-300">{compResult.score}<span className="text-xs text-zinc-400">/100</span></div>
            <div className="text-[10px] text-zinc-400">applied {compResult.rulesApplied.length}</div>
            <div className="text-[10px] text-green-200">suggest: {compResult.suggestions.join(', ')}</div>
          </div>
        )}
        {gearResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">{gearResult.genre} · {gearResult.budget}</div>
            <div className="text-[12px] text-cyan-200 mt-1">📷 {gearResult.recommendation.lens}</div>
            <div className="text-[11px] text-zinc-300">💡 {gearResult.recommendation.lighting}</div>
            <div className="text-[11px] text-zinc-300">🎒 {gearResult.recommendation.accessory}</div>
            <div className="text-[10px] text-cyan-300 italic mt-1">{gearResult.tip}</div>
          </div>
        )}
        {printResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Print · {printResult.quality}</div>
            <div className="text-2xl font-bold text-purple-300">{printResult.megapixels} <span className="text-xs text-zinc-400">MP</span></div>
            <div className="text-[10px] text-zinc-400">res {printResult.resolution}</div>
            <div className="text-[10px] text-purple-200">@300dpi: {printResult.maxPrintAt300DPI}</div>
            <div className="text-[10px] text-purple-200">@150dpi: {printResult.maxPrintAt150DPI}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Direction</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
