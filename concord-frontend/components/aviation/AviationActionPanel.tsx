'use client';

/**
 * AviationActionPanel — pilot's pre-flight bench.
 * airport-lookup (aviationapi.com FAA NASR) / weather-metar (aviationweather.gov) /
 * perf-takeoff / perf-landing + mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Plane, Cloud, MapPin, ArrowDown, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('aviation', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'apt' | 'wx' | 'to' | 'ldg' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface Runway { id: string; length: number; surface: string }
interface Frequencies { tower?: string; ground?: string; atis?: string; approach?: string; awos?: string }
interface Airport { ident: string; name: string; city: string; lat: number; lng: number; elev_ft: number; runways: Runway[]; frequencies: Frequencies; fuel: string[] }
interface AirportResult { airport: Airport; source?: string }
interface MetarReport { icaoId: string; rawText: string; reportTime: string; tempC?: number; dewpC?: number; windDir?: number; windSpd?: number; windGust?: number; visibilityMi?: number; altim?: number; flightCategory: string; clouds?: { cover: string; base: number }[] }
interface MetarResult { reports: MetarReport[]; count: number; source?: string }
interface PerfResult { groundRoll_ft: number; over50ft_ft: number; inputs: Record<string, number>; notes?: string }

export function AviationActionPanel() {
  const [ident, setIdent] = useState('');
  const [metarIds, setMetarIds] = useState('');
  const [pressureAlt, setPressureAlt] = useState('');
  const [oat, setOat] = useState('');
  const [weight, setWeight] = useState('');
  const [headwind, setHeadwind] = useState('');
  const [slope, setSlope] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [aptResult, setAptResult] = useState<AirportResult | null>(null);
  const [wxResult, setWxResult] = useState<MetarResult | null>(null);
  const [toResult, setToResult] = useState<PerfResult | null>(null);
  const [ldgResult, setLdgResult] = useState<PerfResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });
  const [lastAction, setLastAction] = useState<(() => void) | null>(null);

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actApt() {
    if (!ident.trim()) { err('Ident required (e.g. KSFO).'); return; }
    setBusy('apt'); setFeedback(null);
    try {
      const r = await callMacro<AirportResult>('airport-lookup', { ident: ident.trim().toUpperCase() });
      if (r.ok && r.result) { setAptResult(r.result); pipe.publish('av.apt', r.result, { label: `${r.result.airport.ident}` }); ok(`${r.result.airport.name} — elev ${r.result.airport.elev_ft} ft.`); } else err(r.error ?? 'lookup failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actWx() {
    if (!metarIds.trim()) { err('METAR ids required (csv of ICAO codes).'); return; }
    setBusy('wx'); setFeedback(null);
    try {
      const r = await callMacro<MetarResult>('weather-metar', { ids: metarIds.split(',').map(s => s.trim()).filter(Boolean) });
      if (r.ok && r.result) { setWxResult(r.result); pipe.publish('av.wx', r.result, { label: `${r.result.count} METARs` }); ok(`${r.result.count} METARs.`); } else err(r.error ?? 'wx failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actTo() {
    const pa = parseFloat(pressureAlt), t = parseFloat(oat), w = parseFloat(weight), hw = parseFloat(headwind), sl = parseFloat(slope);
    if (![pa, t, w, hw, sl].every(Number.isFinite)) { err('All 5 takeoff inputs required.'); return; }
    setBusy('to'); setFeedback(null);
    try {
      const r = await callMacro<PerfResult>('perf-takeoff', { pressureAlt: pa, oat: t, weight: w, headwind: hw, slope: sl });
      if (r.ok && r.result) { setToResult(r.result); pipe.publish('av.to', r.result, { label: `TO ${r.result.groundRoll_ft}ft` }); ok(`Ground roll ${r.result.groundRoll_ft} ft.`); } else err(r.error ?? 'takeoff failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actLdg() {
    const pa = parseFloat(pressureAlt), t = parseFloat(oat), w = parseFloat(weight), hw = parseFloat(headwind);
    if (![pa, t, w, hw].every(Number.isFinite)) { err('Pressure alt + OAT + weight + headwind required.'); return; }
    setBusy('ldg'); setFeedback(null);
    try {
      const r = await callMacro<PerfResult>('perf-landing', { pressureAlt: pa, oat: t, weight: w, headwind: hw });
      if (r.ok && r.result) { setLdgResult(r.result); pipe.publish('av.ldg', r.result, { label: `LDG ${r.result.groundRoll_ft}ft` }); ok(`Ground roll ${r.result.groundRoll_ft} ft.`); } else err(r.error ?? 'landing failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Flight prep — ${aptResult?.airport?.ident ?? ident}`, tags: ['aviation', 'preflight', aptResult?.airport?.ident].filter((t): t is string => !!t), source: 'aviation:preflight:mint', meta: { visibility: 'private', consent: { allowCitations: false }, aviation: { airport: aptResult, wx: wxResult, takeoff: toResult, landing: ldgResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('av.mintedDtuId', id, { label: `Prep DTU ${id.slice(0, 8)}…` }); ok(`Prep DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const m = wxResult?.reports?.[0];
    const body = [`✈ Pre-flight brief`, '',
      aptResult ? `${aptResult.airport.ident} (${aptResult.airport.name}) · elev ${aptResult.airport.elev_ft} ft${aptResult.airport.runways[0] ? ` · RW ${aptResult.airport.runways[0].id} ${aptResult.airport.runways[0].length} ft` : ''}` : '',
      m ? `WX ${m.icaoId}: ${m.flightCategory} · ${m.tempC}°C · wind ${m.windDir}@${m.windSpd}${m.windGust ? `G${m.windGust}` : ''}kt · vis ${m.visibilityMi}sm` : '',
      toResult ? `Takeoff: ${toResult.groundRoll_ft} ft / over50 ${toResult.over50ft_ft} ft` : '',
      ldgResult ? `Landing: ${ldgResult.groundRoll_ft} ft / over50 ${ldgResult.over50ft_ft} ft` : '',
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
    if (!aptResult) { err('Run airport lookup first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Airport profile — ${aptResult.airport.ident}`, tags: ['aviation', 'airport', 'public'], source: 'aviation:airport:publish', meta: { visibility: 'public', consent: { allowCitations: true }, airport: aptResult.airport } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('av.publishedDtuId', id, { label: `Public apt ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const m = wxResult?.reports?.[0];
      const task = `Pre-flight brief. ${aptResult ? `Departing ${aptResult.airport.ident} (${aptResult.airport.name}), elev ${aptResult.airport.elev_ft} ft, ${aptResult.airport.runways[0]?.length ?? '?'} ft longest runway.` : ''} ${m ? `Wx: ${m.flightCategory}, ${m.tempC}°C, wind ${m.windDir}@${m.windSpd}${m.windGust ? `G${m.windGust}` : ''} kt, vis ${m.visibilityMi} sm.` : ''} ${toResult ? `Takeoff ground roll ${toResult.groundRoll_ft} ft / over50 ${toResult.over50ft_ft} ft.` : ''} Identify the go/no-go call + one specific risk to brief. Plain text, 3 sentences max.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Briefed.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'apt' as ActionId, label: 'Airport', desc: 'FAA NASR via aviationapi', icon: MapPin, accent: '#3b82f6', handler: actApt },
    { id: 'wx' as ActionId, label: 'METAR', desc: 'aviationweather.gov', icon: Cloud, accent: '#06b6d4', handler: actWx },
    { id: 'to' as ActionId, label: 'Takeoff', desc: 'C172 perf model', icon: Plane, accent: '#22c55e', handler: actTo },
    { id: 'ldg' as ActionId, label: 'Landing', desc: 'C172 perf model', icon: ArrowDown, accent: '#f59e0b', handler: actLdg },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private prep DTU', icon: Sparkles, accent: '#8b5cf6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief to crew', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public airport profile', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Brief', desc: 'Agent: go/no-go + risk', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const FLT_CAT_COLOR: Record<string, string> = { VFR: 'bg-green-500/10 text-green-300 border-green-500/30', MVFR: 'bg-blue-500/10 text-blue-300 border-blue-500/30', IFR: 'bg-red-500/10 text-red-300 border-red-500/30', LIFR: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30', UNK: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/30' };

  return (
    <div className="rounded-lg border border-sky-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-sky-500/10 pb-2">
        <Plane className="h-4 w-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-white">Aviation bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">FAA NASR · ADDS METAR · C172 POH</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input type="text" value={ident} onChange={(e) => setIdent(e.target.value.toUpperCase())} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="ICAO (KSFO)" />
        <input type="text" value={metarIds} onChange={(e) => setMetarIds(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="METAR ids csv" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
        <div className="flex items-center gap-2 flex-wrap col-span-2">
          <RecallSlot ctl={dmRecall} />
          <RecallSlot ctl={publishRecall} />
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-zinc-400 font-mono">C172 POH</div>
        <input type="text" value={pressureAlt} onChange={(e) => setPressureAlt(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Press alt ft" />
        <input type="text" value={oat} onChange={(e) => setOat(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="OAT °C" />
        <input type="text" value={weight} onChange={(e) => setWeight(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Weight lb" />
        <input type="text" value={headwind} onChange={(e) => setHeadwind(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Headwind kt" />
        <input type="text" value={slope} onChange={(e) => setSlope(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Slope %" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(act => {
          const Icon = act.icon; const isBusy = busy === act.id;
          return (
            <button key={act.id} type="button" disabled={!!busy} onClick={() => { setLastAction(() => act.handler); act.handler(); }}
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

      {busy && (
        <div role="status" aria-live="polite" className="flex items-center gap-2 px-3 py-2 rounded text-[11px] text-sky-300 bg-sky-500/5 border border-sky-500/20">
          <Loader2 className="h-3 w-3 animate-spin" /> <span>Working…</span>
        </div>
      )}

      {!busy && !aptResult && !wxResult && !toResult && !ldgResult && !agentReply && (!feedback || feedback.kind === 'ok') && (
        <div className="rounded-md border border-dashed border-zinc-700 bg-zinc-900/30 p-4 text-center">
          <p className="text-[12px] text-zinc-300">No flight prep yet.</p>
          <p className="text-[11px] text-zinc-500 mt-0.5">Enter an ICAO and run Airport, METAR, or a C172 perf calc to begin.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {aptResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">{aptResult.airport.ident} · {aptResult.airport.name}</div>
            <div className="text-[11px] text-zinc-300">{aptResult.airport.city} · {aptResult.airport.elev_ft} ft elev · {aptResult.airport.lat.toFixed(3)}, {aptResult.airport.lng.toFixed(3)}</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-0.5 mt-1.5 text-[10px]">
              {Object.entries(aptResult.airport.frequencies).filter(([, v]) => v).map(([k, v]) => <div key={k} className="text-zinc-300"><span className="text-blue-400 uppercase">{k}</span> <span className="font-mono text-blue-100">{v}</span></div>)}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {aptResult.airport.runways.slice(0, 6).map((r, i) => <div key={i} className="text-[10px] bg-blue-500/10 text-blue-200 px-1.5 py-0.5 rounded font-mono">RW {r.id} · {r.length}ft · {r.surface}</div>)}
            </div>
            {aptResult.airport.fuel.length > 0 && <div className="text-[10px] text-zinc-400 mt-1">fuel: {aptResult.airport.fuel.join(' · ')}</div>}
          </div>
        )}
        {wxResult && wxResult.reports.map((m, i) => (
          <div key={i} className={cn('rounded-md border p-2.5', FLT_CAT_COLOR[m.flightCategory] ?? FLT_CAT_COLOR.UNK)}>
            <div className="text-[10px] uppercase tracking-wider font-semibold">{m.icaoId} · {m.flightCategory}</div>
            <div className="font-mono text-[10px] text-zinc-200 break-all">{m.rawText}</div>
            <div className="text-[10px] text-zinc-400 mt-0.5">{m.tempC}°C / dp {m.dewpC}°C · wind {m.windDir}@{m.windSpd}{m.windGust ? `G${m.windGust}` : ''}kt · vis {m.visibilityMi}sm · alt {m.altim}</div>
          </div>
        ))}
        {toResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Takeoff</div>
            <div className="text-2xl font-bold text-green-300">{toResult.groundRoll_ft} <span className="text-xs text-zinc-400">ft roll</span></div>
            <div className="text-[10px] text-zinc-400">over 50 ft: {toResult.over50ft_ft} ft</div>
            <div className="text-[10px] text-zinc-400">ISA temp at alt: {toResult.inputs.isaTemp}°C</div>
          </div>
        )}
        {ldgResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Landing</div>
            <div className="text-2xl font-bold text-amber-300">{ldgResult.groundRoll_ft} <span className="text-xs text-zinc-400">ft roll</span></div>
            <div className="text-[10px] text-zinc-400">over 50 ft: {ldgResult.over50ft_ft} ft</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Go/no-go brief</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} role={feedback.kind === 'err' ? 'alert' : 'status'} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span className="flex-1">{feedback.text}</span>{feedback.kind === 'err' && lastAction && (<button type="button" disabled={!!busy} onClick={() => lastAction()} className="ml-2 px-2 py-0.5 rounded border border-red-500/40 text-red-200 hover:bg-red-500/10 disabled:opacity-40">Retry</button>)}</motion.div>)}
      </AnimatePresence>
    </div>
  );
}
