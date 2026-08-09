'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { ProductivityFeed } from '@/components/goals/ProductivityFeed';
import { OKRWorkspace } from '@/components/goals/OKRWorkspace';
import { GoalsAnalyticsTools } from '@/components/goals/GoalsAnalyticsTools';
import { AgentAutonomyPanel } from '@/components/goals/AgentAutonomyPanel';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useMutation } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Target,
  Plus,
  CheckCircle2,
  Clock,
  Sparkles,
  Flame,
  Trophy,
  Star,
  Unlock,
  Zap,
  Flag,
  Users,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Award,
  TrendingUp,
  Swords,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

// --------------- Types ---------------

interface SubTask {
  id: string;
  label: string;
  done: boolean;
}

interface Goal {
  id: string;
  title: string;
  description: string;
  category: 'Career' | 'Health' | 'Learning' | 'Creative' | 'Financial' | 'Personal';
  progress: number;
  priority: 'low' | 'medium' | 'high';
  targetDate: string;
  subtasks: SubTask[];
  xp: number;
  milestones: number[];
  status: 'active' | 'completed';
  /** Client-side convenience only — copied from the artifact's updatedAt so
   * the derived Milestones timeline can order/date completions. Not part of
   * the persisted `data` shape. */
  completedAt?: string;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  type: 'daily' | 'weekly' | 'community';
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Legendary';
  xp: number;
  progress: number;
  target: number;
  deadline?: string;
  accepted: boolean;
}

// --------------- Seed Data (empty — populated from backend) ---------------

const GOALS_FALLBACK: Goal[] = [];

const CHALLENGES_FALLBACK: Challenge[] = [];

// --------------- Style Mappings ---------------

const categoryColors: Record<string, string> = {
  Career: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  Health: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  Learning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  Creative: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  Financial: 'bg-green-500/20 text-green-400 border-green-500/30',
  Personal: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
};

const categoryDotColors: Record<string, string> = {
  Career: 'bg-purple-400',
  Health: 'bg-blue-400',
  Learning: 'bg-yellow-400',
  Creative: 'bg-pink-400',
  Financial: 'bg-green-400',
  Personal: 'bg-cyan-400',
};

const difficultyColors: Record<string, string> = {
  Easy: 'bg-green-500/20 text-green-400',
  Medium: 'bg-yellow-500/20 text-yellow-400',
  Hard: 'bg-orange-500/20 text-orange-400',
  Legendary: 'bg-red-500/20 text-red-400',
};

const priorityFlame: Record<string, string> = {
  low: 'text-gray-400',
  medium: 'text-yellow-400',
  high: 'text-red-400',
};

// --------------- Helpers ---------------

function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

function getLevel(xp: number): { label: string; color: string; next: number } {
  if (xp >= 5000) return { label: 'Legend', color: 'text-red-400', next: 10000 };
  if (xp >= 3000) return { label: 'Pro', color: 'text-purple-400', next: 5000 };
  if (xp >= 1000) return { label: 'Rising', color: 'text-cyan-400', next: 3000 };
  return { label: 'Beginner', color: 'text-gray-400', next: 1000 };
}

function getLevelFloor(xp: number): number {
  if (xp >= 5000) return 5000;
  if (xp >= 3000) return 3000;
  if (xp >= 1000) return 1000;
  return 0;
}

// --------------- Sub-Components ---------------

function ProgressRing({ radius, stroke, progress, color = '#22d3ee', size }: { radius: number; stroke: number; progress: number; color?: string; size: number }) {
  const nr = radius - stroke / 2;
  const circ = 2 * Math.PI * nr;
  const offset = circ - Math.min(progress, 1) * circ;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={nr} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-white/10" />
      <motion.circle cx={size / 2} cy={size / 2} r={nr} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circ} initial={{ strokeDashoffset: circ }} animate={{ strokeDashoffset: offset }} transition={{ duration: 1, ease: 'easeOut' }} />
    </svg>
  );
}

function XpLevelBar({ xp }: { xp: number }) {
  const lvl = getLevel(xp);
  const floor = getLevelFloor(xp);
  const pct = (xp - floor) / (lvl.next - floor);
  return (
    <div className="w-full space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className={`font-semibold ${lvl.color}`}>{lvl.label}</span>
        <span className="text-gray-400">{xp.toLocaleString()} / {lvl.next.toLocaleString()} XP</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <motion.div className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500" initial={{ width: 0 }} animate={{ width: `${Math.min(pct * 100, 100)}%` }} transition={{ duration: 1.2, ease: 'easeOut' }} />
      </div>
    </div>
  );
}

