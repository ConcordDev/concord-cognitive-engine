'use client';

/**
 * WellnessActionPanel — Whoop-shape recovery + strain + sleep workbench.
 * Self-contained; runs the 4 new wellness.* macros plus mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Moon, Activity, Battery, TrendingUp, Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string; reason?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('wellness', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'sleep' | 'strain' | 'recovery' | 'hrv' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface SleepResult { score?: number; hoursAsleep?: number; efficiencyPct?: number; disturbances?: number; band?: string }
interface StrainResult { strain?: number; band?: string; totalActiveMin?: number; weightedLoad?: number }
interface RecoveryResult { recoveryPct?: number; band?: string; recommendation?: string }
interface HrvTrendResult { count?: number; average?: number; recentAverage?: number; latest?: number; min?: number; max?: number; trend?: string; message?: string }

export function WellnessActionPanel() {
  const [minutesAsleep, setMinutesAsleep] = useState('');
  const [minutesInBed, setMinutesInBed] = useState('');
  const [disturbances, setDisturbances] = useState('');
  const [z1, setZ1] = useState(''); const [z2, setZ2] = useState(''); const [z3, setZ3] = useState('');
  const [z4, setZ4] = useState(''); const [z5, setZ5] = useState('');
  const [hrvMs, setHrvMs] = useState(''); const [baselineHrv, setBaselineHrv] = useState('');
  const [rhrBpm, setRhrBpm] = useState(''); const [baselineRhr, setBaselineRhr] = useState('');
  const [hrvSeries, setHrvSeries] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [sleepResult, setSleepResult] = useState<SleepResult | null>(null);
  const [strainResult, setStrainResult] = useState<StrainResult | null>(null);
  const [recoveryResult, setRecoveryResult] = useState<RecoveryResult | null>(null);
  const [hrvResult, setHrvResult] = useState<HrvTrendResult | null>(null);
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

  async function actSleep() {
    setBusy('sleep'); setFeedback(null);
    try {
      const r = await callMacro<SleepResult>('sleepScore', { minutesAsleep: parseFloat(minutesAsleep), minutesInBed: parseFloat(minutesInBed), disturbances: parseInt(disturbances, 10) });
      if (r.ok && r.result) { setSleepResult(r.result); pipe.publish('wellness.sleep', r.result, { label: `${r.result.score}/100` }); ok(`Sleep ${r.result.band} (${r.result.score}).`); }
      else err(r.reason ?? r.error ?? 'sleep failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actStrain() {
    setBusy('strain'); setFeedback(null);
    try {
      const r = await callMacro<StrainResult>('strainLog', { minutesByZone: { z1: parseInt(z1, 10), z2: parseInt(z2, 10), z3: parseInt(z3, 10), z4: parseInt(z4, 10), z5: parseInt(z5, 10) } });
      if (r.ok && r.result) { setStrainResult(r.result); pipe.publish('wellness.strain', r.result, { label: `${r.result.strain} ${r.result.band ?? ''}` }); ok(`Strain ${r.result.strain} (${r.result.band}).`); }
      else err(r.error ?? 'strain failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actRecovery() {
    setBusy('recovery'); setFeedback(null);
    try {
      const r = await callMacro<RecoveryResult>('recoveryReport', { hrvMs: parseFloat(hrvMs), baselineHrvMs: parseFloat(baselineHrv), rhrBpm: parseFloat(rhrBpm), baselineRhrBpm: parseFloat(baselineRhr), sleepScore: sleepResult?.score ?? 70 });
      if (r.ok && r.result) { setRecoveryResult(r.result); pipe.publish('wellness.recovery', r.result, { label: `${r.result.recoveryPct}% ${r.result.band ?? ''}` }); ok(`Recovery ${r.result.recoveryPct}% (${r.result.band}).`); }
      else err(r.reason ?? r.error ?? 'recovery failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actHrv() {
    const readings = hrvSeries.split('\n').map(l => { const [date, ms] = l.split(',').map(s => s.trim()); return date && ms ? { date, hrvMs: parseFloat(ms) } : null; }).filter(Boolean);
    setBusy('hrv'); setFeedback(null);
    try {
      const r = await callMacro<HrvTrendResult>('hrvTrend', { readings });
      if (r.ok && r.result) { setHrvResult(r.result); pipe.publish('wellness.hrv', r.result, { label: r.result.trend ?? 'hrv' }); ok(`HRV ${r.result.trend ?? r.result.message ?? 'analyzed'}.`); }
      else err(r.error ?? 'hrv failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: {
          title: `Wellness — ${new Date().toISOString().slice(0, 10)}`,
          tags: ['wellness', recoveryResult?.band ?? 'unknown', `sleep:${sleepResult?.score ?? 0}`],
          source: 'wellness:snapshot:mint',
          meta: { visibility: 'private', consent: { allowCitations: false }, wellness: { sleep: sleepResult, strain: strainResult, recovery: recoveryResult, hrv: hrvResult } },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintedDtuId(id); pipe.publish('wellness.mintedDtuId', id, { label: `snapshot ${id.slice(0, 8)}` }); ok(`Wellness DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `🌿 Wellness — ${new Date().toLocaleDateString()}`,
      '',
      sleepResult ? `Sleep: ${sleepResult.score}/100 (${sleepResult.band}) · ${sleepResult.hoursAsleep}h @ ${sleepResult.efficiencyPct}%` : '',
      strainResult ? `Strain: ${strainResult.strain}/21 (${strainResult.band}) · ${strainResult.totalActiveMin}m active` : '',
      recoveryResult ? `Recovery: ${recoveryResult.recoveryPct}% (${recoveryResult.band}) — ${recoveryResult.recommendation}` : '',
      hrvResult?.trend ? `HRV: ${hrvResult.trend} (avg ${hrvResult.average}ms)` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
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
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({
          domain: 'dtu', name: 'create',
          input: {
            title: `Wellness trend — ${hrvResult?.trend ?? 'snapshot'}`,
            tags: ['wellness', 'public', recoveryResult?.band ?? 'unknown'],
            source: 'wellness:trend:publish',
            meta: { visibility: 'public', consent: { allowCitations: true }, anonymized: true, trends: { hrv: hrvResult, recovery: recoveryResult } },
          },
        });
        const dtu = r.data?.result?.dtu ?? r.data?.result;
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('wellness.publishedDtuId', id, { label: `trend ${id.slice(0, 8)}` }); ok(`Trend published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Wellness state:`,
        sleepResult ? `sleep ${sleepResult.score}/100 ${sleepResult.band}.` : '',
        strainResult ? `strain ${strainResult.strain}/21 ${strainResult.band}.` : '',
        recoveryResult ? `recovery ${recoveryResult.recoveryPct}% ${recoveryResult.band}.` : '',
        hrvResult?.trend ? `HRV trend ${hrvResult.trend}.` : '',
        '',
        'Recommend a 24-hour plan: what to do, what to avoid, one specific tweak that compounds the trend.',
        'Plain text. Practical, not vague.',
      ].filter(Boolean).join(' ');
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 4 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('24-hour plan ready.'); }
      else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void }> = [
    { id: 'sleep',    label: 'Sleep',     desc: 'sleepScore (0-100 + band)',                  icon: Moon,       accent: '#6366f1', handler: actSleep },
    { id: 'strain',   label: 'Strain',    desc: 'strainLog Whoop-scale 0-21',                 icon: Activity,   accent: '#f97316', handler: actStrain },
    { id: 'recovery', label: 'Recovery',  desc: 'recoveryReport HRV + RHR + sleep',           icon: Battery,    accent: '#22c55e', handler: actRecovery },
    { id: 'hrv',      label: 'HRV trend', desc: 'hrvTrend across last N days',                icon: TrendingUp, accent: '#06b6d4', handler: actHrv },
    { id: 'mint',     label: mintedDtuId      ? 'Saved'     : 'Mint',         desc: mintedDtuId      ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private wellness DTU',                          icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm',       label: 'DM coach',  desc: 'Send wellness brief to coach',               icon: Send,       accent: '#ec4899', handler: actDm },
    { id: 'publish',  label: publishedDtuId ? 'Published' : 'Publish trend', desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Anonymized public trend DTU',                   icon: Globe,    accent: '#15803d', handler: actPublish },
    { id: 'agent',    label: '24h plan',  desc: 'Agent recommends next 24h plan',             icon: Wand2,      accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <Battery className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Wellness workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">whoop</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Min asleep</label><input type="text" value={minutesAsleep} onChange={(e) => setMinutesAsleep(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Min in bed</label><input type="text" value={minutesInBed} onChange={(e) => setMinutesInBed(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Disturbances</label><input type="text" value={disturbances} onChange={(e) => setDisturbances(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">DM recipient</label><input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="coach user id" /></div>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {[{ k: 'z1', v: z1, set: setZ1, label: 'Z1' }, { k: 'z2', v: z2, set: setZ2, label: 'Z2' }, { k: 'z3', v: z3, set: setZ3, label: 'Z3' }, { k: 'z4', v: z4, set: setZ4, label: 'Z4' }, { k: 'z5', v: z5, set: setZ5, label: 'Z5' }].map(({ k, v, set, label }) => (
          <div key={k}><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">{label} min</label><input type="text" value={v} onChange={(e) => set(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" /></div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">HRV ms</label><input type="text" value={hrvMs} onChange={(e) => setHrvMs(e.target.value.replace(/[^\d.]/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Baseline HRV</label><input type="text" value={baselineHrv} onChange={(e) => setBaselineHrv(e.target.value.replace(/[^\d.]/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">RHR bpm</label><input type="text" value={rhrBpm} onChange={(e) => setRhrBpm(e.target.value.replace(/[^\d.]/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Baseline RHR</label><input type="text" value={baselineRhr} onChange={(e) => setBaselineRhr(e.target.value.replace(/[^\d.]/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" /></div>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">HRV series (YYYY-MM-DD,ms — one per line)</label>
        <textarea value={hrvSeries} onChange={(e) => setHrvSeries(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-2 focus:ring-cyan-400/40 resize-none" />
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {sleepResult && <Tile label="Sleep" big={`${sleepResult.score}`} sub={sleepResult.band} accent="#6366f1" />}
        {strainResult && <Tile label="Strain" big={`${strainResult.strain}`} sub={strainResult.band} accent="#f97316" />}
        {recoveryResult && <Tile label="Recovery" big={`${recoveryResult.recoveryPct}%`} sub={recoveryResult.band} accent={recoveryResult.band === 'green' ? '#22c55e' : recoveryResult.band === 'yellow' ? '#eab308' : '#ef4444'} />}
        {hrvResult && <Tile label="HRV trend" big={hrvResult.average ? `${hrvResult.average}` : '—'} sub={hrvResult.trend ?? hrvResult.message} accent="#06b6d4" />}
      </div>

      {recoveryResult?.recommendation && (
        <div className={cn('rounded-md border p-2.5 text-[11px]', recoveryResult.band === 'green' ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-200' : recoveryResult.band === 'yellow' ? 'border-amber-500/40 bg-amber-500/5 text-amber-200' : 'border-rose-500/40 bg-rose-500/5 text-rose-200')}>
          💡 {recoveryResult.recommendation}
        </div>
      )}

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> 24-hour plan</div>
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
      <div className="text-2xl font-bold" style={{ color: accent }}>{big}</div>
      {sub && <div className="text-[10px] text-zinc-400 capitalize">{sub}</div>}
    </div>
  );
}
