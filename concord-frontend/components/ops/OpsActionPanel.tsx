'use client';

/**
 * OpsActionPanel — PagerDuty-shape on-call + runbook + escalation +
 * post-mortem action surface. Self-contained input, runs the 4 new
 * ops.* macros plus mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Phone, BookOpen, AlertOctagon, FileText,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string; reason?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('ops', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'oncall' | 'runbook' | 'escalation' | 'postmortem' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface OnCallResult { atUtc?: string; current?: string; slot?: { user: string; startHour: number; endHour: number }; rotationSize?: number }
interface RunbookResult { matches?: number; topMatch?: { alertPattern: string; owner: string; steps?: string[] }; allMatches?: Array<{ alertPattern: string; owner: string; stepCount: number }>; suggestion?: string }
interface EscalationResult { severity?: string; minutesOpen?: number; thresholdMinutes?: number; breached?: boolean; recommendation?: string }
interface PostmortemResult { title?: string; incidentId?: string; severity?: string; durationMin?: number; sections?: Array<{ name: string; placeholder: string }> }

export function OpsActionPanel() {
  const [rotation, setRotation] = useState('');
  const [runbooks, setRunbooks] = useState('');
  const [alertSig, setAlertSig] = useState('');
  const [escSev, setEscSev] = useState<'sev1' | 'sev2' | 'sev3' | 'sev4'>('sev2');
  const [escMin, setEscMin] = useState('');
  const [pmTitle, setPmTitle] = useState('');
  const [pmSev, setPmSev] = useState<'sev1' | 'sev2' | 'sev3' | 'sev4'>('sev2');
  const [pmAffected, setPmAffected] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [oncallResult, setOncallResult] = useState<OnCallResult | null>(null);
  const [runbookResult, setRunbookResult] = useState<RunbookResult | null>(null);
  const [escalationResult, setEscalationResult] = useState<EscalationResult | null>(null);
  const [postmortemResult, setPostmortemResult] = useState<PostmortemResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

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

  function parseRotation() {
    return rotation.split('\n').map(l => {
      const parts = l.trim().split(/\s+/);
      if (parts.length < 3) return null;
      return { user: parts[0], startHour: parseInt(parts[1], 10), endHour: parseInt(parts[2], 10) };
    }).filter(Boolean);
  }
  function parseRunbooks() {
    return runbooks.split('\n').map(l => {
      const parts = l.split('|').map(s => s.trim());
      if (parts.length < 3) return null;
      return { alertPattern: parts[0], steps: parts[1].split(';').map(s => s.trim()), owner: parts[2] };
    }).filter(Boolean);
  }

  async function actOnCall() {
    const rot = parseRotation();
    if (!rot.length) { err('Add rotation (user startHour endHour per line).'); return; }
    setBusy('oncall'); setFeedback(null);
    try {
      const r = await callMacro<OnCallResult>('pageOnCall', { rotation: rot });
      if (r.ok && r.result) { setOncallResult(r.result); pipe.publish('ops.oncall', r.result, { label: r.result.current ?? 'on-call' }); ok(`On-call: ${r.result.current}.`); }
      else err(r.error ?? 'on-call lookup failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actRunbook() {
    if (!alertSig.trim()) { err('Enter an alert signature.'); return; }
    const rb = parseRunbooks();
    setBusy('runbook'); setFeedback(null);
    try {
      const r = await callMacro<RunbookResult>('runbookLookup', { runbooks: rb, alert: alertSig.trim() });
      if (r.ok && r.result) { setRunbookResult(r.result); pipe.publish('ops.runbook', r.result, { label: `${r.result.matches ?? 0} matches` }); ok(`${r.result.matches ?? 0} runbook matches.`); }
      else err(r.reason ?? r.error ?? 'runbook lookup failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actEscalation() {
    setBusy('escalation'); setFeedback(null);
    try {
      const r = await callMacro<EscalationResult>('escalationCheck', { severity: escSev, minutesOpen: parseFloat(escMin) });
      if (r.ok && r.result) { setEscalationResult(r.result); pipe.publish('ops.escalation', r.result, { label: r.result.breached ? 'BREACHED' : 'within' }); ok(r.result.breached ? 'BREACHED — escalate.' : 'Within window.'); }
      else err(r.error ?? 'escalation check failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPostmortem() {
    if (!pmTitle.trim()) { err('Post-mortem title required.'); return; }
    setBusy('postmortem'); setFeedback(null);
    try {
      const r = await callMacro<PostmortemResult>('postmortemDraft', { title: pmTitle.trim(), severity: pmSev, affected: pmAffected.trim() || 'unspecified' });
      if (r.ok && r.result) { setPostmortemResult(r.result); pipe.publish('ops.postmortem', r.result, { label: r.result.incidentId ?? 'PM' }); ok('Post-mortem skeleton ready.'); }
      else err(r.error ?? 'post-mortem failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Ops snapshot — ${new Date().toISOString().slice(0, 10)}`,
          tags: ['ops', 'snapshot', escalationResult?.breached ? 'breached' : 'ok'],
          source: 'ops:snapshot:mint',
          meta: { visibility: 'private', consent: { allowCitations: false }, ops: { oncall: oncallResult, runbook: runbookResult, escalation: escalationResult, postmortem: postmortemResult } },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintedDtuId(id); pipe.publish('ops.mintedDtuId', id, { label: `snapshot ${id.slice(0, 8)}` }); ok(`Snapshot DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!recipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `📟 Ops handoff — ${new Date().toLocaleString()}`,
      '',
      oncallResult?.current ? `Current on-call: ${oncallResult.current}` : '',
      escalationResult ? `Escalation: ${escalationResult.recommendation}` : '',
      runbookResult?.topMatch ? `Runbook: ${runbookResult.topMatch.alertPattern} → ${runbookResult.topMatch.steps?.join(' · ')}` : '',
      postmortemResult?.incidentId ? `Post-mortem skeleton: ${postmortemResult.incidentId}` : '',
      mintedDtuId ? `\n[Snapshot DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    if (!postmortemResult?.incidentId) { err('Draft a post-mortem first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', {
          domain: 'dtu', name: 'create',
          input: {
            title: `Public post-mortem — ${postmortemResult.title ?? postmortemResult.incidentId}`,
            tags: ['ops', 'post-mortem', 'public', postmortemResult.severity ?? 'sev3'],
            source: 'ops:postmortem:publish',
            meta: { visibility: 'public', consent: { allowCitations: true }, postmortem: postmortemResult },
          },
        });
        const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('ops.publishedDtuId', id, { label: `PM ${id.slice(0, 8)}` }); ok(`Post-mortem published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Ops state:`,
        oncallResult?.current ? `On-call ${oncallResult.current}.` : '',
        escalationResult ? `Escalation: ${escalationResult.recommendation}.` : '',
        runbookResult?.topMatch ? `Top runbook: ${runbookResult.topMatch.alertPattern}.` : '',
        postmortemResult ? `Post-mortem drafted for ${postmortemResult.incidentId}.` : '',
        '',
        'Identify the single highest-leverage action item from this state that would prevent the next incident in this class.',
        'Be specific (e.g. add a circuit breaker, not "improve reliability"). Plain text, one paragraph.',
      ].filter(Boolean).join(' ');
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 4 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Action item ready.'); }
      else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'oncall',     label: 'On-call',     desc: 'pageOnCall current slot',           icon: Phone,        accent: '#ec4899', handler: actOnCall },
    { id: 'runbook',    label: 'Runbook',     desc: 'runbookLookup match by alert',      icon: BookOpen,     accent: '#06b6d4', handler: actRunbook },
    { id: 'escalation', label: 'Escalation',  desc: 'escalationCheck threshold breach',  icon: AlertOctagon, accent: '#ef4444', handler: actEscalation },
    { id: 'postmortem', label: 'Post-mortem', desc: 'postmortemDraft 5-section skeleton', icon: FileText,    accent: '#8b5cf6', handler: actPostmortem },
    { id: 'mint',       label: mintedDtuId      ? 'Saved'     : 'Mint snapshot',  desc: mintedDtuId      ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private DTU of full ops state',          icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm',         label: 'DM handoff',  desc: 'Send handoff to next on-call',     icon: Send,         accent: '#f97316', handler: actDm },
    { id: 'publish',    label: publishedDtuId ? 'Published' : 'Publish PM',     desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public post-mortem + federation',          icon: Globe,    accent: '#22c55e', handler: actPublish, disabled: !postmortemResult },
    { id: 'agent',      label: 'High-leverage AI', desc: 'Agent picks 1 high-leverage action item', icon: Wand2,    accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-rose-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-rose-500/10 pb-2">
        <Phone className="h-4 w-4 text-rose-400" />
        <h3 className="text-sm font-semibold text-white">On-call ops workbench</h3>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Rotation (user startHour endHour, one per line, UTC)</label>
            <textarea value={rotation} onChange={(e) => setRotation(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-2 focus:ring-pink-400/40 resize-none" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Runbooks (alertPattern | step;step | owner)</label>
            <textarea value={runbooks} onChange={(e) => setRunbooks(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-2 focus:ring-cyan-400/40 resize-none" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Alert signature (for runbook lookup)</label>
            <input type="text" value={alertSig} onChange={(e) => setAlertSig(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="db-timeout" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Escalation severity</label>
              <select value={escSev} onChange={(e) => setEscSev(e.target.value as typeof escSev)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white">
                {(['sev1', 'sev2', 'sev3', 'sev4'] as const).map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Minutes open</label>
              <input type="text" value={escMin} onChange={(e) => setEscMin(e.target.value.replace(/[^\d.]/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Post-mortem title</label>
            <input type="text" value={pmTitle} onChange={(e) => setPmTitle(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="API outage post-mortem" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select value={pmSev} onChange={(e) => setPmSev(e.target.value as typeof pmSev)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white">
              {(['sev1', 'sev2', 'sev3', 'sev4'] as const).map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
            </select>
            <input type="text" value={pmAffected} onChange={(e) => setPmAffected(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="affected service" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">DM recipient (for handoff)</label>
            <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="next on-call user id" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
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
                'disabled:opacity-40 disabled:cursor-not-allowed',
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {oncallResult && (
          <div className="rounded-md border border-pink-500/30 bg-pink-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-pink-300 font-semibold flex items-center gap-1.5"><Phone className="w-3 h-3" /> On-call</div>
            <div className="text-sm font-semibold text-zinc-100 mt-1">{oncallResult.current}</div>
            {oncallResult.slot && <div className="text-[10px] text-zinc-400">{oncallResult.slot.startHour}:00–{oncallResult.slot.endHour}:00 UTC</div>}
          </div>
        )}
        {runbookResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5"><BookOpen className="w-3 h-3" /> Runbook ({runbookResult.matches} matches)</div>
            {runbookResult.topMatch ? (
              <>
                <div className="text-[11px] text-zinc-300"><strong className="text-cyan-300">{runbookResult.topMatch.alertPattern}</strong> · owner: {runbookResult.topMatch.owner}</div>
                {runbookResult.topMatch.steps?.map((s, i) => <div key={i} className="text-[11px] text-zinc-400">  {i + 1}. {s}</div>)}
              </>
            ) : <p className="text-[11px] text-amber-300">{runbookResult.suggestion}</p>}
          </div>
        )}
        {escalationResult && (
          <div className={cn('rounded-md border p-2.5 space-y-0.5', escalationResult.breached ? 'border-rose-500/40 bg-rose-500/5' : 'border-emerald-500/40 bg-emerald-500/5')}>
            <div className={cn('text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5', escalationResult.breached ? 'text-rose-300' : 'text-emerald-300')}>
              <AlertOctagon className="w-3 h-3" /> Escalation {escalationResult.severity}: {escalationResult.breached ? 'BREACHED' : 'within window'}
            </div>
            <div className="text-[11px] text-zinc-300">{escalationResult.recommendation}</div>
          </div>
        )}
        {postmortemResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold flex items-center gap-1.5"><FileText className="w-3 h-3" /> {postmortemResult.title} ({postmortemResult.incidentId})</div>
            <div className="text-[10px] text-zinc-400">{postmortemResult.severity?.toUpperCase()} · duration {postmortemResult.durationMin}m</div>
            <ol className="text-[11px] text-zinc-300 list-decimal list-inside space-y-0.5 mt-1">
              {postmortemResult.sections?.map((s, i) => <li key={i}><span className="text-purple-300 font-semibold capitalize">{s.name}:</span> <span className="text-zinc-400 italic text-[10px]">{s.placeholder}</span></li>)}
            </ol>
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
            <Wand2 className="w-3 h-3" /> High-leverage AI
          </div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div
            key={feedback.text}
            initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}
          >
            {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
