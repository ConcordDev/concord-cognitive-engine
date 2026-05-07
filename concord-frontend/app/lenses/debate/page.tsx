'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Scale, Plus, Search, Users, MessageSquare,
  ThumbsUp, ThumbsDown, Layers, ChevronDown, Zap, Send, Timer, Trophy, TrendingUp, Loader2, Trash2,
  AlertTriangle, CheckCircle, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

interface DebateData {
  topic: string;
  description: string;
  status: 'open' | 'in-progress' | 'voting' | 'closed';
  format: 'open' | 'structured' | 'oxford' | 'lincoln-douglas';
  proArguments: { author: string; text: string; votes: number }[];
  conArguments: { author: string; text: string; votes: number }[];
  proVotes: number;
  conVotes: number;
  moderator: string;
  timeLimit: number;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  open: 'text-neon-green bg-neon-green/10',
  'in-progress': 'text-neon-cyan bg-neon-cyan/10',
  voting: 'text-yellow-400 bg-yellow-400/10',
  closed: 'text-gray-400 bg-gray-400/10',
};

/* ------------------------------------------------------------------ */
/*  Argument Strength Meter                                            */
/* ------------------------------------------------------------------ */

function ArgumentStrengthMeter({ text }: { text: string }) {
  const strength = useMemo(() => {
    if (!text) return 0;
    let score = 0;
    if (text.length > 20) score += 20;
    if (text.length > 60) score += 20;
    if (/because|therefore|since|thus|hence|evidence|data|study|research|shows?/i.test(text)) score += 25;
    if (/however|although|moreover|furthermore|consequently/i.test(text)) score += 15;
    if (/\d+%|\d+ (million|billion|thousand)|\d{4}/i.test(text)) score += 20;
    return Math.min(100, score);
  }, [text]);

  const label = strength >= 80 ? 'Strong' : strength >= 50 ? 'Moderate' : strength >= 25 ? 'Weak' : 'Insufficient';
  const color = strength >= 80 ? '#22c55e' : strength >= 50 ? '#eab308' : strength >= 25 ? '#f97316' : '#6b7280';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Argument Strength</span>
        <span className="font-semibold" style={{ color }}>{label} ({strength}%)</span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <motion.div className="h-full rounded-full" style={{ backgroundColor: color }}
          initial={{ width: 0 }} animate={{ width: `${strength}%` }} transition={{ duration: 0.4 }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pro / Con Balance Scale                                            */
/* ------------------------------------------------------------------ */

function ProConScale({ proCount, conCount, proVotes, conVotes }:
  { proCount: number; conCount: number; proVotes: number; conVotes: number }) {
  const totalArgs = proCount + conCount;
  const totalVotes = proVotes + conVotes;
  const proPct = totalArgs > 0 ? (proCount / totalArgs) * 100 : 50;
  const proVotePct = totalVotes > 0 ? (proVotes / totalVotes) * 100 : 50;

  return (
    <div className="panel p-4 space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <Scale className="w-4 h-4 text-neon-purple" /> Balance
      </h3>
      {/* Arguments bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-500">
          <span className="text-neon-green">Pro ({proCount})</span>
          <span>Arguments</span>
          <span className="text-red-400">Con ({conCount})</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden flex">
          <motion.div className="h-full bg-neon-green/70"
            initial={{ width: 0 }} animate={{ width: `${proPct}%` }} transition={{ duration: 0.5 }} />
          <motion.div className="h-full bg-red-400/70 flex-1"
            initial={{ width: 0 }} animate={{ width: `${100 - proPct}%` }} transition={{ duration: 0.5 }} />
        </div>
      </div>
      {/* Votes bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-500">
          <span className="text-neon-green">{proVotes} votes</span>
          <span>Community</span>
          <span className="text-red-400">{conVotes} votes</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden flex">
          <motion.div className="h-full bg-neon-green/40"
            initial={{ width: 0 }} animate={{ width: `${proVotePct}%` }} transition={{ duration: 0.5 }} />
          <motion.div className="h-full bg-red-400/40 flex-1" />
        </div>
      </div>
      {/* Verdict */}
      {totalArgs > 0 && (
        <div className={cn('text-xs px-3 py-2 rounded-lg text-center font-semibold',
          proPct > 60 ? 'bg-neon-green/10 text-neon-green border border-neon-green/20' :
          proPct < 40 ? 'bg-red-400/10 text-red-400 border border-red-400/20' :
          'bg-yellow-400/10 text-yellow-400 border border-yellow-400/20')}>
          {proPct > 60 ? '✓ Pro side leads' : proPct < 40 ? '✗ Con side leads' : '⚖ Evenly matched'}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Debate Phase & Turn Types                                          */
/* ------------------------------------------------------------------ */

type DebatePhase = 'setup' | 'opening' | 'rebuttal' | 'closing' | 'voting' | 'finished';
type DebateSide = 'pro' | 'con';

const PHASE_CONFIG: Record<DebatePhase, { label: string; description: string; allowSubmit: boolean; hasTurns: boolean }> = {
  setup:    { label: 'Setup',    description: 'Configure debate rules and timer',   allowSubmit: false, hasTurns: false },
  opening:  { label: 'Opening',  description: 'Opening statements from each side',  allowSubmit: true,  hasTurns: true },
  rebuttal: { label: 'Rebuttal', description: 'Rebuttals to opposing arguments',    allowSubmit: true,  hasTurns: true },
  closing:  { label: 'Closing',  description: 'Closing statements from each side',  allowSubmit: true,  hasTurns: true },
  voting:   { label: 'Voting',   description: 'Community votes on the winner',      allowSubmit: false, hasTurns: false },
  finished: { label: 'Finished', description: 'Debate concluded',                   allowSubmit: false, hasTurns: false },
};

const PHASE_ORDER: DebatePhase[] = ['setup', 'opening', 'rebuttal', 'closing', 'voting', 'finished'];

function getNextPhase(current: DebatePhase): DebatePhase {
  const idx = PHASE_ORDER.indexOf(current);
  return idx < PHASE_ORDER.length - 1 ? PHASE_ORDER[idx + 1] : 'finished';
}

/* ------------------------------------------------------------------ */
/*  Current Speaker Indicator                                          */
/* ------------------------------------------------------------------ */

function CurrentSpeakerBanner({ phase, currentTurn, onSkipTurn }: { phase: DebatePhase; currentTurn: DebateSide; onSkipTurn: () => void }) {
  const config = PHASE_CONFIG[phase];
  if (!config.hasTurns) return null;

  const isPro = currentTurn === 'pro';
  return (
    <div className={cn(
      'rounded-lg px-4 py-3 flex items-center justify-between border',
      isPro ? 'bg-neon-green/10 border-neon-green/30' : 'bg-red-400/10 border-red-400/30'
    )}>
      <div className="flex items-center gap-3">
        <div className={cn('w-3 h-3 rounded-full animate-pulse', isPro ? 'bg-neon-green' : 'bg-red-400')} />
        <div>
          <p className={cn('text-sm font-bold', isPro ? 'text-neon-green' : 'text-red-400')}>
            {isPro ? 'PRO' : 'CON'} side speaking
          </p>
          <p className="text-xs text-gray-400">{config.label} phase — {isPro ? 'Pro' : 'Con'} has the floor</p>
        </div>
      </div>
      <button onClick={onSkipTurn}
        className="px-3 py-1 rounded text-xs bg-white/5 border border-white/10 hover:bg-white/10 text-gray-300">
        Skip Turn
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Phase Progress Bar                                                 */
/* ------------------------------------------------------------------ */

function PhaseProgressBar({ phase, onPhaseSelect }: { phase: DebatePhase; onPhaseSelect: (p: DebatePhase) => void }) {
  const currentIdx = PHASE_ORDER.indexOf(phase);
  return (
    <div className="flex items-center gap-1 w-full">
      {PHASE_ORDER.map((p, i) => {
        const isCurrent = p === phase;
        const isPast = i < currentIdx;
        return (
          <button key={p} onClick={() => onPhaseSelect(p)}
            className={cn(
              'flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider rounded transition-all text-center',
              isCurrent ? 'bg-neon-purple/30 text-neon-purple border border-neon-purple/40' :
              isPast ? 'bg-white/5 text-gray-500 border border-white/5' :
              'bg-white/[0.02] text-gray-600 border border-white/5'
            )}>
            {PHASE_CONFIG[p].label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Debate Round Timer                                                 */
/* ------------------------------------------------------------------ */

function DebateRoundTimer({ onTimeUp, turnKey, autoStart, phase, currentTurn }: {
  onTimeUp?: () => void;
  /** Changes whenever a new turn begins — triggers auto-reset + auto-start */
  turnKey?: number;
  autoStart?: boolean;
  phase?: DebatePhase;
  currentTurn?: DebateSide;
}) {
  const [minutes, setMinutes] = useState(3);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(3 * 60);
  const [round, setRound] = useState(1);
  const [finished, setFinished] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;
  const prevTurnKeyRef = useRef(turnKey);

  useEffect(() => { if (!running) setRemaining(minutes * 60); }, [minutes, running]);

  // Auto-reset & auto-start when turnKey changes (turn/phase advanced)
  useEffect(() => {
    if (turnKey !== undefined && turnKey !== prevTurnKeyRef.current) {
      prevTurnKeyRef.current = turnKey;
      setFinished(false);
      setRemaining(minutes * 60);
      setRound(r => r + 1);
      if (autoStart) {
        setRunning(true);
      } else {
        setRunning(false);
      }
    }
  }, [turnKey, autoStart, minutes]);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setRemaining(r => {
          if (r <= 1) {
            setRunning(false);
            setFinished(true);
            onTimeUpRef.current?.();
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]);

  const reset = () => { setRunning(false); setFinished(false); setRemaining(minutes * 60); };
  const nextRound = () => { setRound(r => r + 1); reset(); };
  const total = minutes * 60;
  const pct = total > 0 ? (remaining / total) * 100 : 0;
  const mm = Math.floor(remaining / 60).toString().padStart(2, '0');
  const ss = (remaining % 60).toString().padStart(2, '0');
  const circumference = 2 * Math.PI * 28;
  const dash = (pct / 100) * circumference;
  const urgentColor = remaining <= 30 ? '#ef4444' : running ? '#a855f7' : '#6b7280';

  const isActive = phase && phase !== 'setup' && phase !== 'finished';
  const turnLabel = phase && currentTurn
    ? `${PHASE_CONFIG[phase].label} — ${currentTurn === 'pro' ? 'Pro' : 'Con'}`
    : `Round ${round}`;

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Timer className="w-4 h-4 text-neon-purple" /> Round Timer
        </h3>
        <span className={cn('text-xs', isActive ? 'text-neon-cyan font-medium' : 'text-gray-500')}>{turnLabel}</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative w-16 h-16 shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
            <circle cx="32" cy="32" r="28" fill="none"
              stroke={urgentColor} strokeWidth="5" strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              style={{ transition: 'stroke-dasharray 0.5s linear' }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={cn('text-xs font-mono font-bold', remaining <= 30 && running ? 'text-red-400 animate-pulse' : 'text-white')}>
              {mm}:{ss}
            </span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          {!running && !finished && (
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={15} value={minutes}
                onChange={e => setMinutes(Math.max(1, Number(e.target.value)))}
                className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-center" />
              <span className="text-xs text-gray-400">minutes</span>
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => finished ? reset() : setRunning(r => !r)}
              className={cn('px-3 py-1 rounded text-xs font-medium transition-colors',
                running ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                        : 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30')}>
              {finished ? 'Reset' : running ? 'Pause' : 'Start'}
            </button>
            {finished && (
              <button onClick={nextRound}
                className="px-3 py-1 rounded text-xs bg-neon-green/20 text-neon-green border border-neon-green/30">
                Next Round
              </button>
            )}
            {running && (
              <button onClick={reset} className="px-3 py-1 rounded text-xs bg-white/5 border border-white/10 hover:bg-white/10">
                Reset
              </button>
            )}
          </div>
          {finished && <p className="text-xs text-yellow-400 animate-bounce">Time's up! {turnLabel} complete.</p>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Verdict Scoring Display                                            */
/* ------------------------------------------------------------------ */

function VerdictDisplay({ proArguments, conArguments, proVotes, conVotes }:
  { proArguments: {votes:number}[]; conArguments: {votes:number}[]; proVotes:number; conVotes:number }) {
  const proScore = (proArguments?.length || 0) * 10 + proVotes * 2;
  const conScore = (conArguments?.length || 0) * 10 + conVotes * 2;
  const total = proScore + conScore;
  const winner = proScore > conScore ? 'Pro' : conScore > proScore ? 'Con' : 'Tie';
  const winnerColor = winner === 'Pro' ? 'text-neon-green' : winner === 'Con' ? 'text-red-400' : 'text-yellow-400';
  const proWidth = total > 0 ? (proScore / total) * 100 : 50;

  return (
    <div className="panel p-4 space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <Trophy className="w-4 h-4 text-yellow-400" /> Scoring
      </h3>
      <div className="grid grid-cols-3 items-center gap-2 text-center">
        <div>
          <p className="text-2xl font-bold text-neon-green">{proScore}</p>
          <p className="text-xs text-gray-500">Pro Score</p>
        </div>
        <div>
          <p className={cn('text-sm font-bold', winnerColor)}>{winner}</p>
          <p className="text-xs text-gray-600">leads</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-red-400">{conScore}</p>
          <p className="text-xs text-gray-500">Con Score</p>
        </div>
      </div>
      <div className="h-2 rounded-full overflow-hidden flex">
        <div className="h-full bg-neon-green/60 transition-all duration-500" style={{ width: `${proWidth}%` }} />
        <div className="h-full bg-red-400/60 flex-1" />
      </div>
      <p className="text-xs text-gray-600 text-center">Score = (args × 10) + (votes × 2)</p>
    </div>
  );
}

export default function DebateLensPage() {
  useLensNav('debate');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('debate');
  const [search, setSearch] = useState('');
  const [selectedDebate, setSelectedDebate] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);
  const [showDebateTools, setShowDebateTools] = useState(false);
  const [newDebate, setNewDebate] = useState<{ topic: string; description: string; format: DebateData['format']; timeLimit: number }>({ topic: '', description: '', format: 'open', timeLimit: 30 });
  const [newArgument, setNewArgument] = useState('');
  const [argumentSide, setArgumentSide] = useState<'pro' | 'con'>('pro');

  // --- Debate phase & turn management ---
  const [debatePhase, setDebatePhase] = useState<DebatePhase>('setup');
  const [currentTurn, setCurrentTurn] = useState<DebateSide>('pro');
  const [turnCount, setTurnCount] = useState(0);

  const phaseConfig = PHASE_CONFIG[debatePhase];

  const advanceTurn = useCallback(() => {
    const config = PHASE_CONFIG[debatePhase];
    if (config.hasTurns) {
      // Each phase has 2 turns (pro then con). After both, advance phase.
      if (currentTurn === 'pro') {
        setCurrentTurn('con');
        setArgumentSide('con');
        setTurnCount(c => c + 1);
      } else {
        // Both sides spoke — advance to next phase
        const next = getNextPhase(debatePhase);
        setCurrentTurn('pro');
        setArgumentSide('pro');
        setTurnCount(c => c + 1);
        setDebatePhase(next);
      }
    } else {
      // Non-turn phases auto-advance on timer
      setTurnCount(c => c + 1);
      setDebatePhase(getNextPhase(debatePhase));
    }
  }, [debatePhase, currentTurn]);

  const handleTimerExpired = useCallback(() => {
    if (debatePhase !== 'setup' && debatePhase !== 'finished') {
      advanceTurn();
    }
  }, [debatePhase, advanceTurn]);

  const handleSelectDebate = useCallback((id: string) => {
    setSelectedDebate(id);
    // Reset state machine for the newly selected debate
    setDebatePhase('setup');
    setCurrentTurn('pro');
    setArgumentSide('pro');
    setTurnCount(0);
  }, []);

  const canSubmitArgument = phaseConfig.allowSubmit && (!phaseConfig.hasTurns || argumentSide === currentTurn);

  // Wire to social groups API for community features
  const { data: trendingTopics } = useQuery({
    queryKey: ['social-trending-topics'],
    queryFn: async () => {
      const { data } = await api.get('/api/social/topics/trending');
      return data;
    },
    staleTime: 60000,
    retry: 1,
  });

  const {
    items, isLoading, isError, error, refetch,
    create, createMut, update, remove, deleteMut,
  } = useLensData<DebateData>('debate', 'debate', { seed: [] });

  // --- Domain action state ---
  const runAction = useRunArtifact('debate');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const handleDebateAction = useCallback(async (action: string) => {
    const targetId = items[0]?.id;
    if (!targetId) return;
    setActiveAction(action);
    setActionResult(null);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setActiveAction(null);
  }, [items, runAction]);

  const debates = useMemo(() =>
    items.map(item => ({ id: item.id, ...item.data, topic: item.title || item.data?.topic || 'Untitled Debate' }))
      .filter(d => !search || d.topic?.toLowerCase().includes(search.toLowerCase())),
    [items, search]
  );

  const selectedDebateData = useMemo(() => debates.find(d => d.id === selectedDebate), [debates, selectedDebate]);

  const stats = useMemo(() => ({
    total: debates.length,
    active: debates.filter(d => d.status === 'open' || d.status === 'in-progress').length,
    totalArguments: debates.reduce((s, d) => s + (d.proArguments?.length || 0) + (d.conArguments?.length || 0), 0),
    totalVotes: debates.reduce((s, d) => s + (d.proVotes || 0) + (d.conVotes || 0), 0),
  }), [debates]);

  const handleCreate = useCallback(async () => {
    if (!newDebate.topic.trim()) return;
    await create({
      title: newDebate.topic,
      data: {
        topic: newDebate.topic, description: newDebate.description,
        status: 'open', format: newDebate.format,
        proArguments: [], conArguments: [],
        proVotes: 0, conVotes: 0, moderator: '',
        timeLimit: newDebate.timeLimit, createdAt: new Date().toISOString(),
      },
    });
    setNewDebate({ topic: '', description: '', format: 'open', timeLimit: 30 });
    setShowCreate(false);
  }, [newDebate, create]);

  const handleAddArgument = useCallback(async () => {
    if (!newArgument.trim() || !selectedDebate || !selectedDebateData) return;
    const item = items.find(i => i.id === selectedDebate);
    if (!item) return;
    const newArg = { author: 'You', text: newArgument, votes: 0 };
    const updatedData = { ...item.data } as DebateData;
    if (argumentSide === 'pro') {
      updatedData.proArguments = [...(updatedData.proArguments || []), newArg];
    } else {
      updatedData.conArguments = [...(updatedData.conArguments || []), newArg];
    }
    await update(selectedDebate, { data: updatedData });
    setNewArgument('');
  }, [newArgument, selectedDebate, selectedDebateData, argumentSide, items, update]);

  if (isError) return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;

  return (
    <div data-lens-theme="debate" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Scale className="w-6 h-6 text-neon-purple" />
          <div>
            <h1 className="text-xl font-bold">Debate Lens</h1>
            <p className="text-sm text-gray-400">Structured debates & argumentation</p>
          </div>
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="debate" data={realtimeData || {}} compact />
        </div>
        <button onClick={() => setShowDebateTools(t => !t)}
          className={cn('btn-neon', showDebateTools && 'bg-purple-500/20 border-purple-500/40')}>
          <Timer className="w-4 h-4 mr-1 inline" /> Tools
        </button>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-neon purple">
          <Plus className="w-4 h-4 mr-2 inline" /> New Debate
        </button>
      </header>

      <UniversalActions domain="debate" artifactId={items[0]?.id} compact />

      {/* ── Domain Action Panel ─────────────────────────────────── */}
      <div className="panel p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-purple" /> AI Analysis Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          {(['evaluateArgument','steelmanPosition','scoreDebate','fallacyCheck'] as const).map(action => (
            <button
              key={action}
              onClick={() => handleDebateAction(action)}
              disabled={activeAction !== null || !items[0]?.id}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-neon-purple/10 border border-neon-purple/30 text-neon-purple hover:bg-neon-purple/20 disabled:opacity-50 transition-colors"
            >
              {activeAction === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              {action === 'evaluateArgument' ? 'Evaluate Argument' : action === 'steelmanPosition' ? 'Steelman Position' : action === 'scoreDebate' ? 'Score Debate' : 'Fallacy Check'}
            </button>
          ))}
        </div>

        {/* evaluateArgument result */}
        {actionResult && actionResult.overallScore !== undefined && (
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div className="grid grid-cols-4 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-lg font-bold ${Number(actionResult.overallScore) >= 70 ? 'text-neon-green' : Number(actionResult.overallScore) >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>{String(actionResult.overallScore)}</p>
                <p className="text-[10px] text-gray-500">Overall Score</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-lg font-bold text-neon-cyan">{String(actionResult.evidenceScore ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Evidence</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-lg font-bold text-neon-purple">{String(actionResult.reasoningScore ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Reasoning</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-xs font-bold uppercase ${actionResult.strength === 'strong' ? 'text-neon-green' : actionResult.strength === 'moderate' ? 'text-yellow-400' : 'text-red-400'}`}>{String(actionResult.strength ?? '—')}</p>
                <p className="text-[10px] text-gray-500">Strength</p>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Score</span>
                <span className="text-gray-400">{String(actionResult.overallScore ?? 0)}/100</span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-neon-purple rounded-full transition-all" style={{ width: `${actionResult.overallScore ?? 0}%` }} />
              </div>
            </div>
            {Array.isArray(actionResult.fallaciesDetected) && (actionResult.fallaciesDetected as string[]).length > 0 && (
              <div>
                <p className="text-xs text-yellow-400 mb-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Fallacies Detected</p>
                <div className="flex flex-wrap gap-1">
                  {(actionResult.fallaciesDetected as string[]).map((f, i) => (
                    <span key={i} className="px-2 py-0.5 text-[10px] rounded bg-yellow-400/10 text-yellow-400 border border-yellow-400/20">{f}</span>
                  ))}
                </div>
              </div>
            )}
            {actionResult.addressesCounterpoints !== undefined && (
              <p className="text-xs flex items-center gap-1">
                {actionResult.addressesCounterpoints ? <CheckCircle className="w-3 h-3 text-neon-green" /> : <XCircle className="w-3 h-3 text-gray-500" />}
                <span className="text-gray-400">{actionResult.addressesCounterpoints ? 'Addresses counterpoints' : 'No counterpoint addressed'}</span>
              </p>
            )}
          </div>
        )}

        {/* steelmanPosition result */}
        {actionResult && actionResult.steelmanSteps !== undefined && (
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-lg font-bold text-neon-cyan">{String((actionResult.originalPosition as string)?.split(/\s+/)?.length ?? Number(actionResult.originalLength) ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Original Words</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-lg font-bold text-neon-purple">{Array.isArray(actionResult.steelmanSteps) ? (actionResult.steelmanSteps as unknown[]).length : 0}</p>
                <p className="text-[10px] text-gray-500">Improvements</p>
              </div>
            </div>
            {Array.isArray(actionResult.steelmanSteps) && (
              <ul className="space-y-1">
                {(actionResult.steelmanSteps as string[]).map((step, i) => (
                  <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
                    <span className="text-neon-purple shrink-0 mt-0.5">{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            )}
            {!!actionResult.framework && (
              <div className="bg-neon-purple/5 border border-neon-purple/20 rounded p-3 space-y-1">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Framework</p>
                {Object.entries(actionResult.framework as Record<string, string>).map(([k, v]) => (
                  <p key={k} className="text-xs text-gray-300"><span className="text-neon-purple capitalize">{k}: </span>{v}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* scoreDebate result */}
        {actionResult && actionResult.winner !== undefined && actionResult.margin !== undefined && (
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-neon-green/5 border border-neon-green/20 rounded text-center">
                <p className="text-xs font-bold text-neon-green uppercase truncate">{String(actionResult.winner ?? '—')}</p>
                <p className="text-[10px] text-gray-500">Winner</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-lg font-bold text-yellow-400">{String(actionResult.margin ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Margin</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-xs font-bold ${actionResult.close ? 'text-yellow-400' : 'text-neon-green'}`}>{actionResult.close ? 'Close' : 'Clear'}</p>
                <p className="text-[10px] text-gray-500">Result</p>
              </div>
            </div>
            {Array.isArray(actionResult.sides) && (
              <div className="space-y-2">
                {(actionResult.sides as Array<{side:string;arguments:number;evidencePoints:number;rebuttals:number;score:number;highlights:string[]}>).map((s, i) => (
                  <div key={i} className={`p-2 rounded border ${i === 0 ? 'border-neon-green/30 bg-neon-green/5' : 'border-white/5 bg-white/[0.02]'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-200">{s.side}</span>
                      <span className={`text-sm font-bold ${i === 0 ? 'text-neon-green' : 'text-gray-400'}`}>{s.score} pts</span>
                    </div>
                    <div className="flex gap-3 text-[10px] text-gray-500 mt-1">
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

        {/* fallacyCheck result */}
        {actionResult && actionResult.logicalSoundness !== undefined && (
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-lg font-bold ${Number(actionResult.count) === 0 ? 'text-neon-green' : Number(actionResult.count) <= 2 ? 'text-yellow-400' : 'text-red-400'}`}>{String(actionResult.count ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Fallacies</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">{String(actionResult.textLength ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Chars</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-[10px] font-bold uppercase ${actionResult.logicalSoundness === 'appears-sound' ? 'text-neon-green' : actionResult.logicalSoundness === 'minor-issues' ? 'text-yellow-400' : 'text-red-400'}`}>
                  {String(actionResult.logicalSoundness).replace(/-/g, ' ')}
                </p>
                <p className="text-[10px] text-gray-500">Soundness</p>
              </div>
            </div>
            {Array.isArray(actionResult.fallaciesDetected) && (actionResult.fallaciesDetected as Array<{fallacy:string;description:string}>).length > 0 && (
              <div className="space-y-1">
                {(actionResult.fallaciesDetected as Array<{fallacy:string;description:string}>).map((f, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 bg-yellow-400/5 border border-yellow-400/20 rounded text-xs">
                    <AlertTriangle className="w-3 h-3 text-yellow-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-yellow-400 font-semibold">{f.fallacy}</p>
                      <p className="text-gray-400">{f.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {Number(actionResult.count) === 0 && (
              <p className="text-xs text-neon-green flex items-center gap-1"><CheckCircle className="w-3 h-3" /> No logical fallacies detected</p>
            )}
          </div>
        )}

        {actionResult && !!actionResult.message && (
          <p className="text-xs text-gray-400 italic pt-1">{String(actionResult.message)}</p>
        )}
      </div>

      {showCreate && (
        <div className="panel p-4 space-y-3">
          <h3 className="font-semibold">Start a Debate</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input value={newDebate.topic} onChange={e => setNewDebate(p => ({ ...p, topic: e.target.value }))} placeholder="Debate topic..." className="input-lattice" />
            <select value={newDebate.format} onChange={e => setNewDebate(p => ({ ...p, format: e.target.value as DebateData['format'] }))} className="input-lattice">
              <option value="open">Open Format</option><option value="structured">Structured</option>
              <option value="oxford">Oxford Style</option><option value="lincoln-douglas">Lincoln-Douglas</option>
            </select>
            <input value={newDebate.description} onChange={e => setNewDebate(p => ({ ...p, description: e.target.value }))} placeholder="Description..." className="input-lattice md:col-span-2" />
          </div>
          <button onClick={handleCreate} disabled={createMut.isPending || !newDebate.topic.trim()} className="btn-neon green w-full">
            {createMut.isPending ? 'Creating...' : 'Start Debate'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card"><Scale className="w-5 h-5 text-neon-purple mb-2" /><p className="text-2xl font-bold">{stats.total}</p><p className="text-sm text-gray-400">Debates</p></div>
        <div className="lens-card"><Zap className="w-5 h-5 text-neon-green mb-2" /><p className="text-2xl font-bold">{stats.active}</p><p className="text-sm text-gray-400">Active</p></div>
        <div className="lens-card"><MessageSquare className="w-5 h-5 text-neon-cyan mb-2" /><p className="text-2xl font-bold">{stats.totalArguments}</p><p className="text-sm text-gray-400">Arguments</p></div>
        <div className="lens-card"><Users className="w-5 h-5 text-yellow-400 mb-2" /><p className="text-2xl font-bold">{stats.totalVotes}</p><p className="text-sm text-gray-400">Votes Cast</p></div>
      </div>

      {/* ========== Phase Progress & Speaker ========== */}
      {selectedDebateData && (
        <div className="space-y-3">
          <PhaseProgressBar phase={debatePhase} onPhaseSelect={setDebatePhase} />
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Phase: <span className="text-white font-medium">{phaseConfig.label}</span> — {phaseConfig.description}
            </p>
            {debatePhase === 'setup' && (
              <button onClick={() => { setDebatePhase('opening'); setCurrentTurn('pro'); setTurnCount(c => c + 1); setShowDebateTools(true); }}
                className="px-3 py-1 rounded text-xs bg-neon-green/20 text-neon-green border border-neon-green/30 font-medium">
                Start Debate
              </button>
            )}
            {debatePhase !== 'setup' && debatePhase !== 'finished' && (
              <button onClick={() => { setDebatePhase(getNextPhase(debatePhase)); setCurrentTurn('pro'); setArgumentSide('pro'); setTurnCount(c => c + 1); }}
                className="px-3 py-1 rounded text-xs bg-white/5 border border-white/10 hover:bg-white/10 text-gray-300">
                Skip to {PHASE_CONFIG[getNextPhase(debatePhase)].label}
              </button>
            )}
          </div>
          <CurrentSpeakerBanner phase={debatePhase} currentTurn={currentTurn} onSkipTurn={advanceTurn} />
        </div>
      )}

      {/* ========== Debate Tools Panel ========== */}
      <AnimatePresence>
        {showDebateTools && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <DebateRoundTimer
                onTimeUp={handleTimerExpired}
                turnKey={turnCount}
                autoStart={debatePhase !== 'setup' && debatePhase !== 'finished'}
                phase={debatePhase}
                currentTurn={currentTurn}
              />
              {selectedDebateData ? (
                <div className="space-y-4">
                  <ProConScale
                    proCount={selectedDebateData.proArguments?.length || 0}
                    conCount={selectedDebateData.conArguments?.length || 0}
                    proVotes={selectedDebateData.proVotes || 0}
                    conVotes={selectedDebateData.conVotes || 0}
                  />
                  <VerdictDisplay
                    proArguments={selectedDebateData.proArguments || []}
                    conArguments={selectedDebateData.conArguments || []}
                    proVotes={selectedDebateData.proVotes || 0}
                    conVotes={selectedDebateData.conVotes || 0}
                  />
                </div>
              ) : (
                <div className="panel p-4 flex items-center justify-center text-gray-500 text-sm">
                  Select a debate to see balance & scoring
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trending Topics */}
      {Array.isArray(trendingTopics) && trendingTopics.length > 0 && (
        <div className="panel p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-yellow-400" /> Trending Topics</h3>
          <div className="flex flex-wrap gap-2">
            {trendingTopics.slice(0, 8).map((topic: { id?: string; name?: string; title?: string }, i: number) => (
              <span key={topic.id || i} className="px-3 py-1 text-xs rounded-full bg-yellow-400/10 text-yellow-400 border border-yellow-400/20">
                {topic.name || topic.title || String(topic)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search debates..." className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Debate List */}
        <div className="panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2"><Scale className="w-4 h-4 text-neon-purple" />Debates</h2>
          <div className="space-y-3">
            {isLoading ? (
              <p className="text-gray-400 text-center py-4">Loading...</p>
            ) : debates.length === 0 ? (
              <p className="text-gray-400 text-center py-4">No debates yet.</p>
            ) : debates.map(d => (
              <div key={d.id} className={cn('w-full text-left lens-card transition-all', selectedDebate === d.id && 'border-neon-purple ring-1 ring-neon-purple')}>
                <button onClick={() => handleSelectDebate(d.id)} className="w-full text-left">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold text-sm truncate">{d.topic}</h3>
                    <span className={cn('text-xs px-2 py-0.5 rounded', STATUS_COLORS[d.status || 'open'])}>{d.status}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="text-neon-green">{d.proArguments?.length || 0} pro</span>
                    <span className="text-red-400">{d.conArguments?.length || 0} con</span>
                    <span>{d.format}</span>
                  </div>
                </button>
                <button onClick={() => remove(d.id)} disabled={deleteMut.isPending} className="mt-2 text-gray-500 hover:text-red-400 text-xs flex items-center gap-1">
                  {deleteMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />} Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Debate Detail */}
        <div className="lg:col-span-2 space-y-4">
          {selectedDebateData ? (
            <>
              <div className="panel p-4">
                <h2 className="font-semibold text-lg mb-2">{selectedDebateData.topic}</h2>
                {selectedDebateData.description && <p className="text-sm text-gray-400 mb-4">{selectedDebateData.description}</p>}

                <div className="grid grid-cols-2 gap-4">
                  {/* Pro side */}
                  <div>
                    <h3 className="text-neon-green font-semibold mb-3 flex items-center gap-2"><ThumbsUp className="w-4 h-4" />Pro ({selectedDebateData.proArguments?.length || 0})</h3>
                    <div className="space-y-2">
                      {(selectedDebateData.proArguments || []).map((arg, i) => (
                        <div key={i} className="bg-neon-green/5 border border-neon-green/20 rounded-lg p-3 space-y-2">
                          <p className="text-sm text-gray-200">{arg.text}</p>
                          <p className="text-xs text-gray-500">{arg.author}</p>
                          <ArgumentStrengthMeter text={arg.text} />
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Con side */}
                  <div>
                    <h3 className="text-red-400 font-semibold mb-3 flex items-center gap-2"><ThumbsDown className="w-4 h-4" />Con ({selectedDebateData.conArguments?.length || 0})</h3>
                    <div className="space-y-2">
                      {(selectedDebateData.conArguments || []).map((arg, i) => (
                        <div key={i} className="bg-red-400/5 border border-red-400/20 rounded-lg p-3 space-y-2">
                          <p className="text-sm text-gray-200">{arg.text}</p>
                          <p className="text-xs text-gray-500">{arg.author}</p>
                          <ArgumentStrengthMeter text={arg.text} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Add argument */}
              <div className={cn('panel p-4', !phaseConfig.allowSubmit && 'opacity-60')}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Add Argument</h3>
                  {!phaseConfig.allowSubmit && (
                    <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded">
                      Submissions closed during {phaseConfig.label} phase
                    </span>
                  )}
                  {phaseConfig.allowSubmit && phaseConfig.hasTurns && (
                    <span className={cn('text-xs px-2 py-0.5 rounded',
                      currentTurn === 'pro' ? 'text-neon-green bg-neon-green/10' : 'text-red-400 bg-red-400/10'
                    )}>
                      Only {currentTurn === 'pro' ? 'Pro' : 'Con'} may submit
                    </span>
                  )}
                </div>
                <div className="flex gap-2 mb-3">
                  <button onClick={() => setArgumentSide('pro')}
                    disabled={phaseConfig.hasTurns && currentTurn !== 'pro'}
                    className={cn('px-3 py-1 rounded text-sm',
                      argumentSide === 'pro' ? 'bg-neon-green/20 text-neon-green' : 'bg-lattice-elevated text-gray-400',
                      phaseConfig.hasTurns && currentTurn !== 'pro' && 'opacity-40 cursor-not-allowed'
                    )}>Pro</button>
                  <button onClick={() => setArgumentSide('con')}
                    disabled={phaseConfig.hasTurns && currentTurn !== 'con'}
                    className={cn('px-3 py-1 rounded text-sm',
                      argumentSide === 'con' ? 'bg-red-400/20 text-red-400' : 'bg-lattice-elevated text-gray-400',
                      phaseConfig.hasTurns && currentTurn !== 'con' && 'opacity-40 cursor-not-allowed'
                    )}>Con</button>
                </div>
                <div className="flex gap-2">
                  <input value={newArgument} onChange={e => setNewArgument(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && canSubmitArgument) handleAddArgument(); }}
                    placeholder={canSubmitArgument ? 'Your argument...' : phaseConfig.hasTurns ? `Waiting for ${currentTurn === 'pro' ? 'Pro' : 'Con'} side...` : 'Submissions closed this phase'}
                    disabled={!canSubmitArgument}
                    className="input-lattice flex-1 disabled:opacity-50 disabled:cursor-not-allowed" />
                  <button onClick={handleAddArgument} disabled={!newArgument.trim() || !canSubmitArgument}
                    className="btn-neon disabled:opacity-50"><Send className="w-4 h-4" /></button>
                </div>
                {newArgument.trim() && canSubmitArgument && (
                  <div className="mt-3">
                    <ArgumentStrengthMeter text={newArgument} />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="panel p-4 h-full flex items-center justify-center">
              <div className="text-center text-gray-500">
                <Scale className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Select a debate to view arguments</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <RealtimeDataPanel domain="debate" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="debate" /></div>}
      </div>
    </div>
  );
}
