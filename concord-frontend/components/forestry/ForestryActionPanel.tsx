'use client';

/**
 * ForestryActionPanel — USDA + InciWeb-shape forestry workbench.
 * timberVolume / fireRisk / harvestPlan / carbonSequestration +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Trees, Ruler, Flame, Axe, Leaf, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('forestry', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'volume' | 'risk' | 'harvest' | 'carbon' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface VolumeResult { boardFeet?: number; cubicFeet?: number; valuation?: number }
interface RiskResult { riskLevel?: string; score?: number; factors?: string[] }
interface HarvestResult { schedule?: Array<{ year: number; acres: number; volume: number }>; rotation?: number }
interface CarbonResult { tonsPerYear?: number; lifetimeTons?: number; equivalentCars?: number }

export function ForestryActionPanel() {
  const [standName, setStandName] = useState('');
  const [species, setSpecies] = useState('');
  const [acres, setAcres] = useState('');
  const [age, setAge] = useState('');
  const [trees, setTrees] = useState('');
  const [tempF, setTempF] = useState('');
  const [humidity, setHumidity] = useState('');
  const [windMph, setWindMph] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [volumeResult, setVolumeResult] = useState<VolumeResult | null>(null);
  const [riskResult, setRiskResult] = useState<RiskResult | null>(null);
  const [harvestResult, setHarvestResult] = useState<HarvestResult | null>(null);
  const [carbonResult, setCarbonResult] = useState<CarbonResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actVolume() {
    const a = parseFloat(acres), ag = parseFloat(age), t = parseInt(trees, 10);
    if (!species.trim() || ![a, ag, t].every(Number.isFinite)) { err('Species + acres + age + tree count required.'); return; }
    setBusy('volume'); setFeedback(null);
    try {
      const r = await callMacro<VolumeResult>('timberVolume', { species, acres: a, avgAgeYears: ag, treeCount: t });
      if (r.ok && r.result) { setVolumeResult(r.result); pipe.publish('forestry.volume', r.result, { label: `${r.result.boardFeet?.toLocaleString()} bf` }); ok(`${r.result.boardFeet?.toLocaleString()} board ft.`); } else err(r.error ?? 'volume failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRisk() {
    const t = parseFloat(tempF), h = parseFloat(humidity), w = parseFloat(windMph);
    if (![t, h, w].every(Number.isFinite)) { err('Temp °F + humidity % + wind mph required.'); return; }
    setBusy('risk'); setFeedback(null);
    try {
      const r = await callMacro<RiskResult>('fireRisk', { tempF: t, humidity: h, windMph: w });
      if (r.ok && r.result) { setRiskResult(r.result); pipe.publish('forestry.risk', r.result, { label: `Risk ${r.result.riskLevel}` }); ok(`Risk: ${r.result.riskLevel}.`); } else err(r.error ?? 'risk failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actHarvest() {
    const a = parseFloat(acres), ag = parseFloat(age);
    if (!species.trim() || ![a, ag].every(Number.isFinite)) { err('Species + acres + age required.'); return; }
    setBusy('harvest'); setFeedback(null);
    try {
      const r = await callMacro<HarvestResult>('harvestPlan', { species, acres: a, currentAge: ag });
      if (r.ok && r.result) { setHarvestResult(r.result); pipe.publish('forestry.harvest', r.result, { label: `Harvest ${r.result.schedule?.length ?? 0}yr` }); ok(`${r.result.schedule?.length ?? 0}-year plan.`); } else err(r.error ?? 'harvest failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCarbon() {
    const a = parseFloat(acres), ag = parseFloat(age);
    if (!species.trim() || ![a, ag].every(Number.isFinite)) { err('Species + acres + age required.'); return; }
    setBusy('carbon'); setFeedback(null);
    try {
      const r = await callMacro<CarbonResult>('carbonSequestration', { species, acres: a, ageYears: ag });
      if (r.ok && r.result) { setCarbonResult(r.result); pipe.publish('forestry.carbon', r.result, { label: `Carbon ${r.result.tonsPerYear}t/yr` }); ok(`${r.result.tonsPerYear} t/yr CO₂.`); } else err(r.error ?? 'carbon failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Forest stand — ${standName.trim() || species}`, tags: ['forestry', species], source: 'forestry:stand:mint', meta: { visibility: 'private', consent: { allowCitations: false }, stand: { name: standName, species, acres: parseFloat(acres), volume: volumeResult, risk: riskResult, harvest: harvestResult, carbon: carbonResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('forestry.mintedDtuId', id, { label: `Stand DTU ${id.slice(0, 8)}…` }); ok(`Stand DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🌲 Stand: ${standName || species}`, '', `${acres} acres · age ${age}y`,
      volumeResult ? `Volume: ${volumeResult.boardFeet?.toLocaleString()} bf · $${volumeResult.valuation?.toLocaleString()}` : '',
      riskResult ? `Fire risk: ${riskResult.riskLevel}` : '',
      carbonResult ? `Carbon: ${carbonResult.tonsPerYear} t/yr` : '',
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
    if (!carbonResult) { err('Run carbon estimate first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Carbon record — ${species} ${acres}ac`, tags: ['forestry', 'carbon', 'public'], source: 'forestry:carbon:publish', meta: { visibility: 'public', consent: { allowCitations: true }, carbon: carbonResult, species, acres: parseFloat(acres) } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('forestry.publishedDtuId', id, { label: `Public carbon ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Forest stand: ${standName || species} (${acres}ac, age ${age}y). ${riskResult ? `Fire risk: ${riskResult.riskLevel}.` : ''} ${carbonResult ? `Sequestration: ${carbonResult.tonsPerYear} t/yr.` : ''} Suggest the single best stewardship move for this season (thinning, fuel reduction, replant, or hold). Plain text.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Stewardship move ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'volume' as ActionId, label: 'Volume', desc: 'timberVolume + valuation', icon: Ruler, accent: '#22c55e', handler: actVolume },
    { id: 'risk' as ActionId, label: 'Fire risk', desc: 'fireRisk by weather', icon: Flame, accent: '#ef4444', handler: actRisk },
    { id: 'harvest' as ActionId, label: 'Harvest', desc: 'harvestPlan rotation schedule', icon: Axe, accent: '#f97316', handler: actHarvest },
    { id: 'carbon' as ActionId, label: 'Carbon', desc: 'carbonSequestration t/yr', icon: Leaf, accent: '#06b6d4', handler: actCarbon },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private stand DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send stand brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public carbon record + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Steward', desc: 'Agent: best stewardship move', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-green-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-green-500/10 pb-2">
        <Trees className="h-4 w-4 text-green-400" />
        <h3 className="text-sm font-semibold text-white">Forestry workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">USDA · inciweb</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <input type="text" value={standName} onChange={(e) => setStandName(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Stand name" />
        <select value={species} onChange={(e) => setSpecies(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          {['douglas-fir', 'ponderosa-pine', 'redwood', 'oak', 'maple', 'hemlock', 'cedar', 'aspen'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="text" value={acres} onChange={(e) => setAcres(e.target.value.replace(/[^\d.]/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Acres" />
        <input type="text" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Avg age yrs" />
        <input type="text" value={trees} onChange={(e) => setTrees(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Tree count" />
        <input type="text" value={tempF} onChange={(e) => setTempF(e.target.value.replace(/[^\d.]/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Temp °F" />
        <input type="text" value={humidity} onChange={(e) => setHumidity(e.target.value.replace(/[^\d.]/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Humidity %" />
        <input type="text" value={windMph} onChange={(e) => setWindMph(e.target.value.replace(/[^\d.]/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Wind mph" />
        <div className="md:col-span-2 flex items-center gap-2 flex-wrap">
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {volumeResult && <Tile label="Volume" big={`${(volumeResult.boardFeet ?? 0).toLocaleString()}`} sub={`bf · $${volumeResult.valuation?.toLocaleString()}`} accent="#22c55e" />}
        {riskResult && <Tile label="Fire risk" big={riskResult.riskLevel ?? '—'} sub={`score ${riskResult.score}`} accent={riskResult.riskLevel === 'high' || riskResult.riskLevel === 'extreme' ? '#ef4444' : riskResult.riskLevel === 'moderate' ? '#eab308' : '#22c55e'} />}
        {harvestResult && <Tile label="Harvest" big={`${harvestResult.schedule?.length}y`} sub={`rotation ${harvestResult.rotation}y`} accent="#f97316" />}
        {carbonResult && <Tile label="Carbon" big={`${carbonResult.tonsPerYear}t`} sub={`/yr · ${carbonResult.equivalentCars} cars equiv`} accent="#06b6d4" />}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Stewardship</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}

function Tile({ label, big, sub, accent }: { label: string; big: string; sub?: string; accent: string }) {
  return (<div className="rounded-md border p-2.5" style={{ borderColor: accent + '60', backgroundColor: accent + '10' }}><div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">{label}</div><div className="text-xl font-bold truncate" style={{ color: accent }}>{big}</div>{sub && <div className="text-[10px] text-zinc-400 truncate">{sub}</div>}</div>);
}
