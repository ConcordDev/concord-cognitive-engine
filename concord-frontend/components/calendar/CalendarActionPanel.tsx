'use client';

/**
 * CalendarActionPanel — scheduler bench over the user's REAL calendar.
 *
 * F9: this panel used to demand pasted JSON in an undocumented schema
 * and feed it to the generic artifact calculators; plausible input
 * (start/end keys) crashed the whole lens with a TypeError, and the
 * artifact macros' startTime/endTime schema silently disabled every
 * button. It now reads the same STATE-backed engine as the rest of the
 * lens — events-list / tasks-list for the census, conflicts-check
 * (pairwise) for conflicts, availability-find for free time,
 * ai-auto-schedule for task placement, ical-export for the .ics — and
 * every result is shape-checked before it is stored, so a malformed
 * response becomes inline feedback, never a render crash.
 */

import { useCallback, useEffect, useState } from 'react';
import { Calendar, AlertOctagon, Clock, ListChecks, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { browserTimeZone, calendarDateKey } from '@/lib/calendar-date';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('calendar', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'conf' | 'avail' | 'opt' | 'ical' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface RealEvent { id: string; title: string; start: string; end: string; occurrenceStart?: string; occurrenceEnd?: string }
interface ConflictPair { a: { title: string; start: string; end: string }; b: { title: string; start: string; end: string }; overlapMinutes: number }
interface ConfResult { pairs: ConflictPair[]; totalEvents: number }
interface FreeSlot { start: string; end: string; minutes: number }
interface AvailResult { date: string; freeSlots: FreeSlot[]; totalFreeMinutes: number; busyBlockCount: number }
interface Proposal { taskId: string; title: string; priority: string; estimateMin: number; proposedStart: string; proposedEnd: string }
interface OptResult { day: string; proposals: Proposal[]; scheduledCount: number; unscheduledCount: number }
interface IcalResult { ics: string; eventCount: number; contentType: string }

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const TODAY = calendarDateKey();

export function CalendarActionPanel() {
  const [recipient, setRecipient] = useState('');
  const [events, setEvents] = useState<RealEvent[]>([]);
  const [openTasks, setOpenTasks] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [committed, setCommitted] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confResult, setConfResult] = useState<ConfResult | null>(null);
  const [availResult, setAvailResult] = useState<AvailResult | null>(null);
  const [optResult, setOptResult] = useState<OptResult | null>(null);
  const [icalResult, setIcalResult] = useState<IcalResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  // The bench reads the real store: a month of events around today and
  // the open task list. Nothing is pasted; nothing is seeded.
  const loadReal = useCallback(async () => {
    const now = Date.now();
    const [ev, tk] = await Promise.all([
      callMacro<{ events: RealEvent[] }>('events-list', {
        rangeStart: new Date(now - 7 * 86_400_000).toISOString(),
        rangeEnd: new Date(now + 30 * 86_400_000).toISOString(),
      }),
      callMacro<{ tasks: Array<{ status: string }> }>('tasks-list', { status: 'todo' }),
    ]);
    if (ev.ok && ev.result && Array.isArray(ev.result.events)) {
      setEvents(ev.result.events);
      setLoadError('');
    } else {
      setLoadError(ev.error || 'Could not load your calendar events.');
    }
    if (tk.ok && tk.result && Array.isArray(tk.result.tasks)) setOpenTasks(tk.result.tasks.length);
  }, []);
  useEffect(() => { void loadReal(); }, [loadReal]);

  async function actConf() {
    setBusy('conf'); setFeedback(null);
    try {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 7 * 86_400_000);
      const r = await callMacro<{ pairs: ConflictPair[]; conflicts: unknown[] }>('conflicts-check', {
        start: start.toISOString(), end: end.toISOString(), pairwise: true,
      });
      if (r.ok && r.result && Array.isArray(r.result.pairs)) {
        const result: ConfResult = { pairs: r.result.pairs, totalEvents: events.length };
        setConfResult(result);
        pipe.publish('calendar.conf', result, { label: `Conf ${result.pairs.length}` });
        ok(`${result.pairs.length} conflict${result.pairs.length === 1 ? '' : 's'} across ${result.totalEvents} events this week.`);
      } else err(r.error ?? 'Conflicts check returned an unexpected shape.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  async function actAvail() {
    setBusy('avail'); setFeedback(null);
    try {
      const r = await callMacro<{ freeSlots: Array<{ start: string; end: string }>; busyBlockCount: number }>('availability-find', {
        day: TODAY, durationMin: 30, tz: browserTimeZone(),
      });
      if (r.ok && r.result && Array.isArray(r.result.freeSlots)) {
        const freeSlots: FreeSlot[] = r.result.freeSlots.map((s) => ({
          start: s.start, end: s.end,
          minutes: Math.round((new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000),
        }));
        const result: AvailResult = {
          date: TODAY, freeSlots,
          totalFreeMinutes: freeSlots.reduce((sum, s) => sum + s.minutes, 0),
          busyBlockCount: r.result.busyBlockCount || 0,
        };
        setAvailResult(result);
        pipe.publish('calendar.avail', result, { label: `Avail ${result.totalFreeMinutes}min` });
        ok(`${freeSlots.length} free slots · ${result.totalFreeMinutes} min free today.`);
      } else err(r.error ?? 'Availability returned an unexpected shape.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  async function actOpt() {
    setBusy('opt'); setFeedback(null);
    try {
      const r = await callMacro<OptResult>('ai-auto-schedule', { day: TODAY, tz: browserTimeZone() });
      if (r.ok && r.result && Array.isArray(r.result.proposals)) {
        setOptResult(r.result);
        pipe.publish('calendar.opt', r.result, { label: `Opt ${r.result.scheduledCount}` });
        ok(`${r.result.scheduledCount} task${r.result.scheduledCount === 1 ? '' : 's'} placed${r.result.unscheduledCount ? `, ${r.result.unscheduledCount} didn't fit` : ''}.`);
      } else err(r.error ?? 'Auto-schedule returned an unexpected shape.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  async function commitProposal(p: Proposal) {
    const r = await callMacro('tasks-time-block', { taskId: p.taskId, start: p.proposedStart });
    if (r.ok) {
      setCommitted((prev) => new Set(prev).add(p.taskId));
      ok(`Blocked "${p.title}" at ${fmtTime(p.proposedStart)}.`);
      await loadReal();
    } else {
      err(r.error ?? 'Could not commit that proposal.');
    }
  }

  async function actIcal() {
    setBusy('ical'); setFeedback(null);
    try {
      const r = await callMacro<IcalResult>('ical-export', {
        calendarName: 'Concord Calendar',
        events: events.map((e) => ({
          uid: e.id, summary: e.title,
          start: e.occurrenceStart || e.start, end: e.occurrenceEnd || e.end,
        })),
      });
      if (r.ok && r.result && typeof r.result.ics === 'string') { setIcalResult(r.result); ok(`ICS: ${r.result.eventCount} events.`); }
      else err(r.error ?? 'iCal export returned an unexpected shape.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  function downloadIcs() {
    if (!icalResult) return;
    const blob = new Blob([icalResult.ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `concord-${TODAY}.ics`; a.click();
    URL.revokeObjectURL(url);
  }

  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: withContentLicense({ title: `Day plan — ${TODAY}`, tags: ['calendar', 'plan'], source: 'calendar:plan:mint', meta: { visibility: 'private', consent: { allowCitations: false }, cal: { conf: confResult, avail: availResult, opt: optResult } } }, 'knowledge', ['private']) });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('calendar.mintedDtuId', id, { label: `Plan DTU ${id.slice(0, 8)}…` }); ok(`Plan DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📅 Day plan ${TODAY}`, '',
      confResult ? `Conflicts: ${confResult.pairs.length}${confResult.pairs[0] ? ` (${confResult.pairs[0].a.title} ⨯ ${confResult.pairs[0].b.title} = ${confResult.pairs[0].overlapMinutes}min)` : ''}` : '',
      availResult ? `Free: ${availResult.freeSlots.length} slots / ${availResult.totalFreeMinutes}min today` : '',
      optResult ? `Tasks placed: ${optResult.scheduledCount}${optResult.unscheduledCount ? ` (${optResult.unscheduledCount} didn't fit)` : ''}` : '',
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
    if (!optResult) { err('Run optimize first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: withContentLicense({ title: `Day-plan template`, tags: ['calendar', 'template', 'public'], source: 'calendar:template:publish', meta: { visibility: 'public', consent: { allowCitations: true }, opt: optResult } }, 'knowledge', ['private', 'public_view', 'social_post']) });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('calendar.publishedDtuId', id, { label: `Public day plan ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Day planner. ${confResult ? `${confResult.pairs.length} calendar conflicts.` : ''} ${availResult ? `${availResult.freeSlots.length} free slots totaling ${availResult.totalFreeMinutes}min.` : ''} ${optResult ? `${optResult.scheduledCount} tasks placed, ${optResult.unscheduledCount} unplaced.` : ''} Recommend the single biggest schedule change for today + one task to defer. Plain text, 3 sentences max.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.answer ?? r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Plan ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'conf' as ActionId, label: 'Conflicts', desc: 'This week, real events', icon: AlertOctagon, accent: '#ef4444', handler: actConf },
    { id: 'avail' as ActionId, label: 'Free time', desc: 'Today, your work hours', icon: Clock, accent: '#22c55e', handler: actAvail },
    { id: 'opt' as ActionId, label: 'Optimize', desc: 'Place open tasks', icon: ListChecks, accent: '#a855f7', handler: actOpt },
    { id: 'ical' as ActionId, label: 'ICS', desc: 'Export real events', icon: Download, accent: '#06b6d4', handler: actIcal },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private plan DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send day plan', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public template', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Plan', desc: 'Agent: top change', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-blue-500/20 bg-lattice-deep/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <Calendar className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Scheduler</h3>
        <span className="rounded bg-lattice-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gray-400">conflicts · availability · optimize · ICS</span>
        <span className="ml-auto text-[11px] text-gray-400 tabular-nums">{events.length} real events · {openTasks} open tasks</span>
        <button type="button" onClick={() => void loadReal()} className="p-1 text-gray-400 hover:text-white" aria-label="Reload calendar data">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </header>

      {loadError && (
        <p className="text-[11px] text-rose-300 rounded border border-rose-500/25 bg-rose-500/5 px-2 py-1.5">{loadError}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="flex-1 bg-lattice-surface border border-lattice-border rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(act => {
          const Icon = act.icon; const isBusy = busy === act.id;
          return (
            <button key={act.id} type="button" disabled={!!busy} onClick={act.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-lattice-elevated/40 border-lattice-border hover:bg-lattice-elevated/60 hover:border-white/20', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: act.accent + '20', color: act.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-white leading-tight">{act.label}</div>
              <div className="text-[10px] text-gray-400 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {confResult && (
          <div className={cn('rounded-md border p-2.5', confResult.pairs.length === 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: confResult.pairs.length === 0 ? '#86efac' : '#fca5a5' }}>Conflicts this week</div>
            <div className={cn('text-2xl font-bold', confResult.pairs.length === 0 ? 'text-emerald-300' : 'text-red-300')}>{confResult.pairs.length}</div>
            <div className="text-[10px] text-gray-400">across {confResult.totalEvents} events</div>
            {confResult.pairs.slice(0, 3).map((c, i) => <div key={i} className="text-[10px] text-red-200 mt-0.5">{c.a.title} ⨯ {c.b.title} · {c.overlapMinutes}min</div>)}
          </div>
        )}
        {availResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Free time today</div>
            <div className="text-2xl font-bold text-green-300">{availResult.totalFreeMinutes}<span className="text-xs text-gray-400"> min</span></div>
            <div className="text-[10px] text-gray-400">{availResult.freeSlots.length} slots · {availResult.busyBlockCount} busy blocks</div>
            {availResult.freeSlots.slice(0, 4).map((s, i) => <div key={i} className="text-[10px] text-green-200 mt-0.5 font-mono tabular-nums">{fmtTime(s.start)}–{fmtTime(s.end)} ({s.minutes}m)</div>)}
          </div>
        )}
        {optResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">
              Task placement · {optResult.scheduledCount} placed{optResult.unscheduledCount > 0 ? ` · ${optResult.unscheduledCount} didn't fit` : ''}
            </div>
            {optResult.proposals.length === 0 && <div className="text-[10px] text-gray-400 mt-1">No open unblocked tasks to place.</div>}
            {optResult.proposals.map((p) => (
              <div key={p.taskId} className="flex items-center gap-2 text-[11px] text-gray-200 mt-1">
                <span className="flex-1 truncate">→ {p.title} <span className="text-gray-500">({p.priority} · {p.estimateMin}m)</span></span>
                <span className="font-mono tabular-nums text-gray-400">{fmtTime(p.proposedStart)}–{fmtTime(p.proposedEnd)}</span>
                {committed.has(p.taskId)
                  ? <span className="text-emerald-300 inline-flex items-center gap-1"><Check className="w-3 h-3" />Blocked</span>
                  : <button type="button" onClick={() => void commitProposal(p)} className="px-2 py-0.5 rounded bg-purple-600/30 hover:bg-purple-600/50 text-purple-100">Block</button>}
              </div>
            ))}
          </div>
        )}
        {icalResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 md:col-span-2">
            <div className="flex items-center justify-between"><div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">ICS · {icalResult.eventCount} events</div><button type="button" onClick={downloadIcs} className="text-[10px] text-cyan-200 bg-cyan-500/20 hover:bg-cyan-500/40 px-2 py-1 rounded font-mono">↓ download .ics</button></div>
            <pre className="mt-1 text-[9px] font-mono text-cyan-100 max-h-32 overflow-y-auto bg-lattice-elevated/50 p-2 rounded">{icalResult.ics.slice(0, 600)}{icalResult.ics.length > 600 ? '…' : ''}</pre>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Plan</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-gray-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
