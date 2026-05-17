'use client';

/**
 * MentorshipActionPanel — coach + mentee bench.
 * matchScore / progressTrack / feedbackSummary / developmentPlan +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Users, Target, MessageSquare, TrendingUp, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('mentorship', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'match' | 'prog' | 'fb' | 'plan' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface MatchResult { mentor?: string; mentee?: string; matchScore: number; skillOverlap: number; compatibility: string }
interface ProgResult { totalGoals: number; completed: number; inProgress: number; completionRate: number; sessionsCompleted: number; totalHours: number; momentum: string }
interface FbResult { sessions?: number; avgRating?: number; topThemes?: { theme: string; count: number }[]; satisfaction?: string; message?: string }
interface Milestone { phase: string; weeks: string; focus: string }
interface PlanResult { currentSkillCount: number; targetRole: string; gaps: string[]; milestones: Milestone[]; timelineWeeks: number }

const DEMO_MATCH = JSON.stringify({
  mentor: { name: 'Maya Singh', skills: ['React', 'TypeScript', 'design systems', 'mentoring'], experience: '8 years', availability: 'weekday evenings' },
  mentee: { name: 'Sam Park', goals: ['Learn React + TypeScript', 'Ship first design system'], preferredSchedule: 'weekday evenings' },
}, null, 2);

const DEMO_PROG = JSON.stringify({
  goals: [
    { name: 'Ship landing page', completed: true }, { name: 'Build component library', completed: true },
    { name: 'Lead design review', completed: false }, { name: 'Mentor a junior', completed: false },
  ],
  sessions: [
    { date: '2026-04-01', duration: 1.0 }, { date: '2026-04-08', duration: 1.0 },
    { date: '2026-04-15', duration: 1.5 }, { date: '2026-04-22', duration: 1.0 }, { date: '2026-04-29', duration: 1.0 },
  ],
}, null, 2);

const DEMO_FB = JSON.stringify({
  feedback: [
    { rating: 5, tags: ['practical', 'encouraging'], note: 'Pair-programming session unlocked the pattern' },
    { rating: 4, tags: ['practical', 'challenging'], note: 'Code review was tough but fair' },
    { rating: 5, tags: ['encouraging', 'strategic'], note: 'Career framing was eye-opening' },
    { rating: 4, tags: ['practical'], note: 'Real-world examples landed well' },
  ],
}, null, 2);

export function MentorshipActionPanel() {
  const [matchText, setMatchText] = useState(DEMO_MATCH);
  const [progText, setProgText] = useState(DEMO_PROG);
  const [fbText, setFbText] = useState(DEMO_FB);
  const [currentSkills, setCurrentSkills] = useState('React, TypeScript, Git, Figma');
  const [targetRole, setTargetRole] = useState('Senior Product Engineer');
  const [skillGaps, setSkillGaps] = useState('System design, leading projects, mentoring others');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [progResult, setProgResult] = useState<ProgResult | null>(null);
  const [fbResult, setFbResult] = useState<FbResult | null>(null);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actMatch() {
    try { const parsed = JSON.parse(matchText); setBusy('match'); setFeedback(null);
      const r = await callMacro<MatchResult>('matchScore', { artifact: { data: parsed } }); if (r.ok && r.result) { setMatchResult(r.result); ok(`Match ${r.result.matchScore}/100 (${r.result.compatibility}).`); } else err(r.error ?? 'match failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid match JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actProg() {
    try { const parsed = JSON.parse(progText); setBusy('prog'); setFeedback(null);
      const r = await callMacro<ProgResult>('progressTrack', { artifact: { data: parsed } }); if (r.ok && r.result) { setProgResult(r.result); ok(`${r.result.completionRate}% complete · ${r.result.momentum}.`); } else err(r.error ?? 'prog failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid progress JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actFb() {
    try { const parsed = JSON.parse(fbText); setBusy('fb'); setFeedback(null);
      const r = await callMacro<FbResult>('feedbackSummary', { artifact: { data: parsed } }); if (r.ok && r.result) { setFbResult(r.result); ok(`Avg ${r.result.avgRating} · ${r.result.satisfaction}.`); } else err(r.error ?? 'fb failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid feedback JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPlan() {
    setBusy('plan'); setFeedback(null);
    try { const r = await callMacro<PlanResult>('developmentPlan', { artifact: { data: { currentSkills: currentSkills.split(',').map(s => s.trim()).filter(Boolean), targetRole, skillGaps: skillGaps.split(',').map(s => s.trim()).filter(Boolean) } } }); if (r.ok && r.result) { setPlanResult(r.result); ok(`${r.result.timelineWeeks}-week plan.`); } else err(r.error ?? 'plan failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Mentor session — ${matchResult?.mentee ?? 'pair'}`, tags: ['mentorship', 'session', matchResult?.compatibility].filter((t): t is string => !!t), source: 'mentorship:session:mint', meta: { visibility: 'private', consent: { allowCitations: false }, mentor: { match: matchResult, prog: progResult, fb: fbResult, plan: planResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Session DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🤝 Mentor recap`, '', matchResult ? `Pair: ${matchResult.mentor} ↔ ${matchResult.mentee} · match ${matchResult.matchScore}/100 (${matchResult.compatibility})` : '', progResult ? `Progress: ${progResult.completionRate}% complete · ${progResult.sessionsCompleted} sessions / ${progResult.totalHours}h · ${progResult.momentum}` : '', fbResult ? `Feedback: ${fbResult.avgRating}/5 (${fbResult.satisfaction}) · top themes: ${fbResult.topThemes?.slice(0, 3).map(t => t.theme).join(', ')}` : '', planResult ? `Plan: ${planResult.timelineWeeks}wk to ${planResult.targetRole}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!planResult) { err('Run dev plan first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Dev plan — ${planResult.targetRole}`, tags: ['mentorship', 'devplan', 'public'], source: 'mentorship:plan:publish', meta: { visibility: 'public', consent: { allowCitations: true }, plan: planResult } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Mentor coaching brief. ${matchResult ? `Pair: ${matchResult.mentor} → ${matchResult.mentee} (${matchResult.compatibility} match).` : ''} ${progResult ? `Progress: ${progResult.completionRate}% goals, ${progResult.momentum} momentum.` : ''} ${fbResult ? `Feedback ${fbResult.avgRating}/5.` : ''} ${planResult ? `Targeting ${planResult.targetRole} in ${planResult.timelineWeeks}wk.` : ''} Suggest one concrete topic for next session + one stretch challenge. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'match' as ActionId, label: 'Match', desc: 'matchScore', icon: Users, accent: '#3b82f6', handler: actMatch },
    { id: 'prog' as ActionId, label: 'Progress', desc: 'progressTrack', icon: Target, accent: '#22c55e', handler: actProg },
    { id: 'fb' as ActionId, label: 'Feedback', desc: 'feedbackSummary', icon: MessageSquare, accent: '#f59e0b', handler: actFb },
    { id: 'plan' as ActionId, label: 'Dev plan', desc: 'developmentPlan', icon: TrendingUp, accent: '#a855f7', handler: actPlan },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private session DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send recap', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public dev plan', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Coach', desc: 'Agent: next topic', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const COMP_COLOR: Record<string, string> = { excellent: 'text-emerald-300', good: 'text-blue-300', fair: 'text-amber-300' };
  const MOMENTUM_COLOR: Record<string, string> = { strong: 'text-emerald-300', building: 'text-blue-300', 'early-stage': 'text-amber-300' };

  return (
    <div className="rounded-lg border border-violet-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-violet-500/10 pb-2">
        <Users className="h-4 w-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-white">Mentor bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">match · progress · feedback · plan</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Pair JSON</label>
          <textarea value={matchText} onChange={(e) => setMatchText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold mt-1 block">Progress JSON</label>
          <textarea value={progText} onChange={(e) => setProgText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Feedback JSON</label>
          <textarea value={fbText} onChange={(e) => setFbText(e.target.value)} rows={8} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Dev plan</div>
          <input type="text" value={currentSkills} onChange={(e) => setCurrentSkills(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="Current skills csv" />
          <input type="text" value={targetRole} onChange={(e) => setTargetRole(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="Target role" />
          <input type="text" value={skillGaps} onChange={(e) => setSkillGaps(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="Skill gaps csv" />
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
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
        {matchResult && (
          <div className={cn('rounded-md border p-2.5', matchResult.matchScore >= 70 ? 'border-emerald-500/30 bg-emerald-500/5' : matchResult.matchScore >= 50 ? 'border-blue-500/30 bg-blue-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">{matchResult.mentor} ↔ {matchResult.mentee}</div>
            <div className={cn('text-2xl font-bold', COMP_COLOR[matchResult.compatibility])}>{matchResult.matchScore}<span className="text-xs text-zinc-400">/100</span></div>
            <div className="text-[10px] text-zinc-500">skill overlap: {matchResult.skillOverlap}</div>
            <div className={cn('text-[10px] font-semibold capitalize', COMP_COLOR[matchResult.compatibility])}>{matchResult.compatibility}</div>
          </div>
        )}
        {progResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Progress · {progResult.momentum}</div>
            <div className={cn('text-2xl font-bold', MOMENTUM_COLOR[progResult.momentum])}>{progResult.completionRate}%</div>
            <div className="text-[10px] text-zinc-500">{progResult.completed}/{progResult.totalGoals} goals · {progResult.sessionsCompleted} sessions / {progResult.totalHours}h</div>
          </div>
        )}
        {fbResult && fbResult.avgRating != null && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Feedback · {fbResult.satisfaction}</div>
            <div className="text-2xl font-bold text-amber-300">{fbResult.avgRating}<span className="text-xs text-zinc-400">/5</span></div>
            <div className="text-[10px] text-zinc-500">{fbResult.sessions} sessions</div>
            <div className="flex flex-wrap gap-1 mt-1">{(fbResult.topThemes ?? []).map((t, i) => <span key={i} className="text-[9px] bg-amber-500/10 text-amber-200 px-1.5 py-0.5 rounded">{t.theme} ×{t.count}</span>)}</div>
          </div>
        )}
        {planResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Dev plan · {planResult.timelineWeeks}wk</div>
            <div className="text-[11px] text-purple-200">→ {planResult.targetRole}</div>
            {planResult.gaps.slice(0, 3).map((g, i) => <div key={i} className="text-[10px] text-amber-300">gap: {g}</div>)}
            {planResult.milestones.map((m, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5"><span className="font-mono text-purple-200">{m.phase}</span> ({m.weeks}): {m.focus}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Coaching brief</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
