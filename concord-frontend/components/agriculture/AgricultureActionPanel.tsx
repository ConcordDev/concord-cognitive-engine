'use client';

/**
 * AgricultureActionPanel — farm operator bench.
 * weather-for-field (open-meteo with soil moisture + ET0) /
 * rotationPlan / waterSchedule / predict-yield + mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Sprout, Cloud, Droplet, TrendingUp, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('agriculture', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'wx' | 'rot' | 'water' | 'yield' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface WxToday { tempMax?: number; tempMin?: number; precipSum?: number; et0?: number }
interface WxDay { date: string; tempMax?: number; tempMin?: number; precip?: number; et0?: number }
interface WxResult { lat: number; lng: number; today: WxToday; forecast7: WxDay[]; currentSoilMoisture?: number; currentSoilTemp?: number; source?: string }
interface RotPlan { season: string; crop?: string; rotationFamily?: string; notes?: string }
interface RotResult { plan?: RotPlan[]; familySpread?: string[]; warnings?: string[]; coverCrops?: string[] }
interface WaterResult { totalGallons?: number; perPlantLiters?: number; frequency?: string; nextWatering?: string; warning?: string }
interface YieldResult { predictedYield?: number; unit?: string; confidence?: string; assumedConditions?: Record<string, string | number>; risks?: string[] }

export function AgricultureActionPanel() {
  const [lat, setLat] = useState('37.7749');
  const [lng, setLng] = useState('-122.4194');
  const [acres, setAcres] = useState('40');
  const [crop, setCrop] = useState('corn');
  const [prevCrop, setPrevCrop] = useState('soybean');
  const [plantCount, setPlantCount] = useState('500');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [wxResult, setWxResult] = useState<WxResult | null>(null);
  const [rotResult, setRotResult] = useState<RotResult | null>(null);
  const [waterResult, setWaterResult] = useState<WaterResult | null>(null);
  const [yieldResult, setYieldResult] = useState<YieldResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actWx() {
    setBusy('wx'); setFeedback(null);
    try { const r = await callMacro<WxResult>('weather-for-field', { lat: parseFloat(lat), lng: parseFloat(lng) }); if (r.ok && r.result) { setWxResult(r.result); ok(`Today: ${r.result.today.tempMin}-${r.result.today.tempMax}°C · ${r.result.today.precipSum}mm rain.`); } else err(r.error ?? 'wx failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRot() {
    setBusy('rot'); setFeedback(null);
    try { const r = await callMacro<RotResult>('rotationPlan', { artifact: { data: { currentCrop: crop, previousCrops: [prevCrop], seasons: 4, soilType: 'loam' } } }); if (r.ok && r.result) { setRotResult(r.result); ok(`${r.result.plan?.length ?? 0} seasons planned.`); } else err(r.error ?? 'rotation failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actWater() {
    setBusy('water'); setFeedback(null);
    try { const r = await callMacro<WaterResult>('waterSchedule', { artifact: { data: { crop, plantCount: parseInt(plantCount, 10), waterPerPlantLiters: 2.5, recentRainfallMm: wxResult?.today?.precipSum ?? 0, evapotranspirationMmDay: wxResult?.today?.et0 ?? 4, soilMoisturePercent: wxResult?.currentSoilMoisture ? Math.round(wxResult.currentSoilMoisture * 100) : 50 } } }); if (r.ok && r.result) { setWaterResult(r.result); ok(`${r.result.frequency} · ${r.result.totalGallons} gal.`); } else err(r.error ?? 'water failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actYield() {
    setBusy('yield'); setFeedback(null);
    try { const r = await callMacro<YieldResult>('predict-yield', { artifact: { data: { crop, acres: parseFloat(acres), soilQuality: 75, plannedIrrigationMm: 250, plantingDate: new Date().toISOString().split('T')[0] } } }); if (r.ok && r.result) { setYieldResult(r.result); ok(`${r.result.predictedYield} ${r.result.unit} (${r.result.confidence}).`); } else err(r.error ?? 'yield failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Farm plan — ${crop} ${acres}ac`, tags: ['agriculture', 'farm', crop], source: 'agriculture:farm:mint', meta: { visibility: 'private', consent: { allowCitations: false }, ag: { crop, acres, lat, lng, wx: wxResult, rot: rotResult, water: waterResult, yield: yieldResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Farm DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🌾 Field brief`, '', wxResult ? `Wx: ${wxResult.today.tempMin}-${wxResult.today.tempMax}°C · ${wxResult.today.precipSum}mm · ET₀ ${wxResult.today.et0}mm · soil moist ${wxResult.currentSoilMoisture}` : '', rotResult ? `Rotation: ${rotResult.plan?.map(p => `${p.season}=${p.crop}`).join(', ')}` : '', waterResult ? `Water: ${waterResult.frequency} · ${waterResult.totalGallons} gal · next ${waterResult.nextWatering}` : '', yieldResult ? `Yield: ${yieldResult.predictedYield} ${yieldResult.unit} (${yieldResult.confidence})` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!yieldResult) { err('Run yield prediction first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Yield benchmark — ${crop}`, tags: ['agriculture', 'yield', 'benchmark', 'public'], source: 'agriculture:yield:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, crop, acres, yield: yieldResult } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Farm operator brief for ${crop} on ${acres} acres. ${wxResult ? `7-day forecast: ${wxResult.forecast7.slice(0, 3).map(d => `${d.date} ${d.tempMin}-${d.tempMax}°C ${d.precip}mm`).join('; ')}.` : ''} ${waterResult ? `Water need: ${waterResult.totalGallons} gal/cycle.` : ''} ${yieldResult ? `Predicted yield: ${yieldResult.predictedYield} ${yieldResult.unit}.` : ''} Identify the single most urgent operational action for the next 7 days + one risk. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Action ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'wx' as ActionId, label: 'Weather', desc: '7-day open-meteo', icon: Cloud, accent: '#3b82f6', handler: actWx },
    { id: 'rot' as ActionId, label: 'Rotation', desc: 'rotationPlan', icon: Sprout, accent: '#22c55e', handler: actRot },
    { id: 'water' as ActionId, label: 'Irrigation', desc: 'waterSchedule', icon: Droplet, accent: '#06b6d4', handler: actWater },
    { id: 'yield' as ActionId, label: 'Yield', desc: 'predict-yield', icon: TrendingUp, accent: '#f59e0b', handler: actYield },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private farm DTU', icon: Sparkles, accent: '#a855f7', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send field brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon yield bench', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Action', desc: 'Agent: 7-day op', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-green-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-green-500/10 pb-2">
        <Sprout className="h-4 w-4 text-green-400" />
        <h3 className="text-sm font-semibold text-white">Farm operator bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">open-meteo · rotation · irrigation · yield</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
        <input type="text" value={lat} onChange={(e) => setLat(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Lat" />
        <input type="text" value={lng} onChange={(e) => setLng(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Lng" />
        <input type="text" value={acres} onChange={(e) => setAcres(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Acres" />
        <input type="text" value={crop} onChange={(e) => setCrop(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="Current crop" />
        <input type="text" value={prevCrop} onChange={(e) => setPrevCrop(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="Previous crop" />
        <input type="text" value={plantCount} onChange={(e) => setPlantCount(e.target.value.replace(/\D/g, '') || '0')} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Plants" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
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
        {wxResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-48 overflow-y-auto md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Weather · 7-day · open-meteo</div>
            <div className="text-[11px] text-zinc-300 mt-1">Today: <span className="font-mono text-blue-200">{wxResult.today.tempMin}-{wxResult.today.tempMax}°C · {wxResult.today.precipSum}mm · ET₀ {wxResult.today.et0}mm</span></div>
            {wxResult.currentSoilMoisture != null && <div className="text-[10px] text-zinc-500">Soil: {Math.round((wxResult.currentSoilMoisture ?? 0) * 100)}% moist · {wxResult.currentSoilTemp}°C</div>}
            <div className="mt-1 grid grid-cols-7 gap-0.5">
              {wxResult.forecast7.slice(0, 7).map((d, i) => <div key={i} className="text-center text-[9px] text-zinc-400"><div className="font-mono text-blue-200">{d.date?.slice(5)}</div><div>{d.tempMin}-{d.tempMax}°</div><div className="text-cyan-300">{d.precip}mm</div></div>)}
            </div>
          </div>
        )}
        {rotResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Rotation</div>
            {(rotResult.plan ?? []).map((p, i) => <div key={i} className="text-[11px] text-zinc-300 mt-0.5"><span className="font-mono text-green-200">{p.season}</span>: {p.crop ?? '-'} <span className="text-zinc-500">({p.rotationFamily ?? '-'})</span></div>)}
            {(rotResult.warnings ?? []).length > 0 && <div className="text-[10px] text-amber-300 mt-1">⚠ {rotResult.warnings?.join('; ')}</div>}
            {(rotResult.coverCrops ?? []).length > 0 && <div className="text-[10px] text-emerald-300 mt-0.5">cover: {rotResult.coverCrops?.join(', ')}</div>}
          </div>
        )}
        {waterResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Irrigation · {waterResult.frequency}</div>
            <div className="text-2xl font-bold text-cyan-300">{waterResult.totalGallons} <span className="text-xs text-zinc-400">gal/cycle</span></div>
            <div className="text-[10px] text-zinc-500">{waterResult.perPlantLiters}L per plant</div>
            <div className="text-[10px] text-zinc-500">next: {waterResult.nextWatering}</div>
            {waterResult.warning && <div className="text-[10px] text-amber-300 italic">⚠ {waterResult.warning}</div>}
          </div>
        )}
        {yieldResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Yield · {yieldResult.confidence}</div>
            <div className="text-2xl font-bold text-amber-300">{yieldResult.predictedYield} <span className="text-xs text-zinc-400">{yieldResult.unit}</span></div>
            {(yieldResult.risks ?? []).slice(0, 3).map((r, i) => <div key={i} className="text-[10px] text-red-300">⚠ {r}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> 7-day action</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
