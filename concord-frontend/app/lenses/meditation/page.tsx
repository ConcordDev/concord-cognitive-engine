'use client';

/**
 * /lenses/meditation — Calm / Headspace / Insight Timer shadow.
 * Bespoke session player + streak tracker + daily prompt + journal
 * + 5 real-backend actions (mint, DM streak, publish session,
 * extend-streak agent, save session log).
 *
 * Backed by the new meditation domain macros:
 *   meditation.pickTrack    → goal-banded track selector
 *   meditation.sessionLog   → append to the user's sessions artifact
 *   meditation.streakSummary → current + longest streak
 *   meditation.dailyPrompt  → date-deterministic mindful prompt
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { MeditationStudio } from '@/components/meditation/MeditationStudio';
import { BreathingVisual } from '@/components/meditation/BreathingVisual';
import { SoundscapePlayer } from '@/components/meditation/SoundscapePlayer';
import { CoursesPanel } from '@/components/meditation/CoursesPanel';
import { RemindersPanel } from '@/components/meditation/RemindersPanel';
import { InsightsPanel } from '@/components/meditation/InsightsPanel';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wind, Play, Pause, RotateCcw, Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle, Flame, Clock, BookOpen, Heart,
  GraduationCap, Bell, Volume2, Lightbulb,
} from 'lucide-react';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('meditation', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

interface Track { trackId: string; title: string; narrator: string; durationMinutes: number; goal: string; vibe: string }
interface StreakResult { currentStreak: number; longestStreak: number; totalSessions: number; totalMinutes: number; lastSessionAt?: string | null }
interface PromptResult { date: string; prompt: string }

type Goal = 'focus' | 'sleep' | 'anxiety' | 'gratitude' | 'breath';
const GOALS: { id: Goal; label: string; color: string; vibe: string }[] = [
  { id: 'focus',     label: 'Focus',     color: '#06b6d4', vibe: 'single-pointed attention' },
  { id: 'sleep',     label: 'Sleep',     color: '#6366f1', vibe: 'soften into rest' },
  { id: 'anxiety',   label: 'Anxiety',   color: '#8b5cf6', vibe: 'soothe and ground' },
  { id: 'gratitude', label: 'Gratitude', color: '#22c55e', vibe: 'open the heart' },
  { id: 'breath',    label: 'Breath',    color: '#f97316', vibe: 'rhythmic anchor' },
];

const DURATIONS = [3, 5, 10, 15, 20, 30, 45];

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'mint' | 'dm' | 'publish' | 'agent' | 'log';
type StudioTab = 'studio' | 'breathe' | 'sounds' | 'courses' | 'reminders' | 'insights';

const STUDIO_TABS: { id: StudioTab; label: string; icon: typeof Wind }[] = [
  { id: 'studio', label: 'Library', icon: Sparkles },
  { id: 'breathe', label: 'Breathe', icon: Wind },
  { id: 'sounds', label: 'Sounds', icon: Volume2 },
  { id: 'courses', label: 'Courses', icon: GraduationCap },
  { id: 'reminders', label: 'Reminders', icon: Bell },
  { id: 'insights', label: 'For You', icon: Lightbulb },
];

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

export default function MeditationLensPage() {
  useLensNav('meditation');
  useLensCommand([
    { id: 'play-pause', keys: ' ', description: 'Play / pause', category: 'navigation', action: () => setPlaying(p => !p) },
  ], { lensId: 'meditation' });

  const [goal, setGoal] = useState<Goal>('focus');
  const [minutes, setMinutes] = useState(10);
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [rating, setRating] = useState<number>(0);
  const [journalEntry, setJournalEntry] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [studioTab, setStudioTab] = useState<StudioTab>('studio');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [streak, setStreak] = useState<StreakResult | null>(null);
  // Four-UX-state machine for the practice summary (real `meditation.streak`).
  const [practiceState, setPracticeState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [dailyPrompt, setDailyPrompt] = useState<PromptResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [dmRecipient, setDmRecipient] = useState('');
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const tickRef = useRef<number | null>(null);

  // useLensData wires the lens artifact substrate; sessions get appended via macro.
  const { items: sessionsArtifacts, refetch: refetchSessions } = useLensData<{ sessions?: Array<{ id: string; trackId: string; minutes: number; completedAt: string }> }>('meditation', 'sessions', { seed: [] });

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  // Pull a track when goal or minutes change
  const pickTrack = useCallback(async (g: Goal, m: number) => {
    try {
      const r = await callMacro<Track>('pickTrack', { goal: g, minutes: m });
      if (r.ok && r.result) setTrack(r.result);
    } catch {/* surfaced via feedback when user clicks Play */}
  }, []);

  useEffect(() => { pickTrack(goal, minutes); }, [goal, minutes, pickTrack]);

  // Load daily prompt + streak on mount
  useEffect(() => {
    (async () => {
      try {
        const p = await callMacro<PromptResult>('dailyPrompt', {});
        if (p.ok && p.result) setDailyPrompt(p.result);
      } catch {/* prompt is decorative */}
    })();
  }, []);

  // Practice summary loads from the STATE-backed `meditation.streak` macro and
  // drives the four-UX-state surface (loading → error+Retry → empty → populated).
  const loadPractice = useCallback(async () => {
    setPracticeState('loading');
    setPracticeError(null);
    try {
      const r = await callMacro<{
        currentStreak: number; totalSessions: number; totalMinutes: number;
      }>('streak', {});
      if (!r.ok || !r.result) {
        setPracticeError(r.error ?? 'Could not load your practice.');
        setPracticeState('error');
        return;
      }
      // Fold the streak macro into the page's longest-streak-aware shape.
      setStreak((prev) => ({
        currentStreak: r.result!.currentStreak,
        longestStreak: Math.max(prev?.longestStreak ?? 0, r.result!.currentStreak),
        totalSessions: r.result!.totalSessions,
        totalMinutes: r.result!.totalMinutes,
        lastSessionAt: prev?.lastSessionAt ?? null,
      }));
      setPracticeState('ready');
    } catch (e) {
      setPracticeError(pickMessage(e));
      setPracticeState('error');
    }
  }, []);

  useEffect(() => { loadPractice(); }, [loadPractice]);
  // Re-pull the practice summary whenever a new session artifact lands.
  useEffect(() => {
    if (sessionsArtifacts.length === 0) return;
    loadPractice();
  }, [sessionsArtifacts.length, loadPractice]);

  // Timer
  useEffect(() => {
    if (playing && !completed) {
      tickRef.current = window.setInterval(() => {
        setElapsedSec(s => {
          const next = s + 1;
          if (next >= minutes * 60) {
            setPlaying(false);
            setCompleted(true);
            return minutes * 60;
          }
          return next;
        });
      }, 1000);
    } else {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    }
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
  }, [playing, completed, minutes]);

  function resetTimer() {
    setPlaying(false); setElapsedSec(0); setCompleted(false); setRating(0); setJournalEntry('');
    setMintedDtuId(null); setPublishedDtuId(null); setAgentReply(null);
  }

  const goalCfg = GOALS.find(g => g.id === goal)!;
  const progress = (elapsedSec / (minutes * 60)) * 100;
  const remainingMin = Math.max(0, Math.ceil((minutes * 60 - elapsedSec) / 60));

  async function actLog() {
    if (!completed) { err('Finish a session first.'); return; }
    if (!track) { err('No track loaded.'); return; }
    setBusy('log'); setFeedback(null);
    try {
      const r = await callMacro<{ entry: unknown; total: number }>('sessionLog', {
        trackId: track.trackId,
        minutes,
        completedAt: new Date().toISOString(),
        rating: rating || undefined,
      });
      if (r.ok && r.result) {
        ok(`Logged session ${r.result.total}.`);
        refetchSessions();
      } else err(r.error ?? 'log failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMint() {
    if (!completed || !track) { err('Finish a session first.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Meditation — ${track.title} (${minutes}m, ${goal})`,
          tags: ['meditation', `goal:${goal}`, `vibe:${track.vibe}`, `min:${minutes}`],
          source: 'meditation:session',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            session: {
              trackId: track.trackId,
              title: track.title,
              narrator: track.narrator,
              goal,
              minutes,
              completedAt: new Date().toISOString(),
              rating: rating || null,
              journal: journalEntry.trim(),
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintedDtuId(id); ok(`Session DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!streak) { err('No streak loaded yet.'); return; }
    if (!dmRecipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `🧘 Meditation streak`,
      ``,
      `Current: ${streak.currentStreak} day${streak.currentStreak === 1 ? '' : 's'} 🔥`,
      `Longest: ${streak.longestStreak} day${streak.longestStreak === 1 ? '' : 's'}`,
      `Total: ${streak.totalSessions} sessions · ${streak.totalMinutes} min`,
      track ? `\nToday's track: ${track.title} (${minutes}m ${goal})` : '',
    ].filter(Boolean).join('\n');
    try {
      const r = await api.post('/api/social/dm', { toUserId: dmRecipient.trim(), content: body });
      if (r.data?.ok !== false) { ok(`Streak sent to ${dmRecipient.trim()}.`); setDmRecipient(''); }
      else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    if (!completed || !track) { err('Finish a session first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Meditation milestone — ${streak?.currentStreak ?? 1} day streak`,
          tags: ['meditation', 'milestone', 'public', `goal:${goal}`],
          source: 'meditation:milestone:publish',
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            milestone: {
              streak: streak?.currentStreak ?? 1,
              totalMinutes: streak?.totalMinutes ?? minutes,
              latestGoal: goal,
              latestMinutes: minutes,
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Milestone published ${id.slice(0, 8)}…`); }
      else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Meditation context: goal "${goal}" (${goalCfg.vibe}), ${minutes} min, streak ${streak?.currentStreak ?? 0} day(s).`,
        journalEntry.trim() ? `Post-session journal: "${journalEntry.trim()}".` : '',
        ``,
        `Suggest a single 2-line micro-practice I can do in the next 4 hours to extend this streak`,
        `and stay aligned with the goal. Concrete and embodied. No spiritual jargon.`,
      ].filter(Boolean).join(' ');
      const r = await api.post('/api/lens/run', {
        domain: 'chat_agent', name: 'do',
        input: { task, maxTurns: 3 },
      });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) {
        setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Micro-practice ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  return (
    <LensShell lensId="meditation">
      <FirstRunTour lensId="meditation" />
      <ManifestActionBar />
      <DepthBadge lensId="meditation" size="sm" className="ml-2" />
      <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-purple-950/20 text-zinc-100 px-4 sm:px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <header className="mb-6 flex items-center gap-3">
            <Wind className="w-6 h-6 text-purple-400" />
            <div className="flex-1">
              <h1 className="text-2xl font-semibold">Meditation</h1>
              <p className="text-sm text-zinc-400">A quiet session player + streak. Tap a goal, pick a length, breathe.</p>
            </div>
            {streak && (
              <div className="text-right">
                <div className="flex items-center gap-1 text-orange-300 text-lg font-semibold">
                  <Flame className="w-4 h-4" />{streak.currentStreak}
                </div>
                <div className="text-[10px] text-zinc-400">day streak · {streak.totalMinutes} min total</div>
              </div>
            )}
          </header>

          {dailyPrompt && (
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 mb-6 flex items-start gap-3">
              <Heart className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold mb-0.5">Today&apos;s prompt</div>
                <p className="text-sm text-zinc-200 italic leading-relaxed">{dailyPrompt.prompt}</p>
              </div>
            </div>
          )}

          {/* Goal picker */}
          <div className="mb-4 grid grid-cols-5 gap-2">
            {GOALS.map(g => (
              <button
                key={g.id}
                type="button"
                onClick={() => { setGoal(g.id); resetTimer(); }}
                className={cn(
                  'p-3 rounded-lg border transition-all',
                  goal === g.id ? 'border-purple-500/60' : 'border-zinc-800 hover:border-zinc-700',
                )}
                style={goal === g.id ? { backgroundColor: g.color + '20' } : {}}
              >
                <div className="text-sm font-semibold" style={{ color: goal === g.id ? g.color : '#a1a1aa' }}>{g.label}</div>
              </button>
            ))}
          </div>

          {/* Duration picker */}
          <div className="mb-6 flex items-center justify-center gap-2">
            {DURATIONS.map(m => (
              <button
                key={m}
                type="button"
                onClick={() => { setMinutes(m); resetTimer(); }}
                className={cn(
                  'w-12 h-12 rounded-full text-sm font-mono transition-all',
                  minutes === m ? 'bg-purple-500/30 text-purple-200 ring-2 ring-purple-500/50' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800',
                )}
              >{m}m</button>
            ))}
          </div>

          {/* Player */}
          {track && (
            <div className="rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 p-6 mb-6">
              <div className="text-center mb-4">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">{goalCfg.label} · {goalCfg.vibe}</div>
                <h2 className="text-xl font-semibold text-zinc-100">{track.title}</h2>
                <div className="text-xs text-zinc-400">narrated by {track.narrator}</div>
              </div>

              <div className="relative w-48 h-48 mx-auto mb-4">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle cx="50" cy="50" r="46" fill="none" stroke="rgb(39,39,42)" strokeWidth="4" />
                  <circle
                    cx="50" cy="50" r="46" fill="none"
                    stroke={goalCfg.color}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={`${(progress / 100) * 289} 289`}
                    className="transition-all duration-1000 ease-linear"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-3xl font-light text-zinc-100">
                    {Math.floor(elapsedSec / 60).toString().padStart(2, '0')}:{(elapsedSec % 60).toString().padStart(2, '0')}
                  </div>
                  <div className="text-xs text-zinc-400">{completed ? '✓ complete' : playing ? `${remainingMin}m left` : 'ready'}</div>
                </div>
              </div>

              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setPlaying(p => !p)}
                  disabled={completed}
                  className={cn(
                    'w-14 h-14 rounded-full flex items-center justify-center text-white transition-colors',
                    completed ? 'bg-zinc-800 opacity-40 cursor-not-allowed' : playing ? 'bg-zinc-700 hover:bg-zinc-600' : '',
                  )}
                  style={!completed && !playing ? { backgroundColor: goalCfg.color } : {}}
                  aria-label={playing ? 'Pause' : 'Play'}
                >
                  {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                </button>
                <button
                  type="button"
                  onClick={resetTimer}
                  className="w-10 h-10 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-300"
                  aria-label="Reset"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Post-session reflection */}
          {completed && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border border-purple-500/30 bg-zinc-900/60 p-4 mb-6 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold text-zinc-100">Session complete</span>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">How did it feel?</label>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(n)}
                      className={cn('w-7 h-7 rounded-full text-sm transition-colors', rating >= n ? 'bg-amber-400 text-amber-950' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700')}
                    >★</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Journal (optional)</label>
                <textarea
                  value={journalEntry} onChange={(e) => setJournalEntry(e.target.value)} rows={3}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-purple-400/40 resize-none"
                  placeholder="What did you notice?"
                />
              </div>
            </motion.div>
          )}

          {/* Actions */}
          {completed && (
            <div className="space-y-3 mb-6">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">DM recipient (for streak share)</label>
                <input type="text" value={dmRecipient} onChange={(e) => setDmRecipient(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40" placeholder="meditation buddy user id" />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {[
                  { id: 'log' as ActionId,     label: 'Log',       icon: Clock,    accent: '#06b6d4', desc: 'Append to your sessions',           handler: actLog,     disabled: false },
                  { id: 'mint' as ActionId,    label: mintedDtuId ? 'Saved' : 'Mint',     icon: Sparkles, accent: '#8b5cf6', desc: mintedDtuId ? `DTU ${mintedDtuId.slice(0, 8)}…` : 'Private session DTU + journal', handler: actMint, disabled: !!mintedDtuId },
                  { id: 'dm' as ActionId,      label: 'Share streak', icon: Send,    accent: '#ec4899', desc: 'DM streak to a buddy',              handler: actDm,      disabled: !streak },
                  { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish milestone', icon: Globe, accent: '#22c55e', desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public milestone DTU', handler: actPublish, disabled: !!publishedDtuId },
                  { id: 'agent' as ActionId,   label: 'Micro-practice', icon: Wand2, accent: '#eab308', desc: 'Agent: a 2-line practice for the next 4h', handler: actAgent,   disabled: false },
                ].map(a => {
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
            </div>
          )}

          {agentReply && (
            <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 mb-6">
              <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
                <Wand2 className="w-3 h-3" /> Micro-practice
              </div>
              <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200 leading-relaxed italic">{agentReply}</pre>
            </div>
          )}

          {/* Your practice — four UX states (loading / error+Retry / empty / populated) */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-4 h-4 text-zinc-400" />
              <h3 className="text-sm font-semibold text-zinc-200">Your practice</h3>
            </div>

            {practiceState === 'loading' && (
              <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-zinc-400 py-4 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading your practice…</span>
              </div>
            )}

            {practiceState === 'error' && (
              <div role="alert" className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="flex items-center gap-2 text-sm text-red-300">
                  <AlertTriangle className="w-4 h-4" />
                  <span>{practiceError ?? 'Could not load your practice.'}</span>
                </div>
                <button
                  type="button"
                  onClick={loadPractice}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Retry
                </button>
              </div>
            )}

            {practiceState === 'ready' && streak && streak.totalSessions === 0 && (
              <div className="py-6 text-center">
                <Wind className="w-6 h-6 text-purple-400/60 mx-auto mb-2" />
                <p className="text-sm text-zinc-300 font-medium">No sessions yet</p>
                <p className="text-xs text-zinc-500 mt-0.5">Pick a goal and a length above, then breathe. Your first sit starts the streak.</p>
              </div>
            )}

            {practiceState === 'ready' && streak && streak.totalSessions > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded bg-zinc-950/60 p-2 text-center">
                  <div className="text-lg font-bold text-orange-300 flex items-center justify-center gap-1"><Flame className="w-3 h-3" />{streak.currentStreak}</div>
                  <div className="text-[10px] text-zinc-400">current streak</div>
                </div>
                <div className="rounded bg-zinc-950/60 p-2 text-center">
                  <div className="text-lg font-bold text-purple-300">{streak.longestStreak}</div>
                  <div className="text-[10px] text-zinc-400">longest streak</div>
                </div>
                <div className="rounded bg-zinc-950/60 p-2 text-center">
                  <div className="text-lg font-bold text-zinc-100">{streak.totalSessions}</div>
                  <div className="text-[10px] text-zinc-400">sessions</div>
                </div>
                <div className="rounded bg-zinc-950/60 p-2 text-center">
                  <div className="text-lg font-bold text-emerald-300">{streak.totalMinutes}</div>
                  <div className="text-[10px] text-zinc-400">minutes</div>
                </div>
              </div>
            )}
          </div>

          <AnimatePresence>
            {feedback && (
              <motion.div
                key={feedback.text}
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className={cn(
                  'fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-lg text-sm flex items-start gap-2 border shadow-lg z-50',
                  feedback.kind === 'ok'
                    ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40'
                    : 'bg-red-500/15 text-red-200 border-red-500/40',
                )}
              >
                {feedback.kind === 'ok' ? <Check className="w-4 h-4 mt-0.5" /> : <AlertTriangle className="w-4 h-4 mt-0.5" />}
                <span>{feedback.text}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <section className="mt-6 mx-auto max-w-2xl px-4 sm:px-6">
        <div className="flex flex-wrap gap-1.5 mb-4">
          {STUDIO_TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setStudioTab(t.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors',
                  studioTab === t.id
                    ? 'bg-purple-600/30 border-purple-500/50 text-purple-100'
                    : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200',
                )}
              >
                <Icon className="w-3.5 h-3.5" />{t.label}
              </button>
            );
          })}
        </div>
        {studioTab === 'studio' && <MeditationStudio />}
        {studioTab === 'breathe' && <BreathingVisual />}
        {studioTab === 'sounds' && <SoundscapePlayer />}
        {studioTab === 'courses' && <CoursesPanel />}
        {studioTab === 'reminders' && <RemindersPanel />}
        {studioTab === 'insights' && <InsightsPanel onPlayed={refetchSessions} />}
      </section>
          <RecentMineCard domain="meditation" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="meditation" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="meditation" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
