'use client';

/**
 * NewsActionPanel — Ground News + AllSides-shape news literacy
 * workbench. Surfaces biasDetection / eventExtraction / narrativeTracking /
 * daily-briefing + mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Newspaper, Compass, Calendar, TrendingUp, RadioTower,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('news', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'bias' | 'events' | 'narrative' | 'briefing' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface BiasResult { lean?: string; score?: number; loadedWords?: string[]; balanceScore?: number }
interface EventsResult { events?: Array<{ who: string; what: string; when?: string; where?: string }>; total?: number }
interface NarrativeResult { dominantNarrative?: string; competingNarratives?: string[]; shiftDetected?: boolean }
interface BriefingResult { headlines?: Array<{ source: string; headline: string; url?: string }>; topTopics?: string[] }

export function NewsActionPanel() {
  const [headline, setHeadline] = useState('');
  const [articleText, setArticleText] = useState('');
  const [topic, setTopic] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [biasResult, setBiasResult] = useState<BiasResult | null>(null);
  const [eventsResult, setEventsResult] = useState<EventsResult | null>(null);
  const [narrativeResult, setNarrativeResult] = useState<NarrativeResult | null>(null);
  const [briefingResult, setBriefingResult] = useState<BriefingResult | null>(null);
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

  async function actBias() {
    if (!articleText.trim()) { err('Add article text.'); return; }
    setBusy('bias'); setFeedback(null);
    try { const r = await callMacro<BiasResult>('biasDetection', { text: articleText, headline }); if (r.ok && r.result) { setBiasResult(r.result); pipe.publish('news.bias', r.result, { label: r.result.lean ?? 'lean' }); ok(`Lean: ${r.result.lean}.`); } else err(r.error ?? 'bias failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actEvents() {
    if (!articleText.trim()) { err('Add article text.'); return; }
    setBusy('events'); setFeedback(null);
    try { const r = await callMacro<EventsResult>('eventExtraction', { text: articleText }); if (r.ok && r.result) { setEventsResult(r.result); pipe.publish('news.events', r.result, { label: `${r.result.total ?? 0} events` }); ok(`${r.result.total ?? 0} events.`); } else err(r.error ?? 'events failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actNarrative() {
    if (!topic.trim()) { err('Topic required.'); return; }
    setBusy('narrative'); setFeedback(null);
    try { const r = await callMacro<NarrativeResult>('narrativeTracking', { topic: topic.trim() }); if (r.ok && r.result) { setNarrativeResult(r.result); pipe.publish('news.narrative', r.result, { label: r.result.shiftDetected ? 'SHIFT' : 'stable' }); ok(r.result.shiftDetected ? 'Narrative SHIFT.' : 'Narrative stable.'); } else err(r.error ?? 'narrative failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actBriefing() {
    setBusy('briefing'); setFeedback(null);
    try { const r = await callMacro<BriefingResult>('daily-briefing', {}); if (r.ok && r.result) { setBriefingResult(r.result); pipe.publish('news.briefing', r.result, { label: `${r.result.headlines?.length ?? 0} headlines` }); ok(`${r.result.headlines?.length ?? 0} headlines.`); } else err(r.error ?? 'briefing failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `News — ${headline.trim() || topic.trim() || 'snapshot'}`, tags: ['news', biasResult?.lean ?? 'unknown', topic ? `topic:${topic.trim().toLowerCase()}` : ''].filter(Boolean), source: 'news:snapshot:mint', meta: { visibility: 'private', consent: { allowCitations: false }, news: { headline, topic, bias: biasResult, events: eventsResult, narrative: narrativeResult, briefing: briefingResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('news.mintedDtuId', id, { label: `snapshot ${id.slice(0, 8)}` }); ok(`News DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📰 News brief: ${headline || topic || 'snapshot'}`, '', biasResult ? `Bias: ${biasResult.lean} (${biasResult.score})` : '', eventsResult ? `Events: ${eventsResult.total}` : '', narrativeResult ? `Narrative: ${narrativeResult.dominantNarrative}${narrativeResult.shiftDetected ? ' (SHIFT)' : ''}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
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
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `News literacy — ${topic || 'snapshot'}`, tags: ['news', 'literacy', 'public', biasResult?.lean ?? 'unknown'], source: 'news:literacy:publish', meta: { visibility: 'public', consent: { allowCitations: true }, literacy: { topic, bias: biasResult, narrative: narrativeResult } } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('news.publishedDtuId', id, { label: `literacy ${id.slice(0, 8)}` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `News topic: "${topic || headline || 'general'}". ${biasResult ? `Lean: ${biasResult.lean}.` : ''} ${narrativeResult ? `Narrative: ${narrativeResult.dominantNarrative}.` : ''} Suggest 3 cross-spectrum sources I should read this week to get balanced coverage. Plain text, one per line, with why each adds a different angle.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Source list ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'bias' as ActionId, label: 'Bias', desc: 'biasDetection lean + loaded words', icon: Compass, accent: '#ef4444', handler: actBias },
    { id: 'events' as ActionId, label: 'Events', desc: 'eventExtraction who/what/when/where', icon: Calendar, accent: '#06b6d4', handler: actEvents },
    { id: 'narrative' as ActionId, label: 'Narrative', desc: 'narrativeTracking + shift detection', icon: TrendingUp, accent: '#8b5cf6', handler: actNarrative },
    { id: 'briefing' as ActionId, label: 'Briefing', desc: 'daily-briefing top headlines', icon: RadioTower, accent: '#eab308', handler: actBriefing },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private news DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send literacy brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public literacy DTU + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Cross-spec', desc: 'Agent: 3 cross-spectrum sources', icon: Wand2, accent: '#f97316', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-yellow-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-yellow-500/10 pb-2">
        <Newspaper className="h-4 w-4 text-yellow-400" />
        <h3 className="text-sm font-semibold text-white">News literacy workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">ground · allsides</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input type="text" value={headline} onChange={(e) => setHeadline(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Headline" />
        <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Topic (for narrative tracking)" />
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Article text</label>
        <textarea value={articleText} onChange={(e) => setArticleText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-[12px] text-yellow-100 focus:outline-none focus:ring-2 focus:ring-yellow-400/40 resize-y" placeholder="Paste article text to analyze bias + events…" />
      </div>

      <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {biasResult && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-rose-300 font-semibold">Bias: {biasResult.lean}</div>
            <div className="text-2xl font-bold text-zinc-100">{biasResult.score}</div>
            {biasResult.loadedWords && <div className="text-[10px] text-zinc-400 mt-1">Loaded: {biasResult.loadedWords.slice(0, 5).join(', ')}</div>}
            {biasResult.balanceScore != null && <div className="text-[10px] text-zinc-400">Balance: {biasResult.balanceScore}/100</div>}
          </div>
        )}
        {eventsResult?.events && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Events ({eventsResult.total})</div>
            {eventsResult.events.slice(0, 6).map((e, i) => <div key={i} className="text-[11px] text-zinc-300"><strong className="text-cyan-200">{e.who}</strong> {e.what}{e.where && <span className="text-zinc-400"> · {e.where}</span>}</div>)}
          </div>
        )}
        {narrativeResult && (
          <div className={cn('rounded-md border p-2.5', narrativeResult.shiftDetected ? 'border-amber-500/40 bg-amber-500/5' : 'border-purple-500/30 bg-purple-500/5')}>
            <div className={cn('text-[10px] uppercase tracking-wider font-semibold', narrativeResult.shiftDetected ? 'text-amber-300' : 'text-purple-300')}>Narrative {narrativeResult.shiftDetected && '(SHIFT)'}</div>
            <div className="text-sm font-semibold text-zinc-100 mt-1">{narrativeResult.dominantNarrative}</div>
            {narrativeResult.competingNarratives && <div className="text-[10px] text-zinc-400 mt-1">vs: {narrativeResult.competingNarratives.slice(0, 3).join(' · ')}</div>}
          </div>
        )}
        {briefingResult?.headlines && (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-yellow-300 font-semibold">Briefing ({briefingResult.headlines.length})</div>
            {briefingResult.headlines.slice(0, 5).map((h, i) => <div key={i} className="text-[11px] text-zinc-300"><strong className="text-yellow-200">{h.source}:</strong> {h.headline.slice(0, 80)}</div>)}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-orange-300 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Cross-spectrum sources</div>
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
