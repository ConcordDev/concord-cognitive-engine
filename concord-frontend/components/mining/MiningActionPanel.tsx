'use client';

/**
 * MiningActionPanel — MSHA + USGS-shape mining workbench.
 * oreGradeCalc / blastDesign / safetyMetrics / resourceEstimate +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Hammer, BarChart3, Bomb, ShieldAlert, Calculator, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('mining', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'grade' | 'blast' | 'safety' | 'resource' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface GradeResult { samples?: number; avgGrade?: number; classification?: string; economicPercent?: number }
interface BlastResult { tonsPerHole?: number; explosiveKgPerHole?: number; fragmentationExpected?: string }
interface SafetyResult { trir?: number; ltir?: number; safetyRating?: string; belowIndustry?: boolean }
interface ResourceResult { totalTonnage?: number; recoverableMetal?: number; grossValue?: number; category?: string }

export function MiningActionPanel() {
  const [mineName, setMineName] = useState('');
  const [samples, setSamples] = useState('');
  const [hoursWorked, setHoursWorked] = useState('');
  const [incidents, setIncidents] = useState('');
  const [lostTime, setLostTime] = useState('');
  const [volume, setVolume] = useState('');
  const [grade, setGrade] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [blastResult, setBlastResult] = useState<BlastResult | null>(null);
  const [safetyResult, setSafetyResult] = useState<SafetyResult | null>(null);
  const [resourceResult, setResourceResult] = useState<ResourceResult | null>(null);
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

  async function actGrade() {
    const s = samples.split('\n').map(l => { const m = l.trim().match(/^(\S+)\s+([\d.]+)$/); return m ? { id: m[1], grade: parseFloat(m[2]) } : null; }).filter(Boolean);
    if (!s.length) { err('Add ore samples.'); return; }
    setBusy('grade'); setFeedback(null);
    try { const r = await callMacro<GradeResult>('oreGradeCalc', { samples: s }); if (r.ok && r.result) { setGradeResult(r.result); pipe.publish('mining.grade', r.result, { label: r.result.classification ?? 'grade' }); ok(`${r.result.classification}.`); } else err(r.error ?? 'grade failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actBlast() {
    setBusy('blast'); setFeedback(null);
    try { const r = await callMacro<BlastResult>('blastDesign', {}); if (r.ok && r.result) { setBlastResult(r.result); pipe.publish('mining.blast', r.result, { label: `${r.result.tonsPerHole}t/hole` }); ok(`${r.result.tonsPerHole}t per hole.`); } else err(r.error ?? 'blast failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSafety() {
    setBusy('safety'); setFeedback(null);
    try { const r = await callMacro<SafetyResult>('safetyMetrics', { hoursWorked: parseInt(hoursWorked, 10), incidents: parseInt(incidents, 10), lostTimeIncidents: parseInt(lostTime, 10) }); if (r.ok && r.result) { setSafetyResult(r.result); pipe.publish('mining.safety', r.result, { label: `TRIR ${r.result.trir}` }); ok(`TRIR: ${r.result.trir}.`); } else err(r.error ?? 'safety failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actResource() {
    setBusy('resource'); setFeedback(null);
    try { const r = await callMacro<ResourceResult>('resourceEstimate', { volumeM3: parseFloat(volume), avgGradePercent: parseFloat(grade) }); if (r.ok && r.result) { setResourceResult(r.result); pipe.publish('mining.resource', r.result, { label: `$${r.result.grossValue?.toLocaleString()}` }); ok(`$${r.result.grossValue?.toLocaleString()}.`); } else err(r.error ?? 'resource failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Mining — ${mineName.trim() || 'site'}`, tags: ['mining', gradeResult?.classification ?? 'unclassified'], source: 'mining:site:mint', meta: { visibility: 'private', consent: { allowCitations: false }, mining: { name: mineName, grade: gradeResult, blast: blastResult, safety: safetyResult, resource: resourceResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('mining.mintedDtuId', id, { label: `site ${id.slice(0, 8)}` }); ok(`Site DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`⛏ Mining brief: ${mineName || 'site'}`, '', gradeResult ? `Ore: ${gradeResult.classification} (avg ${gradeResult.avgGrade}%)` : '', safetyResult ? `Safety: TRIR ${safetyResult.trir} (${safetyResult.safetyRating})` : '', resourceResult ? `Resource: $${resourceResult.grossValue?.toLocaleString()} gross (${resourceResult.category})` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
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
    if (!safetyResult) { err('Run safety metrics first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Safety record — TRIR ${safetyResult.trir}`, tags: ['mining', 'safety', 'public'], source: 'mining:safety:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anonymized: true, safety: safetyResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('mining.publishedDtuId', id, { label: `record ${id.slice(0, 8)}` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Mining site: ${mineName || 'unnamed'}. ${gradeResult ? `Ore: ${gradeResult.classification}.` : ''} ${safetyResult ? `Safety: TRIR ${safetyResult.trir}.` : ''} ${resourceResult ? `Resource: $${resourceResult.grossValue}.` : ''} Suggest the single highest-leverage operational improvement. Plain text.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Move ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'grade' as ActionId, label: 'Ore grade', desc: 'oreGradeCalc samples', icon: BarChart3, accent: '#22c55e', handler: actGrade },
    { id: 'blast' as ActionId, label: 'Blast', desc: 'blastDesign hole + explosive', icon: Bomb, accent: '#ef4444', handler: actBlast },
    { id: 'safety' as ActionId, label: 'Safety', desc: 'safetyMetrics TRIR/LTIR', icon: ShieldAlert, accent: '#eab308', handler: actSafety },
    { id: 'resource' as ActionId, label: 'Resource', desc: 'resourceEstimate $ value', icon: Calculator, accent: '#06b6d4', handler: actResource },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private site DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief to ops manager', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anonymized safety + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Improve', desc: 'Agent: top operational move', icon: Wand2, accent: '#f97316', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-stone-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-stone-500/10 pb-2">
        <Hammer className="h-4 w-4 text-stone-400" />
        <h3 className="text-sm font-semibold text-white">Mine workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">msha · usgs</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <input type="text" value={mineName} onChange={(e) => setMineName(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Mine name" />
        <input type="text" value={hoursWorked} onChange={(e) => setHoursWorked(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Hours worked" />
        <input type="text" value={incidents} onChange={(e) => setIncidents(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Incidents" />
        <input type="text" value={lostTime} onChange={(e) => setLostTime(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="LTI" />
        <input type="text" value={volume} onChange={(e) => setVolume(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Volume m³" />
        <input type="text" value={grade} onChange={(e) => setGrade(e.target.value.replace(/[^\d.]/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Avg grade %" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Ore samples (id grade%)</label><textarea value={samples} onChange={(e) => setSamples(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-stone-200 font-mono focus:outline-none focus:ring-2 focus:ring-stone-400/40 resize-none" /></div>

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
        {gradeResult && <Tile label="Ore" big={`${gradeResult.avgGrade}%`} sub={`${gradeResult.classification} · ${gradeResult.economicPercent}% econ`} accent="#22c55e" />}
        {blastResult && <Tile label="Blast" big={`${blastResult.tonsPerHole}t`} sub={`${blastResult.explosiveKgPerHole}kg · ${blastResult.fragmentationExpected}`} accent="#ef4444" />}
        {safetyResult && <Tile label="Safety" big={`TRIR ${safetyResult.trir}`} sub={safetyResult.safetyRating} accent="#eab308" />}
        {resourceResult && <Tile label="Resource" big={`$${(resourceResult.grossValue ?? 0).toLocaleString()}`} sub={resourceResult.category} accent="#06b6d4" />}
      </div>

      {agentReply && (<div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-orange-300 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Improvement</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}

function Tile({ label, big, sub, accent }: { label: string; big: string; sub?: string; accent: string }) {
  return (<div className="rounded-md border p-2.5" style={{ borderColor: accent + '60', backgroundColor: accent + '10' }}><div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">{label}</div><div className="text-xl font-bold truncate" style={{ color: accent }}>{big}</div>{sub && <div className="text-[10px] text-zinc-400 truncate">{sub}</div>}</div>);
}
