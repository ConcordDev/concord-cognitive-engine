'use client';

/**
 * SocietyActionPanel — World Bank data explorer.
 * wb-indicator / wb-country / wb-compare / wb-common-indicators +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Globe2, BarChart3, GitCompareArrows, BookOpen, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('society', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'indicator' | 'country' | 'compare' | 'catalog' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface IndicatorPoint { year: number; value: number; countryName?: string }
interface IndicatorResult { country: string; indicator: string; alias?: string | null; countryName?: string; series: IndicatorPoint[]; latest: IndicatorPoint | null; count: number }
interface CountryResult { iso2: string; iso3: string; name: string; capital: string; region: string; incomeLevel: string; lendingType: string; longitude?: number | null; latitude?: number | null }
interface ComparePoint { country?: string; countryName?: string; year: number; value: number }
interface CompareResult { indicator: string; countries: string[]; points: ComparePoint[]; count: number }
interface CatalogResult { indicators: Record<string, string>; count: number; note?: string }

export function SocietyActionPanel() {
  const [country, setCountry] = useState('');
  const [indicator, setIndicator] = useState('');
  const [compareCountries, setCompareCountries] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [indicatorResult, setIndicatorResult] = useState<IndicatorResult | null>(null);
  const [countryResult, setCountryResult] = useState<CountryResult | null>(null);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [catalogResult, setCatalogResult] = useState<CatalogResult | null>(null);
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

  async function actIndicator() {
    if (!country.trim() || !indicator.trim()) { err('Country + indicator required.'); return; }
    setBusy('indicator'); setFeedback(null);
    try { const r = await callMacro<IndicatorResult>('wb-indicator', { country: country.trim().toUpperCase(), indicator: indicator.trim() }); if (r.ok && r.result) { setIndicatorResult(r.result); pipe.publish('society.indicator', r.result, { label: `${r.result.country} ${r.result.indicator}` }); ok(`${r.result.count} data points · latest ${r.result.latest?.value.toLocaleString()} (${r.result.latest?.year}).`); } else err(r.error ?? 'indicator failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCountry() {
    if (!country.trim()) { err('Country required.'); return; }
    setBusy('country'); setFeedback(null);
    try { const r = await callMacro<CountryResult>('wb-country', { country: country.trim().toUpperCase() }); if (r.ok && r.result) { setCountryResult(r.result); pipe.publish('society.country', r.result, { label: r.result.name }); ok(`${r.result.name} loaded.`); } else err(r.error ?? 'country failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCompare() {
    const countries = compareCountries.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (countries.length < 2) { err('Need 2+ countries.'); return; }
    setBusy('compare'); setFeedback(null);
    try { const r = await callMacro<CompareResult>('wb-compare', { countries, indicator: indicator.trim() }); if (r.ok && r.result) { setCompareResult(r.result); pipe.publish('society.compare', r.result, { label: `${countries.length} countries` }); ok(`${r.result.points.length} data points across ${countries.length} countries.`); } else err(r.error ?? 'compare failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCatalog() {
    setBusy('catalog'); setFeedback(null);
    try { const r = await callMacro<CatalogResult>('wb-common-indicators', {}); if (r.ok && r.result) { setCatalogResult(r.result); pipe.publish('society.catalog', r.result, { label: `${r.result.count} aliases` }); ok(`${r.result.count} indicator aliases.`); } else err(r.error ?? 'catalog failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `WB data — ${country} ${indicator}`, tags: ['society', 'worldbank', country], source: 'society:wb:mint', meta: { visibility: 'private', consent: { allowCitations: false }, wb: { indicator: indicatorResult, country: countryResult, compare: compareResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('society.mintedDtuId', id, { label: `wb ${id.slice(0, 8)}` }); ok(`WB DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🌎 World Bank data`, '', indicatorResult ? `${indicatorResult.countryName} · ${indicatorResult.indicator}: ${indicatorResult.latest?.value.toLocaleString()} (${indicatorResult.latest?.year})` : '', countryResult ? `${countryResult.name} (${countryResult.iso3}) · ${countryResult.region} · ${countryResult.incomeLevel}` : '', compareResult ? `Compare ${indicator}: ${compareResult.points.slice(0, 5).map(p => `${p.country} ${p.value.toLocaleString()}`).join(' · ')}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
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
    if (!compareResult && !indicatorResult) { err('Run a query first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `WB data viz — ${indicator}`, tags: ['society', 'worldbank', 'public'], source: 'society:wb:publish', meta: { visibility: 'public', consent: { allowCitations: true }, indicator: indicatorResult, compare: compareResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('society.publishedDtuId', id, { label: `viz ${id.slice(0, 8)}` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `World-Bank data analyst. ${indicatorResult ? `${indicatorResult.countryName} ${indicatorResult.indicator}: latest ${indicatorResult.latest?.value.toLocaleString()} (${indicatorResult.latest?.year}), ${indicatorResult.count} years of data.` : ''} ${countryResult ? `Region: ${countryResult.region}, income: ${countryResult.incomeLevel}.` : ''} ${compareResult ? `Comparison points: ${compareResult.points.slice(0, 5).map(p => `${p.country}=${p.value.toLocaleString()}`).join(', ')}.` : ''} Identify the single most notable trend or comparison + one policy implication. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Insight ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'indicator' as ActionId, label: 'Indicator', desc: 'wb-indicator series', icon: BarChart3, accent: '#3b82f6', handler: actIndicator },
    { id: 'country' as ActionId, label: 'Country', desc: 'wb-country profile', icon: Globe2, accent: '#22c55e', handler: actCountry },
    { id: 'compare' as ActionId, label: 'Compare', desc: 'wb-compare multi', icon: GitCompareArrows, accent: '#a855f7', handler: actCompare },
    { id: 'catalog' as ActionId, label: 'Catalog', desc: 'indicator aliases', icon: BookOpen, accent: '#f59e0b', handler: actCatalog },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private WB DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send data brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public viz', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Insight', desc: 'Agent: trend + policy', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-sky-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-sky-500/10 pb-2">
        <Globe2 className="h-4 w-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-white">Society / World Bank</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">data.worldbank.org · ~1400 indicators</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <input type="text" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 3))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="ISO-3 (USA)" />
        <input type="text" value={indicator} onChange={(e) => setIndicator(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="indicator (population / SP.POP.TOTL)" />
        <input type="text" value={compareCountries} onChange={(e) => setCompareCountries(e.target.value.toUpperCase())} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Compare csv" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
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
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {indicatorResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-60 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">{indicatorResult.countryName} · {indicatorResult.indicator}</div>
            {indicatorResult.latest && <div className="text-2xl font-bold text-blue-300">{indicatorResult.latest.value.toLocaleString()}<span className="text-xs text-zinc-400"> ({indicatorResult.latest.year})</span></div>}
            <div className="text-[10px] text-zinc-500">{indicatorResult.count} years of data</div>
            <div className="flex gap-0.5 mt-1 h-8 items-end">{indicatorResult.series.slice(0, 20).reverse().map((p, i) => { const max = Math.max(...indicatorResult.series.map(s => s.value)); return <div key={i} className="flex-1 rounded-t-sm bg-blue-400" style={{ height: `${(p.value / max) * 100}%` }} title={`${p.year}: ${p.value}`} />; })}</div>
          </div>
        )}
        {countryResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">{countryResult.name} · {countryResult.iso3}</div>
            <div className="text-[11px] text-zinc-300">capital: {countryResult.capital}</div>
            <div className="text-[10px] text-zinc-500">region: {countryResult.region}</div>
            <div className="text-[10px] text-zinc-500">income: {countryResult.incomeLevel}</div>
            <div className="text-[10px] text-zinc-500">lending: {countryResult.lendingType}</div>
            {countryResult.latitude != null && countryResult.longitude != null && <div className="text-[10px] text-zinc-500 font-mono">{countryResult.latitude.toFixed(2)}, {countryResult.longitude.toFixed(2)}</div>}
          </div>
        )}
        {compareResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-60 overflow-y-auto md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Compare · {compareResult.indicator}</div>
            {compareResult.points.slice(0, 10).map((p, i) => { const max = Math.max(...compareResult.points.map(p => p.value)); return <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex items-center gap-2"><span className="font-mono w-12 text-purple-200">{p.country}</span><div className="flex-1 h-2 bg-zinc-800 rounded-sm overflow-hidden"><div className="h-full bg-purple-400" style={{ width: `${(p.value / max) * 100}%` }} /></div><span className="font-mono text-purple-200 w-24 text-right">{p.value.toLocaleString()}</span><span className="text-zinc-500">({p.year})</span></div>; })}
          </div>
        )}
        {catalogResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-60 overflow-y-auto md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Indicator catalog · {catalogResult.count} aliases</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-1 mt-1">{Object.entries(catalogResult.indicators).slice(0, 30).map(([alias, code]) => <button key={alias} type="button" onClick={() => setIndicator(alias)} className="text-left text-[10px] bg-amber-500/5 hover:bg-amber-500/20 border border-amber-500/20 rounded px-2 py-1"><div className="text-amber-200 font-mono">{alias}</div><div className="text-zinc-500 text-[9px] truncate">{code}</div></button>)}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Insight</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
