'use client';

/**
 * MarketingActionPanel — growth marketer bench.
 * campaignROI / abTestAnalysis / funnelOptimize / audienceSegment +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Megaphone, FlaskConical, Filter, Users, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('marketing', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'roi' | 'ab' | 'funnel' | 'seg' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface RoiResult { campaign?: string; spend: number; revenue: number; roi: number; leads: number; conversions: number; costPerLead: number; costPerAcquisition: number; conversionRate: number; profitable: boolean; grade: string }
interface AbVariant { name: string; visitors: number; conversions: number; conversionRate: number }
interface AbResult { variants: AbVariant[]; winner: string; lift: number; statisticallySignificant: boolean; totalVisitors: number; recommendation: string }
interface FunnelStage { stage: string; visitors: number; dropoff: number; convFromTop: number }
interface FunnelResult { stages: FunnelStage[]; overallConversion: number; biggestLeakage?: string; leakageRate?: number; quickWin: string }
interface Segment { segment: string; users: number; totalSpend: number; avgSpend: number; share: number }
interface SegmentResult { totalUsers: number; segments: Segment[]; highValue?: string; pareto: string }

// No seeded data — every input starts empty. Paste real campaign / A/B /
// funnel / user JSON, or fill the ROI inputs from a live campaign.
export function MarketingActionPanel() {
  const [campaignName, setCampaignName] = useState('');
  const [spend, setSpend] = useState('');
  const [revenue, setRevenue] = useState('');
  const [leads, setLeads] = useState('');
  const [conversions, setConversions] = useState('');
  const [abText, setAbText] = useState('');
  const [funnelText, setFunnelText] = useState('');
  const [usersText, setUsersText] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [roiResult, setRoiResult] = useState<RoiResult | null>(null);
  const [abResult, setAbResult] = useState<AbResult | null>(null);
  const [funnelResult, setFunnelResult] = useState<FunnelResult | null>(null);
  const [segResult, setSegResult] = useState<SegmentResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actRoi() {
    if (!campaignName.trim() || !spend || !revenue) { err('Campaign name + spend + revenue required.'); return; }
    setBusy('roi'); setFeedback(null);
    try {
      const r = await callMacro<RoiResult>('campaignROI', { artifact: { data: { name: campaignName, spend: parseFloat(spend), revenue: parseFloat(revenue), leads: parseInt(leads, 10) || 0, conversions: parseInt(conversions, 10) || 0 } } });
      if (r.ok && r.result) { setRoiResult(r.result); pipe.publish('marketing.roi', r.result, { label: `ROI ${r.result.roi}% (${r.result.grade})` }); ok(`ROI ${r.result.roi}% · ${r.result.grade}.`); } else err(r.error ?? 'roi failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAb() {
    if (!abText.trim()) { err('Paste A/B variants JSON first.'); return; }
    try { const parsed = JSON.parse(abText); setBusy('ab'); setFeedback(null);
      const r = await callMacro<AbResult>('abTestAnalysis', { artifact: { data: parsed } });
      if (r.ok && r.result) { setAbResult(r.result); pipe.publish('marketing.ab', r.result, { label: `Winner: ${r.result.winner}` }); ok(`Winner: ${r.result.winner} (+${r.result.lift}%).`); } else err(r.error ?? 'ab failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid AB JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actFunnel() {
    if (!funnelText.trim()) { err('Paste funnel JSON first.'); return; }
    try { const parsed = JSON.parse(funnelText); setBusy('funnel'); setFeedback(null);
      const r = await callMacro<FunnelResult>('funnelOptimize', { artifact: { data: parsed } });
      if (r.ok && r.result) { setFunnelResult(r.result); pipe.publish('marketing.funnel', r.result, { label: `${r.result.overallConversion}% conv` }); ok(`${r.result.overallConversion}% conv · leak at ${r.result.biggestLeakage}.`); } else err(r.error ?? 'funnel failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid funnel JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSeg() {
    if (!usersText.trim()) { err('Paste users JSON first.'); return; }
    try { const parsed = JSON.parse(usersText); setBusy('seg'); setFeedback(null);
      const r = await callMacro<SegmentResult>('audienceSegment', { artifact: { data: parsed } });
      if (r.ok && r.result) { setSegResult(r.result); pipe.publish('marketing.seg', r.result, { label: `${r.result.segments.length} segments` }); ok(`${r.result.segments.length} segments · high-value: ${r.result.highValue}.`); } else err(r.error ?? 'seg failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid users JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Marketing — ${campaignName}`, tags: ['marketing', 'campaign', roiResult?.grade].filter((t): t is string => !!t), source: 'marketing:report:mint', meta: { visibility: 'private', consent: { allowCitations: false }, mkt: { roi: roiResult, ab: abResult, funnel: funnelResult, seg: segResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('marketing.mintedDtuId', id, { label: `Report DTU ${id.slice(0, 8)}…` }); ok(`Report DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📣 Marketing report`, '',
      roiResult ? `${roiResult.campaign}: ROI ${roiResult.roi}% (${roiResult.grade}) · CPL $${roiResult.costPerLead} · CPA $${roiResult.costPerAcquisition}` : '',
      abResult ? `A/B winner: ${abResult.winner} (+${abResult.lift}%${abResult.statisticallySignificant ? ' · significant' : ' · not significant'})` : '',
      funnelResult ? `Funnel: ${funnelResult.overallConversion}% top-to-bottom · biggest leak: ${funnelResult.biggestLeakage} (${funnelResult.leakageRate}%)` : '',
      segResult ? `Segments: ${segResult.segments.length} · highest LTV: ${segResult.highValue} (${segResult.pareto})` : '',
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
    if (!abResult && !funnelResult) { err('Run A/B or funnel first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Marketing playbook`, tags: ['marketing', 'playbook', 'public'], source: 'marketing:playbook:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, ab: abResult, funnel: funnelResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('marketing.publishedDtuId', id, { label: `Public playbook ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Growth marketing review. ${roiResult ? `Campaign ${roiResult.campaign}: ROI ${roiResult.roi}% (${roiResult.grade}).` : ''} ${abResult ? `A/B: ${abResult.recommendation}.` : ''} ${funnelResult ? `Funnel leak: ${funnelResult.biggestLeakage} (${funnelResult.leakageRate}%).` : ''} ${segResult?.highValue ? `High-value segment: ${segResult.highValue}.` : ''} Identify the single highest-ROI next action this quarter. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Play ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'roi' as ActionId, label: 'ROI', desc: 'campaignROI', icon: Megaphone, accent: '#f59e0b', handler: actRoi },
    { id: 'ab' as ActionId, label: 'A/B', desc: 'abTestAnalysis', icon: FlaskConical, accent: '#a855f7', handler: actAb },
    { id: 'funnel' as ActionId, label: 'Funnel', desc: 'funnelOptimize', icon: Filter, accent: '#3b82f6', handler: actFunnel },
    { id: 'seg' as ActionId, label: 'Segment', desc: 'audienceSegment', icon: Users, accent: '#22c55e', handler: actSeg },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private report DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send report', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon playbook', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Play', desc: 'Agent: top play', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const GRADE_COLOR: Record<string, string> = { exceptional: 'text-emerald-300', strong: 'text-blue-300', positive: 'text-amber-300', negative: 'text-red-300' };

  return (
    <div className="rounded-lg border border-fuchsia-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-fuchsia-500/10 pb-2">
        <Megaphone className="h-4 w-4 text-fuchsia-400" />
        <h3 className="text-sm font-semibold text-white">Marketing bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">ROI · A/B · funnel · segment</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">ROI inputs</div>
          <input type="text" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="Campaign" />
          <div className="grid grid-cols-2 gap-1">
            <input type="text" value={spend} onChange={(e) => setSpend(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Spend $" />
            <input type="text" value={revenue} onChange={(e) => setRevenue(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Revenue $" />
            <input type="text" value={leads} onChange={(e) => setLeads(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Leads" />
            <input type="text" value={conversions} onChange={(e) => setConversions(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Conversions" />
          </div>
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="DM recipient" />
          <div className="flex items-center gap-2 flex-wrap">
            <RecallSlot ctl={dmRecall} />
            <RecallSlot ctl={publishRecall} />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">A/B variants JSON</label>
          <textarea value={abText} onChange={(e) => setAbText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Funnel JSON</label>
          <textarea value={funnelText} onChange={(e) => setFunnelText(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold mt-1 block">Users JSON</label>
          <textarea value={usersText} onChange={(e) => setUsersText(e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
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
        {roiResult && (
          <div className={cn('rounded-md border p-2.5', roiResult.profitable ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">{roiResult.campaign} · {roiResult.grade}</div>
            <div className={cn('text-2xl font-bold', GRADE_COLOR[roiResult.grade])}>{roiResult.roi}%<span className="text-xs text-zinc-400"> ROI</span></div>
            <div className="text-[10px] text-zinc-500">CPL ${roiResult.costPerLead} · CPA ${roiResult.costPerAcquisition}</div>
            <div className="text-[10px] text-zinc-500">conv rate {roiResult.conversionRate}%</div>
          </div>
        )}
        {abResult && (
          <div className={cn('rounded-md border p-2.5 max-h-48 overflow-y-auto', abResult.statisticallySignificant ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">A/B · {abResult.winner} (+{abResult.lift}%)</div>
            <div className="text-[10px] text-zinc-500">{abResult.totalVisitors.toLocaleString()} visitors · {abResult.statisticallySignificant ? '✓ significant' : '⏳ keep testing'}</div>
            {abResult.variants.map((v, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex items-center gap-2"><span className="font-mono w-24 truncate">{v.name}</span><div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-purple-400" style={{ width: `${Math.min(100, v.conversionRate * 10)}%` }} /></div><span className="text-purple-200 font-mono">{v.conversionRate}%</span></div>)}
          </div>
        )}
        {funnelResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-48 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Funnel · {funnelResult.overallConversion}%</div>
            {funnelResult.stages.map((s, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5"><div className="flex items-center gap-2"><span className="font-mono w-20 truncate">{s.stage}</span><div className="flex-1 h-1 bg-zinc-800 rounded-sm overflow-hidden"><div className="h-full bg-blue-400" style={{ width: `${s.convFromTop}%` }} /></div><span className="font-mono text-blue-200">{s.visitors.toLocaleString()}</span></div>{i > 0 && <div className="text-[9px] text-zinc-500 ml-20">drop {s.dropoff}%</div>}</div>)}
            <div className="text-[10px] text-amber-300 mt-1 italic">{funnelResult.quickWin}</div>
          </div>
        )}
        {segResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-48 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Segments · {segResult.totalUsers} users</div>
            <div className="text-[10px] text-emerald-300">{segResult.pareto}</div>
            {segResult.segments.map((s, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5"><strong className="text-green-200">{s.segment}</strong> · {s.users} ({s.share}%) · avg ${s.avgSpend}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Top play</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
