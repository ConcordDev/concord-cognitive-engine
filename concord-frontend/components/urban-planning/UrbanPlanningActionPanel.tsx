'use client';

/**
 * UrbanPlanningActionPanel — city-planner bench.
 * zoningAnalysis / walkabilityScore / trafficImpact / census-acs-county +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Building2, Footprints, Car, Database, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('urban-planning', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'zone' | 'walk' | 'traffic' | 'census' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface ZoneResult { zoneType: string; lotSize: number; floorAreaRatio: number; maxBuildableSqFt: number; maxHeight: string; setback: string; parkingRequired: string; density: string }
interface WalkResult { walkabilityScore: number; rating: string; amenityScores: Record<string, number>; totalAmenities: number }
interface TrafficResult { newDailyTrips: number; peakHourTrips: number; currentADT: number; percentIncrease: number; impactLevel: string; mitigation: string[] }
interface CensusResult { countyName: string; totalPopulation: number; medianHouseholdIncome: number; medianAge: number; bachelorsPlusPct: number | null; ownerOccupiedPct: number | null; longCommutePct: number | null; source: string }

const DEFAULT_ZONE = JSON.stringify({ zoneType: 'mixed', lotSizeSqFt: 12000 }, null, 2);
const DEFAULT_WALK = JSON.stringify({ amenities: [{ category: 'grocery', withinWalkingDistance: true }, { category: 'restaurant', withinWalkingDistance: true }, { category: 'restaurant', withinWalkingDistance: true }, { category: 'school', withinWalkingDistance: true }, { category: 'park', withinWalkingDistance: false }, { category: 'transit', withinWalkingDistance: true }, { category: 'retail', withinWalkingDistance: true }, { category: 'healthcare', withinWalkingDistance: false }] }, null, 2);
const DEFAULT_TRAFFIC = JSON.stringify({ newHousingUnits: 240, newCommercialSqFt: 35000, currentADT: 18000 }, null, 2);
const DEFAULT_CENSUS_PARAMS = JSON.stringify({ stateFips: '06', countyFips: '075', year: 2023 }, null, 2);

export function UrbanPlanningActionPanel() {
  const [zoneText, setZoneText] = useState(DEFAULT_ZONE);
  const [walkText, setWalkText] = useState(DEFAULT_WALK);
  const [trafficText, setTrafficText] = useState(DEFAULT_TRAFFIC);
  const [censusText, setCensusText] = useState(DEFAULT_CENSUS_PARAMS);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [zoneResult, setZoneResult] = useState<ZoneResult | null>(null);
  const [walkResult, setWalkResult] = useState<WalkResult | null>(null);
  const [trafficResult, setTrafficResult] = useState<TrafficResult | null>(null);
  const [censusResult, setCensusResult] = useState<CensusResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actZone() {
    try { const parsed = JSON.parse(zoneText); setBusy('zone'); setFeedback(null);
      const r = await callMacro<ZoneResult>('zoningAnalysis', { artifact: { data: parsed } });
      if (r.ok && r.result) { setZoneResult(r.result); ok(`${r.result.zoneType} · ${r.result.maxBuildableSqFt} sqft buildable`); } else err(r.error ?? 'zone failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid zone JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actWalk() {
    try { const parsed = JSON.parse(walkText); setBusy('walk'); setFeedback(null);
      const r = await callMacro<WalkResult>('walkabilityScore', { artifact: { data: parsed } });
      if (r.ok && r.result) { setWalkResult(r.result); ok(`${r.result.walkabilityScore} · ${r.result.rating}`); } else err(r.error ?? 'walk failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid walk JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actTraffic() {
    try { const parsed = JSON.parse(trafficText); setBusy('traffic'); setFeedback(null);
      const r = await callMacro<TrafficResult>('trafficImpact', { artifact: { data: parsed } });
      if (r.ok && r.result) { setTrafficResult(r.result); ok(`+${r.result.percentIncrease}% trips · ${r.result.impactLevel}`); } else err(r.error ?? 'traffic failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid traffic JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCensus() {
    try { const parsed = JSON.parse(censusText); setBusy('census'); setFeedback(null);
      const r = await apiHelpers.lens.runDomain('urban-planning', 'census-acs-county', { params: parsed });
      const data = (r as { data?: { ok: boolean; result?: CensusResult; error?: string } }).data;
      const result = data?.result;
      if (data?.ok && result) { setCensusResult(result); ok(`${result.countyName} · ${result.totalPopulation.toLocaleString()} pop`); } else err(data?.error ?? 'census failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid census params.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Urban planning brief`, tags: ['urban-planning', zoneResult?.zoneType, walkResult?.rating].filter((t): t is string => !!t), source: 'urban-planning:brief:mint', meta: { visibility: 'private', consent: { allowCitations: false }, urban: { zone: zoneResult, walk: walkResult, traffic: trafficResult, census: censusResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Brief DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🏙 Planning brief`, '', zoneResult ? `Zone: ${zoneResult.zoneType} · ${zoneResult.maxBuildableSqFt} sqft buildable · ${zoneResult.maxHeight}` : '', walkResult ? `Walkability: ${walkResult.walkabilityScore} · ${walkResult.rating}` : '', trafficResult ? `Traffic: +${trafficResult.newDailyTrips}/day · ${trafficResult.impactLevel} (${trafficResult.percentIncrease}%)` : '', censusResult ? `Census ${censusResult.countyName}: ${censusResult.totalPopulation.toLocaleString()} pop · $${censusResult.medianHouseholdIncome.toLocaleString()} median income` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!zoneResult && !walkResult && !trafficResult) { err('Run a check first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Site brief`, tags: ['urban-planning', 'site', 'public'], source: 'urban-planning:site:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, urban: { zone: zoneResult, walk: walkResult, traffic: trafficResult, census: censusResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `City planner brief. ${zoneResult ? `Zoning: ${zoneResult.zoneType} · ${zoneResult.maxBuildableSqFt} sqft buildable.` : ''} ${walkResult ? `Walkability ${walkResult.walkabilityScore}/100 (${walkResult.rating}).` : ''} ${trafficResult ? `Traffic impact: ${trafficResult.impactLevel} (+${trafficResult.percentIncrease}%).` : ''} ${censusResult ? `${censusResult.countyName}: ${censusResult.totalPopulation.toLocaleString()} pop, median income $${censusResult.medianHouseholdIncome.toLocaleString()}.` : ''} Recommend one zoning or transit-policy lever + one equity guardrail. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Planner brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'zone' as ActionId, label: 'Zone', desc: 'zoningAnalysis (FAR)', icon: Building2, accent: '#3b82f6', handler: actZone },
    { id: 'walk' as ActionId, label: 'Walkability', desc: 'walkabilityScore', icon: Footprints, accent: '#22c55e', handler: actWalk },
    { id: 'traffic' as ActionId, label: 'Traffic', desc: 'trafficImpact', icon: Car, accent: '#f59e0b', handler: actTraffic },
    { id: 'census' as ActionId, label: 'Census', desc: 'ACS 5-year (real)', icon: Database, accent: '#a855f7', handler: actCensus },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private brief', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon site brief', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Planner', desc: 'Agent: policy lever', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const IMPACT_COLOR: Record<string, string> = { significant: 'text-red-300', moderate: 'text-amber-300', minimal: 'text-emerald-300' };
  const DENSITY_COLOR: Record<string, string> = { high: 'text-red-300', medium: 'text-amber-300', low: 'text-emerald-300' };

  return (
    <div className="rounded-lg border border-sky-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-sky-500/10 pb-2">
        <Building2 className="h-4 w-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-white">Urban planner bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">zone · walkability · traffic · census</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Zoning JSON</label>
          <textarea value={zoneText} onChange={(e) => setZoneText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Walkability JSON</label>
          <textarea value={walkText} onChange={(e) => setWalkText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Traffic JSON</label>
          <textarea value={trafficText} onChange={(e) => setTrafficText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Census params (real ACS API)</label>
          <textarea value={censusText} onChange={(e) => setCensusText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
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
        {zoneResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Zoning · {zoneResult.zoneType}</div>
            <div className="text-2xl font-bold text-blue-200">{zoneResult.maxBuildableSqFt}<span className="text-xs text-zinc-400"> sqft</span></div>
            <div className="text-[10px] text-zinc-300">FAR {zoneResult.floorAreaRatio} · {zoneResult.maxHeight} · setback {zoneResult.setback}</div>
            <div className="text-[10px] text-zinc-500 mt-1">Parking: {zoneResult.parkingRequired}</div>
            <div className={cn('text-[10px] font-semibold mt-0.5', DENSITY_COLOR[zoneResult.density])}>{zoneResult.density} density</div>
          </div>
        )}
        {walkResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Walk · {walkResult.rating}</div>
            <div className={cn('text-3xl font-bold', walkResult.walkabilityScore >= 70 ? 'text-emerald-300' : walkResult.walkabilityScore >= 40 ? 'text-amber-300' : 'text-red-300')}>{walkResult.walkabilityScore}</div>
            <div className="text-[10px] text-zinc-500">{walkResult.totalAmenities} amenities</div>
            {Object.entries(walkResult.amenityScores).filter(([, v]) => v > 0).map(([k, v], i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex items-center gap-2"><span className="font-mono w-16">{k}</span><div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-green-400" style={{ width: `${Math.min(100, v * 50)}%` }} /></div><span className="font-mono text-green-200">{v}</span></div>)}
          </div>
        )}
        {trafficResult && (
          <div className={cn('rounded-md border p-2.5', trafficResult.impactLevel === 'significant' ? 'border-red-500/40 bg-red-500/10' : trafficResult.impactLevel === 'moderate' ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Traffic · {trafficResult.impactLevel}</div>
            <div className={cn('text-3xl font-bold', IMPACT_COLOR[trafficResult.impactLevel])}>+{trafficResult.percentIncrease}<span className="text-xs text-zinc-400">%</span></div>
            <div className="text-[10px] text-zinc-300">{trafficResult.newDailyTrips}/day · peak {trafficResult.peakHourTrips}/hr</div>
            <div className="text-[10px] text-zinc-500">Current ADT: {trafficResult.currentADT.toLocaleString()}</div>
            {trafficResult.mitigation.slice(0, 2).map((m, i) => <div key={i} className="text-[10px] text-amber-200 mt-0.5">→ {m}</div>)}
          </div>
        )}
        {censusResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Census · {censusResult.countyName}</div>
            <div className="text-2xl font-bold text-purple-200">{(censusResult.totalPopulation / 1000).toFixed(0)}<span className="text-xs text-zinc-400">k</span></div>
            <div className="text-[10px] text-zinc-300">Median income ${censusResult.medianHouseholdIncome.toLocaleString()} · age {censusResult.medianAge}</div>
            {censusResult.bachelorsPlusPct != null && <div className="text-[10px] text-zinc-400 mt-1">{censusResult.bachelorsPlusPct}% bachelor's+ · {censusResult.ownerOccupiedPct}% owner</div>}
            {censusResult.longCommutePct != null && <div className="text-[10px] text-zinc-500">{censusResult.longCommutePct}% 60+ min commute</div>}
            <div className="text-[10px] text-zinc-500 mt-1 italic">{censusResult.source}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Planner brief</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