function WeeklyActivityBar({ goals }: { goals: Goal[] }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  // Derive activity from completed goals by day of week
  const activity = days.map((_, dayIdx) => {
    return goals.filter(g => {
      if (g.status !== 'completed' || !g.targetDate) return false;
      const d = new Date(g.targetDate);
      return ((d.getDay() + 6) % 7) === dayIdx; // Monday=0
    }).length;
  });
  const max = Math.max(...activity, 1);
  return (
    <div className="flex items-end gap-1.5 h-10">
      {days.map((day, i) => (
        <div key={day} className="flex flex-col items-center gap-0.5 flex-1">
          <motion.div className="w-full rounded-sm bg-gradient-to-t from-cyan-600 to-cyan-400" initial={{ height: 0 }} animate={{ height: `${(activity[i] / max) * 100}%` }} transition={{ duration: 0.6, delay: i * 0.05 }} title={`${activity[i]} goals`} />
          <span className="text-[8px] text-gray-400">{day}</span>
        </div>
      ))}
    </div>
  );
}

function resolveIcon(iconName: string) {
  const iconMap: Record<string, typeof Zap> = {
    zap: Zap,
    music: Flag,
    sparkles: Sparkles,
    users: Users,
    star: Star,
    award: Award,
    trophy: Trophy,
    target: Target,
    trending: TrendingUp,
    flame: Flame,
    book: Sparkles,
    settings: Zap,
  };
  return iconMap[iconName] || Sparkles;
}

// --------------- Main Component ---------------

