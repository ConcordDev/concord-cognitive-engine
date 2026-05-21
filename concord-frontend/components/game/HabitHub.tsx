'use client';

// HabitHub — Habitica-style behavior-change loop for the Game lens.
// Dailies / habits / to-dos, streak chains, parties + shared quests,
// avatar cosmetics, custom rewards, reminders, and cross-user challenges.
// Every panel is wired to a real `game` domain macro via lensRun.

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  CheckSquare, Flame, Users, Shirt, Gift, Bell, Swords,
  Plus, Trash2, X, Check, Loader2, ArrowDown, RefreshCw, Crown, Trophy,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HubTab = 'tasks' | 'streaks' | 'party' | 'cosmetics' | 'rewards' | 'reminders' | 'challenges';

interface Progress {
  xp: number; level: number; gold: number; intoLevel: number; nextLevelXp: number;
  streak: number; longestStreak: number;
  dailiesDone: number; dailiesTotal: number; totalTasks: number;
}
interface Task {
  id: string; kind: 'habit' | 'daily' | 'todo'; title: string; notes: string;
  difficulty: 'trivial' | 'easy' | 'medium' | 'hard';
  positive: boolean; negative: boolean; completedToday: boolean;
  streak: number; longestStreak: number; completions: number; lastCompletedDay: string | null;
}
interface StreakChain { id: string; title: string; kind: string; streak: number; longestStreak: number; atRisk: boolean; }
interface PartyMember { userId: string; level: number; xp: number; streak: number; isLeader: boolean; }
interface SharedQuest { id: string; title: string; description: string; goal: number; progress: number; completed: boolean; contributions: Record<string, number>; }
interface Party { id: string; name: string; description: string; leaderId: string; members: PartyMember[]; }
interface PartyListEntry { id: string; name: string; description: string; memberCount: number; hasSharedQuest: boolean; }
interface Cosmetic { id: string; name: string; slot: string; cost: number; rarity: string; icon: string; owned: boolean; equipped: boolean; }
interface Reward { id: string; title: string; notes: string; cost: number; redemptions: number; }
interface Reminder { id: string; title: string; time: string; days: string[]; enabled: boolean; upcomingToday: boolean; overdueToday: boolean; }
interface ChallengeEntry { id: string; title: string; description: string; metric: string; goal: number; participantCount: number; prize: number; endsAt: number; expired: boolean; winnerId: string | null; }
interface BoardRow { userId: string; score: number; progressPct: number; isCurrentUser: boolean; rank: number; }

