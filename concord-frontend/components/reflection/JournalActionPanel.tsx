'use client';

/**
 * JournalActionPanel — Day One-shape action surface for the reflection
 * lens. Self-contained entry composer + actions wiring the 3 existing
 * reflection macros plus mint/DM/publish/agent.
 *
 *   1. Insights        → reflection.insightExtraction (themes, mood,
 *                          patterns from the entry text)
 *   2. Growth          → reflection.growthMetrics (run against
 *                          recent entries; trend metric)
 *   3. Habits          → reflection.habitTracking (parse mentioned
 *                          habits; surface streaks)
 *   4. Save entry      → dtu.create private journal DTU
 *   5. DM to a friend  → /api/social/dm with the entry text
 *   6. Publish gratitude → public DTU + flag published (sanitized
 *                          for federation pickup if user opts in)
 *   7. Prompt me (agent) → chat_agent.do "give me a thoughtful
 *                          journaling prompt based on recent themes"
 */

import { useState } from 'react';
import {
  PenLine, TrendingUp, Activity, Lightbulb,
  Sparkles, Send, Globe, Wand2, Heart,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('reflection', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'insights' | 'growth' | 'habits' | 'save' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface InsightResult { themes?: string[]; mood?: string; patterns?: string[]; takeaways?: string[]; sentiment?: number }
interface GrowthResult { trends?: Array<{ metric: string; value: number; delta?: number }>; summary?: string }
interface HabitResult { habits?: Array<{ name: string; streak?: number; missedDays?: number }>; total?: number }

export function JournalActionPanel() {
  const [entryTitle, setEntryTitle] = useState('');
  const [entryBody, setEntryBody] = useState('');
  const [mood, setMood] = useState<'great' | 'good' | 'ok' | 'low' | 'rough'>('good');
  const [dmRecipient, setDmRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [insightResult, setInsightResult] = useState<InsightResult | null>(null);
  const [growthResult, setGrowthResult] = useState<GrowthResult | null>(null);
  const [habitResult, setHabitResult] = useState<HabitResult | null>(null);
  const [savedDtuId, setSavedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentPrompt, setAgentPrompt] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });
  const ready = entryBody.trim().length > 0;

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

  async function actInsights() {
    if (!ready) { err('Write the entry first.'); return; }
    setBusy('insights'); setFeedback(null);
    try {
      const r = await callMacro<InsightResult>('insightExtraction', { entry: entryBody.trim(), mood });
      if (r.ok && r.result) { setInsightResult(r.result); pipe.publish('reflection.insights', r.result, { label: `${r.result.themes?.length ?? 0} themes` }); ok('Insights extracted.'); }
      else err(r.error ?? 'insights failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actGrowth() {
    setBusy('growth'); setFeedback(null);
    try {
      const r = await callMacro<GrowthResult>('growthMetrics', { window: 'last_30_days', currentEntry: entryBody.trim() });
      if (r.ok && r.result) { setGrowthResult(r.result); pipe.publish('reflection.growth', r.result, { label: `${r.result.trends?.length ?? 0} trends` }); ok('Growth metrics ready.'); }
      else err(r.error ?? 'growth metrics failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actHabits() {
    if (!ready) { err('Write the entry first.'); return; }
    setBusy('habits'); setFeedback(null);
    try {
      const r = await callMacro<HabitResult>('habitTracking', { entry: entryBody.trim() });
      if (r.ok && r.result) { setHabitResult(r.result); pipe.publish('reflection.habits', r.result, { label: `${r.result.habits?.length ?? 0} habits` }); ok(`${r.result.habits?.length ?? 0} habits parsed.`); }
      else err(r.error ?? 'habits failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actSave() {
    if (!ready) { err('Write the entry first.'); return; }
    setBusy('save'); setFeedback(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: {
          title: entryTitle.trim() || `Journal — ${today}`,
          tags: ['reflection', 'journal', 'entry', `mood:${mood}`, `date:${today}`],
          source: 'reflection:journal:save',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            journal: {
              date: today,
              mood,
              title: entryTitle.trim(),
              entry: entryBody.trim(),
              insights: insightResult,
              habits: habitResult,
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setSavedDtuId(id); pipe.publish('reflection.savedDtuId', id, { label: `entry ${id.slice(0, 8)}` }); ok(`Saved DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!ready) { err('Write the entry first.'); return; }
    if (!dmRecipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `📓 ${entryTitle.trim() || 'Journal entry'}`,
      ``,
      `Mood: ${mood}`,
      ``,
      entryBody.trim(),
    ].join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: dmRecipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setDmRecipient(''); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    if (!ready) { err('Write the entry first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({
          domain: 'dtu', name: 'create',
          input: {
            title: `Gratitude — ${entryTitle.trim() || new Date().toISOString().slice(0, 10)}`,
            tags: ['reflection', 'gratitude', 'public'],
            source: 'reflection:gratitude:publish',
            meta: {
              visibility: 'public',
              consent: { allowCitations: true },
              gratitude: {
                date: new Date().toISOString().slice(0, 10),
                mood,
                themes: insightResult?.themes ?? [],
                takeaways: insightResult?.takeaways ?? [],
                body: entryBody.trim().slice(0, 2000),
              },
            },
          },
        });
        const dtu = r.data?.result?.dtu ?? r.data?.result;
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('reflection.publishedDtuId', id, { label: `gratitude ${id.slice(0, 8)}` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentPrompt(null);
    try {
      const task = [
        `Give me a single thoughtful journaling prompt for today's entry.`,
        insightResult?.themes?.length ? `Recent themes: ${insightResult.themes.join(', ')}.` : '',
        insightResult?.mood ? `Current mood: ${insightResult.mood}.` : `Today's mood: ${mood}.`,
        ``,
        `Return only the prompt - one or two sentences, plaintext, no preamble. Make it specific and unobvious.`,
      ].filter(Boolean).join(' ');
      const r = await lensRun({
        domain: 'chat_agent', name: 'do',
        input: { task, maxTurns: 3 },
      });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) {
        setAgentPrompt(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Prompt ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'insights', label: 'Insights',  desc: 'Themes / mood / patterns from this entry',         icon: Lightbulb, accent: '#eab308', handler: actInsights, disabled: !ready },
    { id: 'growth',   label: 'Growth',    desc: 'Trend across last 30 days of entries',             icon: TrendingUp, accent: '#06b6d4', handler: actGrowth },
    { id: 'habits',   label: 'Habits',    desc: 'Parse habits + streaks from entry',                icon: Activity, accent: '#8b5cf6', handler: actHabits, disabled: !ready },
    { id: 'save',     label: savedDtuId      ? 'Saved'     : 'Save entry',       desc: savedDtuId      ? `DTU ${savedDtuId.slice(0, 8)}…`      : 'Private journal DTU (mood + insights)',           icon: Sparkles, accent: '#3b82f6', handler: actSave,    disabled: !ready || !!savedDtuId },
    { id: 'dm',       label: 'DM friend', desc: 'Share entry with a trusted user',                  icon: Send,     accent: '#ec4899', handler: actDm, disabled: !ready },
    { id: 'publish',  label: publishedDtuId ? 'Published' : 'Publish gratitude', desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Sanitized public DTU with themes + takeaways',     icon: Globe,    accent: '#22c55e', handler: actPublish, disabled: !ready || !!publishedDtuId },
    { id: 'agent',    label: 'Prompt me', desc: 'Agent surfaces a specific journaling prompt',      icon: Wand2,    accent: '#f97316', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <PenLine className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Journal entry</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          day one
        </span>
        <span className="ml-auto text-[10px] text-zinc-400 font-mono">{new Date().toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric' })}</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input type="text" value={entryTitle} onChange={(e) => setEntryTitle(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-400/40" placeholder="Title (optional)" />
        <select value={mood} onChange={(e) => setMood(e.target.value as typeof mood)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-white">
          <option value="great">😄 Great</option>
          <option value="good">🙂 Good</option>
          <option value="ok">😐 OK</option>
          <option value="low">😕 Low</option>
          <option value="rough">😩 Rough</option>
        </select>
        <input type="text" value={dmRecipient} onChange={(e) => setDmRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40" placeholder="DM recipient (optional)" />
      </div>

      <textarea
        value={entryBody}
        onChange={(e) => setEntryBody(e.target.value)}
        rows={8}
        className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-400/40 resize-y leading-relaxed"
        placeholder={agentPrompt ? agentPrompt : 'What\'s on your mind today?'}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button
              key={a.id} type="button"
              disabled={a.disabled || !!busy}
              onClick={a.handler}
              className={cn(
                'group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all',
                'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/40 disabled:hover:border-zinc-800',
                'focus:outline-none focus:ring-2 focus:ring-blue-400/40',
              )}
            >
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[12px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      {insightResult && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2.5 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-yellow-300 font-semibold flex items-center gap-1.5">
            <Lightbulb className="w-3 h-3" /> Insights
          </div>
          {insightResult.mood && <div className="text-[11px] text-zinc-300"><strong className="text-yellow-200">Mood:</strong> {insightResult.mood}</div>}
          {insightResult.themes?.length ? (
            <div className="text-[11px] text-zinc-300">
              <strong className="text-yellow-200">Themes:</strong>{' '}
              {insightResult.themes.map((t, i) => <span key={i} className="inline-block rounded bg-yellow-500/20 text-yellow-200 px-1.5 py-0.5 mr-1 mb-0.5">{t}</span>)}
            </div>
          ) : null}
          {insightResult.patterns?.length ? (
            <div className="text-[11px] text-zinc-300"><strong className="text-yellow-200">Patterns:</strong> {insightResult.patterns.join(' · ')}</div>
          ) : null}
          {insightResult.takeaways?.length ? (
            <ul className="text-[11px] text-zinc-300 list-disc list-inside">
              {insightResult.takeaways.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          ) : null}
        </div>
      )}

      {growthResult && (
        <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3" /> Growth (30 days)
          </div>
          {growthResult.summary && <p className="text-[11px] text-zinc-300">{growthResult.summary}</p>}
          {growthResult.trends?.length ? (
            <div className="grid grid-cols-3 gap-1">
              {growthResult.trends.map((t, i) => (
                <div key={i} className="rounded bg-zinc-900/60 px-2 py-1 text-[10px]">
                  <div className="text-zinc-400">{t.metric}</div>
                  <div className="text-cyan-300 font-mono">
                    {t.value}{t.delta != null && <span className={cn('ml-1 text-[9px]', t.delta >= 0 ? 'text-emerald-300' : 'text-rose-300')}>({t.delta >= 0 ? '+' : ''}{t.delta})</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {habitResult && (
        <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold flex items-center gap-1.5">
            <Activity className="w-3 h-3" /> Habits ({habitResult.total ?? habitResult.habits?.length ?? 0})
          </div>
          {habitResult.habits?.map((h, i) => (
            <div key={i} className="flex items-center justify-between text-[11px] text-zinc-300">
              <span>{h.name}</span>
              <span className="font-mono">
                {h.streak != null && <span className="text-emerald-300">🔥 {h.streak}d</span>}
                {h.missedDays ? <span className="text-amber-300 ml-2">⚠ {h.missedDays} missed</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}

      {agentPrompt && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-3">
          <div className="flex items-center gap-1.5 text-orange-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
            <Heart className="w-3 h-3" /> Prompt for you
          </div>
          <p className="text-[12px] text-zinc-200 italic leading-relaxed">{agentPrompt}</p>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div
            key={feedback.text}
            initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn(
              'px-3 py-2 rounded text-[11px] flex items-start gap-2 border',
              feedback.kind === 'ok'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-red-500/10 text-red-300 border-red-500/30',
            )}
          >
            {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