export default function GoalsLensPage() {
  useLensNav('goals');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('goals');

  const [activeTab, setActiveTab] = useState<'goals' | 'challenges' | 'milestones'>('goals');
  const [showAnalyticsTools, setShowAnalyticsTools] = useState(false);
  const [showOKRWorkspace, setShowOKRWorkspace] = useState(false);
  const [showAgentAutonomy, setShowAgentAutonomy] = useState(false);
  const [showProductivityFeed, setShowProductivityFeed] = useState(false);

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-goals', keys: 'g', description: 'Goals', category: 'navigation', action: () => setActiveTab('goals') },
      { id: 'tab-challenges', keys: 'c', description: 'Challenges', category: 'navigation', action: () => setActiveTab('challenges') },
      { id: 'tab-milestones', keys: 'm', description: 'Milestones', category: 'navigation', action: () => setActiveTab('milestones') },
    ],
    { lensId: 'goals' }
  );
  const [goalFilter, setGoalFilter] = useState('All');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);

  // Create goal form state
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState<Goal['category']>('Career');
  const [newTargetDate, setNewTargetDate] = useState('');
  const [newSubtasks, setNewSubtasks] = useState('');
  const [newXp, setNewXp] = useState(200);
  const [newPriority, setNewPriority] = useState<Goal['priority']>('medium');

  // Create challenge form state
  const [showCreateChallenge, setShowCreateChallenge] = useState(false);
  const [newChallengeTitle, setNewChallengeTitle] = useState('');
  const [newChallengeDesc, setNewChallengeDesc] = useState('');
  const [newChallengeType, setNewChallengeType] = useState<Challenge['type']>('daily');
  const [newChallengeDifficulty, setNewChallengeDifficulty] = useState<Challenge['difficulty']>('Easy');
  const [newChallengeTarget, setNewChallengeTarget] = useState(7);
  const [newChallengeDeadline, setNewChallengeDeadline] = useState('');

  const { isLoading, isError: isError, error: error, refetch: refetch, items: goalItems, create: createGoalItem, update: updateGoalItem } = useLensData<Record<string, unknown>>('goals', 'goal', {
    seed: GOALS_FALLBACK.map(g => ({ title: g.title, data: g as unknown as Record<string, unknown> })),
  });
  const { isError: isError2, error: error2, refetch: refetch2, items: challengeItems, create: createChallengeItem, update: updateChallengeItem } = useLensData<Record<string, unknown>>('goals', 'challenge', {
    seed: CHALLENGES_FALLBACK.map(c => ({ title: c.title, data: c as unknown as Record<string, unknown> })),
  });

  // Derive state from useLensData items (real backend data)
  const goals = useMemo(
    () => goalItems.map(item => ({ id: item.id, ...item.data, completedAt: item.updatedAt } as unknown as Goal)),
    [goalItems]
  );
  const challenges = useMemo(() => challengeItems.map(item => ({ id: item.id, ...item.data } as unknown as Challenge)), [challengeItems]);

  // Real, honest goal creation: writes straight to the "goal" artifact type
  // the Goals tab actually reads. (Previously this tried apiHelpers.goals
  // .create() first — which silently succeeds by creating a row in
  // Concord's *agent* self-directed goal system instead, so the try/catch
  // fallback to createGoalItem below never ran and every "New Goal" the
  // user made vanished from their own list. See AgentAutonomyPanel for the
  // agent system's own, correctly-labeled propose flow.)
  const createGoalMutation = useMutation({
    mutationFn: async () => {
      await createGoalItem({
        title: newTitle,
        data: {
          title: newTitle, description: newDescription, category: newCategory,
          progress: 0, priority: newPriority, targetDate: newTargetDate,
          subtasks: newSubtasks.split('\n').filter(Boolean).map((s, i) => ({ id: `st-${i}`, label: s, done: false })),
          xp: newXp, milestones: [], status: 'active',
        } as unknown as Record<string, unknown>,
      });
    },
    onSuccess: () => { setShowCreate(false); setNewTitle(''); setNewDescription(''); setNewSubtasks(''); },
    onError: (err) => {
      console.error('Failed to create goal:', err instanceof Error ? err.message : err);
    },
  });

  // Computed stats
  const totalXp = useMemo(
    () => goals.filter((g) => g.status === 'completed').reduce((s, g) => s + g.xp, 0),
    [goals]
  );
  const level = getLevel(totalXp);
  const completedGoals = useMemo(
    () => goals.filter((g) => g.status === 'completed').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')),
    [goals]
  );
  const completedThisMonth = useMemo(() => {
    const now = new Date();
    return completedGoals.filter((g) => {
      if (!g.completedAt) return false;
      const d = new Date(g.completedAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
  }, [completedGoals]);
  const activeGoalCount = goals.filter((g) => g.status === 'active').length;
  const acceptedChallengeCount = challenges.filter((c) => c.accepted).length;

  const overallProgress = useMemo(() => {
    const active = goals.filter((g) => g.status === 'active');
    if (!active.length) return 0;
    return active.reduce((s, g) => s + g.progress, 0) / active.length;
  }, [goals]);

  // Real streak: consecutive calendar days (ending today) with at least one
  // goal completion. Derived purely from completedAt timestamps — no
  // fabricated number, and honestly 0 until a goal is actually completed.
  const streakDays = useMemo(() => {
    const days = new Set(completedGoals.filter((g) => g.completedAt).map((g) => g.completedAt!.slice(0, 10)));
    let streak = 0;
    const cursor = new Date();
    for (;;) {
      const key = cursor.toISOString().slice(0, 10);
      if (!days.has(key)) break;
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }, [completedGoals]);

  // Deterministic badges — a real function of real counts, never a fake
  // unlock date or server-fabricated rarity. Honeycomb of thresholds over
  // completedGoals/challenges/streak, all already-derived above.
  const badges = useMemo(() => {
    const categoriesCompleted = new Set(completedGoals.map((g) => g.category)).size;
    return [
      { id: 'first-steps', title: 'First Steps', description: 'Create your first goal.', icon: 'target', unlocked: goals.length >= 1 },
      { id: 'momentum', title: 'Momentum', description: 'Complete a goal.', icon: 'flame', unlocked: completedGoals.length >= 1 },
      { id: 'high-achiever', title: 'High Achiever', description: 'Complete 5 goals.', icon: 'trophy', unlocked: completedGoals.length >= 5 },
      { id: 'well-rounded', title: 'Well Rounded', description: 'Complete goals in 3+ categories.', icon: 'sparkles', unlocked: categoriesCompleted >= 3 },
      { id: 'on-a-roll', title: 'On a Roll', description: '3-day completion streak.', icon: 'zap', unlocked: streakDays >= 3 },
      { id: 'challenger', title: 'Challenger', description: 'Accept a challenge.', icon: 'award', unlocked: acceptedChallengeCount >= 1 },
    ];
  }, [goals.length, completedGoals, streakDays, acceptedChallengeCount]);

  const filteredGoals = useMemo(() => {
    if (goalFilter === 'All') return goals;
    if (goalFilter === 'Active') return goals.filter((g) => g.status === 'active');
    if (goalFilter === 'Completed') return goals.filter((g) => g.status === 'completed');
    return goals.filter((g) => g.category === goalFilter);
  }, [goals, goalFilter]);

  // Category breakdown for summary
  const categoryBreakdown = useMemo(() => {
    const cats = ['Career', 'Health', 'Learning', 'Creative', 'Financial', 'Personal'] as const;
    return cats.map((cat) => ({
      name: cat,
      count: goals.filter((g) => g.category === cat).length,
      completed: goals.filter((g) => g.category === cat && g.status === 'completed').length,
    }));
  }, [goals]);

  const toggleSubtask = (goalId: string, subtaskId: string) => {
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;
    const updated = (goal.subtasks || []).map((st) =>
      st.id === subtaskId ? { ...st, done: !st.done } : st
    );
    const doneCount = updated.filter((st) => st.done).length;
    const progress = updated.length > 0 ? Math.round((doneCount / updated.length) * 100) / 100 : 0;
    updateGoalItem(goalId, { data: { ...goal, subtasks: updated, progress } as unknown as Record<string, unknown> }).catch((err) => console.error('Failed to update goal subtask:', err instanceof Error ? err.message : err));
  };

  const completeGoalItem = (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;
    updateGoalItem(goalId, { data: { ...goal, status: 'completed', progress: 1 } as unknown as Record<string, unknown> }).catch((err) => console.error('Failed to complete goal:', err instanceof Error ? err.message : err));
  };

  const acceptChallenge = (id: string) => {
    const challenge = challenges.find(c => c.id === id);
    if (challenge) {
      updateChallengeItem(id, { data: { ...challenge, accepted: true } as unknown as Record<string, unknown> }).catch((err) => console.error('Failed to accept challenge:', err instanceof Error ? err.message : err));
    }
  };

  const bumpChallengeProgress = (id: string) => {
    const challenge = challenges.find(c => c.id === id);
    if (challenge) {
      updateChallengeItem(id, { data: { ...challenge, progress: Math.min(challenge.progress + 1, challenge.target) } as unknown as Record<string, unknown> }).catch((err) => console.error('Failed to update challenge progress:', err instanceof Error ? err.message : err));
    }
  };

  const handleCreateGoal = () => {
    createGoalMutation.mutate();
  };

  const handleCreateChallenge = () => {
    if (!newChallengeTitle.trim()) return;
    createChallengeItem({
      title: newChallengeTitle,
      data: {
        title: newChallengeTitle, description: newChallengeDesc, type: newChallengeType,
        difficulty: newChallengeDifficulty, xp: { Easy: 50, Medium: 150, Hard: 300, Legendary: 750 }[newChallengeDifficulty],
        progress: 0, target: newChallengeTarget, deadline: newChallengeDeadline || undefined, accepted: false,
      } as unknown as Record<string, unknown>,
    }).then(() => {
      setShowCreateChallenge(false); setNewChallengeTitle(''); setNewChallengeDesc(''); setNewChallengeDeadline('');
    }).catch((err) => console.error('Failed to create challenge:', err instanceof Error ? err.message : err));
  };

  const tabs = [
    { key: 'goals' as const, label: 'Goals', icon: Target, count: activeGoalCount },
    { key: 'challenges' as const, label: 'Challenges', icon: Swords, count: acceptedChallengeCount },
    { key: 'milestones' as const, label: 'Milestones', icon: TrendingUp, count: completedGoals.length },
  ];

  const filterPills = ['All', 'Active', 'Completed', 'Career', 'Health', 'Learning', 'Creative', 'Financial', 'Personal'];


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />
      </div>
    );
  }
  return (
    <LensShell lensId="goals" asMain={false}>
      <FirstRunTour lensId="goals" />
      <ManifestActionBar />
      <DepthBadge lensId="goals" size="sm" className="ml-2" />
    <div data-lens-theme="goals" className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* ---- Header ---- */}
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
            <Target className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Goals &amp; OKRs</h1>
            <p className="text-sm text-gray-400">Personal goals, team OKRs, and Concord&apos;s own agent goal system</p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="goals" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-orange-500/15 text-orange-400 px-3 py-1.5 rounded-full text-sm font-semibold">
            <Flame className="w-4 h-4" />
            <span>{streakDays} day streak</span>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="btn-neon purple flex items-center gap-1 text-sm"
          >
            <Plus className="w-3.5 h-3.5" /> New Goal
          </button>
        </div>
      </header>


      {/* AI Actions */}
      {/* ---- Hero Stats Bar ---- */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="lens-card flex flex-col items-center justify-center col-span-1 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative">
            <ProgressRing radius={36} stroke={5} progress={overallProgress} size={72} color="#22d3ee" />
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-cyan-400">{Math.round(overallProgress * 100)}%</span>
          </div>
          <p className="text-xs text-gray-400 mt-2">Overall Progress</p>
          {/* Milestone markers */}
          <div className="flex items-center gap-1 mt-1.5">
            {[25, 50, 75, 100].map((m) => (
              <motion.div
                key={m}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: m * 0.005, type: 'spring', stiffness: 300 }}
                className={`w-2 h-2 rounded-full ${Math.round(overallProgress * 100) >= m ? 'bg-cyan-400' : 'bg-white/10'}`}
                title={`${m}% milestone`}
              />
            ))}
          </div>
        </motion.div>
        {[
          { icon: Flame, iconCls: 'text-orange-400', value: streakDays, label: 'Day Streak', delay: 0.05, glow: 'from-orange-500/5' },
          { icon: CheckCircle2, iconCls: 'text-green-400', value: completedThisMonth, label: 'Completed', delay: 0.1, glow: 'from-green-500/5' },
          { icon: Zap, iconCls: 'text-yellow-400', value: totalXp.toLocaleString(), label: 'XP Earned', delay: 0.15, glow: 'from-yellow-500/5' },
        ].map((s) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: s.delay }} className="lens-card flex flex-col items-center justify-center relative overflow-hidden group" whileHover={{ scale: 1.02, y: -2 }}>
            <div className={`absolute inset-0 bg-gradient-to-br ${s.glow} to-transparent opacity-0 group-hover:opacity-100 transition-opacity`} />
            <s.icon className={`w-6 h-6 ${s.iconCls} mb-1`} />
            <motion.p className="text-2xl font-bold text-white" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: s.delay + 0.2 }}>{s.value}</motion.p>
            <p className="text-xs text-gray-400">{s.label}</p>
          </motion.div>
        ))}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="lens-card flex flex-col items-center justify-center relative overflow-hidden" whileHover={{ scale: 1.02 }}>
          <motion.div
            className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent"
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
          <Star className="w-6 h-6 text-purple-400 mb-1" />
          <p className={`text-lg font-bold ${level.color}`}>{level.label}</p>
          <p className="text-xs text-gray-400">Level</p>
        </motion.div>
      </div>

      {/* XP Level Progress + Weekly Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel p-4 space-y-2">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Level Progress</p>
          <XpLevelBar xp={totalXp} />
        </div>
        <div className="panel p-4 space-y-2">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Weekly Activity</p>
          <WeeklyActivityBar goals={goals} />
        </div>
      </div>

      {/* ---- Tab Navigation ---- */}
      <div className="flex gap-1 bg-white/5 p-1 rounded-xl">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === t.key
                ? 'bg-cyan-500/20 text-cyan-400 shadow-sm shadow-cyan-500/10'
                : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
            }`}
          >
            <t.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{t.label}</span>
            <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full">{t.count}</span>
          </button>
        ))}
      </div>

      {/* ---- Create Goal Form ---- */}
      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="panel p-5 space-y-4">
              <h2 className="font-semibold text-white flex items-center gap-2"><Plus className="w-4 h-4 text-purple-400" /> Create New Goal</h2>
              <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Goal title..." className="input-lattice w-full" />
              <DraftedTextarea lensId="goals" draftKey="newDescription" initial="" onValueChange={setNewDescription} placeholder="Describe your goal and what success looks like..." className="input-lattice w-full h-16 resize-none" />
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as Goal['category'])} className="input-lattice">
                  {['Career', 'Health', 'Learning', 'Creative', 'Financial', 'Personal'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={newPriority} onChange={(e) => setNewPriority(e.target.value as Goal['priority'])} className="input-lattice">
                  <option value="low">Low Priority</option>
                  <option value="medium">Medium Priority</option>
                  <option value="high">High Priority</option>
                </select>
                <input type="date" value={newTargetDate} onChange={(e) => setNewTargetDate(e.target.value)} className="input-lattice" />
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                  <input type="number" value={newXp} onChange={(e) => setNewXp(Number(e.target.value))} min={50} max={2000} step={50} className="input-lattice w-full" placeholder="XP" />
                </div>
                <button onClick={handleCreateGoal} disabled={!newTitle || createGoalMutation.isPending} className="btn-neon purple disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-500">{createGoalMutation.isPending ? 'Creating...' : 'Create Goal'}</button>
              </div>
              <DraftedTextarea lensId="goals" draftKey="newSubtasks" initial="" onValueChange={setNewSubtasks} placeholder="Subtasks (one per line)..." className="input-lattice w-full h-16 resize-none text-sm" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ================================================================ */}
      {/* GOALS TAB                                                        */}
      {/* ================================================================ */}
      {activeTab === 'goals' && (
        <div className="space-y-4">
          {/* Category breakdown mini-bar */}
          <div className="flex gap-3 flex-wrap">
            {categoryBreakdown.map((cb) => (
              <div key={cb.name} className="flex items-center gap-1.5 text-xs text-gray-400">
                <span className={`w-2 h-2 rounded-full ${categoryDotColors[cb.name]}`} />
                <span>{cb.name}</span>
                <span className="text-gray-600">
                  {cb.completed}/{cb.count}
                </span>
              </div>
            ))}
          </div>

          {/* Filter pills */}
          <div className="flex flex-wrap gap-2">
            {filterPills.map((f) => (
              <button
                key={f}
                onClick={() => setGoalFilter(f)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  goalFilter === f
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Goal cards */}
          <div className="space-y-3">
            {filteredGoals.map((goal, i) => {
              const isExpanded = expandedGoal === goal.id;
              const dLeft = daysUntil(goal.targetDate);
              const subtasksDone = goal.subtasks.filter((st) => st.done).length;

              return (
                <motion.div
                  key={goal.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="panel p-4 space-y-3"
                >
                  <div className="flex items-start gap-4">
                    {/* Progress ring */}
                    <div className="relative flex-shrink-0">
                      <ProgressRing
                        radius={24}
                        stroke={4}
                        progress={goal.progress}
                        size={48}
                        color={goal.status === 'completed' ? '#4ade80' : '#a78bfa'}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">
                        {Math.round(goal.progress * 100)}%
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-white truncate">{goal.title}</h3>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${categoryColors[goal.category]}`}>
                          {goal.category}
                        </span>
                        <Flame className={`w-3.5 h-3.5 ${priorityFlame[goal.priority]}`} />
                        {goal.status === 'completed' && (
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{goal.description}</p>

                      {/* Progress bar with milestone markers */}
                      <div className="relative mt-2 h-2 bg-white/10 rounded-full overflow-visible">
                        <motion.div
                          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(goal.progress * 100, 100)}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                        {goal.milestones.map((m) => (
                          <div
                            key={m}
                            className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-white/40 bg-gray-800"
                            style={{ left: `${m}%` }}
                            title={`Milestone at ${m}%`}
                          />
                        ))}
                      </div>

                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                        {goal.status === 'active' && (
                          <span className={`flex items-center gap-1 ${dLeft <= 3 ? 'text-red-400' : ''}`}>
                            <Clock className="w-3 h-3" />
                            {dLeft === 0 ? 'Due today' : `${dLeft} day${dLeft !== 1 ? 's' : ''} left`}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-yellow-400">
                          <Zap className="w-3 h-3" />{goal.xp} XP
                        </span>
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {subtasksDone}/{goal.subtasks.length} tasks
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => setExpandedGoal(isExpanded ? null : goal.id)}
                      className="text-gray-400 hover:text-gray-300 p-1 transition-colors"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Expanded subtasks */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-white/5 pt-3 space-y-1.5">
                          {goal.subtasks.map((st) => (
                            <button
                              key={st.id}
                              onClick={() => toggleSubtask(goal.id, st.id)}
                              className="flex items-center gap-2 w-full text-left text-sm group"
                            >
                              <span
                                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                                  st.done
                                    ? 'bg-green-500/30 border-green-500 text-green-400'
                                    : 'border-gray-600 group-hover:border-gray-400'
                                }`}
                              >
                                {st.done && <CheckCircle2 className="w-3 h-3" />}
                              </span>
                              <span className={st.done ? 'text-gray-400 line-through' : 'text-gray-300'}>
                                {st.label}
                              </span>
                            </button>
                          ))}
                          {goal.status === 'active' && (
                            <button
                              onClick={() => completeGoalItem(goal.id)}
                              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/10 py-1.5 text-xs font-medium text-green-400 hover:bg-green-500/20"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> Mark Complete (+{goal.xp} XP)
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}

            {filteredGoals.length === 0 && (
              <div className="panel p-12 text-center text-gray-400">
                <Target className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>No goals match this filter.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* CHALLENGES TAB                                                   */}
      {/* ================================================================ */}
      {activeTab === 'challenges' && (
        <div className="space-y-4">
          {/* Challenge type filter summary */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-yellow-400" /> Daily: {challenges.filter((c) => c.type === 'daily').length}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-400" /> Weekly: {challenges.filter((c) => c.type === 'weekly').length}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-purple-400" /> Community: {challenges.filter((c) => c.type === 'community').length}
              </span>
            </div>
            <button onClick={() => setShowCreateChallenge((v) => !v)} className="btn-neon purple flex items-center gap-1 text-xs">
              <Plus className="w-3.5 h-3.5" /> New Challenge
            </button>
          </div>

          <AnimatePresence>
            {showCreateChallenge && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="panel p-4 space-y-3">
                  <input value={newChallengeTitle} onChange={(e) => setNewChallengeTitle(e.target.value)} placeholder="Challenge title (e.g. 'Meditate every morning')" className="input-lattice w-full" />
                  <input value={newChallengeDesc} onChange={(e) => setNewChallengeDesc(e.target.value)} placeholder="What does success look like?" className="input-lattice w-full" />
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <select value={newChallengeType} onChange={(e) => setNewChallengeType(e.target.value as Challenge['type'])} className="input-lattice">
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="community">Community</option>
                    </select>
                    <select value={newChallengeDifficulty} onChange={(e) => setNewChallengeDifficulty(e.target.value as Challenge['difficulty'])} className="input-lattice">
                      {(['Easy', 'Medium', 'Hard', 'Legendary'] as const).map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <input type="number" min={1} value={newChallengeTarget} onChange={(e) => setNewChallengeTarget(Number(e.target.value))} className="input-lattice" placeholder="Target reps" />
                    <input type="date" value={newChallengeDeadline} onChange={(e) => setNewChallengeDeadline(e.target.value)} className="input-lattice" />
                    <button onClick={handleCreateChallenge} disabled={!newChallengeTitle} className="btn-neon purple disabled:opacity-50">Create</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {challenges.map((ch, i) => (
            <motion.div
              key={ch.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="panel p-5 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${difficultyColors[ch.difficulty]}`}
                    >
                      {ch.difficulty}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-gray-300 capitalize">
                      {ch.type}
                    </span>
                  </div>
                  <h3 className="font-semibold text-white">{ch.title}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{ch.description}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <div className="flex items-center gap-1 text-yellow-400 text-sm font-bold">
                    <Zap className="w-4 h-4" />
                    {ch.xp} XP
                  </div>
                  {ch.deadline && (
                    <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1 justify-end">
                      <Clock className="w-3 h-3" />
                      {daysUntil(ch.deadline) === 0 ? 'Due today' : `${daysUntil(ch.deadline)}d left`}
                    </p>
                  )}
                </div>
              </div>

              {/* Progress */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Progress</span>
                  <span>
                    {ch.progress} / {ch.target}
                  </span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-orange-500 to-yellow-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min((ch.progress / ch.target) * 100, 100)}%` }}
                    transition={{ duration: 0.8 }}
                  />
                </div>
              </div>

              {!ch.accepted ? (
                <button
                  onClick={() => acceptChallenge(ch.id)}
                  className="btn-neon w-full flex items-center justify-center gap-2 text-sm"
                >
                  <Swords className="w-4 h-4" /> Accept Challenge
                </button>
              ) : ch.progress < ch.target ? (
                <button
                  onClick={() => bumpChallengeProgress(ch.id)}
                  className="w-full flex items-center justify-center gap-2 text-sm rounded-lg border border-orange-500/30 bg-orange-500/10 py-1.5 text-orange-400 hover:bg-orange-500/20"
                >
                  <Plus className="w-3.5 h-3.5" /> Log progress
                </button>
              ) : (
                <div className="text-xs text-center text-green-400 flex items-center justify-center gap-1 py-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Challenge Complete
                </div>
              )}
            </motion.div>
          ))}

          {challenges.length === 0 && (
            <div className="panel p-12 text-center text-gray-400">
              <Swords className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>No challenges yet. Create one to start a self-tracked streak.</p>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* MILESTONES TAB — real completed-goal timeline + deterministic     */}
      {/* badges. Previously this tab (and a separate Achievements tab)    */}
      {/* read from two generic-artifact types ("milestone"/"achievement") */}
      {/* that no macro ever populated and that had no creation UI          */}
      {/* anywhere — permanently empty, "0 of 0" forever. Both are replaced */}
      {/* with content derived from real, already-persisted goal data.     */}
      {/* ================================================================ */}
      {activeTab === 'milestones' && (
        <div className="space-y-6">
          {/* Badges — deterministic function of real counts, no fabricated
              unlock dates or server rarity. */}
          <div>
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Badges</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {badges.map((b, i) => {
                const IconComp = resolveIcon(b.icon);
                return (
                  <motion.div
                    key={b.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.05 }}
                    className={`panel p-4 flex flex-col items-center text-center space-y-2 border ${
                      b.unlocked ? 'bg-cyan-500/10 border-cyan-500/20' : 'opacity-40 grayscale border-transparent'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${b.unlocked ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700/50 text-gray-600'}`}>
                      <IconComp className="w-5 h-5" />
                    </div>
                    <h4 className={`text-sm font-semibold ${b.unlocked ? 'text-white' : 'text-gray-400'}`}>{b.title}</h4>
                    <p className="text-[10px] text-gray-400 leading-tight">{b.description}</p>
                    {b.unlocked && (
                      <span className="text-[10px] text-green-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Unlocked
                      </span>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Completed-goal timeline */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Completed goals</h3>
              <div className="flex items-center gap-1 text-xs text-yellow-400">
                <Zap className="w-3 h-3" /> {totalXp.toLocaleString()} XP earned
              </div>
            </div>
            <div className="relative pl-8">
              <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-gradient-to-b from-cyan-500/50 via-purple-500/50 to-transparent" />
              <div className="space-y-4">
                {completedGoals.map((g, i) => (
                  <motion.div key={g.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="relative">
                    <div className="absolute -left-8 top-3 w-6 h-6 rounded-full flex items-center justify-center border-2 bg-cyan-500/20 border-cyan-500 text-cyan-400">
                      <Unlock className="w-3 h-3" />
                    </div>
                    <div className="panel p-4 border-white/10">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-cyan-500/15">
                          <CheckCircle2 className="w-5 h-5 text-cyan-400" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-white">{g.title}</h3>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${categoryColors[g.category]}`}>{g.category}</span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {g.completedAt && (
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                              <Calendar className="w-3 h-3" /> {new Date(g.completedAt).toLocaleDateString()}
                            </span>
                          )}
                          <span className="text-[10px] text-yellow-400 flex items-center gap-0.5">
                            <Zap className="w-2.5 h-2.5" /> +{g.xp} XP
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
                {completedGoals.length === 0 && (
                  <p className="text-sm text-gray-400 pl-1">No goals completed yet — mark one complete from the Goals tab to start your timeline.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Real-time Data Panel — was previously nested inside the (removed)
          Achievements tab conditional and so only ever rendered on that one
          tab; now always visible regardless of active tab. */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="goals"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowAnalyticsTools(v => !v)}
          className="flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-white"
        >
          {showAnalyticsTools ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Analytics Tools (OKR scoring / decomposition / forecast)
        </button>
        {showAnalyticsTools && (
          <div className="mt-3">
            <GoalsAnalyticsTools />
          </div>
        )}
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowOKRWorkspace(v => !v)}
          className="flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-white"
        >
          {showOKRWorkspace ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          OKR Workspace
        </button>
        {showOKRWorkspace && (
          <section className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <OKRWorkspace />
          </section>
        )}
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowAgentAutonomy(v => !v)}
          className="flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-white"
        >
          {showAgentAutonomy ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Agent Autonomy (Concord's self-directed goals)
        </button>
        {showAgentAutonomy && (
          <div className="mt-3">
            <AgentAutonomyPanel />
          </div>
        )}
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowProductivityFeed(v => !v)}
          className="flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-white"
        >
          {showProductivityFeed ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Productivity Discussion (external reference)
        </button>
        {showProductivityFeed && (
          <section className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <ProductivityFeed />
          </section>
        )}
      </div>
    </div>
          <RecentMineCard domain="goals" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="goals" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="goals" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
