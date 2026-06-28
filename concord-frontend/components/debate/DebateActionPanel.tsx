'use client';

/**
 * DebateActionPanel — Kialo / CMV / Reddit-shape action bar for the
 * debate lens. Operates on the currently-selected debate (passed via
 * props) and exposes 6 paid-app-tier actions wiring real Concord
 * backends, including all 4 debate-specific macros that previously
 * had no UI surface.
 *
 *   1. Fallacy check    → runs debate.fallacyCheck on a selected
 *                          argument; renders the flagged fallacies +
 *                          confidence score inline
 *   2. Steelman         → runs debate.steelmanPosition on a side
 *                          (pro/con); renders the strengthened version
 *   3. Score debate     → runs debate.scoreDebate; renders pro/con
 *                          totals + the winner + reasoning
 *   4. Branch argument  → dtu.create with lineage to a selected
 *                          argument; counter-argument tree node
 *   5. Mint snapshot    → dtu.create private full-debate state DTU
 *   6. Publish for review → dtu.create public + flag published
 *                          (federation; community moderation)
 */

import { useState, useMemo } from 'react';
import {
  Scale, AlertTriangle, Sparkles, Trophy, GitBranch, Globe, Wand2,
  Loader2, Check, ChevronDown, ChevronUp,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api/client';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface ArgumentLike { author?: string; text: string; votes?: number }
interface DebateLike {
  id: string;
  title: string;
  data: {
    topic?: string;
    description?: string;
    status?: string;
    format?: string;
    proArguments?: ArgumentLike[];
    conArguments?: ArgumentLike[];
    proVotes?: number;
    conVotes?: number;
  };
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'fallacy' | 'steelman' | 'score' | 'branch' | 'snapshot' | 'publish';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

// Field names align EXACTLY to the debate-domain handler return contracts
// (server/domains/debate.js). fallacyCheck → {fallaciesDetected[],count,
// logicalSoundness,textLength}; steelmanPosition → {steelmanSteps[],framework,
// originalLength,side}; scoreDebate → {sides[],winner,margin,close}.
interface FallacyResult { fallaciesDetected?: Array<{ fallacy: string; description?: string }>; count?: number; logicalSoundness?: string; textLength?: number; message?: string }
interface SteelmanResult { side?: string; steelmanSteps?: string[]; originalLength?: number; framework?: Record<string, string>; note?: string; message?: string }
interface ScoreSide { side: string; arguments: number; evidencePoints: number; rebuttals: number; score: number; votes?: number; highlights?: string[] }
interface ScoreResult { sides?: ScoreSide[]; winner?: string; margin?: number; close?: boolean; message?: string }

export function DebateActionPanel({ debate }: { debate: DebateLike }) {
  const d = debate.data;
  const runDebate = useRunArtifact('debate');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const allArgs = useMemo(() => [
    ...(d.proArguments ?? []).map((a, i) => ({ side: 'pro' as const, idx: i, ...a })),
    ...(d.conArguments ?? []).map((a, i) => ({ side: 'con' as const, idx: i, ...a })),
  ], [d.proArguments, d.conArguments]);

  const [argChoice, setArgChoice] = useState<string>('');
  const [steelmanSide, setSteelmanSide] = useState<'pro' | 'con'>('pro');
  const [expanded, setExpanded] = useState<ActionId | null>(null);

  const [fallacyResult, setFallacyResult] = useState<FallacyResult | null>(null);
  const [steelmanResult, setSteelmanResult] = useState<SteelmanResult | null>(null);
  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null);
  const [branchDtuId, setBranchDtuId] = useState<string | null>(null);
  const [snapshotDtuId, setSnapshotDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  const pipe = usePipe();
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  function selectedArg(): { side: 'pro' | 'con'; idx: number; text: string; author?: string } | null {
    if (!argChoice) return allArgs[0] ?? null;
    const [side, idxStr] = argChoice.split(':');
    const idx = parseInt(idxStr, 10);
    const a = (side === 'pro' ? d.proArguments : d.conArguments)?.[idx];
    if (!a) return null;
    return { side: side as 'pro' | 'con', idx, text: a.text, author: a.author };
  }

  async function actFallacy() {
    const arg = selectedArg();
    if (!arg) { err('Pick an argument first.'); return; }
    setBusy('fallacy'); setFeedback(null); setExpanded('fallacy');
    try {
      // Run the fallacyCheck macro with the selected argument as the artifact data
      const r = await runDebate.mutateAsync({
        id: debate.id,
        action: 'fallacyCheck',
        params: { text: arg.text },
      });
      const result = (r?.result ?? {}) as FallacyResult;
      setFallacyResult(result);
      const cnt = result.count ?? result.fallaciesDetected?.length ?? 0;
      ok(cnt === 0 ? 'No fallacies flagged.' : `${cnt} fallac${cnt === 1 ? 'y' : 'ies'} flagged.`);
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actSteelman() {
    const sideArgs = steelmanSide === 'pro' ? d.proArguments : d.conArguments;
    if (!sideArgs?.length) { err(`No ${steelmanSide} arguments to steelman.`); return; }
    setBusy('steelman'); setFeedback(null); setExpanded('steelman');
    try {
      const r = await runDebate.mutateAsync({
        id: debate.id,
        action: 'steelmanPosition',
        params: { side: steelmanSide, arguments: sideArgs.map(a => a.text) },
      });
      const result = (r?.result ?? {}) as SteelmanResult;
      setSteelmanResult(result);
      ok(`${steelmanSide} side steelmanned.`);
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actScore() {
    setBusy('score'); setFeedback(null); setExpanded('score');
    try {
      const r = await runDebate.mutateAsync({ id: debate.id, action: 'scoreDebate', params: {} });
      const result = (r?.result ?? {}) as ScoreResult;
      setScoreResult(result);
      ok(result.winner ? `Winner: ${result.winner}.` : 'Debate scored.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actBranch() {
    const arg = selectedArg();
    if (!arg) { err('Pick an argument to branch from.'); return; }
    setBusy('branch'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Counter-argument — ${d.topic ?? debate.title} (${arg.side} #${arg.idx + 1})`,
          tags: ['debate', 'counter-argument', `side:${arg.side === 'pro' ? 'con' : 'pro'}`, `debate:${debate.id}`],
          source: 'debate:branch',
          lineage: [],  // parent argument lives inside the debate artifact; we anchor via meta
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            counterArgument: {
              debateId: debate.id,
              parentSide: arg.side,
              parentIdx: arg.idx,
              parentText: arg.text,
              parentAuthor: arg.author,
              counterSide: arg.side === 'pro' ? 'con' : 'pro',
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setBranchDtuId(id); ok(`Counter-argument DTU ${id.slice(0, 8)}… — open dtu.update to add your text.`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actSnapshot() {
    setBusy('snapshot'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Debate snapshot — ${d.topic ?? debate.title}`,
          tags: ['debate', 'snapshot', d.format ?? 'open'],
          source: 'debate:snapshot',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            debate: {
              id: debate.id,
              topic: d.topic,
              description: d.description,
              status: d.status,
              format: d.format,
              proArguments: d.proArguments,
              conArguments: d.conArguments,
              proVotes: d.proVotes,
              conVotes: d.conVotes,
              capturedAt: new Date().toISOString(),
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setSnapshotDtuId(id); ok(`Snapshot DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', {
          domain: 'dtu', name: 'create',
          input: {
            title: `Debate for community review: ${d.topic ?? debate.title}`,
            tags: ['debate', 'public', 'community-review', d.format ?? 'open'],
            source: 'debate:publish',
            meta: {
              visibility: 'public',
              consent: { allowCitations: true },
              debate: {
                id: debate.id, topic: d.topic, description: d.description, format: d.format,
                proArguments: d.proArguments, conArguments: d.conArguments,
                proVotes: d.proVotes, conVotes: d.conVotes,
              },
            },
          },
        });
        const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('debate.publishedDtuId', id, { label: `Public debate ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… for review · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean; toggleExpand?: boolean }> = [
    { id: 'fallacy',  label: 'Fallacy check', desc: 'Scan an argument for logical fallacies',                   icon: AlertTriangle, accent: '#ef4444', handler: actFallacy,  disabled: allArgs.length === 0,        toggleExpand: true },
    { id: 'steelman', label: 'Steelman',      desc: 'Rebuild a side in its strongest form',                    icon: Sparkles,      accent: '#06b6d4', handler: actSteelman, disabled: allArgs.length === 0,        toggleExpand: true },
    { id: 'score',    label: 'Score debate',  desc: 'Tally + reasoning + likely winner',                       icon: Trophy,        accent: '#eab308', handler: actScore,    disabled: allArgs.length === 0,        toggleExpand: true },
    { id: 'branch',   label: 'Branch',        desc: 'Mint counter-argument DTU lineaging to selected',         icon: GitBranch,     accent: '#8b5cf6', handler: actBranch,   disabled: allArgs.length === 0 },
    { id: 'snapshot', label: 'Snapshot',      desc: 'Save full debate state as private DTU',                   icon: Wand2,         accent: '#3b82f6', handler: actSnapshot, disabled: !!snapshotDtuId },
    { id: 'publish',  label: 'Publish review', desc: 'Public DTU + flag published for community moderation',   icon: Globe,         accent: '#22c55e', handler: actPublish,  disabled: !!publishedDtuId },
  ];

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center gap-2 border-b border-white/10 pb-2">
        <Scale className="w-4 h-4 text-neon-cyan" />
        <h3 className="text-sm font-semibold text-white">Debate actions</h3>
        <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gray-400">
          kialo · CMV
        </span>
      </div>

      {/* Argument selector + steelman side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1 block">Argument (for fallacy / branch)</label>
          <select
            value={argChoice}
            onChange={(e) => setArgChoice(e.target.value)}
            className="w-full bg-lattice-elevated border border-white/10 rounded px-2 py-1.5 text-xs text-white"
            disabled={allArgs.length === 0}
          >
            {allArgs.length === 0 && <option value="">— no arguments yet —</option>}
            {allArgs.map(a => (
              <option key={`${a.side}:${a.idx}`} value={`${a.side}:${a.idx}`}>
                {a.side.toUpperCase()} #{a.idx + 1} — {a.text.slice(0, 60)}{a.text.length > 60 ? '…' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1 block">Side (for steelman)</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSteelmanSide('pro')} className={cn('px-3 py-1.5 rounded text-xs', steelmanSide === 'pro' ? 'bg-neon-green/20 text-neon-green' : 'bg-lattice-elevated text-gray-400')}>Pro</button>
            <button type="button" onClick={() => setSteelmanSide('con')} className={cn('px-3 py-1.5 rounded text-xs', steelmanSide === 'con' ? 'bg-red-400/20 text-red-400' : 'bg-lattice-elevated text-gray-400')}>Con</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          const isExpanded = expanded === a.id;
          return (
            <button
              key={a.id}
              type="button"
              disabled={a.disabled || !!busy}
              onClick={() => { if (a.toggleExpand && isExpanded) { setExpanded(null); return; } a.handler(); }}
              className={cn(
                'group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all',
                'bg-lattice-elevated/40 border-white/10',
                'hover:bg-lattice-elevated hover:border-white/20',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-lattice-elevated/40 disabled:hover:border-white/10',
                isExpanded && 'border-white/30 bg-lattice-elevated',
              )}
            >
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[12px] font-semibold text-gray-100 leading-tight flex items-center gap-1">
                {a.label}
                {a.toggleExpand && (isExpanded ? <ChevronUp className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />)}
              </div>
              <div className="text-[10px] text-gray-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Expanded result panes */}
      {expanded === 'fallacy' && fallacyResult && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/5 p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> Fallacy check
          </div>
          {(fallacyResult.count ?? fallacyResult.fallaciesDetected?.length ?? 0) === 0 ? (
            <p className="text-xs text-emerald-300 flex items-center gap-1.5"><Check className="w-3 h-3" /> No fallacies flagged.</p>
          ) : (
            <>
              <ul className="text-xs text-gray-200 space-y-1">
                {fallacyResult.fallaciesDetected?.map((f, i) => (
                  <li key={i}>
                    <span className="font-semibold text-red-300">{f.fallacy}</span>
                    {f.description && <span className="text-gray-400"> — {f.description}</span>}
                  </li>
                ))}
              </ul>
              {fallacyResult.logicalSoundness && (
                <div className="text-[10px] text-gray-400">Soundness: {fallacyResult.logicalSoundness.replace(/-/g, ' ')}</div>
              )}
            </>
          )}
        </div>
      )}

      {expanded === 'steelman' && steelmanResult && (
        <div className="rounded-lg border border-cyan-400/30 bg-cyan-400/5 p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" /> Steelman ({steelmanResult.side ?? steelmanSide})
            {steelmanResult.originalLength != null && (
              <span className="text-gray-500 normal-case font-normal">· {steelmanResult.originalLength} words</span>
            )}
          </div>
          {Array.isArray(steelmanResult.steelmanSteps) && steelmanResult.steelmanSteps.length > 0 && (
            <ul className="space-y-1">
              {steelmanResult.steelmanSteps.map((step, i) => (
                <li key={i} className="text-xs text-gray-200 flex items-start gap-1.5">
                  <span className="text-cyan-300 shrink-0">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          )}
          {steelmanResult.framework && (
            <div className="rounded border border-cyan-500/20 bg-cyan-500/5 p-2 space-y-0.5">
              {Object.entries(steelmanResult.framework).map(([k, v]) => (
                <p key={k} className="text-[10px] text-gray-300"><span className="text-cyan-300 capitalize">{k}: </span>{v}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {expanded === 'score' && scoreResult && (
        <div className="rounded-lg border border-yellow-400/30 bg-yellow-400/5 p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-yellow-300 font-semibold flex items-center gap-1.5">
            <Trophy className="w-3 h-3" /> Debate score
          </div>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            {scoreResult.winner && <span className="rounded bg-yellow-400/20 px-2 py-0.5 text-yellow-300 font-semibold">Winner: {scoreResult.winner}</span>}
            {scoreResult.margin != null && <span className="text-gray-400">Margin: <strong className="text-gray-200">{scoreResult.margin}</strong></span>}
            {scoreResult.close != null && (
              <span className={cn('rounded px-2 py-0.5', scoreResult.close ? 'bg-yellow-400/10 text-yellow-300' : 'bg-emerald-500/10 text-emerald-300')}>
                {scoreResult.close ? 'Close' : 'Clear'}
              </span>
            )}
          </div>
          {Array.isArray(scoreResult.sides) && scoreResult.sides.length > 0 && (
            <div className="space-y-1.5">
              {scoreResult.sides.map((s, i) => (
                <div key={i} className={cn('rounded border p-2', i === 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/10 bg-white/[0.02]')}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-200">{s.side}</span>
                    <span className={cn('text-xs font-bold', i === 0 ? 'text-emerald-300' : 'text-gray-400')}>{s.score} pts</span>
                  </div>
                  <div className="flex gap-3 text-[10px] text-gray-400 mt-0.5">
                    <span>{s.arguments} args</span>
                    <span>{s.evidencePoints} evidence</span>
                    <span>{s.rebuttals} rebuttals</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Standalone status pills */}
      <div className="flex flex-wrap gap-1.5">
        {branchDtuId && (
          <span className="rounded bg-purple-500/20 text-purple-300 px-2 py-0.5 text-[10px] font-mono">branch {branchDtuId.slice(0, 8)}</span>
        )}
        {snapshotDtuId && (
          <span className="rounded bg-blue-500/20 text-blue-300 px-2 py-0.5 text-[10px] font-mono">snapshot {snapshotDtuId.slice(0, 8)}</span>
        )}
        {publishedDtuId && (
          <span className="rounded bg-emerald-500/20 text-emerald-300 px-2 py-0.5 text-[10px] font-mono">published {publishedDtuId.slice(0, 8)}</span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={publishRecall} />
      </div>

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
