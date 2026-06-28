'use client';

/**
 * AgricultureActionPanel — farm operator bench.
 * weather-for-field (open-meteo with soil moisture + ET0) /
 * rotationPlan / waterSchedule / predict-yield + mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Sprout, Cloud, Droplet, TrendingUp, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

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
// rotationPlan returns { fields: [{ fieldName, lastCrop, suggestedNext, avoid, soilNote, ... }] }
interface RotField { fieldId?: string; fieldName?: string; acreage?: number; soilType?: string; lastCrop?: string; last3Crops?: string[]; suggestedNext?: string[]; avoid?: string[]; soilNote?: string }
interface RotResult { fields?: RotField[] }
// waterSchedule returns { daysAhead, fields: [{ fieldName, totalGallons, totalIrrigationInches, activeDays, skipDays, ... }], totalGallonsAllFields }
interface WaterField { fieldId?: string; fieldName?: string; crop?: string; acreage?: number; totalGallons?: number; totalIrrigationInches?: number; activeDays?: number; skipDays?: number }
interface WaterResult { daysAhead?: number; fields?: WaterField[]; totalGallonsAllFields?: number }
// predict-yield returns { crop, estimatedYieldPerAcre, totalYield, unit, band, soilMultiplier, historyAvg, summary }
interface YieldBand { low: number; mid?: number; high: number; unit: string }
interface YieldResult { crop?: string; acreage?: number; soilType?: string; estimatedYieldPerAcre?: number; totalYield?: number; unit?: string; band?: YieldBand; soilMultiplier?: number; historyAvg?: number | null; summary?: string }

export function AgricultureActionPanel() {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [acres, setAcres] = useState('');
  const [crop, setCrop] = useState('');
  const [prevCrop, setPrevCrop] = useState('');
  const [plantCount, setPlantCount] = useState('');
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

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actWx() {
    const la = parseFloat(lat), ln = parseFloat(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) { err('Field lat + lng required.'); return; }
    setBusy('wx'); setFeedback(null);
    try {
      const r = await callMacro<WxResult>('weather-for-field', { lat: la, lng: ln });
      if (r.ok && r.result) { setWxResult(r.result); pipe.publish('ag.wx', r.result, { label: `Wx ${r.result.today.tempMin}-${r.result.today.tempMax}°C` }); ok(`Today: ${r.result.today.tempMin}-${r.result.today.tempMax}°C · ${r.result.today.precipSum}mm rain.`); } else err(r.error ?? 'wx failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRot() {
    if (!crop.trim() || !prevCrop.trim()) { err('Current + previous crop required.'); return; }
    setBusy('rot'); setFeedback(null);
    try {
      // rotationPlan reads artifact.data.fields[] (each with rotation history) +
      // artifact.data.rotationRules, and returns { fields: [{ fieldName,
      // lastCrop, suggestedNext, avoid, soilNote }] }. Seed a single field whose
      // last crop is the entered previous crop so the handler recommends a next.
      const year = new Date().getFullYear();
      const r = await callMacro<RotResult>('rotationPlan', {
        fields: [{ fieldId: 'op-field', name: crop.trim() || 'My field', acreage: parseFloat(acres) || 0, soilType: 'loam', history: [{ year, season: 'summer', crop: prevCrop.trim() }] }],
        rotationRules: [
          { previousCrop: 'corn', recommendedNext: ['soybeans', 'wheat', 'alfalfa'], avoid: ['corn'] },
          { previousCrop: 'soybeans', recommendedNext: ['corn', 'wheat'], avoid: ['soybeans'] },
          { previousCrop: 'wheat', recommendedNext: ['soybeans', 'alfalfa', 'corn'], avoid: ['wheat'] },
          { previousCrop: 'alfalfa', recommendedNext: ['corn', 'wheat'], avoid: ['soybeans'] },
        ],
      });
      if (r.ok && r.result) { setRotResult(r.result); pipe.publish('ag.rot', r.result, { label: `Rotation: ${r.result.fields?.length ?? 0} field(s)` }); ok(`${r.result.fields?.[0]?.suggestedNext?.length ?? 0} crop option(s) after ${prevCrop.trim()}.`); } else err(r.error ?? 'rotation failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actWater() {
    const ac = parseFloat(acres);
    if (!crop.trim() || !Number.isFinite(ac)) { err('Crop + acres required.'); return; }
    setBusy('water'); setFeedback(null);
    try {
      // waterSchedule reads artifact.data.fields[] + optional weatherForecast and
      // returns { fields: [{ totalGallons, totalIrrigationInches, activeDays,
      // skipDays }], totalGallonsAllFields }. Seed one field; thread today's
      // precip into a 1-day forecast so the run reflects real weather when present.
      const today = new Date().toISOString().split('T')[0];
      const weatherForecast = wxResult
        ? [{ date: today, highTemp: wxResult.today?.tempMax ?? 80, precipInches: (wxResult.today?.precipSum ?? 0) / 25.4 }]
        : [];
      const r = await callMacro<WaterResult>('waterSchedule', {
        daysAhead: 7,
        fields: [{ fieldId: 'op-field', name: crop.trim() || 'My field', acreage: ac, soilType: 'loam', crop: crop.trim() }],
        weatherForecast,
      });
      if (r.ok && r.result) { setWaterResult(r.result); const total = r.result.totalGallonsAllFields ?? 0; pipe.publish('ag.water', r.result, { label: `Water ${total.toLocaleString()}gal` }); ok(`${r.result.fields?.[0]?.activeDays ?? 0} active day(s) · ${total.toLocaleString()} gal.`); } else err(r.error ?? 'water failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actYield() {
    const ac = parseFloat(acres);
    if (!crop.trim() || !Number.isFinite(ac)) { err('Crop + acres required.'); return; }
    setBusy('yield'); setFeedback(null);
    try {
      // predict-yield reads crop / acreage / soilType (NOT "acres") and returns
      // estimatedYieldPerAcre / totalYield / unit / band / summary.
      const r = await callMacro<YieldResult>('predict-yield', { crop: crop.trim(), acreage: ac, soilType: 'loam' });
      if (r.ok && r.result) { setYieldResult(r.result); pipe.publish('ag.yield', r.result, { label: `Yield ${r.result.totalYield} ${r.result.unit}` }); ok(`${r.result.estimatedYieldPerAcre} ${r.result.unit}/ac · ${r.result.totalYield} total.`); } else err(r.error ?? 'yield failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Farm plan — ${crop} ${acres}ac`, tags: ['agriculture', 'farm', crop], source: 'agriculture:farm:mint', meta: { visibility: 'private', consent: { allowCitations: false }, ag: { crop, acres, lat, lng, wx: wxResult, rot: rotResult, water: waterResult, yield: yieldResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('ag.mintedDtuId', id, { label: `Farm DTU ${id.slice(0, 8)}…` }); ok(`Farm DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🌾 Field brief`, '',
      wxResult ? `Wx: ${wxResult.today.tempMin}-${wxResult.today.tempMax}°C · ${wxResult.today.precipSum}mm · ET₀ ${wxResult.today.et0}mm · soil moist ${wxResult.currentSoilMoisture}` : '',
      rotResult ? `Rotation: after ${rotResult.fields?.[0]?.lastCrop ?? '?'} → ${(rotResult.fields?.[0]?.suggestedNext ?? []).join(', ') || 'no recommendation'}` : '',
      waterResult ? `Water: ${(waterResult.totalGallonsAllFields ?? 0).toLocaleString()} gal over ${waterResult.daysAhead ?? 7}d · ${waterResult.fields?.[0]?.activeDays ?? 0} active days` : '',
      yieldResult ? `Yield: ${yieldResult.estimatedYieldPerAcre} ${yieldResult.unit}/ac · ${yieldResult.totalYield} total` : '',
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
    if (!yieldResult) { err('Run yield prediction first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Yield benchmark — ${crop}`, tags: ['agriculture', 'yield', 'benchmark', 'public'], source: 'agriculture:yield:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, crop, acres, yield: yieldResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('ag.publishedDtuId', id, { label: `Public yield ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Farm operator brief for ${crop} on ${acres} acres. ${wxResult ? `7-day forecast: ${wxResult.forecast7.slice(0, 3).map(d => `${d.date} ${d.tempMin}-${d.tempMax}°C ${d.precip}mm`).join('; ')}.` : ''} ${waterResult ? `Water need: ${(waterResult.totalGallonsAllFields ?? 0).toLocaleString()} gal/${waterResult.daysAhead ?? 7}d.` : ''} ${yieldResult ? `Predicted yield: ${yieldResult.estimatedYieldPerAcre} ${yieldResult.unit}/ac.` : ''} Identify the single most urgent operational action for the next 7 days + one risk. Plain text, 3 sentences max.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
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
        {wxResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-48 overflow-y-auto md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Weather · 7-day · open-meteo</div>
            <div className="text-[11px] text-zinc-300 mt-1">Today: <span className="font-mono text-blue-200">{wxResult.today.tempMin}-{wxResult.today.tempMax}°C · {wxResult.today.precipSum}mm · ET₀ {wxResult.today.et0}mm</span></div>
            {wxResult.currentSoilMoisture != null && <div className="text-[10px] text-zinc-400">Soil: {Math.round((wxResult.currentSoilMoisture ?? 0) * 100)}% moist · {wxResult.currentSoilTemp}°C</div>}
            <div className="mt-1 grid grid-cols-7 gap-0.5">
              {wxResult.forecast7.slice(0, 7).map((d, i) => <div key={i} className="text-center text-[9px] text-zinc-400"><div className="font-mono text-blue-200">{d.date?.slice(5)}</div><div>{d.tempMin}-{d.tempMax}°</div><div className="text-cyan-300">{d.precip}mm</div></div>)}
            </div>
          </div>
        )}
        {rotResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Rotation</div>
            {(rotResult.fields ?? []).map((f, i) => (
              <div key={i} className="text-[11px] text-zinc-300 mt-0.5">
                <span className="text-zinc-400">after </span>
                <span className="font-mono text-green-200">{f.lastCrop ?? '?'}</span>
                <span className="text-zinc-400"> → </span>
                {(f.suggestedNext ?? []).length > 0 ? (f.suggestedNext ?? []).join(', ') : <span className="text-zinc-500">no recommendation</span>}
                {f.soilNote && <div className="text-[10px] text-emerald-300 mt-0.5">{f.soilNote}</div>}
                {(f.avoid ?? []).length > 0 && <div className="text-[10px] text-amber-300 mt-0.5">avoid: {(f.avoid ?? []).join(', ')}</div>}
              </div>
            ))}
            {(rotResult.fields ?? []).length === 0 && <div className="text-[10px] text-zinc-500 mt-0.5">No rotation candidates.</div>}
          </div>
        )}
        {waterResult && (() => {
          const wf = waterResult.fields?.[0];
          return (
            <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Irrigation · {waterResult.daysAhead ?? 7}-day</div>
              <div className="text-2xl font-bold text-cyan-300">{(waterResult.totalGallonsAllFields ?? 0).toLocaleString()} <span className="text-xs text-zinc-400">gal</span></div>
              <div className="text-[10px] text-zinc-400">{wf?.totalIrrigationInches ?? 0}&quot; total irrigation</div>
              <div className="text-[10px] text-zinc-400">{wf?.activeDays ?? 0} active · {wf?.skipDays ?? 0} skip days</div>
            </div>
          );
        })()}
        {yieldResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Yield · {yieldResult.crop}</div>
            <div className="text-2xl font-bold text-amber-300">{yieldResult.estimatedYieldPerAcre} <span className="text-xs text-zinc-400">{yieldResult.unit}/ac</span></div>
            <div className="text-[10px] text-zinc-400">{yieldResult.totalYield} {yieldResult.unit} total</div>
            {yieldResult.band && <div className="text-[10px] text-zinc-400">band {yieldResult.band.low}–{yieldResult.band.high}</div>}
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
