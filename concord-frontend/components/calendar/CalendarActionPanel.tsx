'use client';

/**
 * CalendarActionPanel — scheduler bench.
 * detectConflicts / findAvailability / scheduleOptimize / ical-export +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Calendar, AlertOctagon, Clock, ListChecks, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

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

interface Conflict { event1: string; event2: string; overlapMinutes: number }
interface ConflictResult { totalEvents: number; conflicts: Conflict[]; conflictCount: number; conflictFree: boolean }
interface Slot { start: string; end: string; minutes: number }
interface AvailResult { date: string; workHours: string; eventsToday: number; availableSlots: Slot[]; totalFreeMinutes: number }
interface OptResult { optimizedOrder: string[]; morningBlock: string[]; afternoonBlock: string[]; totalMinutes: number; totalHours: number; fitsInWorkday: boolean }
interface IcalResult { ics: string; eventCount: number; contentType: string }

const TODAY = new Date().toISOString().split('T')[0];
const DEMO_EVENTS = JSON.stringify({
  events: [
    { name: 'Standup', start: `${TODAY}T09:00:00`, end: `${TODAY}T09:15:00` },
    { name: 'Design review', start: `${TODAY}T10:00:00`, end: `${TODAY}T11:00:00` },
    { name: '1:1 w/ Lee', start: `${TODAY}T10:45:00`, end: `${TODAY}T11:15:00` },
    { name: 'Lunch', start: `${TODAY}T12:00:00`, end: `${TODAY}T13:00:00` },
    { name: 'Client call', start: `${TODAY}T14:00:00`, end: `${TODAY}T15:00:00` },
    { name: 'Deep work', start: `${TODAY}T15:30:00`, end: `${TODAY}T16:30:00` },
  ],
  date: TODAY,
  workStartHour: 9,
  workEndHour: 18,
  slotMinutes: 30,
}, null, 2);

const DEMO_TASKS = JSON.stringify({
  tasks: [
    { name: 'Write proposal', duration: 90, priority: 'critical', energy: 'high' },
    { name: 'Code review', duration: 45, priority: 'high', energy: 'high' },
    { name: 'Inbox triage', duration: 30, priority: 'medium', energy: 'low' },
    { name: 'Expense report', duration: 20, priority: 'low', energy: 'low' },
    { name: 'Team sync', duration: 60, priority: 'high', energy: 'medium' },
  ],
}, null, 2);

export function CalendarActionPanel() {
  const [eventsText, setEventsText] = useState(DEMO_EVENTS);
  const [tasksText, setTasksText] = useState(DEMO_TASKS);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confResult, setConfResult] = useState<ConflictResult | null>(null);
  const [availResult, setAvailResult] = useState<AvailResult | null>(null);
  const [optResult, setOptResult] = useState<OptResult | null>(null);
  const [icalResult, setIcalResult] = useState<IcalResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  function parseJSON<T>(text: string): T | null { try { return JSON.parse(text) as T; } catch { return null; } }

  async function actConf() {
    const parsed = parseJSON<{ events: unknown[] }>(eventsText); if (!parsed) { err('Invalid events JSON.'); return; }
    setBusy('conf'); setFeedback(null);
    try { const r = await callMacro<ConflictResult>('detectConflicts', { artifact: { data: parsed } }); if (r.ok && r.result) { setConfResult(r.result); ok(`${r.result.conflictCount} conflicts in ${r.result.totalEvents} events.`); } else err(r.error ?? 'conf failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAvail() {
    const parsed = parseJSON<Record<string, unknown>>(eventsText); if (!parsed) { err('Invalid events JSON.'); return; }
    setBusy('avail'); setFeedback(null);
    try { const r = await callMacro<AvailResult>('findAvailability', { artifact: { data: parsed } }); if (r.ok && r.result) { setAvailResult(r.result); ok(`${r.result.availableSlots.length} slots · ${r.result.totalFreeMinutes}min free.`); } else err(r.error ?? 'avail failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actOpt() {
    const parsed = parseJSON<{ tasks: unknown[] }>(tasksText); if (!parsed) { err('Invalid tasks JSON.'); return; }
    setBusy('opt'); setFeedback(null);
    try { const r = await callMacro<OptResult>('scheduleOptimize', { artifact: { data: parsed } }); if (r.ok && r.result) { setOptResult(r.result); ok(`${r.result.totalHours}h · ${r.result.fitsInWorkday ? 'fits' : 'overflows'}.`); } else err(r.error ?? 'opt failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actIcal() {
    const parsed = parseJSON<{ events: unknown[] }>(eventsText); if (!parsed) { err('Invalid events JSON.'); return; }
    setBusy('ical'); setFeedback(null);
    try { const r = await callMacro<IcalResult>('ical-export', { artifact: { data: { events: parsed.events }, title: 'Concord Calendar' }, calendarName: 'Concord Calendar' }); if (r.ok && r.result) { setIcalResult(r.result); ok(`ICS: ${r.result.eventCount} events.`); } else err(r.error ?? 'ical failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
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
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Day plan — ${TODAY}`, tags: ['calendar', 'plan'], source: 'calendar:plan:mint', meta: { visibility: 'private', consent: { allowCitations: false }, cal: { conf: confResult, avail: availResult, opt: optResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Plan DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📅 Day plan ${TODAY}`, '', confResult ? `Conflicts: ${confResult.conflictCount}${confResult.conflicts[0] ? ` (${confResult.conflicts[0].event1} ⨯ ${confResult.conflicts[0].event2} = ${confResult.conflicts[0].overlapMinutes}min)` : ''}` : '', availResult ? `Free: ${availResult.availableSlots.length} slots / ${availResult.totalFreeMinutes}min in ${availResult.workHours}` : '', optResult ? `Schedule: ${optResult.totalHours}h ${optResult.fitsInWorkday ? '✓ fits' : '⚠ overflows'} · AM: ${optResult.morningBlock.join(', ')}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!optResult) { err('Run schedule optimize first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Day-plan template`, tags: ['calendar', 'template', 'public'], source: 'calendar:template:publish', meta: { visibility: 'public', consent: { allowCitations: true }, opt: optResult } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Day planner. ${confResult ? `${confResult.conflictCount} calendar conflicts.` : ''} ${availResult ? `${availResult.availableSlots.length} free slots totaling ${availResult.totalFreeMinutes}min.` : ''} ${optResult ? `Task load: ${optResult.totalHours}h, ${optResult.fitsInWorkday ? 'fits in workday' : 'overflows'}.` : ''} Recommend the single biggest schedule change for today + one task to defer. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Plan ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'conf' as ActionId, label: 'Conflicts', desc: 'detectConflicts', icon: AlertOctagon, accent: '#ef4444', handler: actConf },
    { id: 'avail' as ActionId, label: 'Free time', desc: 'findAvailability', icon: Clock, accent: '#22c55e', handler: actAvail },
    { id: 'opt' as ActionId, label: 'Optimize', desc: 'scheduleOptimize', icon: ListChecks, accent: '#a855f7', handler: actOpt },
    { id: 'ical' as ActionId, label: 'ICS', desc: 'ical-export (RFC 5545)', icon: Download, accent: '#06b6d4', handler: actIcal },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private plan DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send day plan', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public template', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Plan', desc: 'Agent: top change', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <Calendar className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Scheduler bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">conflicts · availability · optimize · ICS</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Events JSON</label>
          <textarea value={eventsText} onChange={(e) => setEventsText(e.target.value)} rows={8} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Tasks JSON (for optimize)</label>
          <textarea value={tasksText} onChange={(e) => setTasksText(e.target.value)} rows={8} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
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
        {confResult && (
          <div className={cn('rounded-md border p-2.5', confResult.conflictFree ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: confResult.conflictFree ? '#86efac' : '#fca5a5' }}>Conflicts</div>
            <div className={cn('text-2xl font-bold', confResult.conflictFree ? 'text-emerald-300' : 'text-red-300')}>{confResult.conflictCount}</div>
            <div className="text-[10px] text-zinc-500">of {confResult.totalEvents} events</div>
            {confResult.conflicts.slice(0, 3).map((c, i) => <div key={i} className="text-[10px] text-red-200 mt-0.5">{c.event1} ⨯ {c.event2} · {c.overlapMinutes}min</div>)}
          </div>
        )}
        {availResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Free time · {availResult.workHours}</div>
            <div className="text-2xl font-bold text-green-300">{availResult.totalFreeMinutes}<span className="text-xs text-zinc-400"> min</span></div>
            <div className="text-[10px] text-zinc-500">{availResult.availableSlots.length} slots · {availResult.eventsToday} events today</div>
            {availResult.availableSlots.slice(0, 4).map((s, i) => <div key={i} className="text-[10px] text-green-200 mt-0.5 font-mono">{s.start}–{s.end} ({s.minutes}m)</div>)}
          </div>
        )}
        {optResult && (
          <div className={cn('rounded-md border p-2.5 md:col-span-2', optResult.fitsInWorkday ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Optimized · {optResult.totalHours}h {optResult.fitsInWorkday ? '✓ fits' : '⚠ overflows'}</div>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <div className="text-[10px]"><div className="text-amber-300 font-semibold uppercase tracking-wider mb-0.5">Morning (high energy)</div>{optResult.morningBlock.map((t, i) => <div key={i} className="text-zinc-300">→ {t}</div>)}</div>
              <div className="text-[10px]"><div className="text-blue-300 font-semibold uppercase tracking-wider mb-0.5">Afternoon (low energy)</div>{optResult.afternoonBlock.map((t, i) => <div key={i} className="text-zinc-300">→ {t}</div>)}</div>
            </div>
          </div>
        )}
        {icalResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 md:col-span-2">
            <div className="flex items-center justify-between"><div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">ICS · {icalResult.eventCount} events</div><button type="button" onClick={downloadIcs} className="text-[10px] text-cyan-200 bg-cyan-500/20 hover:bg-cyan-500/40 px-2 py-1 rounded font-mono">↓ download .ics</button></div>
            <pre className="mt-1 text-[9px] font-mono text-cyan-100 max-h-32 overflow-y-auto bg-zinc-900/50 p-2 rounded">{icalResult.ics.slice(0, 600)}{icalResult.ics.length > 600 ? '…' : ''}</pre>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Plan</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
