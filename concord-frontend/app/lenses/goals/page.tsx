'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { ProductivityFeed } from '@/components/goals/ProductivityFeed';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { apiHelpers } from '@/lib/api/client';
import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Target,
  Plus,
  CheckCircle2,
  Clock,
  Sparkles,
  Flame,
  Trophy,
  Star,
  Lock,
  Unlock,
  Zap,
  Flag,
  Users,
  Calendar,
  ChevronDown,
  ChevronUp,
  Award,
  TrendingUp,
  Swords,
  Loader2,
  BarChart3,
  GitBranch,
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
  category: 'Production' | 'Mixing' | 'Release' | 'Learning' | 'Collaboration';
  progress: number;
  priority: 'low' | 'medium' | 'high';
  targetDate: string;
  subtasks: SubTask[];
  xp: number;
  milestones: number[];
  status: 'active' | 'completed';
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
  participants?: number;
  endsIn: string;
  accepted: boolean;
}

interface Milestone {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
  date?: string;
  icon: string;
  xpReward: number;
}

interface Achievement {
  id: string;
  name: string;
  description: string;
  category: 'Production' | 'Social' | 'Sales' | 'Learning';
  unlocked: boolean;
  icon: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

// --------------- Seed Data (empty — populated from backend) ---------------

const GOALS_FALLBACK: Goal[] = [];

const CHALLENGES_FALLBACK: Challenge[] = [];

const MILESTONES_FALLBACK: Milestone[] = [];

const ACHIEVEMENTS_FALLBACK: Achievement[] = [];

// --------------- Style Mappings ---------------

const categoryColors: Record<string, string> = {
  Production: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  Mixing: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  Release: 'bg-green-500/20 text-green-400 border-green-500/30',
  Learning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  Collaboration: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
};

const categoryDotColors: Record<string, string> = {
  Production: 'bg-purple-400',
  Mixing: 'bg-blue-400',
  Release: 'bg-green-400',
  Learning: 'bg-yellow-400',
  Collaboration: 'bg-pink-400',
};

const difficultyColors: Record<string, string> = {
  Easy: 'bg-green-500/20 text-green-400',
  Medium: 'bg-yellow-500/20 text-yellow-400',
  Hard: 'bg-orange-500/20 text-orange-400',
  Legendary: 'bg-red-500/20 text-red-400',
};

const rarityColors: Record<string, string> = {
  common: 'text-gray-400',
  rare: 'text-blue-400',
  epic: 'text-purple-400',
  legendary: 'text-yellow-400',
};

const rarityBgColors: Record<string, string> = {
  common: 'bg-gray-500/10 border-gray-500/20',
  rare: 'bg-blue-500/10 border-blue-500/20',
  epic: 'bg-purple-500/10 border-purple-500/20',
  legendary: 'bg-yellow-500/10 border-yellow-500/20',
};

const priorityFlame: Record<string, string> = {
  low: 'text-gray-500',
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
        <span className="text-gray-500">{xp.toLocaleString()} / {lvl.next.toLocaleString()} XP</span>
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
          <span className="text-[8px] text-gray-500">{day}</span>
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

  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'goals' | 'challenges' | 'milestones' | 'achievements'>('goals');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-goals', keys: 'g', description: 'Goals', category: 'navigation', action: () => setActiveTab('goals') },
      { id: 'tab-challenges', keys: 'c', description: 'Challenges', category: 'navigation', action: () => setActiveTab('challenges') },
      { id: 'tab-milestones', keys: 'm', description: 'Milestones', category: 'navigation', action: () => setActiveTab('milestones') },
      { id: 'tab-achievements', keys: 'a', description: 'Achievements', category: 'navigation', action: () => setActiveTab('achievements') },
    ],
    { lensId: 'goals' }
  );
  const [goalFilter, setGoalFilter] = useState('All');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);

  // Create goal form state
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState<Goal['category']>('Production');
  const [newTargetDate, setNewTargetDate] = useState('');
  const [newSubtasks, setNewSubtasks] = useState('');
  const [newXp, setNewXp] = useState(200);
  const [newPriority, setNewPriority] = useState<Goal['priority']>('medium');

  const { isLoading, isError: isError, error: error, refetch: refetch, items: goalItems, create: createGoalItem, update: updateGoalItem } = useLensData<Record<string, unknown>>('goals', 'goal', {
    seed: GOALS_FALLBACK.map(g => ({ title: g.title, data: g as unknown as Record<string, unknown> })),
  });
  const { isError: isError2, error: error2, refetch: refetch2, items: challengeItems, update: updateChallengeItem } = useLensData<Record<string, unknown>>('goals', 'challenge', {
    seed: CHALLENGES_FALLBACK.map(c => ({ title: c.title, data: c as unknown as Record<string, unknown> })),
  });
  const { isError: isError3, error: error3, refetch: refetch3, items: milestoneItems } = useLensData<Record<string, unknown>>('goals', 'milestone', {
    seed: MILESTONES_FALLBACK.map(m => ({ title: m.title, data: m as unknown as Record<string, unknown> })),
  });
  const { isError: isError4, error: error4, refetch: refetch4, items: achievementItems } = useLensData<Record<string, unknown>>('goals', 'achievement', {
    seed: ACHIEVEMENTS_FALLBACK.map(a => ({ title: a.name, data: a as unknown as Record<string, unknown> })),
  });

  // Derive state from useLensData items (real backend data)
  const goals = useMemo(() => goalItems.map(item => ({ id: item.id, ...item.data } as unknown as Goal)), [goalItems]);
  const challenges = useMemo(() => challengeItems.map(item => ({ id: item.id, ...item.data } as unknown as Challenge)), [challengeItems]);
  const milestones = useMemo(() => milestoneItems.map(item => ({ id: item.id, ...item.data } as unknown as Milestone)), [milestoneItems]);
  const achievements = useMemo(() => achievementItems.map(item => ({ id: item.id, ...item.data } as unknown as Achievement)), [achievementItems]);

  // API integration
  const createGoalMutation = useMutation({
    mutationFn: async () => {
      // Try backend first, fallback to lens data
      try {
        await apiHelpers.goals.create({ title: newTitle, description: newDescription, priority: newPriority });
        queryClient.invalidateQueries({ queryKey: ['goals'] });
      } catch (e) {
        console.warn('Goals backend unavailable, using lens data fallback:', e);
        await createGoalItem({
          title: newTitle,
          data: {
            title: newTitle, description: newDescription, category: newCategory,
            progress: 0, priority: newPriority, targetDate: newTargetDate,
            subtasks: newSubtasks.split('\n').filter(Boolean).map((s, i) => ({ id: `st-${i}`, label: s, done: false })),
            xp: newXp, milestones: [], status: 'active',
          } as unknown as Record<string, unknown>,
        });
      }
    },
    onSuccess: () => { setShowCreate(false); setNewTitle(''); setNewDescription(''); setNewSubtasks(''); },
    onError: (err) => {
      console.error('Failed to create goal:', err instanceof Error ? err.message : err);
    },
  });

  const autoPropose = useMutation({
    mutationFn: async () => {
      try { await apiHelpers.goals.autoPropose(); } catch (e) { console.warn('Goals auto-propose not available:', e); }
      queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
    onError: (err) => {
      console.error('Auto-propose failed:', err instanceof Error ? err.message : err);
    },
  });

  // Computed stats
  const totalXp = useMemo(
    () => goals.filter((g) => g.status === 'completed').reduce((s, g) => s + g.xp, 0),
    [goals]
  );
  const level = getLevel(totalXp);
  const completedThisMonth = goals.filter((g) => g.status === 'completed').length;
  const activeGoalCount = goals.filter((g) => g.status === 'active').length;
  const acceptedChallengeCount = challenges.filter((c) => c.accepted).length;
  const unlockedAchievementCount = achievements.filter((a) => a.unlocked).length;

  const overallProgress = useMemo(() => {
    const active = goals.filter((g) => g.status === 'active');
    if (!active.length) return 0;
    return active.reduce((s, g) => s + g.progress, 0) / active.length;
  }, [goals]);

  const streakDays = 0;

  const filteredGoals = useMemo(() => {
    if (goalFilter === 'All') return goals;
    if (goalFilter === 'Active') return goals.filter((g) => g.status === 'active');
    if (goalFilter === 'Completed') return goals.filter((g) => g.status === 'completed');
    if (goalFilter === 'Creative') return goals.filter((g) => g.category === 'Production' || g.category === 'Mixing');
    if (goalFilter === 'Technical') return goals.filter((g) => g.category === 'Learning');
    if (goalFilter === 'Release') return goals.filter((g) => g.category === 'Release');
    return goals;
  }, [goals, goalFilter]);

  // Category breakdown for summary
  const categoryBreakdown = useMemo(() => {
    const cats = ['Production', 'Mixing', 'Release', 'Learning', 'Collaboration'] as const;
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

  const acceptChallenge = (id: string) => {
    const challenge = challenges.find(c => c.id === id);
    if (challenge) {
      updateChallengeItem(id, { data: { ...challenge, accepted: true } as unknown as Record<string, unknown> }).catch((err) => console.error('Failed to accept challenge:', err instanceof Error ? err.message : err));
    }
  };

  const handleCreateGoal = () => {
    createGoalMutation.mutate();
  };

  // --- Action wiring ---
  const runAction = useRunArtifact('goals');
  const [goalsActionResult, setGoalsActionResult] = useState<{ action: string; data: unknown } | null>(null);
  const handleGoalsAction = useCallback((action: string) => {
    const artifactId = goalItems[0]?.id;
    if (!artifactId) return;
    runAction.mutate(
      { id: artifactId, action, params: {} },
      {
        onSuccess: (res) => setGoalsActionResult({ action, data: res.result }),
        onError: (e) => {
          console.error(`Action failed:`, e);
          setGoalsActionResult({ action, data: { error: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` } });
        },
      }
    );
  }, [goalItems, runAction]);

  const tabs = [
    { key: 'goals' as const, label: 'Goals', icon: Target, count: activeGoalCount },
    { key: 'challenges' as const, label: 'Challenges', icon: Swords, count: acceptedChallengeCount },
    { key: 'milestones' as const, label: 'Milestones', icon: TrendingUp, count: milestones.filter((m) => m.unlocked).length },
    { key: 'achievements' as const, label: 'Achievements', icon: Award, count: unlockedAchievementCount },
  ];

  const filterPills = ['All', 'Active', 'Completed', 'Creative', 'Technical', 'Release'];


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

  if (isError || isError2 || isError3 || isError4) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message || error3?.message || error4?.message} onRetry={() => { refetch(); refetch2(); refetch3(); refetch4(); }} />
      </div>
    );
  }
  return (
    <LensShell lensId="goals" asMain={false}>
      <ManifestActionBar />
    <div data-lens-theme="goals" className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* ---- Header ---- */}
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
            <Target className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Creative Goals</h1>
            <p className="text-sm text-gray-400">Track your creative journey and level up</p>
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
            onClick={() => autoPropose.mutate()}
            disabled={autoPropose.isPending}
            className="btn-neon flex items-center gap-1 text-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {autoPropose.isPending ? 'Proposing...' : 'Auto-Propose'}
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="btn-neon purple flex items-center gap-1 text-sm"
          >
            <Plus className="w-3.5 h-3.5" /> New Goal
          </button>
        </div>
      </header>


      {/* AI Actions */}
      <UniversalActions domain="goals" artifactId={goalItems[0]?.id} compact />
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
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Level Progress</p>
          <XpLevelBar xp={totalXp} />
        </div>
        <div className="panel p-4 space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Weekly Activity</p>
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
              <textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Describe your goal and what success looks like..." className="input-lattice w-full h-16 resize-none" />
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as Goal['category'])} className="input-lattice">
                  {['Production', 'Mixing', 'Release', 'Learning', 'Collaboration'].map((c) => <option key={c} value={c}>{c}</option>)}
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
              <textarea value={newSubtasks} onChange={(e) => setNewSubtasks(e.target.value)} placeholder="Subtasks (one per line)..." className="input-lattice w-full h-16 resize-none text-sm" />
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
                      className="text-gray-500 hover:text-gray-300 p-1 transition-colors"
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
                              <span className={st.done ? 'text-gray-500 line-through' : 'text-gray-300'}>
                                {st.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}

            {filteredGoals.length === 0 && (
              <div className="panel p-12 text-center text-gray-500">
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
                    {ch.participants && (
                      <span className="text-[10px] flex items-center gap-1 text-gray-400">
                        <Users className="w-3 h-3" />
                        {ch.participants} joined
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-white">{ch.title}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{ch.description}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <div className="flex items-center gap-1 text-yellow-400 text-sm font-bold">
                    <Zap className="w-4 h-4" />
                    {ch.xp} XP
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1 flex items-center gap-1 justify-end">
                    <Clock className="w-3 h-3" />
                    {ch.endsIn}
                  </p>
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
              ) : (
                <div className="text-xs text-center text-green-400 flex items-center justify-center gap-1 py-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Challenge Accepted
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* ================================================================ */}
      {/* MILESTONES TAB                                                   */}
      {/* ================================================================ */}
      {activeTab === 'milestones' && (
        <div className="space-y-4">
          {/* Milestone summary */}
          <div className="panel p-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Trophy className="w-4 h-4 text-yellow-400" />
              <span>
                {milestones.filter((m) => m.unlocked).length} of {milestones.length} milestones unlocked
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-yellow-400">
              <Zap className="w-3 h-3" />
              {milestones.filter((m) => m.unlocked).reduce((s, m) => s + m.xpReward, 0)} XP earned
            </div>
          </div>

          <div className="relative pl-8">
            {/* Vertical timeline line */}
            <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-gradient-to-b from-cyan-500/50 via-purple-500/50 to-transparent" />

            <div className="space-y-6">
              {milestones.map((ms, i) => {
                const IconComp = resolveIcon(ms.icon);

                return (
                  <motion.div
                    key={ms.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.08 }}
                    className="relative"
                  >
                    {/* Node on timeline */}
                    <div
                      className={`absolute -left-8 top-3 w-6 h-6 rounded-full flex items-center justify-center border-2 ${
                        ms.unlocked
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400'
                          : 'bg-gray-800 border-gray-600 text-gray-600'
                      }`}
                    >
                      {ms.unlocked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    </div>

                    <div className={`panel p-4 ${ms.unlocked ? 'border-white/10' : 'opacity-50'}`}>
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                            ms.unlocked ? 'bg-cyan-500/15' : 'bg-gray-700/30'
                          }`}
                        >
                          <IconComp className={`w-5 h-5 ${ms.unlocked ? 'text-cyan-400' : 'text-gray-600'}`} />
                        </div>
                        <div className="flex-1">
                          <h3 className={`font-semibold ${ms.unlocked ? 'text-white' : 'text-gray-500'}`}>
                            {ms.title}
                          </h3>
                          <p className="text-xs text-gray-400">{ms.description}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {ms.date && (
                            <span className="text-xs text-gray-500 flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {ms.date}
                            </span>
                          )}
                          <span className="text-[10px] text-yellow-400 flex items-center gap-0.5">
                            <Zap className="w-2.5 h-2.5" />
                            +{ms.xpReward} XP
                          </span>
                          {!ms.unlocked && <Lock className="w-4 h-4 text-gray-600" />}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* ACHIEVEMENTS TAB                                                 */}
      {/* ================================================================ */}
      {activeTab === 'achievements' && (
        <div className="space-y-6">
          {/* Achievement summary */}
          <div className="panel p-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Award className="w-4 h-4 text-purple-400" />
              <span>
                {achievements.filter((a) => a.unlocked).length} of {achievements.length} achievements unlocked
              </span>
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <span className={rarityColors.common}>Common</span>
              <span className={rarityColors.rare}>Rare</span>
              <span className={rarityColors.epic}>Epic</span>
              <span className={rarityColors.legendary}>Legendary</span>
            </div>
          </div>

          {(['Production', 'Social', 'Sales', 'Learning'] as const).map((cat) => {
            const catAchievements = achievements.filter((a) => a.category === cat);

            return (
              <div key={cat}>
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  {cat}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {catAchievements.map((ach, i) => {
                    const IconComp = resolveIcon(ach.icon);

                    return (
                      <motion.div
                        key={ach.id}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.05 }}
                        className={`panel p-4 flex flex-col items-center text-center space-y-2 border ${
                          ach.unlocked ? rarityBgColors[ach.rarity] : 'opacity-40 grayscale border-transparent'
                        }`}
                      >
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            ach.unlocked ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700/50 text-gray-600'
                          }`}
                        >
                          <IconComp className="w-5 h-5" />
                        </div>
                        <h4
                          className={`text-sm font-semibold ${
                            ach.unlocked ? 'text-white' : 'text-gray-500'
                          }`}
                        >
                          {ach.name}
                        </h4>
                        <p className="text-[10px] text-gray-400 leading-tight">{ach.description}</p>
                        <span className={`text-[9px] uppercase font-semibold tracking-wider ${rarityColors[ach.rarity]}`}>
                          {ach.rarity}
                        </span>
                        {ach.unlocked && (
                          <span className="text-[10px] text-green-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Unlocked
                          </span>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            );
          })}

      {/* Real-time Data Panel */}
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
        </div>
      )}

      {/* ---- Goals Domain Actions Panel ---- */}
      <div className="panel p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-neon-cyan" /> Goals Analytics Actions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { action: 'okrScoring', label: 'OKR Scoring', icon: Target, color: 'neon-cyan', desc: 'Score objectives with confidence-adjusted key result completion' },
            { action: 'goalDecomposition', label: 'Goal Decomposition', icon: GitBranch, color: 'neon-purple', desc: 'Critical path, dependency graph, and resource allocation' },
            { action: 'progressForecast', label: 'Progress Forecast', icon: TrendingUp, color: 'neon-green', desc: 'Linear regression forecast with confidence bands' },
          ].map(({ action, label, icon: Icon, color, desc }) => (
            <button
              key={action}
              onClick={() => handleGoalsAction(action)}
              disabled={runAction.isPending || !goalItems[0]?.id}
              className={`p-4 rounded-lg border text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-lattice-surface border-lattice-border hover:border-${color}/40`}
            >
              <div className="flex items-center gap-2 mb-1">
                {runAction.isPending && goalsActionResult === null ? (
                  <Loader2 className={`w-4 h-4 text-${color} animate-spin`} />
                ) : (
                  <Icon className={`w-4 h-4 text-${color}`} />
                )}
                <span className="text-sm font-semibold text-white">{label}</span>
              </div>
              <p className="text-xs text-gray-400">{desc}</p>
            </button>
          ))}
        </div>
        {!goalItems[0]?.id && (
          <p className="text-xs text-gray-500 text-center">Create a goal to run analytics actions.</p>
        )}

        {runAction.isPending && (
          <div className="flex items-center justify-center gap-3 py-4">
            <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
            <span className="text-sm text-gray-400">Running...</span>
          </div>
        )}

        {goalsActionResult && !runAction.isPending && (() => {
          const r = goalsActionResult.data as Record<string, unknown>;
          if (goalsActionResult.action === 'okrScoring') {
            const overallScore = r.overallScore as number;
            const overallStatus = r.overallStatus as string;
            const summary = r.summary as Record<string, number> | undefined;
            const objectives = (r.objectives as { id: string; title: string; score: number; status: string; krCount: number; krOnTrack: number }[]) || [];
            return (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <div className={`px-3 py-1.5 rounded-full text-sm font-bold ${overallStatus === 'green' ? 'bg-neon-green/20 text-neon-green' : overallStatus === 'yellow' ? 'bg-yellow-400/20 text-yellow-400' : 'bg-red-400/20 text-red-400'}`}>
                    {overallScore}% Overall
                  </div>
                  <span className={`text-sm font-medium ${overallStatus === 'green' ? 'text-neon-green' : overallStatus === 'yellow' ? 'text-yellow-400' : 'text-red-400'}`}>{overallStatus?.toUpperCase()}</span>
                </div>
                {summary && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="lens-card text-center">
                      <p className="text-xl font-bold text-neon-green">{summary.onTrack}</p>
                      <p className="text-xs text-gray-400">On Track</p>
                    </div>
                    <div className="lens-card text-center">
                      <p className="text-xl font-bold text-yellow-400">{summary.atRisk}</p>
                      <p className="text-xs text-gray-400">At Risk</p>
                    </div>
                    <div className="lens-card text-center">
                      <p className="text-xl font-bold text-red-400">{summary.offTrack}</p>
                      <p className="text-xs text-gray-400">Off Track</p>
                    </div>
                  </div>
                )}
                {objectives.length > 0 && (
                  <div className="space-y-2">
                    {objectives.slice(0, 5).map((obj) => (
                      <div key={obj.id} className="lens-card flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-white truncate max-w-xs">{obj.title}</p>
                          <p className="text-xs text-gray-500">{obj.krCount} key results — {obj.krOnTrack} on track</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-lattice-deep rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${obj.status === 'green' ? 'bg-neon-green' : obj.status === 'yellow' ? 'bg-yellow-400' : 'bg-red-400'}`} style={{ width: `${obj.score}%` }} />
                          </div>
                          <span className="text-xs font-mono text-gray-300 w-10">{obj.score}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          if (goalsActionResult.action === 'goalDecomposition') {
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Total Tasks', value: r.totalTasks as number },
                    { label: 'Top-Level Goals', value: r.topLevelGoals as number },
                    { label: 'Sub-Goals', value: r.subGoalCount as number },
                    { label: 'Project Duration', value: `${r.projectDuration} units` },
                  ].map(({ label, value }) => (
                    <div key={label} className="lens-card text-center">
                      <p className="text-xl font-bold text-white">{value}</p>
                      <p className="text-xs text-gray-400">{label}</p>
                    </div>
                  ))}
                </div>
                {(r.criticalPath as { tasks: string[] })?.tasks?.length > 0 && (
                  <div className="lens-card">
                    <p className="text-xs text-red-400 uppercase tracking-wider mb-2">Critical Path ({(r.criticalPath as { length: number }).length} tasks)</p>
                    <div className="flex flex-wrap gap-1">
                      {(r.criticalPath as { tasks: string[] }).tasks.map((t) => (
                        <span key={t} className="text-xs px-2 py-0.5 rounded bg-red-400/10 text-red-400">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
                {(r.hasCycle as boolean) && (
                  <div className="lens-card border-red-400/30">
                    <p className="text-xs text-red-400">Dependency cycle detected in: {(r.cyclicTasks as string[]).join(', ')}</p>
                  </div>
                )}
                {(r.resourceConflicts as unknown[])?.length > 0 && (
                  <div className="lens-card">
                    <p className="text-xs text-yellow-400 mb-1">{(r.resourceConflicts as unknown[]).length} resource conflict(s) detected</p>
                  </div>
                )}
              </div>
            );
          }
          if (goalsActionResult.action === 'progressForecast') {
            const forecast = r.forecast as Record<string, unknown> | undefined;
            const velocity = r.velocity as Record<string, unknown> | undefined;
            const regression = r.regression as Record<string, unknown> | undefined;
            const currentState = r.currentState as Record<string, unknown> | undefined;
            return (
              <div className="space-y-3">
                {currentState && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="lens-card text-center">
                      <p className="text-xl font-bold text-neon-cyan">{currentState.progress as number}%</p>
                      <p className="text-xs text-gray-400">Current Progress</p>
                    </div>
                    <div className="lens-card text-center">
                      <p className="text-xl font-bold text-gray-300">{currentState.remaining as number}%</p>
                      <p className="text-xs text-gray-400">Remaining</p>
                    </div>
                    <div className="lens-card text-center">
                      <p className="text-xl font-bold text-white">{currentState.daysElapsed as number}d</p>
                      <p className="text-xs text-gray-400">Days Elapsed</p>
                    </div>
                  </div>
                )}
                {forecast && (
                  <div className="lens-card">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-white">Forecast</p>
                      <span className={`text-xs px-2 py-0.5 rounded ${forecast.onTrack ? 'bg-neon-green/10 text-neon-green' : 'bg-red-400/10 text-red-400'}`}>{forecast.onTrack ? 'On Track' : 'Behind'}</span>
                    </div>
                    {!!forecast.estimatedCompletionDate && (
                      <p className="text-sm text-gray-300">Est. completion: <span className="text-neon-cyan font-mono">{forecast.estimatedCompletionDate as string}</span></p>
                    )}
                    {!!forecast.daysRemainingBest && (
                      <p className="text-xs text-gray-400 mt-1">Best: {forecast.daysRemainingBest as number}d — Worst: {forecast.daysRemainingWorst as number}d</p>
                    )}
                  </div>
                )}
                {velocity && (
                  <div className="lens-card flex items-center justify-between">
                    <span className="text-sm text-gray-300">Velocity Trend</span>
                    <span className={`text-sm font-medium ${velocity.trend === 'accelerating' ? 'text-neon-green' : velocity.trend === 'steady progress' ? 'text-neon-cyan' : 'text-red-400'}`}>{velocity.trend as string}</span>
                  </div>
                )}
                {regression && (
                  <div className="lens-card">
                    <p className="text-xs text-gray-500 mb-1">Regression fit: <span className={`font-medium ${(regression.rSquared as number) > 0.8 ? 'text-neon-green' : 'text-yellow-400'}`}>{regression.fit as string}</span> (R²={regression.rSquared as number})</p>
                    <p className="text-xs font-mono text-gray-400">{regression.equation as string}</p>
                  </div>
                )}
              </div>
            );
          }
          return null;
        })()}
      </div>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <ProductivityFeed />
      </section>
    </div>
    </LensShell>
  );
}
