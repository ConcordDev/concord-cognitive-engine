'use client';

/**
 * GeologyActionPanel — field-geologist bench.
 * rockClassify / recent-earthquakes (real USGS) / seismicRisk / usgs-seismic-hazard (real USGS DESIGNMAPS) +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Mountain, Waves, Activity, Database, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, payload: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('geology', action, payload);
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'rock' | 'quakes' | 'risk' | 'design' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface RockResult { specimen: string; rockType: string; mohsHardness: number; luster: string; color: string; texture: string; durability: string; commonUses: string[] }
interface QuakeEvent { id: string; magnitude: number; place: string; time: string | null; depthKm: number; tsunami: boolean; alert: string | null; sig: number; mmi: number | null }
interface QuakeResult { events: QuakeEvent[]; count: number; sinceHours: number; source: string }
interface RiskResult { location: { lat: number; lon: number }; soilType: string; amplificationFactor: number; baseSeismicRisk: number; adjustedRisk: number; riskLevel: string; recommendations: string[] }
interface DesignResult { location: { lat: number; lng: number }; riskCategory: number; siteClass: string; ss: number; s1: number; sds: number; sd1: number; sdc: string; pga: number; source: string }

const DEFAULT_ROCK = JSON.stringify({ name: 'unknown specimen', mohsHardness: 7, luster: 'vitreous', color: 'gray', texture: 'crystalline' }, null, 2);
const DEFAULT_QUAKES = JSON.stringify({ minMagnitude: 4.0, sinceHours: 48, limit: 20 }, null, 2);
const DEFAULT_RISK = JSON.stringify({ latitude: 37.77, longitude: -122.42, soilType: 'soft-soil', buildingCode: 'IBC 2021' }, null, 2);
const DEFAULT_DESIGN = JSON.stringify({ latitude: 37.77, longitude: -122.42, riskCategory: 2, siteClass: 'D' }, null, 2);

export function GeologyActionPanel() {
  const [rockText, setRockText] = useState(DEFAULT_ROCK);
  const [quakeText, setQuakeText] = useState(DEFAULT_QUAKES);
  const [riskText, setRiskText] = useState(DEFAULT_RISK);
  const [designText, setDesignText] = useState(DEFAULT_DESIGN);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [rockResult, setRockResult] = useState<RockResult | null>(null);
  const [quakeResult, setQuakeResult] = useState<QuakeResult | null>(null);
  const [riskResult, setRiskResult] = useState<RiskResult | null>(null);
  const [designResult, setDesignResult] = useState<DesignResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actRock() {
    try { const parsed = JSON.parse(rockText); setBusy('rock'); setFeedback(null);
      const r = await callMacro<RockResult>('rockClassify', { artifact: { data: parsed } });
      if (r.ok && r.result) { setRockResult(r.result); ok(`${r.result.rockType} · Mohs ${r.result.mohsHardness} · ${r.result.durability}`); } else err(r.error ?? 'rock failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid rock JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actQuakes() {
    try { const parsed = JSON.parse(quakeText); setBusy('quakes'); setFeedback(null);
      const r = await callMacro<QuakeResult>('recent-earthquakes', { params: parsed });
      if (r.ok && r.result) { setQuakeResult(r.result); ok(`${r.result.count} events in last ${r.result.sinceHours}h`); } else err(r.error ?? 'quakes failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid quake params.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRisk() {
    try { const parsed = JSON.parse(riskText); setBusy('risk'); setFeedback(null);
      const r = await callMacro<RiskResult>('seismicRisk', { artifact: { data: parsed } });
      if (r.ok && r.result) { setRiskResult(r.result); ok(`${r.result.adjustedRisk}% adjusted · ${r.result.riskLevel}`); } else err(r.error ?? 'risk failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid risk JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDesign() {
    try { const parsed = JSON.parse(designText); setBusy('design'); setFeedback(null);
      const r = await callMacro<DesignResult>('usgs-seismic-hazard', { params: parsed });
      if (r.ok && r.result) { setDesignResult(r.result); ok(`SDC ${r.result.sdc} · Sds ${r.result.sds}`); } else err(r.error ?? 'design failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid design params.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Geology brief`, tags: ['geology', rockResult?.rockType, riskResult?.riskLevel].filter((t): t is string => !!t), source: 'geology:brief:mint', meta: { visibility: 'private', consent: { allowCitations: false }, geology: { rock: rockResult, quakes: quakeResult, risk: riskResult, design: designResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Brief DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`⛰ Geology brief`, '', rockResult ? `Rock: ${rockResult.rockType} · Mohs ${rockResult.mohsHardness} · ${rockResult.durability}` : '', quakeResult ? `Quakes: ${quakeResult.count} events in last ${quakeResult.sinceHours}h (max M${Math.max(...quakeResult.events.map(e => e.magnitude || 0)).toFixed(1)})` : '', riskResult ? `Site risk: ${riskResult.adjustedRisk}% · ${riskResult.riskLevel}` : '', designResult ? `ASCE 7: SDC ${designResult.sdc} · Sds ${designResult.sds}g · Sd1 ${designResult.sd1}g` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!quakeResult && !riskResult) { err('Run quakes or risk first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Site geology card`, tags: ['geology', 'site', 'public'], source: 'geology:site:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, geology: { rock: rockResult, risk: riskResult, design: designResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Engineering geologist brief. ${rockResult ? `Specimen: ${rockResult.rockType} (Mohs ${rockResult.mohsHardness}, ${rockResult.durability}).` : ''} ${quakeResult ? `${quakeResult.count} recent quakes (last ${quakeResult.sinceHours}h).` : ''} ${riskResult ? `Site risk: ${riskResult.riskLevel} (${riskResult.adjustedRisk}%); soil ${riskResult.soilType}, amplification ${riskResult.amplificationFactor}×.` : ''} ${designResult ? `ASCE 7 SDC ${designResult.sdc}, Sds=${designResult.sds}g.` : ''} Recommend the strongest foundation/site-prep consideration + one inspection cadence. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Geologist brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'rock' as ActionId, label: 'Rock', desc: 'rockClassify', icon: Mountain, accent: '#a16207', handler: actRock },
    { id: 'quakes' as ActionId, label: 'Quakes', desc: 'USGS catalog (real)', icon: Waves, accent: '#dc2626', handler: actQuakes },
    { id: 'risk' as ActionId, label: 'Site risk', desc: 'seismicRisk', icon: Activity, accent: '#f59e0b', handler: actRisk },
    { id: 'design' as ActionId, label: 'ASCE 7', desc: 'usgs-seismic-hazard', icon: Database, accent: '#a855f7', handler: actDesign },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private brief', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon site card', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Geologist', desc: 'Agent: foundation tip', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const RISK_COLOR: Record<string, string> = { high: 'text-red-300', moderate: 'text-amber-300', low: 'text-emerald-300' };
  const ALERT_COLOR: Record<string, string> = { red: 'text-red-300', orange: 'text-orange-300', yellow: 'text-yellow-300', green: 'text-emerald-300' };

  return (
    <div className="rounded-lg border border-amber-700/30 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-700/20 pb-2">
        <Mountain className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold text-white">Field geologist bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">rock · quakes · risk · ASCE 7</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Rock specimen JSON</label>
          <textarea value={rockText} onChange={(e) => setRockText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Quake params (real USGS API)</label>
          <textarea value={quakeText} onChange={(e) => setQuakeText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-yellow-400 font-semibold">Site risk JSON</label>
          <textarea value={riskText} onChange={(e) => setRiskText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">ASCE 7 params (real DESIGNMAPS)</label>
          <textarea value={designText} onChange={(e) => setDesignText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient user-id" />
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
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {rockResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Rock · {rockResult.rockType}</div>
            <div className="text-2xl font-bold text-amber-200">Mohs {rockResult.mohsHardness}</div>
            <div className="text-[10px] text-zinc-300">{rockResult.color} · {rockResult.luster} · {rockResult.texture}</div>
            <div className="text-[10px] text-zinc-400 mt-1">Durability: {rockResult.durability}</div>
            <div className="flex flex-wrap gap-1 mt-1">{rockResult.commonUses.map((u, i) => <span key={i} className="px-1.5 py-0.5 rounded bg-zinc-800 text-[9px] text-amber-200">{u}</span>)}</div>
          </div>
        )}
        {quakeResult && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">USGS · last {quakeResult.sinceHours}h</div>
            <div className="text-2xl font-bold text-red-200">{quakeResult.count}</div>
            <div className="text-[10px] text-zinc-500">{quakeResult.source}</div>
            {quakeResult.events.slice(0, 6).map((q, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span className="truncate flex-1"><strong className={cn(q.magnitude >= 5 ? 'text-red-300' : q.magnitude >= 4 ? 'text-amber-300' : 'text-zinc-300')}>M{q.magnitude?.toFixed(1)}</strong> {q.place}</span>{q.alert && <span className={cn('font-mono text-[9px]', ALERT_COLOR[q.alert])}>{q.alert}</span>}{q.tsunami && <span className="text-blue-300 ml-1">🌊</span>}</div>)}
          </div>
        )}
        {riskResult && (
          <div className={cn('rounded-md border p-2.5', riskResult.riskLevel === 'high' ? 'border-red-500/40 bg-red-500/10' : riskResult.riskLevel === 'moderate' ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-yellow-300 font-semibold">Site risk · {riskResult.riskLevel}</div>
            <div className={cn('text-3xl font-bold', RISK_COLOR[riskResult.riskLevel])}>{riskResult.adjustedRisk}<span className="text-xs text-zinc-400">%</span></div>
            <div className="text-[10px] text-zinc-300">Soil: {riskResult.soilType} · amp {riskResult.amplificationFactor}×</div>
            <div className="text-[10px] text-zinc-500">Base risk: {riskResult.baseSeismicRisk}%</div>
            {riskResult.recommendations.slice(0, 2).map((r, i) => <div key={i} className="text-[10px] text-yellow-200 mt-0.5">→ {r}</div>)}
          </div>
        )}
        {designResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">ASCE 7 · SDC {designResult.sdc}</div>
            <div className="text-2xl font-bold text-purple-200">{designResult.sds}<span className="text-xs text-zinc-400">g</span></div>
            <div className="text-[10px] text-zinc-300">Sd1 {designResult.sd1}g · Ss {designResult.ss}g · S1 {designResult.s1}g</div>
            <div className="text-[10px] text-zinc-500">Risk Cat {designResult.riskCategory} · Site {designResult.siteClass}</div>
            <div className="text-[10px] text-zinc-500">PGA {designResult.pga}g</div>
            <div className="text-[10px] text-zinc-500 mt-1 italic">{designResult.source}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Geologist brief</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
