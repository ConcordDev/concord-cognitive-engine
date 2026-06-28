'use client';

/**
 * AstronomyActionPanel — sky-watcher bench.
 * apod (NASA Astronomy Picture of the Day) / iss-current-location /
 * near-earth-objects (NeoWs) / celestialPosition + mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Orbit, Image, Satellite, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle, Star } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('astronomy', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'apod' | 'iss' | 'neo' | 'pos' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface ApodResult { date: string; title: string; explanation: string; mediaType: string; url: string; hdurl?: string; copyright?: string }
interface IssResult { name: string; latitude: number; longitude: number; altitudeKm: number; velocityKmH: number; visibility: string; footprintKm: number; timestamp: number }
interface NeoObject { id: string; name: string; absoluteMagnitude: number; estimatedDiameterMeters: { min: number; max: number }; potentiallyHazardous: boolean; approach?: { date: string; relativeVelocityKmH: number; missDistanceKm: number; missDistanceLunar: number; orbitingBody: string }; nasaJplUrl?: string }
interface NeoResult { objects?: NeoObject[]; elementCount?: number; hazardousCount?: number }
interface PosResult { body?: string; ra?: string; dec?: string; alt?: number; az?: number; constellation?: string; visible?: boolean }

const TODAY = new Date().toISOString().split('T')[0];

export function AstronomyActionPanel() {
  // TODAY is the real current date — defaulting date inputs to it is not
  // fake data, just sensible UX. Body and observer coords start empty.
  const [apodDate, setApodDate] = useState(TODAY);
  const [neoStart, setNeoStart] = useState(TODAY);
  const [neoEnd, setNeoEnd] = useState(TODAY);
  const [body, setBody] = useState('');
  const [obsLat, setObsLat] = useState('');
  const [obsLng, setObsLng] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [apodResult, setApodResult] = useState<ApodResult | null>(null);
  const [issResult, setIssResult] = useState<IssResult | null>(null);
  const [neoResult, setNeoResult] = useState<NeoResult | null>(null);
  const [posResult, setPosResult] = useState<PosResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actApod() {
    setBusy('apod'); setFeedback(null);
    try {
      const r = await callMacro<ApodResult>('apod', { date: apodDate });
      if (r.ok && r.result) { setApodResult(r.result); pipe.publish('astro.apod', r.result, { label: `APOD: ${r.result.title}` }); ok(`${r.result.title}`); } else err(r.error ?? 'apod failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actIss() {
    setBusy('iss'); setFeedback(null);
    try {
      const r = await callMacro<IssResult>('iss-current-location', {});
      if (r.ok && r.result) { setIssResult(r.result); pipe.publish('astro.iss', r.result, { label: `ISS ${r.result.latitude.toFixed(2)},${r.result.longitude.toFixed(2)}` }); ok(`ISS at ${r.result.latitude.toFixed(2)}, ${r.result.longitude.toFixed(2)}.`); } else err(r.error ?? 'iss failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actNeo() {
    setBusy('neo'); setFeedback(null);
    try {
      const r = await callMacro<NeoResult>('near-earth-objects', { startDate: neoStart, endDate: neoEnd });
      if (r.ok && r.result) { setNeoResult(r.result); pipe.publish('astro.neo', r.result, { label: `NEOs ${r.result.elementCount ?? r.result.objects?.length ?? 0}` }); ok(`${r.result.elementCount ?? r.result.objects?.length ?? 0} NEOs · ${r.result.hazardousCount ?? 0} hazardous.`); } else err(r.error ?? 'neo failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPos() {
    if (!body.trim()) { err('Body required (e.g. Mars).'); return; }
    const la = parseFloat(obsLat), ln = parseFloat(obsLng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) { err('Observer lat + lng required.'); return; }
    setBusy('pos'); setFeedback(null);
    try {
      // Field names below are the handler's exact reads: body | observerLat |
      // observerLng | date (server/domains/astronomy.js#celestialPosition).
      const r = await callMacro<PosResult>('celestialPosition', { body, observerLat: la, observerLng: ln, date: new Date().toISOString() });
      if (r.ok && r.result) { setPosResult(r.result); pipe.publish('astro.pos', r.result, { label: `${r.result.body} alt ${r.result.alt}°` }); ok(`${r.result.body} @ ${r.result.alt}° alt.`); } else err(r.error ?? 'pos failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Sky log — ${TODAY}`, tags: ['astronomy', 'skywatch', apodResult ? 'apod' : null].filter((t): t is string => !!t), source: 'astronomy:sky:mint', meta: { visibility: 'private', consent: { allowCitations: false }, sky: { apod: apodResult, iss: issResult, neo: neoResult, pos: posResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('astro.mintedDtuId', id, { label: `Sky DTU ${id.slice(0, 8)}…` }); ok(`Sky DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body_ = [`🔭 Sky log ${TODAY}`, '',
      apodResult ? `APOD: "${apodResult.title}"` : '',
      issResult ? `ISS: ${issResult.latitude.toFixed(2)}, ${issResult.longitude.toFixed(2)} @ ${Math.round(issResult.altitudeKm)}km · ${Math.round(issResult.velocityKmH)}km/h` : '',
      neoResult ? `NEOs: ${neoResult.elementCount ?? neoResult.objects?.length ?? 0} in window · ${neoResult.hazardousCount ?? 0} hazardous` : '',
      posResult ? `${posResult.body}: alt ${posResult.alt}° az ${posResult.az}° · ${posResult.visible ? '✓ visible' : '✗ below horizon'}` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body_ });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!apodResult && !neoResult) { err('Run APOD or NEO first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Sky card — ${TODAY}`, tags: ['astronomy', 'nasa', 'public'], source: 'astronomy:sky:publish', meta: { visibility: 'public', consent: { allowCitations: true }, apod: apodResult, neo: neoResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('astro.publishedDtuId', id, { label: `Public sky card ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Tonight's sky-watching brief for observer at ${obsLat}, ${obsLng}. ${apodResult ? `Today's APOD: "${apodResult.title}".` : ''} ${issResult ? `ISS at ${issResult.latitude.toFixed(2)}, ${issResult.longitude.toFixed(2)}.` : ''} ${neoResult?.hazardousCount ? `${neoResult.hazardousCount} potentially hazardous NEOs in window.` : ''} ${posResult ? `${posResult.body} at alt ${posResult.alt}°.` : ''} Recommend one specific thing to look at tonight + best viewing time. Plain text, 3 sentences max.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'apod' as ActionId, label: 'APOD', desc: 'NASA picture of day', icon: Image, accent: '#8b5cf6', handler: actApod },
    { id: 'iss' as ActionId, label: 'ISS', desc: 'real-time location', icon: Satellite, accent: '#06b6d4', handler: actIss },
    { id: 'neo' as ActionId, label: 'NEOs', desc: 'near-Earth objects', icon: AlertTriangle, accent: '#f59e0b', handler: actNeo },
    { id: 'pos' as ActionId, label: 'Position', desc: 'celestialPosition', icon: Star, accent: '#a855f7', handler: actPos },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private sky DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send sky log', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public sky card', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Tonight', desc: 'Agent: viewing tip', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-indigo-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-indigo-500/10 pb-2">
        <Orbit className="h-4 w-4 text-indigo-400" />
        <h3 className="text-sm font-semibold text-white">Sky watcher</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">NASA APOD · ISS · NeoWs</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
        <input type="date" value={apodDate} onChange={(e) => setApodDate(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" />
        <input type="date" value={neoStart} onChange={(e) => setNeoStart(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" />
        <input type="date" value={neoEnd} onChange={(e) => setNeoEnd(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" />
        <input type="text" value={body} onChange={(e) => setBody(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="Body (Mars)" />
        <input type="text" value={obsLat} onChange={(e) => setObsLat(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Obs lat" />
        <input type="text" value={obsLng} onChange={(e) => setObsLng(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Obs lng" />
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {apodResult && (
          <div className="rounded-md border border-violet-500/30 bg-violet-500/5 p-2.5 md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-violet-300 font-semibold">APOD · {apodResult.date}</div>
            <div className="text-[12px] font-semibold text-violet-200">{apodResult.title}</div>
            {/* eslint-disable-next-line @next/next/no-img-element -- NASA APOD serves arbitrary external image hosts; next/image domain allowlist is impractical here */}
            {apodResult.mediaType === 'image' && apodResult.url && <img src={apodResult.url} alt={apodResult.title} className="mt-1.5 rounded max-h-64 object-contain" />}
            <div className="text-[10px] text-zinc-400 mt-1 line-clamp-3">{apodResult.explanation}</div>
            {apodResult.copyright && <div className="text-[10px] text-zinc-400 italic mt-0.5">© {apodResult.copyright}</div>}
          </div>
        )}
        {issResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">ISS · {issResult.name}</div>
            <div className="text-sm text-cyan-200 font-mono">{issResult.latitude.toFixed(3)}, {issResult.longitude.toFixed(3)}</div>
            <div className="text-[10px] text-zinc-400">alt {Math.round(issResult.altitudeKm)}km · {Math.round(issResult.velocityKmH).toLocaleString()}km/h</div>
            <div className="text-[10px] text-zinc-400">visibility: {issResult.visibility} · footprint {Math.round(issResult.footprintKm)}km</div>
          </div>
        )}
        {neoResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-60 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">NEOs · {neoResult.elementCount ?? neoResult.objects?.length} total</div>
            {(neoResult.hazardousCount ?? 0) > 0 && <div className="text-[11px] text-red-300 font-semibold">⚠ {neoResult.hazardousCount} potentially hazardous</div>}
            {(neoResult.objects ?? []).slice(0, 5).map((o, i) => <div key={i} className={cn('text-[10px] mt-0.5', o.potentiallyHazardous ? 'text-red-300' : 'text-zinc-300')}><strong>{o.name}</strong> · ⌀ {Math.round(o.estimatedDiameterMeters.max)}m · {o.approach ? `${o.approach.missDistanceLunar.toFixed(2)} LD @ ${Math.round(o.approach.relativeVelocityKmH).toLocaleString()}km/h` : '-'}</div>)}
          </div>
        )}
        {posResult && (
          <div className={cn('rounded-md border p-2.5', posResult.visible ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-500/30 bg-zinc-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">{posResult.body}</div>
            <div className="text-2xl font-bold text-emerald-300">{posResult.alt}°<span className="text-xs text-zinc-400"> alt</span></div>
            <div className="text-[10px] text-zinc-400">az {posResult.az}° · {posResult.constellation}</div>
            <div className="text-[10px] text-zinc-400">{posResult.visible ? '✓ above horizon' : '✗ below horizon'}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Tonight's viewing</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
