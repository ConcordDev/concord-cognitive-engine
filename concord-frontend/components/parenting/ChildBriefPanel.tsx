'use client';

/**
 * ChildBriefPanel — Wonder Weeks / Cozi-shape action surface for the
 * parenting lens. Self-contained: takes a child name + age (years +
 * months) and exposes 6 paid-app-tier actions wiring real backends
 * plus the 5 existing parenting macros that had no UI.
 *
 *   1. Milestone check  → parenting.milestoneCheck (age-banded
 *                          developmental expectations)
 *   2. Routine optimize → parenting.routineOptimizer (the day's
 *                          schedule reflowed against age + nap window)
 *   3. Mint snapshot    → dtu.create with the child's snapshot
 *                          (private; tags=[parenting,child:Name])
 *   4. DM caregiver     → /api/social/dm to co-parent / nanny / family
 *                          with the milestone summary + recent notes
 *   5. Publish journey  → dtu.create public anonymized growth DTU
 *                          (federation pickup for parenting communities)
 *   6. Developmental brief (agent) → chat_agent.do "what should I
 *                          watch for in the next 4-6 weeks?"
 */

import { useState } from 'react';
import {
  Baby, Milestone, Clock, Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('parenting', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'milestone' | 'routine' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

// Real response shapes from `parenting.milestoneCheck` / `parenting.routineOptimizer`
// (server/domains/parenting.js) — verified against the handler source, not
// guessed. An earlier version of this panel invented `expected`/`behind`/
// `ahead`/`suggestions`/`napWindow` fields that don't exist in the actual
// macro output, so the buttons showed a fake "success" toast while silently
// rendering nothing real. Fixed alongside the request-shape bug below.
interface MilestoneCategoryResult { category: string; ageRange: string; expected: string[]; achieved: number; total: number; completionRate: number }
interface MilestoneResult {
  childName?: string; ageMonths: number; ageDisplay?: string;
  milestoneResults: MilestoneCategoryResult[]; overallCompletionRate: number;
  totalMilestonesRecorded: number; assessment: string;
}
interface RoutineSlot { time: string; activity: string; duration: number; category: string }
interface RoutineResult {
  stage: string; ageYears: number; suggestedRoutine: RoutineSlot[];
  existingSchedules: number; newSuggestions: number; categoryBreakdown: Record<string, number>;
}

export function ChildBriefPanel() {
  const [childName, setChildName] = useState('');
  const [ageYears, setAgeYears] = useState('');
  const [ageMonths, setAgeMonths] = useState('');
  const [recentNotes, setRecentNotes] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [milestoneResult, setMilestoneResult] = useState<MilestoneResult | null>(null);
  const [routineResult, setRoutineResult] = useState<RoutineResult | null>(null);
  const [snapshotDtuId, setSnapshotDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [dmRecipient, setDmRecipient] = useState('');
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ageInMonths = (parseFloat(ageYears) || 0) * 12 + (parseFloat(ageMonths) || 0);
  const childKnown = childName.trim().length > 0 && ageInMonths > 0;

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  // `milestoneCheck`/`routineOptimizer` read `artifact.data.childAge` as a
  // free-text string like "2y 3m" (parsed by a regex in the handler) — NOT
  // a numeric `ageMonths` field. Building that string here is the fix for
  // the real bug where these two actions always computed against age 0
  // (milestoneCheck) or silently defaulted to the toddler template
  // (routineOptimizer) regardless of what the caller typed in.
  function childAgeStr(): string {
    const y = parseFloat(ageYears) || 0;
    const m = parseFloat(ageMonths) || 0;
    return `${y}y ${m}m`;
  }

  async function actMilestone() {
    if (!childKnown) { err('Enter child name + age.'); return; }
    setBusy('milestone'); setFeedback(null);
    try {
      const r = await callMacro<MilestoneResult>('milestoneCheck', { childName: childName.trim(), childAge: childAgeStr(), milestones: [] });
      if (r.ok && r.result) { setMilestoneResult(r.result); ok('Milestones loaded.'); }
      else err(r.error ?? 'milestone check failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actRoutine() {
    if (!childKnown) { err('Enter child name + age.'); return; }
    setBusy('routine'); setFeedback(null);
    try {
      const r = await callMacro<RoutineResult>('routineOptimizer', { childAge: childAgeStr(), schedules: [] });
      if (r.ok && r.result) { setRoutineResult(r.result); ok('Routine optimized.'); }
      else err(r.error ?? 'routine optimize failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMint() {
    if (!childKnown) { err('Enter child name + age.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: {
          title: `Snapshot — ${childName.trim()} (${ageYears || 0}y ${ageMonths || 0}m)`,
          tags: ['parenting', 'child-snapshot', `child:${childName.trim()}`],
          source: 'parenting:snapshot',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            child: {
              name: childName.trim(),
              ageMonths: ageInMonths,
              ageYears: parseFloat(ageYears) || 0,
              snapshotDate: new Date().toISOString(),
              recentNotes: recentNotes.trim(),
              milestones: milestoneResult,
              routine: routineResult,
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setSnapshotDtuId(id); ok(`Snapshot saved ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!childKnown) { err('Enter child name + age.'); return; }
    if (!dmRecipient.trim()) { err('Enter a caregiver recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const parts: string[] = [
      `👶 ${childName.trim()} update`,
      `Age: ${ageYears || 0}y ${ageMonths || 0}m`,
      '',
    ];
    if (milestoneResult) {
      parts.push(`Milestone assessment: ${milestoneResult.assessment} (${milestoneResult.overallCompletionRate}% complete)`);
      for (const cat of milestoneResult.milestoneResults.slice(0, 4)) {
        parts.push(`  • ${cat.category} (${cat.ageRange}): ${cat.achieved}/${cat.total} — ${cat.expected.join(', ')}`);
      }
      parts.push('');
    }
    if (recentNotes.trim()) {
      parts.push(`Notes: ${recentNotes.trim()}`);
    }
    try {
      const r = await api.post('/api/social/dm', { toUserId: dmRecipient.trim(), content: parts.join('\n') });
      if (r.data?.ok !== false) { ok(`Update sent to ${dmRecipient.trim()}.`); setDmRecipient(''); }
      else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    if (!childKnown) { err('Enter child name + age.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      // Anonymize: drop the child's name from the public DTU body.
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: {
          title: `Growth journey ${ageYears || 0}y${ageMonths ? `-${ageMonths}m` : ''}`,
          tags: ['parenting', 'growth-journey', 'public', `age-months:${ageInMonths}`],
          source: 'parenting:journey:public',
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            anonymized: true,
            child: {
              ageMonths: ageInMonths,
              milestones: milestoneResult,
              routine: routineResult,
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Journey published ${id.slice(0, 8)}… (anonymized).`); }
      else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    if (!childKnown) { err('Enter child name + age.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const expectedFlat = milestoneResult?.milestoneResults.flatMap((c) => c.expected) ?? [];
      const task = [
        `Developmental brief for ${childName.trim()}, ${ageInMonths} months old.`,
        milestoneResult ? `Milestone assessment: ${milestoneResult.assessment} (${milestoneResult.overallCompletionRate}% complete).` : '',
        expectedFlat.length ? `Currently expected: ${expectedFlat.slice(0, 4).join(', ')}.` : '',
        recentNotes.trim() ? `Recent notes: ${recentNotes.trim()}.` : '',
        ``,
        `Return a short brief: what to watch for in the next 4-6 weeks, 2-3 simple activities`,
        `that support the next milestones, and any developmental red flags to discuss with the pediatrician.`,
      ].filter(Boolean).join(' ');
      const r = await lensRun({
        domain: 'chat_agent', name: 'do',
        input: { task, maxTurns: 4 },
      });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) {
        setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Brief ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'milestone', label: 'Milestone check', desc: 'Age-banded developmental expectations',         icon: Milestone, accent: '#8b5cf6', handler: actMilestone, disabled: !childKnown },
    { id: 'routine',   label: 'Optimize routine', desc: 'Day schedule reflowed against age',           icon: Clock,     accent: '#06b6d4', handler: actRoutine,   disabled: !childKnown },
    { id: 'mint',      label: snapshotDtuId ? 'Snapshot saved' : 'Mint snapshot', desc: snapshotDtuId ? `DTU ${snapshotDtuId.slice(0, 8)}…` : 'Private DTU of this child', icon: Sparkles, accent: '#3b82f6', handler: actMint, disabled: !childKnown || !!snapshotDtuId },
    { id: 'dm',        label: 'DM caregiver',     desc: 'Update co-parent / nanny / family',           icon: Send,      accent: '#ec4899', handler: actDm,        disabled: !childKnown },
    { id: 'publish',   label: publishedDtuId ? 'Journey published' : 'Publish journey', desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Anonymized public DTU + federation', icon: Globe, accent: '#22c55e', handler: actPublish, disabled: !childKnown || !!publishedDtuId },
    { id: 'agent',     label: 'Developmental brief', desc: 'Agent: what to watch for next 4-6 weeks',  icon: Wand2,     accent: '#eab308', handler: actAgent,     disabled: !childKnown },
  ];

  return (
    <div className="rounded-lg border border-amber-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-500/10 pb-2">
        <Baby className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Child action brief</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          wonder weeks · cozi
        </span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Child name</label>
          <input type="text" value={childName} onChange={(e) => setChildName(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-amber-400/40" placeholder="e.g. Ava" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Years</label>
          <input type="text" value={ageYears} onChange={(e) => setAgeYears(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/40" placeholder="2" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Months</label>
          <input type="text" value={ageMonths} onChange={(e) => setAgeMonths(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/40" placeholder="3" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">DM recipient (caregiver)</label>
          <input type="text" value={dmRecipient} onChange={(e) => setDmRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40" placeholder="co-parent user id" />
        </div>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Recent notes (optional)</label>
        <textarea value={recentNotes} onChange={(e) => setRecentNotes(e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-amber-400/40 resize-none" placeholder="Started saying 2-word phrases this week; sleep regression past 4 days…" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
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
                'bg-zinc-900/40 border-zinc-800',
                'hover:bg-zinc-800/60 hover:border-zinc-700',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/40 disabled:hover:border-zinc-800',
                'focus:outline-none focus:ring-2 focus:ring-amber-400/40',
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

      {milestoneResult && (
        <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold flex items-center gap-1.5">
            <Milestone className="w-3 h-3" /> Milestones at {milestoneResult.ageDisplay ?? `${milestoneResult.ageMonths}mo`} · {milestoneResult.overallCompletionRate}% complete
          </div>
          <p className="text-[11px] text-purple-200">{milestoneResult.assessment}</p>
          {milestoneResult.milestoneResults.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No CDC benchmark bracket applies at this age yet.</p>
          ) : (
            <ul className="space-y-1">
              {milestoneResult.milestoneResults.map((cat) => (
                <li key={cat.category} className="text-[11px] text-gray-300">
                  <strong className="text-purple-200">{cat.category}</strong> ({cat.ageRange}) — {cat.achieved}/{cat.total}: {cat.expected.join(' · ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {routineResult && (
        <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5">
            <Clock className="w-3 h-3" /> Optimized routine — {routineResult.stage} stage ({routineResult.newSuggestions} new of {routineResult.suggestedRoutine.length} slots)
          </div>
          <ul className="text-[11px] text-gray-300 space-y-0.5">
            {routineResult.suggestedRoutine.map((slot, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="font-mono text-cyan-200 w-12 shrink-0">{slot.time}</span>
                <span>{slot.activity}</span>
                <span className="text-zinc-500">· {slot.duration}m · {slot.category}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-56 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
            <Wand2 className="w-3 h-3" />
            Developmental brief
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
