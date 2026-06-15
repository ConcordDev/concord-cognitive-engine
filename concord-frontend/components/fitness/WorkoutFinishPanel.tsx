'use client';

/**
 * WorkoutFinishPanel — an end-of-workout action surface
 * for the fitness lens. Sits below the existing WorkoutLogger; once you
 * finish a workout, this panel turns it into shareable + analysable
 * artifacts.
 *
 *   1. Progression       → fitness.progressionCalc on the recorded sets
 *   2. HR zones          → fitness.hr-zones for the avg HR + max-HR input
 *   3. Save workout      → fitness.workout-save (persist to user's log)
 *   4. Mint workout DTU  → dtu.create with full set table (private)
 *   5. DM training partner → /api/social/dm with PRs + volume summary
 *   6. Publish PR        → dtu.create public + flag published if the
 *                          user marks this session as a PR
 *   7. Next workout (agent) → chat_agent.do "design my next workout
 *                          given the progression on these lifts"
 */

import { useState } from 'react';
import {
  Dumbbell, TrendingUp, Heart, Sparkles, Send, Globe, Wand2, Save,
  Loader2, Check, AlertTriangle, Plus, X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface LiftEntry {
  name: string;
  sets: Array<{ reps: number; weight: number; rir?: number }>;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('fitness', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'progression' | 'hrzones' | 'save' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface ProgressionResult { suggestions?: Array<{ lift: string; suggestion: string; nextWeight?: number }>; volumeKg?: number }
interface HrZoneResult { maxHr?: number; zones?: Array<{ zone: number; range: string; purpose: string }> }

export function WorkoutFinishPanel() {
  const [title, setTitle] = useState('');
  const [lifts, setLifts] = useState<LiftEntry[]>([{ name: 'Squat', sets: [{ reps: 5, weight: 0, rir: 2 }] }]);
  const [avgHr, setAvgHr] = useState('');
  const [age, setAge] = useState('30');
  const [partnerId, setPartnerId] = useState('');
  const [isPr, setIsPr] = useState(false);

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [progressionResult, setProgressionResult] = useState<ProgressionResult | null>(null);
  const [hrResult, setHrResult] = useState<HrZoneResult | null>(null);
  const [savedWorkoutId, setSavedWorkoutId] = useState<string | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  const ready = lifts.some(l => l.name.trim() && l.sets.some(s => s.weight > 0 && s.reps > 0));
  const totalVolume = lifts.reduce((sum, l) => sum + l.sets.reduce((s, st) => s + st.weight * st.reps, 0), 0);
  const totalSets = lifts.reduce((sum, l) => sum + l.sets.length, 0);

  function addLift() {
    setLifts(prev => [...prev, { name: '', sets: [{ reps: 5, weight: 0, rir: 2 }] }]);
  }
  function removeLift(idx: number) {
    setLifts(prev => prev.filter((_, i) => i !== idx));
  }
  function updateLiftName(idx: number, name: string) {
    setLifts(prev => prev.map((l, i) => i === idx ? { ...l, name } : l));
  }
  function addSet(liftIdx: number) {
    setLifts(prev => prev.map((l, i) => i === liftIdx ? { ...l, sets: [...l.sets, { reps: l.sets[l.sets.length - 1]?.reps ?? 5, weight: l.sets[l.sets.length - 1]?.weight ?? 0, rir: 2 }] } : l));
  }
  function updateSet(liftIdx: number, setIdx: number, field: 'reps' | 'weight' | 'rir', val: number) {
    setLifts(prev => prev.map((l, i) => i === liftIdx ? { ...l, sets: l.sets.map((s, j) => j === setIdx ? { ...s, [field]: val } : s) } : l));
  }
  function removeSet(liftIdx: number, setIdx: number) {
    setLifts(prev => prev.map((l, i) => i === liftIdx ? { ...l, sets: l.sets.filter((_, j) => j !== setIdx) } : l));
  }

  async function actProgression() {
    if (!ready) { err('Add a lift with at least one set.'); return; }
    setBusy('progression'); setFeedback(null);
    try {
      const r = await callMacro<ProgressionResult>('progressionCalc', { lifts });
      if (r.ok && r.result) { setProgressionResult(r.result); ok('Progression suggestions ready.'); }
      else err(r.error ?? 'progression failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actHr() {
    if (!avgHr || !age) { err('Enter average HR + age.'); return; }
    setBusy('hrzones'); setFeedback(null);
    try {
      const r = await callMacro<HrZoneResult>('hr-zones', { age: parseInt(age, 10), avgHr: parseInt(avgHr, 10) });
      if (r.ok && r.result) { setHrResult(r.result); ok('HR zones computed.'); }
      else err(r.error ?? 'HR zones failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actSave() {
    if (!ready) { err('Add at least one logged lift.'); return; }
    setBusy('save'); setFeedback(null);
    try {
      const r = await callMacro<{ workoutId?: string }>('workout-save', {
        title: title.trim() || `Workout ${new Date().toISOString().slice(0, 10)}`,
        lifts,
        finishedAt: new Date().toISOString(),
        notes: '',
      });
      if (r.ok && r.result?.workoutId) { setSavedWorkoutId(r.result.workoutId); ok(`Workout saved ${r.result.workoutId.slice(0, 8)}…`); }
      else err(r.error ?? 'save failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMint() {
    if (!ready) { err('Add at least one logged lift.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: {
          title: `Workout — ${title.trim() || new Date().toISOString().slice(0, 10)}`,
          tags: ['fitness', 'workout', isPr ? 'pr' : 'session', `volume:${Math.round(totalVolume)}kg`],
          source: 'fitness:workout:mint',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            workout: {
              title: title.trim(),
              finishedAt: new Date().toISOString(),
              lifts,
              totalVolume,
              totalSets,
              isPr,
              avgHr: avgHr ? parseInt(avgHr, 10) : null,
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintedDtuId(id); ok(`Workout DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!ready) { err('Add at least one logged lift.'); return; }
    if (!partnerId.trim()) { err('Enter a training-partner user id.'); return; }
    setBusy('dm'); setFeedback(null);
    const liftLines = lifts.filter(l => l.name.trim()).map(l => {
      const top = l.sets.reduce((max, s) => s.weight > (max?.weight ?? 0) ? s : max, l.sets[0]);
      return `  ${l.name}: ${l.sets.length} sets, top ${top?.weight}kg × ${top?.reps}`;
    });
    const body = [
      `💪 ${title.trim() || 'Workout'} — ${new Date().toLocaleDateString()}`,
      ``,
      ...liftLines,
      ``,
      `Volume: ${Math.round(totalVolume)} kg · ${totalSets} sets`,
      isPr ? '🏆 PR session.' : '',
    ].filter(Boolean).join('\n');
    try {
      const r = await api.post('/api/social/dm', { toUserId: partnerId.trim(), content: body });
      if (r.data?.ok !== false) { ok(`Sent to ${partnerId.trim()}.`); setPartnerId(''); }
      else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    if (!ready) { err('Add at least one logged lift.'); return; }
    if (!isPr) { err('Mark this session as a PR first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const topByLift = lifts.filter(l => l.name.trim()).map(l => {
        const top = l.sets.reduce((max, s) => s.weight > (max?.weight ?? 0) ? s : max, l.sets[0]);
        return { lift: l.name, weight: top?.weight ?? 0, reps: top?.reps ?? 0 };
      });
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: {
          title: `PR — ${topByLift[0]?.lift ?? 'Lift'} ${topByLift[0]?.weight}kg × ${topByLift[0]?.reps}`,
          tags: ['fitness', 'pr', 'public'],
          source: 'fitness:pr:publish',
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            pr: { date: new Date().toISOString().slice(0, 10), topByLift, totalVolume },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`PR published ${id.slice(0, 8)}…`); }
      else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    if (!ready) { err('Add at least one logged lift.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const summary = lifts.filter(l => l.name.trim()).map(l => {
        const top = l.sets.reduce((max, s) => s.weight > (max?.weight ?? 0) ? s : max, l.sets[0]);
        return `${l.name}: ${l.sets.length}x top ${top?.weight}kg×${top?.reps} (avg RIR ${(l.sets.reduce((s, st) => s + (st.rir ?? 0), 0) / l.sets.length).toFixed(1)})`;
      }).join('; ');
      const task = [
        `Today's workout: ${summary}.`,
        `Total volume: ${Math.round(totalVolume)} kg across ${totalSets} sets.`,
        progressionResult?.suggestions?.length ? `Progression flags: ${progressionResult.suggestions.map(s => `${s.lift}: ${s.suggestion}`).join('; ')}.` : '',
        ``,
        `Design my next workout (same split-day). Return: 1) per-lift target weights + sets/reps;`,
        `2) one accessory lift to add; 3) a brief reasoning paragraph (linear progression vs deload).`,
      ].filter(Boolean).join(' ');
      const r = await lensRun({
        domain: 'chat_agent', name: 'do',
        input: { task, maxTurns: 4 },
      });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) {
        setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Next workout drafted.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'progression', label: 'Progression',   desc: 'Suggested next-session weights per lift',  icon: TrendingUp, accent: '#22c55e', handler: actProgression, disabled: !ready },
    { id: 'hrzones',     label: 'HR zones',       desc: 'Compute zones from avg HR + age',          icon: Heart,      accent: '#ef4444', handler: actHr },
    { id: 'save',        label: savedWorkoutId   ? 'Saved'     : 'Save workout',  desc: savedWorkoutId   ? `id ${savedWorkoutId.slice(0, 8)}…`  : 'Persist to fitness.workout-save log',          icon: Save,      accent: '#06b6d4', handler: actSave,      disabled: !ready || !!savedWorkoutId },
    { id: 'mint',        label: mintedDtuId      ? 'Minted'    : 'Mint DTU',      desc: mintedDtuId      ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private DTU with full set table',              icon: Sparkles,  accent: '#3b82f6', handler: actMint,      disabled: !ready || !!mintedDtuId },
    { id: 'dm',          label: 'DM partner',     desc: 'Send workout summary to training partner',  icon: Send,       accent: '#ec4899', handler: actDm,        disabled: !ready },
    { id: 'publish',     label: publishedDtuId   ? 'PR published' : 'Publish PR', desc: publishedDtuId   ? `DTU ${publishedDtuId.slice(0, 8)}…` : isPr ? 'Public PR DTU + federation' : 'Mark as PR first', icon: Globe, accent: '#15803d', handler: actPublish, disabled: !ready || !isPr || !!publishedDtuId },
    { id: 'agent',       label: 'Next workout',   desc: 'Agent drafts the next session',             icon: Wand2,      accent: '#eab308', handler: actAgent,     disabled: !ready },
  ];

  return (
    <div className="rounded-lg border border-orange-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-orange-500/10 pb-2">
        <Dumbbell className="h-4 w-4 text-orange-400" />
        <h3 className="text-sm font-semibold text-white">Workout finisher</h3>
        <span className="ml-auto text-[10px] text-zinc-400 font-mono">
          {totalSets} sets · {Math.round(totalVolume)} kg
        </span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white focus:outline-none focus:ring-2 focus:ring-orange-400/40" placeholder="Workout title (Push Day, Legs A, …)" />
        <input type="text" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40" placeholder="Training-partner user id" />
        <label className="flex items-center gap-2 px-3 py-1.5 rounded border border-zinc-800 bg-zinc-900 text-[12px] text-zinc-300 cursor-pointer hover:bg-zinc-800">
          <input type="checkbox" checked={isPr} onChange={(e) => setIsPr(e.target.checked)} className="rounded" />
          🏆 PR session
        </label>
      </div>

      <div className="space-y-2">
        {lifts.map((lift, li) => (
          <div key={li} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <input type="text" value={lift.name} onChange={(e) => updateLiftName(li, e.target.value)} className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[12px] text-white font-semibold focus:outline-none focus:ring-2 focus:ring-orange-400/40" placeholder="Lift name (Squat, Bench, …)" />
              <button type="button" onClick={() => addSet(li)} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-orange-500/15 text-orange-300 text-[10px] hover:bg-orange-500/25"><Plus className="w-3 h-3" /> set</button>
              <button type="button" onClick={() => removeLift(li)} className="p-1 rounded hover:bg-zinc-800 text-zinc-400" aria-label="Remove lift"><X className="w-3 h-3" /></button>
            </div>
            <div className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-1 items-center">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider px-1">#</span>
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider px-1">Weight (kg)</span>
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider px-1">Reps</span>
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider px-1">RIR</span>
              <span></span>
              {lift.sets.map((s, si) => (
                <>
                  <span key={`n-${si}`} className="text-[11px] text-zinc-400 font-mono px-1">{si + 1}</span>
                  <input key={`w-${si}`} type="number" value={s.weight || ''} onChange={(e) => updateSet(li, si, 'weight', parseFloat(e.target.value) || 0)} className="bg-zinc-950 border border-zinc-800 rounded px-2 py-0.5 text-[11px] text-white font-mono focus:outline-none focus:ring-1 focus:ring-orange-400/40" />
                  <input key={`r-${si}`} type="number" value={s.reps || ''} onChange={(e) => updateSet(li, si, 'reps', parseInt(e.target.value, 10) || 0)} className="bg-zinc-950 border border-zinc-800 rounded px-2 py-0.5 text-[11px] text-white font-mono focus:outline-none focus:ring-1 focus:ring-orange-400/40" />
                  <input key={`i-${si}`} type="number" value={s.rir ?? ''} onChange={(e) => updateSet(li, si, 'rir', parseInt(e.target.value, 10) || 0)} className="bg-zinc-950 border border-zinc-800 rounded px-2 py-0.5 text-[11px] text-white font-mono focus:outline-none focus:ring-1 focus:ring-orange-400/40" placeholder="2" />
                  <button key={`d-${si}`} type="button" onClick={() => removeSet(li, si)} className="p-0.5 rounded hover:bg-zinc-800 text-zinc-600" aria-label="Remove set"><X className="w-3 h-3" /></button>
                </>
              ))}
            </div>
          </div>
        ))}
        <button type="button" onClick={addLift} className="w-full inline-flex items-center justify-center gap-1 py-1.5 rounded border border-dashed border-zinc-700 text-zinc-400 text-[12px] hover:bg-zinc-900 hover:text-zinc-200"><Plus className="w-3 h-3" /> Add lift</button>
      </div>

      {/* HR inputs (only relevant when computing HR zones) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Age (HR)</label>
          <input type="text" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-2 focus:ring-red-400/40" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Avg HR</label>
          <input type="text" value={avgHr} onChange={(e) => setAvgHr(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-2 focus:ring-red-400/40" placeholder="130" />
        </div>
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
                'focus:outline-none focus:ring-2 focus:ring-orange-400/40',
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

      {progressionResult?.suggestions?.length ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3" /> Progression suggestions
          </div>
          {progressionResult.suggestions.map((s, i) => (
            <div key={i} className="text-[11px] text-zinc-300">
              <strong className="text-emerald-200">{s.lift}:</strong> {s.suggestion}
              {s.nextWeight != null && <span className="text-emerald-400 font-mono ml-2">→ {s.nextWeight}kg</span>}
            </div>
          ))}
        </div>
      ) : null}

      {hrResult?.zones?.length ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold flex items-center gap-1.5">
            <Heart className="w-3 h-3" /> HR zones (max ~ {hrResult.maxHr} bpm)
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-1">
            {hrResult.zones.map(z => (
              <div key={z.zone} className="rounded bg-zinc-900/60 px-2 py-1 text-[10px]">
                <div className="text-red-300 font-mono">Z{z.zone}</div>
                <div className="text-zinc-300">{z.range}</div>
                <div className="text-zinc-400 text-[9px]">{z.purpose}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
            <Wand2 className="w-3 h-3" /> Next workout
          </div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre>
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
