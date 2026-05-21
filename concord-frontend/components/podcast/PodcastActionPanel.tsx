'use client';

/**
 * PodcastActionPanel — Apple Podcasts + Buzzsprout-shape workbench.
 * Surfaces episodeAnalytics / guestResearch / productionChecklist /
 * monetizationCalc + mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Mic, BarChart3, UserSearch, ListChecks, DollarSign,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('podcast', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'analytics' | 'guest' | 'checklist' | 'monetize' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface AnalyticsResult { totalListens?: number; avgListensPerEpisode?: number; topEpisode?: string; growth?: string; completionRate?: number }
interface GuestResult { name?: string; topics?: string[]; questionSuggestions?: string[]; prepChecklist?: string[] }
interface ChecklistResult { totalSteps?: number; completed?: number; progress?: number; nextStep?: string }
interface MonetizeResult { adRevenue?: number; premiumRevenue?: number; totalMonthlyRevenue?: number; annualProjection?: number; tier?: string; nextMilestone?: string }

export function PodcastActionPanel() {
  const [showTitle, setShowTitle] = useState('');
  const [episodes, setEpisodes] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestTopics, setGuestTopics] = useState('');
  const [downloads, setDownloads] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [analyticsResult, setAnalyticsResult] = useState<AnalyticsResult | null>(null);
  const [guestResult, setGuestResult] = useState<GuestResult | null>(null);
  const [checklistResult, setChecklistResult] = useState<ChecklistResult | null>(null);
  const [monetizeResult, setMonetizeResult] = useState<MonetizeResult | null>(null);
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

  async function actAnalytics() {
    const eps = episodes.split('\n').map(l => { const m = l.trim().match(/^(.+?)\s+(\d+)$/); return m ? { title: m[1], listens: parseInt(m[2], 10) } : null; }).filter(Boolean);
    if (!eps.length) { err('Add episodes (title listens per line).'); return; }
    setBusy('analytics'); setFeedback(null);
    try { const r = await callMacro<AnalyticsResult>('episodeAnalytics', { episodes: eps }); if (r.ok && r.result) { setAnalyticsResult(r.result); pipe.publish('podcast.analytics', r.result, { label: `${r.result.totalListens} listens` }); ok(`${r.result.totalListens} total listens.`); } else err(r.error ?? 'analytics failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actGuest() {
    if (!guestName.trim()) { err('Guest name required.'); return; }
    setBusy('guest'); setFeedback(null);
    try { const r = await callMacro<GuestResult>('guestResearch', { name: guestName.trim(), topics: guestTopics.split('\n').map(s => s.trim()).filter(Boolean) }); if (r.ok && r.result) { setGuestResult(r.result); pipe.publish('podcast.guest', r.result, { label: r.result.name ?? guestName }); ok(`${r.result.questionSuggestions?.length ?? 0} questions suggested.`); } else err(r.error ?? 'guest failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actChecklist() {
    setBusy('checklist'); setFeedback(null);
    try { const r = await callMacro<ChecklistResult>('productionChecklist', { completedSteps: [] }); if (r.ok && r.result) { setChecklistResult(r.result); pipe.publish('podcast.checklist', r.result, { label: `${r.result.progress}% done` }); ok(`${r.result.progress}% done.`); } else err(r.error ?? 'checklist failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMonetize() {
    setBusy('monetize'); setFeedback(null);
    try { const r = await callMacro<MonetizeResult>('monetizationCalc', { monthlyDownloads: parseInt(downloads, 10) }); if (r.ok && r.result) { setMonetizeResult(r.result); pipe.publish('podcast.monetize', r.result, { label: `$${r.result.totalMonthlyRevenue}/mo` }); ok(`$${r.result.totalMonthlyRevenue}/mo.`); } else err(r.error ?? 'monetize failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Podcast — ${showTitle.trim() || 'show'}`, tags: ['podcast', monetizeResult?.tier ?? 'unknown'], source: 'podcast:show:mint', meta: { visibility: 'private', consent: { allowCitations: false }, podcast: { show: showTitle, analytics: analyticsResult, guest: guestResult, checklist: checklistResult, monetize: monetizeResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('podcast.mintedDtuId', id, { label: `show ${id.slice(0, 8)}` }); ok(`Show DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🎙 Podcast: ${showTitle || 'show'}`, '', analyticsResult ? `Listens: ${analyticsResult.totalListens} · avg ${analyticsResult.avgListensPerEpisode}` : '', guestResult ? `Guest: ${guestResult.name} (${guestResult.topics?.join(', ')})` : '', monetizeResult ? `Rev: $${monetizeResult.totalMonthlyRevenue}/mo (${monetizeResult.tier})` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
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
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Public show notes — ${showTitle.trim()}`, tags: ['podcast', 'public', 'show-notes'], source: 'podcast:notes:publish', meta: { visibility: 'public', consent: { allowCitations: true }, showNotes: { show: showTitle, guest: guestResult?.name, topics: guestResult?.topics, questions: guestResult?.questionSuggestions } } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('podcast.publishedDtuId', id, { label: `notes ${id.slice(0, 8)}` }); ok(`Notes published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Podcast: "${showTitle || 'show'}". ${analyticsResult ? `${analyticsResult.totalListens} listens, ${analyticsResult.growth}.` : ''} ${monetizeResult ? `$${monetizeResult.totalMonthlyRevenue}/mo, ${monetizeResult.tier}.` : ''} Suggest the next single growth move (audience, sponsorship, or production) that gets us to the next tier. Plain text.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Growth move ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'analytics' as ActionId, label: 'Analytics', desc: 'episodeAnalytics totals + top', icon: BarChart3, accent: '#06b6d4', handler: actAnalytics },
    { id: 'guest' as ActionId, label: 'Guest prep', desc: 'guestResearch questions + checklist', icon: UserSearch, accent: '#8b5cf6', handler: actGuest },
    { id: 'checklist' as ActionId, label: 'Production', desc: 'productionChecklist progress', icon: ListChecks, accent: '#22c55e', handler: actChecklist },
    { id: 'monetize' as ActionId, label: 'Money', desc: 'monetizationCalc ad + premium', icon: DollarSign, accent: '#eab308', handler: actMonetize },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private show DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send show brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public show notes + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Growth', desc: 'Agent: next growth move', icon: Wand2, accent: '#f97316', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-rose-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-rose-500/10 pb-2">
        <Mic className="h-4 w-4 text-rose-400" />
        <h3 className="text-sm font-semibold text-white">Podcast workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">apple podcasts · buzzsprout</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input type="text" value={showTitle} onChange={(e) => setShowTitle(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Show title" />
        <input type="text" value={guestName} onChange={(e) => setGuestName(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Guest name" />
        <input type="text" value={downloads} onChange={(e) => setDownloads(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Monthly downloads" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Episodes (title listens per line)</label><textarea value={episodes} onChange={(e) => setEpisodes(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-rose-200 font-mono focus:outline-none focus:ring-2 focus:ring-rose-400/40 resize-none" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Guest topics (one per line)</label><textarea value={guestTopics} onChange={(e) => setGuestTopics(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-rose-200 font-mono focus:outline-none focus:ring-2 focus:ring-rose-400/40 resize-none" /></div>
      </div>

      <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient (co-host / producer)" />

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
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        {analyticsResult && <Tile label="Listens" big={`${(analyticsResult.totalListens ?? 0).toLocaleString()}`} sub={`avg ${analyticsResult.avgListensPerEpisode}/ep · ${analyticsResult.growth}`} accent="#06b6d4" />}
        {guestResult && <Tile label="Guest prep" big={`${guestResult.questionSuggestions?.length ?? 0}q`} sub={guestResult.name} accent="#8b5cf6" />}
        {checklistResult && <Tile label="Production" big={`${checklistResult.progress}%`} sub={`next: ${checklistResult.nextStep}`} accent="#22c55e" />}
        {monetizeResult && <Tile label="Revenue" big={`$${(monetizeResult.totalMonthlyRevenue ?? 0).toLocaleString()}/mo`} sub={`${monetizeResult.tier} · annual ~$${((monetizeResult.annualProjection ?? 0) / 1000).toFixed(1)}k`} accent="#eab308" />}
      </div>

      {monetizeResult?.nextMilestone && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2.5 text-[11px] text-zinc-300">
          💰 <strong className="text-yellow-200">Next milestone:</strong> {monetizeResult.nextMilestone}
        </div>
      )}

      {agentReply && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-orange-300 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Growth move</div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>
            {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Tile({ label, big, sub, accent }: { label: string; big: string; sub?: string; accent: string }) {
  return (
    <div className="rounded-md border p-2.5" style={{ borderColor: accent + '60', backgroundColor: accent + '10' }}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">{label}</div>
      <div className="text-xl font-bold truncate" style={{ color: accent }}>{big}</div>
      {sub && <div className="text-[10px] text-zinc-400 truncate">{sub}</div>}
    </div>
  );
}
