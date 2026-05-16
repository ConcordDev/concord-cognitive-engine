'use client';

/**
 * CrisisActionPanel — crisis-response info action workbench. Runs the
 * 3 existing cri.* macros (severityAssessment, responseTimeline,
 * stakeholderImpact) plus mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  AlertTriangle, Clock, Users, Siren, Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertOctagon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string; reason?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('cri', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'severity' | 'timeline' | 'impact' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface SeverityResult { severity?: string; score?: number; factors?: string[]; recommendation?: string }
interface TimelineResult { phases?: Array<{ phase: string; window: string; actions: string[] }>; totalDurationHours?: number }
interface ImpactResult { stakeholders?: Array<{ group: string; impact: string; priority?: string }>; totalAffected?: number }

export function CrisisActionPanel() {
  const [crisisName, setCrisisName] = useState('');
  const [eventType, setEventType] = useState('outage');
  const [scope, setScope] = useState<'local' | 'regional' | 'global'>('regional');
  const [affectedCount, setAffectedCount] = useState('1000');
  const [duration, setDuration] = useState('4');
  const [stakeholders, setStakeholders] = useState('customers\nemployees\npress\nregulators');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [severityResult, setSeverityResult] = useState<SeverityResult | null>(null);
  const [timelineResult, setTimelineResult] = useState<TimelineResult | null>(null);
  const [impactResult, setImpactResult] = useState<ImpactResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });
  const ready = crisisName.trim().length > 0;

  async function actSeverity() {
    if (!ready) { err('Crisis name required.'); return; }
    setBusy('severity'); setFeedback(null);
    try {
      const r = await callMacro<SeverityResult>('severityAssessment', { name: crisisName.trim(), eventType, scope, affectedCount: parseInt(affectedCount, 10), durationHours: parseFloat(duration) });
      if (r.ok && r.result) { setSeverityResult(r.result); ok(`Severity: ${r.result.severity ?? '—'}.`); }
      else err(r.reason ?? r.error ?? 'severity failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actTimeline() {
    if (!ready) { err('Crisis name required.'); return; }
    setBusy('timeline'); setFeedback(null);
    try {
      const r = await callMacro<TimelineResult>('responseTimeline', { name: crisisName.trim(), eventType, severity: severityResult?.severity ?? 'high' });
      if (r.ok && r.result) { setTimelineResult(r.result); ok(`Timeline: ${r.result.phases?.length ?? 0} phases.`); }
      else err(r.error ?? 'timeline failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actImpact() {
    const stk = stakeholders.split('\n').map(s => s.trim()).filter(Boolean);
    if (!stk.length) { err('Add at least one stakeholder.'); return; }
    setBusy('impact'); setFeedback(null);
    try {
      const r = await callMacro<ImpactResult>('stakeholderImpact', { stakeholders: stk.map(group => ({ group })), eventType, severity: severityResult?.severity ?? 'high' });
      if (r.ok && r.result) { setImpactResult(r.result); ok(`${r.result.stakeholders?.length ?? 0} stakeholder groups assessed.`); }
      else err(r.error ?? 'impact failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMint() {
    if (!ready) { err('Crisis name required.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Crisis — ${crisisName.trim()}`,
          tags: ['cri', 'crisis', eventType, scope, severityResult?.severity ?? 'unassessed'],
          source: 'cri:crisis:mint',
          meta: {
            visibility: 'private', consent: { allowCitations: false },
            crisis: { name: crisisName.trim(), eventType, scope, affectedCount: parseInt(affectedCount, 10), durationHours: parseFloat(duration), assessment: severityResult, timeline: timelineResult, impact: impactResult },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintedDtuId(id); ok(`Crisis DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actDm() {
    if (!ready) { err('Crisis name required.'); return; }
    if (!recipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `🚨 Crisis brief: ${crisisName.trim()}`, '',
      `Type: ${eventType} · Scope: ${scope} · Affected: ~${affectedCount} · Duration: ${duration}h`,
      severityResult ? `Severity: ${severityResult.severity} (${severityResult.score})` : '',
      severityResult?.recommendation ? `\nRecommendation: ${severityResult.recommendation}` : '',
      timelineResult?.phases?.length ? `\nResponse phases: ${timelineResult.phases.map(p => p.phase).join(' → ')}` : '',
      mintedDtuId ? `\n[Crisis DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
      if (r.data?.ok !== false) { ok(`Brief sent to ${recipient.trim()}.`); setRecipient(''); }
      else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actPublish() {
    if (!ready) { err('Crisis name required.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Public crisis brief — ${crisisName.trim()}`,
          tags: ['cri', 'crisis', 'public', severityResult?.severity ?? 'unassessed'],
          source: 'cri:crisis:publish',
          meta: { visibility: 'public', consent: { allowCitations: true }, crisis: { name: crisisName.trim(), eventType, scope, severity: severityResult?.severity, recommendation: severityResult?.recommendation, phases: timelineResult?.phases } },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Crisis brief published ${id.slice(0, 8)}…`); }
      else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actAgent() {
    if (!ready) { err('Crisis name required.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Crisis: "${crisisName.trim()}" (${eventType}, ${scope}).`,
        `Affected ~${affectedCount}, duration so far ${duration}h.`,
        severityResult?.severity ? `Severity: ${severityResult.severity}.` : '',
        '',
        'Draft a 3-bullet immediate-response brief for the incident commander.',
        'Each bullet: who does what, by when, what depends on the next step.',
        'Plain text. Concrete. No corporate softening.',
      ].filter(Boolean).join(' ');
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 4 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Commander brief ready.'); }
      else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void }> = [
    { id: 'severity', label: 'Severity',  desc: 'severityAssessment factor scoring',         icon: AlertOctagon, accent: '#ef4444', handler: actSeverity },
    { id: 'timeline', label: 'Timeline',  desc: 'responseTimeline 5-phase response',         icon: Clock,        accent: '#06b6d4', handler: actTimeline },
    { id: 'impact',   label: 'Impact',    desc: 'stakeholderImpact per-group analysis',      icon: Users,        accent: '#f97316', handler: actImpact },
    { id: 'mint',     label: mintedDtuId      ? 'Saved'     : 'Mint crisis',  desc: mintedDtuId      ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private crisis state DTU',                 icon: Sparkles,     accent: '#3b82f6', handler: actMint },
    { id: 'dm',       label: 'DM IC',     desc: 'Send brief to incident commander',          icon: Send,         accent: '#ec4899', handler: actDm },
    { id: 'publish',  label: publishedDtuId ? 'Published' : 'Publish brief',  desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public crisis brief + federation',          icon: Globe,        accent: '#22c55e', handler: actPublish },
    { id: 'agent',    label: 'IC brief',  desc: 'Agent drafts 3-bullet IC brief',            icon: Wand2,        accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-rose-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-rose-500/10 pb-2">
        <Siren className="h-4 w-4 text-rose-400" />
        <h3 className="text-sm font-semibold text-white">Crisis response workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">CRI</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input type="text" value={crisisName} onChange={(e) => setCrisisName(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white focus:outline-none focus:ring-2 focus:ring-rose-400/40" placeholder="Crisis name (e.g. east-region power outage)" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="IC user id (for DM)" />
        <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          {['outage', 'breach', 'natural-disaster', 'pandemic', 'recall', 'cyberattack', 'reputational'].map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          {(['local', 'regional', 'global'] as const).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="text" value={affectedCount} onChange={(e) => setAffectedCount(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="affected count" />
        <input type="text" value={duration} onChange={(e) => setDuration(e.target.value.replace(/[^\d.]/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="duration hours" />
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Stakeholders (one per line)</label>
        <textarea value={stakeholders} onChange={(e) => setStakeholders(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-2 focus:ring-orange-400/40 resize-none" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={!!busy} onClick={a.handler}
              className={cn('group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[12px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {severityResult && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-rose-300 font-semibold flex items-center gap-1.5"><AlertOctagon className="w-3 h-3" /> Severity</div>
            <div className="text-2xl font-bold text-rose-300 mt-1">{severityResult.severity ?? '—'}{severityResult.score != null && <span className="text-sm ml-2 text-zinc-400">({severityResult.score})</span>}</div>
            {severityResult.recommendation && <p className="text-[11px] text-zinc-300 mt-1">{severityResult.recommendation}</p>}
          </div>
        )}
        {timelineResult?.phases && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5"><Clock className="w-3 h-3" /> Response phases</div>
            <ol className="text-[11px] text-zinc-300 list-decimal list-inside mt-1 space-y-0.5">
              {timelineResult.phases.map((p, i) => <li key={i}><strong className="text-cyan-200">{p.phase}</strong> <span className="text-zinc-500">({p.window})</span></li>)}
            </ol>
          </div>
        )}
        {impactResult?.stakeholders && (
          <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold flex items-center gap-1.5"><Users className="w-3 h-3" /> Stakeholder impact</div>
            {impactResult.stakeholders.map((s, i) => (
              <div key={i} className="text-[11px] text-zinc-300"><strong className="text-orange-200 capitalize">{s.group}:</strong> {s.impact} {s.priority && <span className="text-[10px] text-zinc-500">({s.priority})</span>}</div>
            ))}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> IC brief</div>
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
