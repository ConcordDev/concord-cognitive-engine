'use client';

/**
 * EcoActionPanel — ecology / sustainability bench.
 * carbonFootprint / biodiversityIndex / sustainabilityScore / aqi-current (real open-meteo) +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Leaf, Squirrel, TrendingUp, Wind, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, payload: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('eco', action, payload);
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'carbon' | 'bio' | 'sust' | 'aqi' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface CarbonResult { totalKgCO2e?: number; perCategory?: Record<string, number>; comparisonToAverage?: number; offsetCost?: number; recommendations?: string[]; classification?: string }
interface BioResult { speciesCount?: number; shannonIndex?: number; simpsonIndex?: number; evenness?: number; dominantSpecies?: { species: string; abundance: number }[]; healthLabel?: string }
interface SustResult { overallScore?: number; rating?: string; dimensions?: { name: string; score: number }[]; strengths?: string[]; weaknesses?: string[] }
interface AqiResult { aqi?: number; level?: string; pm2_5?: number; pm10?: number; o3?: number; no2?: number; source?: string; recommendation?: string }

const DEFAULT_CARBON = JSON.stringify({ activities: [{ category: 'travel', subtype: 'car-gas', value: 14000, unit: 'miles' }, { category: 'travel', subtype: 'flights-economy', value: 12000, unit: 'miles' }, { category: 'energy', subtype: 'electricity-grid', value: 8500, unit: 'kWh' }, { category: 'food', subtype: 'beef', value: 45, unit: 'kg' }, { category: 'food', subtype: 'dairy', value: 100, unit: 'kg' }, { category: 'goods', subtype: 'electronics', value: 1200, unit: 'usd' }] }, null, 2);
const DEFAULT_BIO = JSON.stringify({ species: [{ name: 'oak', count: 24 }, { name: 'maple', count: 18 }, { name: 'pine', count: 12 }, { name: 'beech', count: 8 }, { name: 'birch', count: 6 }, { name: 'cedar', count: 3 }, { name: 'aspen', count: 1 }] }, null, 2);
const DEFAULT_SUST = JSON.stringify({ activities: { renewable: 0.6, waste_diverted: 0.75, water_per_capita: 88, transit_share: 0.42, biodiversity_protected: 0.31 } }, null, 2);
const DEFAULT_AQI = JSON.stringify({ latitude: 37.77, longitude: -122.42 }, null, 2);

export function EcoActionPanel() {
  const [carbonText, setCarbonText] = useState(DEFAULT_CARBON);
  const [bioText, setBioText] = useState(DEFAULT_BIO);
  const [sustText, setSustText] = useState(DEFAULT_SUST);
  const [aqiText, setAqiText] = useState(DEFAULT_AQI);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [carbonResult, setCarbonResult] = useState<CarbonResult | null>(null);
  const [bioResult, setBioResult] = useState<BioResult | null>(null);
  const [sustResult, setSustResult] = useState<SustResult | null>(null);
  const [aqiResult, setAqiResult] = useState<AqiResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actCarbon() {
    try { const parsed = JSON.parse(carbonText); setBusy('carbon'); setFeedback(null);
      const r = await callMacro<CarbonResult>('carbonFootprint', { artifact: { data: parsed } });
      if (r.ok && r.result) { setCarbonResult(r.result); ok(`${r.result.totalKgCO2e?.toFixed?.(0) ?? '?'}kg CO₂e · ${r.result.classification ?? '?'}`); } else err(r.error ?? 'carbon failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid carbon JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actBio() {
    try { const parsed = JSON.parse(bioText); setBusy('bio'); setFeedback(null);
      const r = await callMacro<BioResult>('biodiversityIndex', { artifact: { data: parsed } });
      if (r.ok && r.result) { setBioResult(r.result); ok(`Shannon ${r.result.shannonIndex?.toFixed?.(2)} · ${r.result.healthLabel ?? '?'}`); } else err(r.error ?? 'bio failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid bio JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSust() {
    try { const parsed = JSON.parse(sustText); setBusy('sust'); setFeedback(null);
      const r = await callMacro<SustResult>('sustainabilityScore', { artifact: { data: parsed } });
      if (r.ok && r.result) { setSustResult(r.result); ok(`${r.result.overallScore ?? '?'}/100 · ${r.result.rating ?? '?'}`); } else err(r.error ?? 'sust failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid sust JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAqi() {
    try { const parsed = JSON.parse(aqiText); setBusy('aqi'); setFeedback(null);
      const r = await callMacro<AqiResult>('aqi-current', { params: parsed });
      if (r.ok && r.result) { setAqiResult(r.result); ok(`AQI ${r.result.aqi ?? '?'} · ${r.result.level ?? '?'}`); } else err(r.error ?? 'aqi failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid aqi JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Eco snapshot`, tags: ['eco', sustResult?.rating, aqiResult?.level].filter((t): t is string => !!t), source: 'eco:snapshot:mint', meta: { visibility: 'private', consent: { allowCitations: false }, eco: { carbon: carbonResult, bio: bioResult, sust: sustResult, aqi: aqiResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Eco DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🌱 Eco snapshot`, '', carbonResult ? `Carbon: ${carbonResult.totalKgCO2e?.toFixed?.(0) ?? '?'}kg CO₂e · ${carbonResult.classification ?? '?'} · offset ~$${carbonResult.offsetCost?.toFixed?.(0)}` : '', bioResult ? `Bio: Shannon ${bioResult.shannonIndex?.toFixed?.(2)} · evenness ${bioResult.evenness?.toFixed?.(2)} · ${bioResult.healthLabel ?? '?'}` : '', sustResult ? `Sustainability: ${sustResult.overallScore ?? '?'}/100 · ${sustResult.rating ?? '?'}` : '', aqiResult ? `AQI: ${aqiResult.aqi ?? '?'} (${aqiResult.level ?? '?'}) · PM2.5 ${aqiResult.pm2_5 ?? '?'}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!carbonResult && !sustResult) { err('Run a check first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Ecology report`, tags: ['eco', 'report', 'public'], source: 'eco:report:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, eco: { carbon: carbonResult, sust: sustResult, aqi: aqiResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Sustainability advisor brief. ${carbonResult ? `Carbon: ${carbonResult.totalKgCO2e?.toFixed?.(0) ?? '?'}kg CO₂e (${carbonResult.classification ?? '?'}).` : ''} ${bioResult ? `Biodiversity Shannon ${bioResult.shannonIndex?.toFixed?.(2)} (${bioResult.healthLabel ?? '?'}).` : ''} ${sustResult ? `Sustainability ${sustResult.overallScore ?? '?'}/100 (${sustResult.rating ?? '?'}); weak: ${sustResult.weaknesses?.[0] ?? 'n/a'}.` : ''} ${aqiResult ? `AQI ${aqiResult.aqi ?? '?'} (${aqiResult.level ?? '?'}).` : ''} Recommend the single highest-impact reduction + one habit-level action. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Advisor brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'carbon' as ActionId, label: 'Carbon', desc: 'carbonFootprint', icon: Leaf, accent: '#15803d', handler: actCarbon },
    { id: 'bio' as ActionId, label: 'Bio', desc: 'biodiversityIndex (Shannon)', icon: Squirrel, accent: '#a16207', handler: actBio },
    { id: 'sust' as ActionId, label: 'Sustain', desc: 'sustainabilityScore', icon: TrendingUp, accent: '#22c55e', handler: actSust },
    { id: 'aqi' as ActionId, label: 'AQI', desc: 'open-meteo (real)', icon: Wind, accent: '#3b82f6', handler: actAqi },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private snapshot', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send snapshot', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon report', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Advisor', desc: 'Agent: top reduction', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const AQI_COLOR: Record<string, string> = { good: 'text-emerald-300', moderate: 'text-amber-300', 'unhealthy-sensitive': 'text-orange-300', unhealthy: 'text-red-300', 'very-unhealthy': 'text-purple-300', hazardous: 'text-red-500' };

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <Leaf className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Ecology / sustainability bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">carbon · bio · sustain · AQI</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">Activities JSON</label>
          <textarea value={carbonText} onChange={(e) => setCarbonText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Species JSON</label>
          <textarea value={bioText} onChange={(e) => setBioText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Sustainability JSON</label>
          <textarea value={sustText} onChange={(e) => setSustText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">AQI params (real API)</label>
          <textarea value={aqiText} onChange={(e) => setAqiText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
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
        {carbonResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Carbon · {carbonResult.classification ?? '?'}</div>
            <div className="text-2xl font-bold text-emerald-200">{carbonResult.totalKgCO2e?.toFixed?.(0) ?? '?'}<span className="text-xs text-zinc-400">kg</span></div>
            <div className="text-[10px] text-zinc-300">vs avg: {carbonResult.comparisonToAverage ? `${(carbonResult.comparisonToAverage * 100).toFixed(0)}%` : '—'} · offset ~${carbonResult.offsetCost?.toFixed?.(0) ?? '?'}</div>
            {carbonResult.perCategory && Object.entries(carbonResult.perCategory).map(([k, v], i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>{k}</span><span className="font-mono text-emerald-200">{v?.toFixed?.(0) ?? '?'}kg</span></div>)}
            {carbonResult.recommendations?.slice(0, 2).map((r, i) => <div key={i} className="text-[10px] text-emerald-200 mt-0.5">→ {r}</div>)}
          </div>
        )}
        {bioResult && (
          <div className="rounded-md border border-amber-700/30 bg-amber-900/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Bio · {bioResult.healthLabel ?? '?'}</div>
            <div className="text-2xl font-bold text-amber-200">{bioResult.shannonIndex?.toFixed?.(2) ?? '?'}<span className="text-xs text-zinc-400"> H</span></div>
            <div className="text-[10px] text-zinc-300">{bioResult.speciesCount ?? '?'} species · Simpson {bioResult.simpsonIndex?.toFixed?.(2)} · evenness {bioResult.evenness?.toFixed?.(2)}</div>
            {bioResult.dominantSpecies?.slice(0, 5).map((s, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>{s.species}</span><span className="font-mono text-amber-200">{(s.abundance * 100).toFixed(1)}%</span></div>)}
          </div>
        )}
        {sustResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Sustain · {sustResult.rating ?? '?'}</div>
            <div className={cn('text-3xl font-bold', (sustResult.overallScore ?? 0) >= 70 ? 'text-emerald-300' : (sustResult.overallScore ?? 0) >= 40 ? 'text-amber-300' : 'text-red-300')}>{sustResult.overallScore ?? '?'}</div>
            {sustResult.dimensions?.slice(0, 5).map((d, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>{d.name}</span><span className="font-mono text-green-200">{d.score}</span></div>)}
            {sustResult.weaknesses?.slice(0, 2).map((w, i) => <div key={i} className="text-[10px] text-red-300 mt-0.5">⚠ {w}</div>)}
          </div>
        )}
        {aqiResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">AQI · {aqiResult.level ?? '?'}</div>
            <div className={cn('text-3xl font-bold', AQI_COLOR[aqiResult.level ?? 'good'])}>{aqiResult.aqi ?? '?'}</div>
            <div className="text-[10px] text-zinc-300">PM2.5 {aqiResult.pm2_5 ?? '?'} · PM10 {aqiResult.pm10 ?? '?'}</div>
            <div className="text-[10px] text-zinc-500">O₃ {aqiResult.o3 ?? '?'} · NO₂ {aqiResult.no2 ?? '?'}</div>
            {aqiResult.recommendation && <div className="text-[10px] text-blue-200 mt-1 italic">{aqiResult.recommendation}</div>}
            <div className="text-[10px] text-zinc-500 mt-1 italic">{aqiResult.source ?? ''}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Sustainability advisor</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
