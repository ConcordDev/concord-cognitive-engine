'use client';

/**
 * NonprofitActionPanel — Candid + GiveWell-shape NPO workbench.
 * donorRetention / grantReporting / campaignProgress / search-orgs +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Heart, Users, FileText, Target, Search, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('nonprofit', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'retention' | 'grant' | 'campaign' | 'search' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface RetentionResult { ratePct?: number; band?: string; lapsed?: number; recovered?: number }
interface GrantResult { totalGranted?: number; reportsDue?: number; nextDeadline?: string; spendDownPct?: number }
interface CampaignResult { raised?: number; goal?: number; progressPct?: number; daysLeft?: number }
interface Org { ein?: string; name: string; mission?: string; rating?: string }

export function NonprofitActionPanel() {
  const [orgName, setOrgName] = useState('');
  const [ein, setEin] = useState('');
  const [donorCount, setDonorCount] = useState('');
  const [lapsedCount, setLapsedCount] = useState('');
  const [campaignGoal, setCampaignGoal] = useState('');
  const [campaignRaised, setCampaignRaised] = useState('');
  const [campaignDaysLeft, setCampaignDaysLeft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [retentionResult, setRetentionResult] = useState<RetentionResult | null>(null);
  const [grantResult, setGrantResult] = useState<GrantResult | null>(null);
  const [campaignResult, setCampaignResult] = useState<CampaignResult | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

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

  async function actRetention() {
    setBusy('retention'); setFeedback(null);
    try { const r = await callMacro<RetentionResult>('donorRetention', { totalDonors: parseInt(donorCount, 10), lapsedDonors: parseInt(lapsedCount, 10) }); if (r.ok && r.result) { setRetentionResult(r.result); pipe.publish('nonprofit.retention', r.result, { label: `${r.result.ratePct}%` }); ok(`Retention: ${r.result.ratePct}%.`); } else err(r.error ?? 'retention failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actGrant() {
    setBusy('grant'); setFeedback(null);
    try { const r = await callMacro<GrantResult>('grantReporting', {}); if (r.ok && r.result) { setGrantResult(r.result); pipe.publish('nonprofit.grant', r.result, { label: `${r.result.reportsDue} due` }); ok(`${r.result.reportsDue} reports due.`); } else err(r.error ?? 'grant failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCampaign() {
    setBusy('campaign'); setFeedback(null);
    try { const r = await callMacro<CampaignResult>('campaignProgress', { goal: parseFloat(campaignGoal), raised: parseFloat(campaignRaised), daysLeft: parseInt(campaignDaysLeft, 10) }); if (r.ok && r.result) { setCampaignResult(r.result); pipe.publish('nonprofit.campaign', r.result, { label: `${r.result.progressPct}% raised` }); ok(`${r.result.progressPct}% raised.`); } else err(r.error ?? 'campaign failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSearch() {
    if (!searchQuery.trim()) { err('Query required.'); return; }
    setBusy('search'); setFeedback(null);
    try { const r = await callMacro<{ orgs?: Org[] }>('search-orgs', { query: searchQuery.trim(), limit: 10 }); if (r.ok && r.result?.orgs) { setOrgs(r.result.orgs); pipe.publish('nonprofit.orgs', r.result.orgs, { label: `${r.result.orgs.length} orgs` }); ok(`${r.result.orgs.length} orgs.`); } else err(r.error ?? 'search failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `NPO — ${orgName.trim() || 'analysis'}`, tags: ['nonprofit', ein].filter(Boolean), source: 'nonprofit:org:mint', meta: { visibility: 'private', consent: { allowCitations: false }, npo: { orgName, ein, retention: retentionResult, grant: grantResult, campaign: campaignResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('nonprofit.mintedDtuId', id, { label: `org ${id.slice(0, 8)}` }); ok(`NPO DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`💗 ${orgName || 'NPO'} brief`, '', retentionResult ? `Retention: ${retentionResult.ratePct}% (${retentionResult.band})` : '', campaignResult ? `Campaign: ${campaignResult.progressPct}% raised (${campaignResult.daysLeft}d left)` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
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
    if (!campaignResult) { err('Run a campaign first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Campaign — ${orgName.trim() || 'public'}`, tags: ['nonprofit', 'campaign', 'public'], source: 'nonprofit:campaign:publish', meta: { visibility: 'public', consent: { allowCitations: true }, campaign: campaignResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('nonprofit.publishedDtuId', id, { label: `campaign ${id.slice(0, 8)}` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `NPO: ${orgName || 'unnamed'}. ${retentionResult ? `Retention ${retentionResult.ratePct}%.` : ''} ${campaignResult ? `Campaign ${campaignResult.progressPct}% raised.` : ''} Suggest the single highest-ROI donor-engagement move for next month. Plain text.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Move ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'retention' as ActionId, label: 'Retention', desc: 'donorRetention rate', icon: Users, accent: '#22c55e', handler: actRetention },
    { id: 'grant' as ActionId, label: 'Grants', desc: 'grantReporting deadlines', icon: FileText, accent: '#06b6d4', handler: actGrant },
    { id: 'campaign' as ActionId, label: 'Campaign', desc: 'campaignProgress %', icon: Target, accent: '#f97316', handler: actCampaign },
    { id: 'search' as ActionId, label: 'Search orgs', desc: 'search-orgs by query', icon: Search, accent: '#8b5cf6', handler: actSearch },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private NPO DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief to board', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public campaign + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Engage', desc: 'Agent: top engagement move', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-rose-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-rose-500/10 pb-2">
        <Heart className="h-4 w-4 text-rose-400" />
        <h3 className="text-sm font-semibold text-white">Nonprofit workbench</h3>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Org name" />
        <input type="text" value={ein} onChange={(e) => setEin(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="EIN" />
        <input type="text" value={donorCount} onChange={(e) => setDonorCount(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Donor count" />
        <input type="text" value={lapsedCount} onChange={(e) => setLapsedCount(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Lapsed" />
        <input type="text" value={campaignGoal} onChange={(e) => setCampaignGoal(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Goal $" />
        <input type="text" value={campaignRaised} onChange={(e) => setCampaignRaised(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Raised $" />
        <input type="text" value={campaignDaysLeft} onChange={(e) => setCampaignDaysLeft(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Days left" />
        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Org search" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {retentionResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Retention ({retentionResult.band})</div>
            <div className="text-2xl font-bold text-emerald-300">{retentionResult.ratePct}%</div>
            <div className="text-[10px] text-zinc-400">lapsed {retentionResult.lapsed} · recovered {retentionResult.recovered}</div>
          </div>
        )}
        {campaignResult && (
          <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold">Campaign</div>
            <div className="text-2xl font-bold text-orange-300">${campaignResult.raised?.toLocaleString()} <span className="text-xs text-zinc-400">/ ${campaignResult.goal?.toLocaleString()}</span></div>
            <div className="h-2 bg-zinc-800 rounded-full mt-1 overflow-hidden"><div className="h-full bg-orange-400" style={{ width: `${Math.min(100, campaignResult.progressPct ?? 0)}%` }} /></div>
            <div className="text-[10px] text-zinc-400 mt-1">{campaignResult.progressPct}% · {campaignResult.daysLeft}d left</div>
          </div>
        )}
        {grantResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Grants</div>
            <div className="text-sm text-zinc-100">${grantResult.totalGranted?.toLocaleString()} · {grantResult.reportsDue} reports due</div>
            <div className="text-[10px] text-zinc-400">next: {grantResult.nextDeadline} · spend-down {grantResult.spendDownPct}%</div>
          </div>
        )}
        {orgs.length > 0 && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-40 overflow-y-auto md:col-span-3">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Orgs ({orgs.length})</div>
            {orgs.slice(0, 8).map((o, i) => <div key={i} className="text-[11px] text-zinc-300"><strong className="text-purple-200">{o.name}</strong> <span className="font-mono text-zinc-400">{o.ein}</span>{o.rating && <span className="text-emerald-300 ml-2">{o.rating}</span>}{o.mission && <div className="text-zinc-400 line-clamp-1">{o.mission}</div>}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Engagement move</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