const DIFFICULTY_XP: Record<string, number> = { trivial: 5, easy: 10, medium: 20, hard: 35 };
const RARITY: Record<string, string> = {
  common: 'text-gray-400 border-gray-500/30',
  rare: 'text-neon-blue border-neon-blue/30',
  epic: 'text-neon-purple border-neon-purple/30',
  legendary: 'text-neon-yellow border-neon-yellow/30',
};
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HabitHub({ onXpChange }: { onXpChange?: (xp: number) => void }) {
  const [tab, setTab] = useState<HubTab>('tasks');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Tasks
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState({ kind: 'daily' as Task['kind'], title: '', notes: '', difficulty: 'easy' as Task['difficulty'] });

  // Streaks
  const [streaks, setStreaks] = useState<{ accountStreak: number; longestAccountStreak: number; chains: StreakChain[]; atRisk: StreakChain[]; lossPenaltyHint: string } | null>(null);

  // Party
  const [partyStatus, setPartyStatus] = useState<{ inParty: boolean; party?: Party; sharedQuest?: SharedQuest | null } | null>(null);
  const [partyList, setPartyList] = useState<PartyListEntry[]>([]);
  const [newParty, setNewParty] = useState({ name: '', description: '' });
  const [newQuest, setNewQuest] = useState({ title: '', description: '', goal: 20 });

  // Cosmetics
  const [cosmetics, setCosmetics] = useState<Cosmetic[]>([]);
  const [cosGold, setCosGold] = useState(0);

  // Rewards
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [rewardGold, setRewardGold] = useState(0);
  const [newReward, setNewReward] = useState({ title: '', notes: '', cost: 50 });

  // Reminders
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [newReminder, setNewReminder] = useState({ title: '', time: '', days: [...WEEKDAYS] });

  // Challenges
  const [challenges, setChallenges] = useState<ChallengeEntry[]>([]);
  const [newChal, setNewChal] = useState({ title: '', description: '', metric: 'tasks', goal: 30, prize: 200, days: 7 });
  const [openBoard, setOpenBoard] = useState<{ id: string; title: string; goal: number; rows: BoardRow[]; winnerId: string | null } | null>(null);

  // -------------------------------------------------------------------------
  // Loaders
  // -------------------------------------------------------------------------

  const loadProgress = useCallback(async () => {
    const r = await lensRun('game', 'playerProgress', {});
    if (r.data.ok && r.data.result) {
      setProgress(r.data.result as Progress);
      onXpChange?.((r.data.result as Progress).xp);
    }
  }, [onXpChange]);

  const loadTasks = useCallback(async () => {
    const r = await lensRun('game', 'taskList', {});
    if (r.data.ok && r.data.result) setTasks(((r.data.result as { tasks: Task[] }).tasks) || []);
    else if (!r.data.ok) setErr(r.data.error);
  }, []);

  const loadStreaks = useCallback(async () => {
    const r = await lensRun('game', 'streakSummary', {});
    if (r.data.ok && r.data.result) setStreaks(r.data.result as typeof streaks);
  }, []);

  const loadParty = useCallback(async () => {
    const [st, list] = await Promise.all([
      lensRun('game', 'partyStatus', {}),
      lensRun('game', 'partyList', {}),
    ]);
    if (st.data.ok) setPartyStatus(st.data.result as typeof partyStatus);
    if (list.data.ok && list.data.result) setPartyList(((list.data.result as { parties: PartyListEntry[] }).parties) || []);
  }, []);

  const loadCosmetics = useCallback(async () => {
    const r = await lensRun('game', 'cosmeticCatalog', {});
    if (r.data.ok && r.data.result) {
      const res = r.data.result as { items: Cosmetic[]; gold: number };
      setCosmetics(res.items || []);
      setCosGold(res.gold || 0);
    }
  }, []);

  const loadRewards = useCallback(async () => {
    const r = await lensRun('game', 'rewardList', {});
    if (r.data.ok && r.data.result) {
      const res = r.data.result as { rewards: Reward[]; gold: number };
      setRewards(res.rewards || []);
      setRewardGold(res.gold || 0);
    }
  }, []);

  const loadReminders = useCallback(async () => {
    const r = await lensRun('game', 'reminderList', {});
    if (r.data.ok && r.data.result) setReminders(((r.data.result as { reminders: Reminder[] }).reminders) || []);
  }, []);

  const loadChallenges = useCallback(async () => {
    const r = await lensRun('game', 'challengeList', {});
    if (r.data.ok && r.data.result) setChallenges(((r.data.result as { challenges: ChallengeEntry[] }).challenges) || []);
  }, []);

  useEffect(() => {
    loadProgress();
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === 'streaks') loadStreaks();
    if (tab === 'party') loadParty();
    if (tab === 'cosmetics') loadCosmetics();
    if (tab === 'rewards') loadRewards();
    if (tab === 'reminders') loadReminders();
    if (tab === 'challenges') loadChallenges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : 'action failed'); }
    setBusy(null);
  }, []);

  const createTask = () => run('create-task', async () => {
    if (!newTask.title.trim()) { setErr('Task title is required'); return; }
    const r = await lensRun('game', 'taskCreate', { ...newTask });
    if (!r.data.ok) { setErr(r.data.error); return; }
    setNewTask({ kind: newTask.kind, title: '', notes: '', difficulty: 'easy' });
    await loadTasks();
  });

  const completeTask = (id: string, direction: 'up' | 'down') => run(`task-${id}-${direction}`, async () => {
    const r = await lensRun('game', 'taskComplete', { id, direction });
    if (!r.data.ok) { setErr(r.data.error); return; }
    await Promise.all([loadTasks(), loadProgress()]);
    if (tab === 'streaks') await loadStreaks();
  });

  const deleteTask = (id: string) => run(`del-task-${id}`, async () => {
    const r = await lensRun('game', 'taskDelete', { id });
    if (!r.data.ok) { setErr(r.data.error); return; }
    await loadTasks();
  });

  const createParty = () => run('create-party', async () => {
    if (!newParty.name.trim()) { setErr('Party name is required'); return; }
    const r = await lensRun('game', 'partyCreate', { ...newParty });
    if (!r.data.ok) { setErr(r.data.error); return; }
    setNewParty({ name: '', description: '' });
    await loadParty();
  });

  const joinParty = (partyId: string) => run(`join-${partyId}`, async () => {
    const r = await lensRun('game', 'partyJoin', { partyId });
    if (!r.data.ok) { setErr(r.data.error); return; }
    await loadParty();
  });

  const leaveParty = () => run('leave-party', async () => {
    const r = await lensRun('game', 'partyLeave', {});
    if (!r.data.ok) { setErr(r.data.error); return; }
    await loadParty();
  });

  const setSharedQuest = () => run('set-quest', async () => {
    if (!newQuest.title.trim()) { setErr('Quest title is required'); return; }
    const r = await lensRun('game', 'partySetQuest', { ...newQuest });
    if (!r.data.ok) { setErr(r.data.error); return; }
    setNewQuest({ title: '', description: '', goal: 20 });
    await loadParty();
  });

  const contributeQuest = () => run('contribute', async () => {
    const r = await lensRun('game', 'partyContribute', { amount: 1 });
    if (!r.data.ok) { setErr(r.data.error); return; }
    await Promise.all([loadParty(), loadProgress()]);
  });

  const buyCosmetic = (id: string) => run(`buy-${id}`, async () => {
    const r = await lensRun('game', 'cosmeticBuy', { id });
    if (!r.data.ok) { setErr(r.data.error); return; }
    await loadCosmetics();
  });

  const equipCosmetic = (id: string, unequip: boolean) => run(`equip-${id}`, async () => {
    const r = await lensRun('game', 'cosmeticEquip', { id, unequip });
    if (!r.data.ok) { setErr(r.data.error); return; }
    await loadCosmetics();
  });

  const createReward = () => run('create-reward', async () => {
    if (!newReward.title.trim()) { setErr('Reward title is required'); return; }
    const r = await lensRun('game', 'rewardCreate', { ...newReward });
    if (!r.data.ok) { setErr(r.data.error); return; }
    setNewReward({ title: '', notes: '', cost: 50 });
    await loadRewards();
  });

  const redeemReward = (id: string) => run(`redeem-${id}`, async () => {
    const r = await lensRun('game', 'rewardRedeem', { id });
    if (!r.data.ok) { setErr(r.data.error); return; }
    await Promise.all([loadRewards(), loadProgress()]);
  });

  const deleteReward = (id: string) => run(`del-reward-${id}`, async () => {
    const r = await lensRun('game', 'rewardDelete', { id });
    if (!r.data.ok) { setErr(r.data.error); return; }
    await loadRewards();
  });

  const createReminder = () => run('create-reminder', async () => {
    if (!newReminder.title.trim()) { setErr('Reminder title is required'); return; }
    if (!newReminder.time) { setErr('Reminder time is required'); return; }
    const r = await lensRun('game', 'reminderCreate', { ...newReminder });
    if (!r.data.ok) { setErr(r.data.error); return; }
    setNewReminder({ title: '', time: '', days: [...WEEKDAYS] });
    await loadReminders();
  });

  const toggleReminder = (id: string) => run(`toggle-${id}`, async () => {
    const r = await lensRun('game', 'reminderToggle', { id });
    if (!r.data.ok) { setErr(r.data.error); return; }
    await loadReminders();
  });

  const deleteReminder = (id: string) => run(`del-rem-${id}`, async () => {
    const r = await lensRun('game', 'reminderDelete', { id });
    if (!r.data.ok) { setErr(r.data.error); return; }
    await loadReminders();
  });

  const createChallenge = () => run('create-chal', async () => {
    if (!newChal.title.trim()) { setErr('Challenge title is required'); return; }
    const r = await lensRun('game', 'challengeCreate', { ...newChal });
    if (!r.data.ok) { setErr(r.data.error); return; }
    setNewChal({ title: '', description: '', metric: 'tasks', goal: 30, prize: 200, days: 7 });
    await loadChallenges();
  });

  const joinChallenge = (challengeId: string) => run(`join-chal-${challengeId}`, async () => {
    const r = await lensRun('game', 'challengeJoin', { challengeId });
    if (!r.data.ok) { setErr(r.data.error); return; }
    await loadChallenges();
  });

  const progressChallenge = (challengeId: string) => run(`prog-chal-${challengeId}`, async () => {
    const r = await lensRun('game', 'challengeProgress', { challengeId, amount: 1 });
    if (!r.data.ok) { setErr(r.data.error); return; }
    await Promise.all([loadChallenges(), loadProgress()]);
    if (openBoard?.id === challengeId) await viewBoard(challengeId);
  });

  const viewBoard = useCallback(async (challengeId: string) => {
    const r = await lensRun('game', 'challengeLeaderboard', { challengeId });
    if (!r.data.ok) { setErr(r.data.error); return; }
    const res = r.data.result as { challengeId: string; title: string; goal: number; leaderboard: BoardRow[]; winnerId: string | null };
    setOpenBoard({ id: res.challengeId, title: res.title, goal: res.goal, rows: res.leaderboard || [], winnerId: res.winnerId });
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const HUB_TABS: { id: HubTab; label: string; icon: typeof CheckSquare }[] = [
    { id: 'tasks', label: 'Dailies & Habits', icon: CheckSquare },
    { id: 'streaks', label: 'Streaks', icon: Flame },
    { id: 'party', label: 'Party', icon: Users },
    { id: 'cosmetics', label: 'Avatar', icon: Shirt },
    { id: 'rewards', label: 'Rewards', icon: Gift },
    { id: 'reminders', label: 'Reminders', icon: Bell },
    { id: 'challenges', label: 'Challenges', icon: Swords },
  ];

  return (
    <div className="panel p-4 space-y-4" data-lens-theme="game">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Flame className="w-5 h-5 text-neon-pink" /> Habit Hub
        </h2>
        {progress && (
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="text-neon-cyan">Lv {progress.level}</span>
            <span className="text-neon-yellow">{progress.xp.toLocaleString()} XP</span>
            <span className="text-amber-400">{progress.gold.toLocaleString()} gold</span>
            <span className="text-neon-pink">{progress.streak}d streak</span>
            <span className="text-gray-400">{progress.dailiesDone}/{progress.dailiesTotal} dailies</span>
          </div>
        )}
      </div>

      {/* XP progress within level */}
      {progress && (
        <div className="h-2 bg-lattice-bg rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-neon-blue to-neon-pink"
            style={{ width: `${Math.min(100, (progress.intoLevel / Math.max(1, progress.nextLevelXp)) * 100)}%` }}
          />
        </div>
      )}

      {/* Hub sub-tabs */}
      <div className="flex gap-1 flex-wrap border-b border-lattice-border pb-2">
        {HUB_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs transition-colors',
                tab === t.id ? 'bg-neon-purple/20 text-neon-purple border-b-2 border-neon-purple' : 'text-gray-400 hover:text-white',
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {err && (
        <div className="flex items-center justify-between bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
          <span className="text-xs text-red-400">{err}</span>
          <button onClick={() => setErr(null)} className="text-red-400 hover:text-red-300" aria-label="Dismiss error"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* ===================== TASKS ===================== */}
      {tab === 'tasks' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
            <div className="md:col-span-2">
              <label className="text-[10px] text-gray-400 block mb-1">Title</label>
              <input
                value={newTask.title}
                onChange={(e) => setNewTask((p) => ({ ...p, title: e.target.value }))}
                placeholder="e.g. 30 min reading"
                className="input-lattice w-full text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">Type</label>
              <select value={newTask.kind} onChange={(e) => setNewTask((p) => ({ ...p, kind: e.target.value as Task['kind'] }))} className="input-lattice w-full text-sm">
                <option value="daily">Daily</option>
                <option value="habit">Habit</option>
                <option value="todo">To-Do</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">Difficulty</label>
              <select value={newTask.difficulty} onChange={(e) => setNewTask((p) => ({ ...p, difficulty: e.target.value as Task['difficulty'] }))} className="input-lattice w-full text-sm">
                <option value="trivial">Trivial</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <button onClick={createTask} disabled={busy === 'create-task'} className="btn-neon text-sm py-2 flex items-center justify-center gap-1">
              {busy === 'create-task' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(['daily', 'habit', 'todo'] as const).map((kind) => (
              <div key={kind} className="space-y-2">
                <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">{kind === 'todo' ? 'To-Dos' : `${kind}s`}</h3>
                {tasks.filter((t) => t.kind === kind).length === 0 && (
                  <p className="text-xs text-gray-600 italic">No {kind} tasks yet.</p>
                )}
                {tasks.filter((t) => t.kind === kind).map((t) => (
                  <div key={t.id} className={cn('lens-card p-3', t.completedToday && 'opacity-50')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-white font-medium truncate">{t.title}</p>
                        {t.notes && <p className="text-[11px] text-gray-500 truncate">{t.notes}</p>}
                        <p className="text-[10px] text-gray-500 mt-1">
                          {t.difficulty} · +{DIFFICULTY_XP[t.difficulty]} XP · streak {t.streak} · done {t.completions}×
                        </p>
                      </div>
                      <button onClick={() => deleteTask(t.id)} disabled={busy === `del-task-${t.id}`} className="text-gray-600 hover:text-red-400 shrink-0" aria-label="Delete task">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex gap-1.5 mt-2">
                      <button
                        onClick={() => completeTask(t.id, 'up')}
                        disabled={!!busy || (t.kind !== 'habit' && t.completedToday)}
                        className="btn-neon text-[11px] py-1 px-3 flex items-center gap-1 disabled:opacity-40"
                      >
                        {busy === `task-${t.id}-up` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        {t.kind === 'habit' ? '+' : t.completedToday ? 'Done' : 'Complete'}
                      </button>
                      {t.kind === 'habit' && (
                        <button
                          onClick={() => completeTask(t.id, 'down')}
                          disabled={!!busy}
                          className="text-[11px] py-1 px-3 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 flex items-center gap-1 disabled:opacity-40"
                        >
                          {busy === `task-${t.id}-down` ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowDown className="w-3 h-3" />} -
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== STREAKS ===================== */}
      {tab === 'streaks' && (
        <div className="space-y-3">
          {streaks ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="lens-card text-center py-3">
                  <p className="text-2xl font-bold text-neon-pink">{streaks.accountStreak}d</p>
                  <p className="text-[10px] text-gray-400">Account Streak</p>
                </div>
                <div className="lens-card text-center py-3">
                  <p className="text-2xl font-bold text-neon-yellow">{streaks.longestAccountStreak}d</p>
                  <p className="text-[10px] text-gray-400">Longest Ever</p>
                </div>
                <div className="lens-card text-center py-3">
                  <p className="text-2xl font-bold text-red-400">{streaks.atRisk.length}</p>
                  <p className="text-[10px] text-gray-400">Chains At Risk</p>
                </div>
              </div>
              <p className={cn('text-xs px-3 py-2 rounded border', streaks.atRisk.length ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-neon-green/10 border-neon-green/30 text-neon-green')}>
                {streaks.lossPenaltyHint}
              </p>
              <div className="space-y-2">
                {streaks.chains.length === 0 && <p className="text-xs text-gray-600 italic">No active chains yet — complete a daily to start one.</p>}
                {streaks.chains.map((c) => (
                  <div key={c.id} className="lens-card p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm text-white">{c.title}</p>
                      <p className="text-[10px] text-gray-500">{c.kind} · best {c.longestStreak}d</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.atRisk && <span className="text-[10px] text-red-400 border border-red-500/40 rounded px-1.5 py-0.5">at risk</span>}
                      <span className="text-lg font-bold text-neon-pink flex items-center gap-1"><Flame className="w-4 h-4" />{c.streak}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : <p className="text-xs text-gray-500">Loading streaks…</p>}
        </div>
      )}

      {/* ===================== PARTY ===================== */}
      {tab === 'party' && (
        <div className="space-y-4">
          {partyStatus?.inParty && partyStatus.party ? (
            <>
              <div className="lens-card p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white flex items-center gap-1"><Users className="w-4 h-4 text-neon-cyan" />{partyStatus.party.name}</p>
                    {partyStatus.party.description && <p className="text-[11px] text-gray-500">{partyStatus.party.description}</p>}
                  </div>
                  <button onClick={leaveParty} disabled={busy === 'leave-party'} className="text-xs text-red-400 border border-red-500/40 rounded px-3 py-1 hover:bg-red-500/10">Leave</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3">
                  {partyStatus.party.members.map((m) => (
                    <div key={m.userId} className="bg-lattice-bg rounded p-2 text-center">
                      <p className="text-xs text-white truncate flex items-center justify-center gap-1">
                        {m.isLeader && <Crown className="w-3 h-3 text-neon-yellow" />}{m.userId}
                      </p>
                      <p className="text-[10px] text-gray-500">Lv {m.level} · {m.streak}d streak</p>
                    </div>
                  ))}
                </div>
              </div>

              {partyStatus.sharedQuest ? (
                <div className="lens-card p-3">
                  <p className="text-sm font-semibold text-white">Shared Quest: {partyStatus.sharedQuest.title}</p>
                  {partyStatus.sharedQuest.description && <p className="text-[11px] text-gray-500">{partyStatus.sharedQuest.description}</p>}
                  <div className="h-2 bg-lattice-bg rounded-full overflow-hidden mt-2">
                    <div className="h-full bg-gradient-to-r from-neon-cyan to-neon-green" style={{ width: `${Math.min(100, (partyStatus.sharedQuest.progress / partyStatus.sharedQuest.goal) * 100)}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-gray-400">{partyStatus.sharedQuest.progress} / {partyStatus.sharedQuest.goal}</span>
                    {partyStatus.sharedQuest.completed
                      ? <span className="text-xs text-neon-green flex items-center gap-1"><Trophy className="w-3.5 h-3.5" />Completed</span>
                      : <button onClick={contributeQuest} disabled={busy === 'contribute'} className="btn-neon text-xs py-1 px-3">Contribute +1</button>}
                  </div>
                </div>
              ) : partyStatus.party.leaderId && (
                <div className="lens-card p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-300">Set a Shared Quest (leader only)</p>
                  <input value={newQuest.title} onChange={(e) => setNewQuest((p) => ({ ...p, title: e.target.value }))} placeholder="Quest title" className="input-lattice w-full text-sm" />
                  <div className="flex gap-2">
                    <input value={newQuest.description} onChange={(e) => setNewQuest((p) => ({ ...p, description: e.target.value }))} placeholder="Description" className="input-lattice flex-1 text-sm" />
                    <input type="number" min={1} value={newQuest.goal} onChange={(e) => setNewQuest((p) => ({ ...p, goal: Number(e.target.value) }))} className="input-lattice w-24 text-sm" />
                    <button onClick={setSharedQuest} disabled={busy === 'set-quest'} className="btn-neon text-sm py-1.5 px-3">Set</button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="lens-card p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-300">Create a Party</p>
                <div className="flex gap-2">
                  <input value={newParty.name} onChange={(e) => setNewParty((p) => ({ ...p, name: e.target.value }))} placeholder="Party name" className="input-lattice flex-1 text-sm" />
                  <input value={newParty.description} onChange={(e) => setNewParty((p) => ({ ...p, description: e.target.value }))} placeholder="Description" className="input-lattice flex-1 text-sm" />
                  <button onClick={createParty} disabled={busy === 'create-party'} className="btn-neon text-sm py-1.5 px-3 flex items-center gap-1">
                    {busy === 'create-party' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-300">Open Parties</p>
                {partyList.length === 0 && <p className="text-xs text-gray-600 italic">No parties yet. Create the first one.</p>}
                {partyList.map((p) => (
                  <div key={p.id} className="lens-card p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm text-white">{p.name}</p>
                      <p className="text-[10px] text-gray-500">{p.memberCount} member(s){p.hasSharedQuest ? ' · shared quest active' : ''}</p>
                    </div>
                    <button onClick={() => joinParty(p.id)} disabled={busy === `join-${p.id}`} className="btn-neon text-xs py-1 px-3">Join</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ===================== COSMETICS ===================== */}
      {tab === 'cosmetics' && (
        <div className="space-y-3">
          <p className="text-xs text-amber-400 font-mono">{cosGold.toLocaleString()} gold available · earn gold by completing tasks</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {cosmetics.map((c) => (
              <div key={c.id} className={cn('lens-card p-3 flex flex-col', c.equipped && 'border-neon-green/40')}>
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{c.icon}</span>
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded border', RARITY[c.rarity])}>{c.rarity}</span>
                </div>
                <p className="text-sm text-white font-medium mt-1">{c.name}</p>
                <p className="text-[10px] text-gray-500 capitalize">{c.slot} slot</p>
                <div className="mt-2 pt-2 border-t border-lattice-border flex items-center justify-between">
                  <span className="text-xs text-amber-400">{c.cost} gold</span>
                  {!c.owned ? (
                    <button onClick={() => buyCosmetic(c.id)} disabled={busy === `buy-${c.id}` || cosGold < c.cost} className={cn('btn-neon text-xs py-1 px-3', cosGold < c.cost && 'opacity-40 cursor-not-allowed')}>
                      {busy === `buy-${c.id}` ? '…' : 'Buy'}
                    </button>
                  ) : c.equipped ? (
                    <button onClick={() => equipCosmetic(c.id, true)} disabled={busy === `equip-${c.id}`} className="text-xs text-neon-green border border-neon-green/40 rounded px-2 py-1">Equipped</button>
                  ) : (
                    <button onClick={() => equipCosmetic(c.id, false)} disabled={busy === `equip-${c.id}`} className="text-xs text-neon-cyan border border-neon-cyan/40 rounded px-2 py-1">Equip</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== REWARDS ===================== */}
      {tab === 'rewards' && (
        <div className="space-y-3">
          <p className="text-xs text-amber-400 font-mono">{rewardGold.toLocaleString()} gold available</p>
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <label className="text-[10px] text-gray-400 block mb-1">Reward title</label>
              <input value={newReward.title} onChange={(e) => setNewReward((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. Movie night" className="input-lattice w-full text-sm" />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-[10px] text-gray-400 block mb-1">Notes</label>
              <input value={newReward.notes} onChange={(e) => setNewReward((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional" className="input-lattice w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">Gold cost</label>
              <input type="number" min={1} value={newReward.cost} onChange={(e) => setNewReward((p) => ({ ...p, cost: Number(e.target.value) }))} className="input-lattice w-24 text-sm" />
            </div>
            <button onClick={createReward} disabled={busy === 'create-reward'} className="btn-neon text-sm py-2 px-4 flex items-center gap-1">
              {busy === 'create-reward' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Reward
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rewards.length === 0 && <p className="text-xs text-gray-600 italic">No custom rewards yet. Define a reward to redeem with earned gold.</p>}
            {rewards.map((r) => (
              <div key={r.id} className="lens-card p-3 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium truncate">{r.title}</p>
                    {r.notes && <p className="text-[11px] text-gray-500 truncate">{r.notes}</p>}
                    <p className="text-[10px] text-gray-500 mt-1">redeemed {r.redemptions}×</p>
                  </div>
                  <button onClick={() => deleteReward(r.id)} disabled={busy === `del-reward-${r.id}`} className="text-gray-600 hover:text-red-400" aria-label="Delete reward"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="mt-2 pt-2 border-t border-lattice-border flex items-center justify-between">
                  <span className="text-xs text-amber-400">{r.cost} gold</span>
                  <button onClick={() => redeemReward(r.id)} disabled={busy === `redeem-${r.id}` || rewardGold < r.cost} className={cn('btn-neon text-xs py-1 px-3', rewardGold < r.cost && 'opacity-40 cursor-not-allowed')}>
                    {busy === `redeem-${r.id}` ? '…' : 'Redeem'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== REMINDERS ===================== */}
      {tab === 'reminders' && (
        <div className="space-y-3">
          <div className="lens-card p-3 space-y-2">
            <div className="flex gap-2 flex-wrap items-end">
              <div className="flex-1 min-w-[160px]">
                <label className="text-[10px] text-gray-400 block mb-1">Reminder title</label>
                <input value={newReminder.title} onChange={(e) => setNewReminder((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. Evening review" className="input-lattice w-full text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 block mb-1">Time</label>
                <input type="time" value={newReminder.time} onChange={(e) => setNewReminder((p) => ({ ...p, time: e.target.value }))} className="input-lattice text-sm" />
              </div>
              <button onClick={createReminder} disabled={busy === 'create-reminder'} className="btn-neon text-sm py-2 px-4 flex items-center gap-1">
                {busy === 'create-reminder' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Schedule
              </button>
            </div>
            <div className="flex gap-1 flex-wrap">
              {WEEKDAYS.map((d) => (
                <button
                  key={d}
                  onClick={() => setNewReminder((p) => ({ ...p, days: p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d] }))}
                  className={cn('text-[10px] uppercase px-2 py-1 rounded', newReminder.days.includes(d) ? 'bg-neon-purple/25 text-neon-purple' : 'bg-lattice-bg text-gray-500')}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {reminders.length === 0 && <p className="text-xs text-gray-600 italic">No reminders scheduled.</p>}
            {reminders.map((r) => (
              <div key={r.id} className="lens-card p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm text-white flex items-center gap-2">
                    {r.title}
                    {r.overdueToday && <span className="text-[10px] text-red-400 border border-red-500/40 rounded px-1.5">overdue</span>}
                    {!r.overdueToday && r.upcomingToday && <span className="text-[10px] text-neon-cyan border border-neon-cyan/40 rounded px-1.5">today</span>}
                  </p>
                  <p className="text-[10px] text-gray-500 font-mono">{r.time} · {r.days.join(' ')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleReminder(r.id)} disabled={busy === `toggle-${r.id}`} className={cn('text-xs rounded px-2 py-1 border', r.enabled ? 'text-neon-green border-neon-green/40' : 'text-gray-500 border-gray-600')}>
                    {r.enabled ? 'On' : 'Off'}
                  </button>
                  <button onClick={() => deleteReminder(r.id)} disabled={busy === `del-rem-${r.id}`} className="text-gray-600 hover:text-red-400" aria-label="Delete reminder"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== CHALLENGES ===================== */}
      {tab === 'challenges' && (
        <div className="space-y-3">
          <div className="lens-card p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-300">Create a Cross-User Challenge</p>
            <div className="flex gap-2 flex-wrap">
              <input value={newChal.title} onChange={(e) => setNewChal((p) => ({ ...p, title: e.target.value }))} placeholder="Challenge title" className="input-lattice flex-1 min-w-[140px] text-sm" />
              <input value={newChal.description} onChange={(e) => setNewChal((p) => ({ ...p, description: e.target.value }))} placeholder="Description" className="input-lattice flex-1 min-w-[140px] text-sm" />
            </div>
            <div className="flex gap-2 flex-wrap items-end">
              <div>
                <label className="text-[10px] text-gray-400 block mb-1">Metric</label>
                <select value={newChal.metric} onChange={(e) => setNewChal((p) => ({ ...p, metric: e.target.value }))} className="input-lattice text-sm">
                  <option value="tasks">Tasks</option>
                  <option value="xp">XP</option>
                  <option value="streak">Streak</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-400 block mb-1">Goal</label>
                <input type="number" min={1} value={newChal.goal} onChange={(e) => setNewChal((p) => ({ ...p, goal: Number(e.target.value) }))} className="input-lattice w-20 text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 block mb-1">Prize XP</label>
                <input type="number" min={0} value={newChal.prize} onChange={(e) => setNewChal((p) => ({ ...p, prize: Number(e.target.value) }))} className="input-lattice w-20 text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 block mb-1">Days</label>
                <input type="number" min={1} value={newChal.days} onChange={(e) => setNewChal((p) => ({ ...p, days: Number(e.target.value) }))} className="input-lattice w-16 text-sm" />
              </div>
              <button onClick={createChallenge} disabled={busy === 'create-chal'} className="btn-neon text-sm py-2 px-4 flex items-center gap-1">
                {busy === 'create-chal' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {challenges.length === 0 && <p className="text-xs text-gray-600 italic">No challenges yet. Create one and invite others.</p>}
            {challenges.map((c) => (
              <div key={c.id} className="lens-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium">{c.title}</p>
                    {c.description && <p className="text-[11px] text-gray-500">{c.description}</p>}
                    <p className="text-[10px] text-gray-500 mt-1">
                      metric: {c.metric} · goal {c.goal} · {c.participantCount} player(s) · prize {c.prize} XP
                      {c.winnerId && ` · winner: ${c.winnerId}`}
                      {c.expired && ' · ended'}
                    </p>
                  </div>
                  <Swords className="w-4 h-4 text-neon-pink shrink-0" />
                </div>
                <div className="flex gap-1.5 mt-2">
                  <button onClick={() => joinChallenge(c.id)} disabled={busy === `join-chal-${c.id}`} className="btn-neon text-[11px] py-1 px-3">Join</button>
                  <button onClick={() => progressChallenge(c.id)} disabled={busy === `prog-chal-${c.id}` || c.expired || !!c.winnerId} className="text-[11px] py-1 px-3 rounded border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10 disabled:opacity-40">+1 Progress</button>
                  <button onClick={() => viewBoard(c.id)} className="text-[11px] py-1 px-3 rounded border border-gray-600 text-gray-300 hover:text-white flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" /> Leaderboard
                  </button>
                </div>
                {openBoard?.id === c.id && (
                  <div className="mt-2 bg-lattice-bg rounded p-2 space-y-1">
                    {openBoard.rows.length === 0 && <p className="text-[11px] text-gray-600">No participants yet.</p>}
                    {openBoard.rows.map((row) => (
                      <div key={row.userId} className={cn('flex items-center justify-between text-[11px]', row.isCurrentUser && 'text-neon-cyan')}>
                        <span className="flex items-center gap-1">
                          {row.rank === 1 ? <Crown className="w-3 h-3 text-neon-yellow" /> : `#${row.rank}`}
                          {row.userId}{row.isCurrentUser && ' (you)'}
                          {openBoard.winnerId === row.userId && <Trophy className="w-3 h-3 text-neon-green" />}
                        </span>
                        <span className="font-mono">{row.score}/{openBoard.goal} ({row.progressPct}%)</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
