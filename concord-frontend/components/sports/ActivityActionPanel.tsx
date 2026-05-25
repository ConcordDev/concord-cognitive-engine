'use client';

/**
 * ActivityActionPanel — ESPN Fantasy + Strava-shape action surface for
 * the sports lens. Self-contained input lets you log an activity
 * snapshot, then run the 4 sports macros + the mint/DM/publish/agent
 * quartet.
 *
 *   1. Performance stats → sports.performanceStats (trend + consistency)
 *   2. Training plan     → sports.trainingPlan (sport × level × days)
 *   3. Injury risk       → sports.injuryRisk (load + recovery factors)
 *   4. Team analysis     → sports.teamAnalysis (roster summary)
 *   5. Mint snapshot     → private DTU
 *   6. DM coach          → /api/social/dm with the snapshot
 *   7. Publish race report → public DTU + flag published
 *   8. Race-plan (agent) → chat_agent.do "build a race-day plan"
 */

import { useState } from 'react';
import {
  Trophy, BarChart3, ClipboardList, AlertTriangle, Users,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('sports', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'stats' | 'plan' | 'risk' | 'team' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface StatsResult { metric?: string; average?: number; best?: number; trend?: string; consistency?: number; dataPoints?: number }
interface PlanResult { sport?: string; daysPerWeek?: number; schedule?: Array<{ day: number; workout: string; intensity: string }>; principle?: string }
interface RiskResult { riskScore?: number; riskLevel?: string; recommendations?: string[] }

const SPORTS = ['running', 'swimming', 'cycling', 'general'];
const LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'];

export function ActivityActionPanel() {
  const [sport, setSport] = useState('running');
  const [level, setLevel] = useState('intermediate');
  const [daysPerWeek, setDaysPerWeek] = useState('');
  const [statsText, setStatsText] = useState('');
  const [weeklyHours, setWeeklyHours] = useState('');
  const [restDays, setRestDays] = useState('');
  const [age, setAge] = useState('');
  const [sleepHours, setSleepHours] = useState('');
  const [coachId, setCoachId] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [statsResult, setStatsResult] = useState<StatsResult | null>(null);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [riskResult, setRiskResult] = useState<RiskResult | null>(null);
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

  const statsArray = statsText.split('\n').map(s => s.trim()).filter(Boolean).map(v => ({ metric: 'value', value: parseFloat(v) || 0 }));

  async function actStats() {
    if (!statsArray.length) { err('Add at least one value (one per line).'); return; }
    setBusy('stats'); setFeedback(null);
    try {
      const r = await callMacro<StatsResult>('performanceStats', { stats: statsArray });
      if (r.ok && r.result) { setStatsResult(r.result); pipe.publish('sports.performance', r.result, { label: `${r.result.trend ?? 'trend'}` }); ok('Stats analyzed.'); }
      else err(r.error ?? 'stats failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPlan() {
    setBusy('plan'); setFeedback(null);
    try {
      const r = await callMacro<PlanResult>('trainingPlan', { sport, level, daysPerWeek: parseInt(daysPerWeek, 10) });
      if (r.ok && r.result) { setPlanResult(r.result); pipe.publish('sports.plan', r.result, { label: `${r.result.sport ?? sport} plan` }); ok('Plan ready.'); }
      else err(r.error ?? 'plan failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actRisk() {
    setBusy('risk'); setFeedback(null);
    try {
      const r = await callMacro<RiskResult>('injuryRisk', {
        weeklyHours: parseFloat(weeklyHours),
        restDaysPerWeek: parseInt(restDays, 10),
        age: parseInt(age, 10),
        sleepHours: parseFloat(sleepHours),
        previousInjuries: 0,
      });
      if (r.ok && r.result) { setRiskResult(r.result); pipe.publish('sports.risk', r.result, { label: `risk ${r.result.riskLevel}` }); ok(`Risk: ${r.result.riskLevel}.`); }
      else err(r.error ?? 'risk failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actTeam() {
    setBusy('team'); setFeedback(null);
    err('Team analysis needs a roster input — skipped here (use bespoke team page).');
    setBusy(null);
  }

  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: {
          title: `${sport} snapshot — ${new Date().toISOString().slice(0, 10)}`,
          tags: ['sports', sport, level, `weekly-hrs:${weeklyHours}`],
          source: 'sports:snapshot:mint',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            snapshot: { sport, level, daysPerWeek: parseInt(daysPerWeek, 10), weeklyHours: parseFloat(weeklyHours), restDays: parseInt(restDays, 10), age: parseInt(age, 10), sleepHours: parseFloat(sleepHours), stats: statsArray, results: { performance: statsResult, plan: planResult, risk: riskResult } },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintedDtuId(id); pipe.publish('sports.mintedDtuId', id, { label: `snapshot ${id.slice(0, 8)}` }); ok(`DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!coachId.trim()) { err('Enter a coach user id.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `🏃 ${sport} snapshot — ${level}`,
      ``,
      `Volume: ${weeklyHours} h/wk · ${restDays} rest day(s) · sleep ${sleepHours}h`,
      riskResult?.riskLevel ? `Injury risk: ${riskResult.riskLevel} (${riskResult.riskScore})` : '',
      statsResult?.trend ? `Performance trend: ${statsResult.trend} (avg ${statsResult.average})` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: coachId.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setCoachId(''); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({
          domain: 'dtu', name: 'create',
          input: {
            title: `${sport} race report — ${new Date().toISOString().slice(0, 10)}`,
            tags: ['sports', sport, 'race-report', 'public'],
            source: 'sports:report:publish',
            meta: { visibility: 'public', consent: { allowCitations: true }, race: { sport, level, stats: statsArray, trend: statsResult?.trend, plan: planResult } },
          },
        });
        const dtu = r.data?.result?.dtu ?? r.data?.result;
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('sports.publishedDtuId', id, { label: `report ${id.slice(0, 8)}` }); ok(`Race report published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Build a race-day plan for ${sport} (${level} athlete).`,
        `Training volume: ${weeklyHours} h/wk over ${daysPerWeek} days.`,
        `Sleep: ${sleepHours}h. Age: ${age}.`,
        riskResult?.riskLevel ? `Injury risk: ${riskResult.riskLevel}.` : '',
        statsResult?.trend ? `Recent trend: ${statsResult.trend}.` : '',
        ``,
        `Return: 1) pace + fueling strategy for race day; 2) the 3 things to avoid in the final week; 3) the warm-up sequence.`,
      ].filter(Boolean).join(' ');
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 4 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Race plan ready.'); }
      else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'stats',   label: 'Performance',  desc: 'Trend + best/worst + consistency',           icon: BarChart3,     accent: '#06b6d4', handler: actStats,  disabled: statsArray.length === 0 },
    { id: 'plan',    label: 'Training plan', desc: 'Sport × level × days/wk schedule',           icon: ClipboardList, accent: '#22c55e', handler: actPlan },
    { id: 'risk',    label: 'Injury risk',   desc: 'Load + recovery factors',                     icon: AlertTriangle, accent: '#ef4444', handler: actRisk },
    { id: 'team',    label: 'Team',          desc: 'Roster analysis (paste players)',             icon: Users,         accent: '#8b5cf6', handler: actTeam },
    { id: 'mint',    label: mintedDtuId      ? 'Saved'     : 'Mint',         desc: mintedDtuId      ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private snapshot DTU',                       icon: Sparkles, accent: '#3b82f6', handler: actMint,    disabled: !!mintedDtuId },
    { id: 'dm',      label: 'DM coach',      desc: 'Snapshot + risk + trend to coach user',       icon: Send,          accent: '#ec4899', handler: actDm },
    { id: 'publish', label: publishedDtuId ? 'Published' : 'Publish report', desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public race report + federation',           icon: Globe,    accent: '#15803d', handler: actPublish, disabled: !!publishedDtuId },
    { id: 'agent',   label: 'Race plan',     desc: 'Agent drafts race-day plan',                  icon: Wand2,         accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <Trophy className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Activity workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          espn fantasy · strava
        </span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Sport</label>
          <select value={sport} onChange={(e) => setSport(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white capitalize">
            {SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Level</label>
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white capitalize">
            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Days/wk</label>
          <input type="text" value={daysPerWeek} onChange={(e) => setDaysPerWeek(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Weekly hours</label>
          <input type="text" value={weeklyHours} onChange={(e) => setWeeklyHours(e.target.value.replace(/[^\d.]/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Rest days/wk</label>
          <input type="text" value={restDays} onChange={(e) => setRestDays(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Age</label>
          <input type="text" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Sleep hrs</label>
          <input type="text" value={sleepHours} onChange={(e) => setSleepHours(e.target.value.replace(/[^\d.]/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Coach (for DM)</label>
          <input type="text" value={coachId} onChange={(e) => setCoachId(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="coach user id" />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Performance values (one per line — e.g. 5k times in min)</label>
        <textarea value={statsText} onChange={(e) => setStatsText(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400/40 resize-none" placeholder="22.5&#10;22.1&#10;21.8&#10;21.5" />
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
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/40 disabled:hover:border-zinc-800',
                'focus:outline-none focus:ring-2 focus:ring-emerald-400/40',
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
        {statsResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5">
              <BarChart3 className="w-3 h-3" /> Performance ({statsResult.dataPoints} pts)
            </div>
            <div className="text-[11px] text-zinc-300">avg <span className="font-mono text-cyan-300">{statsResult.average}</span> · best <span className="font-mono">{statsResult.best}</span> · trend <span className={cn('font-semibold', statsResult.trend === 'improving' ? 'text-emerald-300' : 'text-amber-300')}>{statsResult.trend}</span> · σ <span className="font-mono">{statsResult.consistency}</span></div>
          </div>
        )}
        {planResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold flex items-center gap-1.5">
              <ClipboardList className="w-3 h-3" /> {planResult.sport} plan
            </div>
            {planResult.schedule?.map((d, i) => (
              <div key={i} className="text-[11px] text-zinc-300"><span className="font-mono text-emerald-300">D{d.day}</span> {d.workout} <span className="text-[9px] text-zinc-400">({d.intensity})</span></div>
            ))}
            {planResult.principle && <p className="text-[10px] text-zinc-400 italic">{planResult.principle}</p>}
          </div>
        )}
        {riskResult && (
          <div className={cn('rounded-md border p-2.5 space-y-0.5', riskResult.riskLevel === 'high' ? 'border-rose-500/40 bg-rose-500/5' : riskResult.riskLevel === 'moderate' ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/40 bg-emerald-500/5')}>
            <div className={cn('text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5', riskResult.riskLevel === 'high' ? 'text-rose-300' : riskResult.riskLevel === 'moderate' ? 'text-amber-300' : 'text-emerald-300')}>
              <AlertTriangle className="w-3 h-3" /> Injury risk: {riskResult.riskLevel} ({riskResult.riskScore})
            </div>
            {riskResult.recommendations?.map((r, i) => <div key={i} className="text-[11px] text-zinc-300">• {r}</div>)}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
            <Wand2 className="w-3 h-3" /> Race plan
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
