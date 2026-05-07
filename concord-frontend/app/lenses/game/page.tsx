'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy, Star, Zap, Target, Users, Swords, Crown,
  Flame, TrendingUp, ShoppingBag, Lock, Unlock,
  ChevronRight, ChevronDown, Plus, X, Check, Clock,
  BarChart3, Sparkles, Gem, Gamepad2, Joystick,
  GitBranch, BookOpen, Cpu,
  Activity, ArrowUp, Loader2, Scale, BarChart2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MainTab = 'dashboard' | 'skills' | 'quests' | 'achievements' | 'leaderboard' | 'shop' | 'history' | 'minigame';
type LeaderboardPeriod = 'weekly' | 'monthly' | 'alltime';
type QuestStatus = 'available' | 'accepted' | 'completed';
type SkillBranch = 'production' | 'theory' | 'engineering' | 'performance';

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  unlocked: boolean;
  progress: number;
  maxProgress: number;
  xpReward: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

interface Quest {
  id: string;
  name: string;
  description: string;
  icon: string;
  xpReward: number;
  difficulty: 'easy' | 'medium' | 'hard';
  type: 'daily' | 'weekly' | 'challenge';
  status: QuestStatus;
  timeLeft?: string;
}

interface LeaderboardPlayer {
  id: string;
  name: string;
  title: string;
  level: number;
  xp: number;
  achievements: number;
  isCurrentUser?: boolean;
}

interface SkillNode {
  id: string;
  name: string;
  description: string;
  level: number;
  maxLevel: number;
  xpCost: number;
  unlocked: boolean;
  requires?: string;
}

interface ShopItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: 'badge' | 'title' | 'theme' | 'emote';
  cost: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  owned: boolean;
}

interface XpHistoryEntry {
  day: string;
  xp: number;
  label: string;
}

interface GameProfile {
  name: string;
  title: string;
  level: number;
  xp: number;
  nextLevelXp: number;
  totalXpEarned: number;
  achievements: number;
  totalAchievements: number;
  streak: number;
  longestStreak: number;
  questsCompleted: number;
  challengesWon: number;
  joinDate: string;
  rank: number;
  completionRate: number;
  xpHistory: XpHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Initial state — empty; all data comes from the backend API
// ---------------------------------------------------------------------------

const INITIAL_PROFILE = {
  name: '',
  title: '',
  level: 1,
  xp: 0,
  nextLevelXp: 1000,
  totalXpEarned: 0,
  achievements: 0,
  totalAchievements: 0,
  streak: 0,
  longestStreak: 0,
  questsCompleted: 0,
  challengesWon: 0,
  joinDate: new Date().toISOString().slice(0, 10),
  rank: 0,
  completionRate: 0,
};

const INITIAL_XP_HISTORY: { day: string; xp: number; label: string }[] = [];

const INITIAL_ACHIEVEMENTS: Achievement[] = [];

const INITIAL_QUESTS: Quest[] = [];

const INITIAL_LEADERBOARD: LeaderboardPlayer[] = [];

const SKILL_TREES: Record<SkillBranch, { label: string; color: string; icon: typeof Gamepad2; nodes: SkillNode[] }> = {
  production: {
    label: 'Building',
    color: 'text-neon-purple',
    icon: Gamepad2,
    nodes: [
      { id: 'p1', name: 'Prototyping', description: 'Rapidly turning ideas into working drafts', level: 0, maxLevel: 5, xpCost: 0, unlocked: true },
      { id: 'p2', name: 'Architecture', description: 'Structuring complex systems and workflows', level: 0, maxLevel: 5, xpCost: 200, unlocked: false, requires: 'p1' },
      { id: 'p3', name: 'Integration', description: 'Connecting tools, APIs, and data sources', level: 0, maxLevel: 5, xpCost: 300, unlocked: false, requires: 'p1' },
      { id: 'p4', name: 'Automation', description: 'Building repeatable pipelines and triggers', level: 0, maxLevel: 5, xpCost: 400, unlocked: false, requires: 'p2' },
      { id: 'p5', name: 'Optimization', description: 'Performance tuning and resource management', level: 0, maxLevel: 5, xpCost: 500, unlocked: false, requires: 'p2' },
    ],
  },
  theory: {
    label: 'Knowledge',
    color: 'text-neon-cyan',
    icon: BookOpen,
    nodes: [
      { id: 't1', name: 'Fundamentals', description: 'Core concepts and first principles', level: 0, maxLevel: 5, xpCost: 0, unlocked: true },
      { id: 't2', name: 'Analysis', description: 'Breaking down problems systematically', level: 0, maxLevel: 5, xpCost: 250, unlocked: false, requires: 't1' },
      { id: 't3', name: 'Pattern Recognition', description: 'Identifying recurring structures and signals', level: 0, maxLevel: 5, xpCost: 350, unlocked: false, requires: 't1' },
      { id: 't4', name: 'Systems Thinking', description: 'Understanding complex interdependencies', level: 0, maxLevel: 5, xpCost: 450, unlocked: false, requires: 't2' },
      { id: 't5', name: 'Research Mastery', description: 'Advanced investigation and synthesis', level: 0, maxLevel: 5, xpCost: 600, unlocked: false, requires: 't4' },
    ],
  },
  engineering: {
    label: 'Engineering',
    color: 'text-neon-green',
    icon: Cpu,
    nodes: [
      { id: 'e1', name: 'Data Wrangling', description: 'Cleaning, transforming, and shaping data', level: 0, maxLevel: 5, xpCost: 0, unlocked: true },
      { id: 'e2', name: 'Debugging', description: 'Diagnosing and resolving complex issues', level: 0, maxLevel: 5, xpCost: 200, unlocked: false, requires: 'e1' },
      { id: 'e3', name: 'Visualization', description: 'Presenting data and insights clearly', level: 0, maxLevel: 5, xpCost: 300, unlocked: false, requires: 'e1' },
      { id: 'e4', name: 'Deployment', description: 'Shipping reliable systems to production', level: 0, maxLevel: 5, xpCost: 500, unlocked: false, requires: 'e2' },
      { id: 'e5', name: 'AI & ML', description: 'Machine learning models and inference', level: 0, maxLevel: 5, xpCost: 400, unlocked: false, requires: 'e3' },
    ],
  },
  performance: {
    label: 'Leadership',
    color: 'text-neon-pink',
    icon: Joystick,
    nodes: [
      { id: 'r1', name: 'Communication', description: 'Clear and effective information exchange', level: 0, maxLevel: 5, xpCost: 0, unlocked: true },
      { id: 'r2', name: 'Collaboration', description: 'Working effectively across teams and roles', level: 0, maxLevel: 5, xpCost: 250, unlocked: false, requires: 'r1' },
      { id: 'r3', name: 'Decision Making', description: 'Quick, informed judgment under uncertainty', level: 0, maxLevel: 5, xpCost: 350, unlocked: false, requires: 'r1' },
      { id: 'r4', name: 'Strategy', description: 'Long-term planning and resource allocation', level: 0, maxLevel: 5, xpCost: 450, unlocked: false, requires: 'r2' },
      { id: 'r5', name: 'Mentorship', description: 'Teaching, guiding, and growing others', level: 0, maxLevel: 5, xpCost: 500, unlocked: false, requires: 'r3' },
    ],
  },
};

// Shop items are fetched from the backend via useLensData (see component body)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rarityColor: Record<string, string> = {
  common: 'text-gray-400 border-gray-500/30',
  rare: 'text-neon-blue border-neon-blue/30',
  epic: 'text-neon-purple border-neon-purple/30',
  legendary: 'text-neon-yellow border-neon-yellow/30',
};

const difficultyStyle: Record<string, string> = {
  easy: 'bg-neon-green/20 text-neon-green',
  medium: 'bg-neon-blue/20 text-neon-blue',
  hard: 'bg-neon-pink/20 text-neon-pink',
};

function _xpForLevel(lv: number) {
  return lv * 1000 + (lv > 10 ? (lv - 10) * 500 : 0);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GameLensPage() {
  useLensNav('game');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('game');

  const [activeTab, setActiveTab] = useState<MainTab>('dashboard');
  const [lbPeriod, setLbPeriod] = useState<LeaderboardPeriod>('alltime');
  const { items: shopLensItems, update: updateShopItem } = useLensData<ShopItem>('game', 'shop-item', {
    seed: SHOP_ITEMS.map(s => ({ title: s.name, data: s as unknown as Record<string, unknown> })),
  });
  const [shopItems, setShopItems] = useState<ShopItem[]>([]);

  // Sync shop items from API
  useEffect(() => {
    if (shopLensItems.length > 0) {
      setShopItems(shopLensItems.map(i => ({ ...(i.data as unknown as ShopItem), id: i.id })));
    }
  }, [shopLensItems]);
  const [playerXp, setPlayerXp] = useState(0);
  const [expandedBranch, setExpandedBranch] = useState<SkillBranch | null>('production');
  const [showCreateChallenge, setShowCreateChallenge] = useState(false);
  const [newChallenge, setNewChallenge] = useState({ name: '', description: '', difficulty: 'medium' as Quest['difficulty'], xpReward: 300 });
  const [unlockAnim, setUnlockAnim] = useState<string | null>(null);
  const [questFilter, setQuestFilter] = useState<'all' | 'daily' | 'weekly' | 'challenge'>('all');

  // Fetch achievements from /api/game/achievements
  const { data: achievementsResp, isLoading, isError: isError, error: error, refetch: refetch } = useQuery({
    queryKey: ['game', 'achievements'],
    queryFn: () => api.get('/api/game/achievements').then(r => r.data),
  });
  const achievements: Achievement[] = (achievementsResp?.achievements || []).map((a: Record<string, unknown>) => ({
    id: a.id as string,
    name: a.name as string || a.id as string,
    description: a.description as string || '',
    icon: a.icon as string || '🏆',
    category: a.category as string || 'general',
    unlocked: !!(a.earned || a.unlocked),
    progress: (a.progress as number) || (a.earned ? 1 : 0),
    maxProgress: (a.maxProgress as number) || 1,
    xpReward: (a.xpReward as number) || 50,
    rarity: (a.rarity as Achievement['rarity']) || 'common',
  }));

  // Fetch challenges/quests from /api/game/challenges
  const { data: challengesResp, isError: isError2, error: error2, refetch: refetch2 } = useQuery({
    queryKey: ['game', 'challenges'],
    queryFn: () => api.get('/api/game/challenges').then(r => r.data),
  });
  const { create: createQuest } = useLensData<Quest>('game', 'quest', { noSeed: true });
  const quests: Quest[] = (challengesResp?.challenges || []).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    name: c.name as string,
    description: c.description as string,
    icon: '⚡',
    xpReward: (c.reward as number) || 100,
    difficulty: 'medium' as Quest['difficulty'],
    type: 'daily' as Quest['type'],
    status: 'available' as QuestStatus,
  }));

  // Fetch profile from /api/game/profile
  const { data: profileResp, isError: isError3, error: error3, refetch: refetch3 } = useQuery({
    queryKey: ['game', 'profile'],
    queryFn: () => api.get('/api/game/profile').then(r => r.data),
  });
  const profileData = profileResp?.profile || null;

  // Fetch leaderboard from /api/game/leaderboard
  const { data: leaderboardResp, isError: isError4, error: error4, refetch: refetch4 } = useQuery({
    queryKey: ['game', 'leaderboard'],
    queryFn: () => api.get('/api/game/leaderboard').then(r => r.data),
  });
  const leaderboardData = (leaderboardResp?.leaderboard || []) as Record<string, unknown>[];

  // Sync profile data into local state when available
  useEffect(() => {
    if (profileData?.xp && profileData.xp !== playerXp) {
      setPlayerXp(profileData.xp as number);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileData]);

  const { update: updateQuest } = useLensData<Quest>('game', 'quest', { noSeed: true });
  const completeQuestMutation = useMutation({
    mutationFn: (questId: string) => {
      const quest = quests.find(q => q.id === questId);
      return api.post(`/api/game/quests/${questId}/complete`, { xpReward: quest?.xpReward || 100 }).then(r => r.data);
    },
    onSuccess: () => { refetch2(); refetch3(); },
    onError: (err) => {
      console.error('Failed to complete quest:', err instanceof Error ? err.message : err);
    },
  });

  // Local quest status overrides (optimistic UI)
  const [questStatusOverrides, setQuestStatusOverrides] = useState<Record<string, QuestStatus>>({});
  const effectiveQuests = useMemo(() =>
    quests.map(q => questStatusOverrides[q.id] ? { ...q, status: questStatusOverrides[q.id] } : q),
    [quests, questStatusOverrides]
  );

  // Quest flow
  const acceptQuest = useCallback((id: string) => {
    setQuestStatusOverrides(prev => ({ ...prev, [id]: 'accepted' as QuestStatus }));
    updateQuest(id, { data: { status: 'accepted' } as unknown as Partial<Quest> })
      .catch(err => console.error('Failed to accept quest:', err instanceof Error ? err.message : err));
  }, [updateQuest]);

  const completeQuest = useCallback((id: string) => {
    const quest = quests.find((q) => q.id === id);
    if (!quest) return;
    setQuestStatusOverrides(prev => ({ ...prev, [id]: 'completed' as QuestStatus }));
    setPlayerXp((prev) => prev + quest.xpReward);
    completeQuestMutation.mutate(id);
  }, [quests, completeQuestMutation]);

  // Shop purchase
  const purchaseItem = useCallback((id: string) => {
    const item = shopItems.find((i) => i.id === id);
    if (!item || item.owned || playerXp < item.cost || purchasingIds.has(id)) return;
    setPurchasingIds(prev => new Set(prev).add(id));
    setShopItems((prev) => prev.map((i) => (i.id === id ? { ...i, owned: true } : i)));
    setPlayerXp((prev) => prev - item.cost);
    updateShopItem(id, { data: { owned: true } as unknown as Partial<ShopItem> })
      .catch(err => console.error('Failed to persist shop purchase:', err instanceof Error ? err.message : err));
  }, [shopItems, playerXp, updateShopItem]);

  // Achievement unlock (optimistic UI - will refresh from API on next fetch)
  const [achievementOverrides, setAchievementOverrides] = useState<Record<string, boolean>>({});
  const effectiveAchievements = useMemo(() =>
    achievements.map(a => achievementOverrides[a.id] ? { ...a, unlocked: true, progress: a.maxProgress } : a),
    [achievements, achievementOverrides]
  );
  const triggerUnlock = useCallback((id: string) => {
    setAchievementOverrides(prev => ({ ...prev, [id]: true }));
    setUnlockAnim(id);
    const ach = achievements.find((a) => a.id === id);
    if (ach) setPlayerXp((prev) => prev + ach.xpReward);
    setTimeout(() => setUnlockAnim(null), 2000);
  }, [achievements]);

  // Create custom challenge (local-only, added to local quest list)
  const [localQuests, setLocalQuests] = useState<Quest[]>([]);
  const allQuests = useMemo(() => [...effectiveQuests, ...localQuests], [effectiveQuests, localQuests]);
  const submitChallenge = useCallback(() => {
    if (!newChallenge.name.trim()) return;
    const questData: Quest = { id: `q-custom-${Date.now()}`, name: newChallenge.name, description: newChallenge.description, icon: '🎯', xpReward: newChallenge.xpReward, difficulty: newChallenge.difficulty, type: 'challenge', status: 'available' };
    setLocalQuests((prev) => [...prev, questData]);
    createQuest({ title: questData.name, data: questData as unknown as Record<string, unknown>, meta: { status: 'active', tags: ['challenge', questData.difficulty] } })
      .then(() => { refetch2(); })
      .catch(err => console.error('Failed to persist challenge:', err instanceof Error ? err.message : err));
    setNewChallenge({ name: '', description: '', difficulty: 'medium', xpReward: 300 });
    setShowCreateChallenge(false);
  }, [newChallenge, createQuest, refetch2]);

  // Computed
  const filteredQuests = useMemo(() => {
    if (questFilter === 'all') return allQuests;
    return allQuests.filter((q) => q.type === questFilter);
  }, [allQuests, questFilter]);

  const sortedLeaderboard = useMemo(() => {
    const apiPlayers = (leaderboardData || []) as unknown as LeaderboardPlayer[];
    return [...apiPlayers].sort((a: LeaderboardPlayer, b: LeaderboardPlayer) => b.xp - a.xp);
  }, [leaderboardData]);

  const profile = (profileData || INITIAL_PROFILE) as unknown as GameProfile;
  const xpHistory: XpHistoryEntry[] = (profile.xpHistory || INITIAL_XP_HISTORY) as XpHistoryEntry[];
  const xpMax = Math.max(1, ...xpHistory.map((d: { xp: number }) => d.xp));
  const level = profile.level || 1;
  const progressPct = ((playerXp) / ((profile.nextLevelXp as number) || 1000)) * 100;

  const TABS: { id: MainTab; label: string; icon: typeof Trophy }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'skills', label: 'Skill Tree', icon: GitBranch },
    { id: 'quests', label: 'Quests', icon: Target },
    { id: 'achievements', label: 'Achievements', icon: Trophy },
    { id: 'leaderboard', label: 'Leaderboard', icon: Users },
    { id: 'shop', label: 'Shop', icon: ShoppingBag },
    { id: 'history', label: 'XP History', icon: TrendingUp },
    { id: 'minigame', label: 'Mini-Game', icon: Gamepad2 },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------


  if (isLoading) {
    return (
      <div data-lens-theme="game" className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading game library...</p>
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
    <div className="p-6 space-y-6 min-h-screen">
      {/* Header */}
      <header className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-neon-purple/20 flex items-center justify-center">
            <Swords className="w-6 h-6 text-neon-purple" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Game Lens</h1>
            <p className="text-sm text-gray-400">Gamification platform &mdash; level up your skills and track progress</p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="game" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-neon-yellow font-mono text-sm">
            <Zap className="w-4 h-4" />
            {playerXp.toLocaleString()} XP
          </div>
          <div className="flex items-center gap-1 text-neon-pink font-mono text-sm">
            <Flame className="w-4 h-4" />
            {profile.streak}d streak
          </div>
          <div className="flex items-center gap-1 text-neon-cyan font-mono text-sm">
            <Star className="w-4 h-4" />
            Lv {level}
          </div>
        </div>
      </header>

      {/* XP Progress Bar */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-400">Progress to Level {level + 1}</span>
          <span className="text-sm font-mono text-white">{playerXp.toLocaleString()} / {(profile.nextLevelXp || 1000).toLocaleString()} XP</span>
        </div>
        <div className="h-3 bg-lattice-bg rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-neon-blue via-neon-purple to-neon-pink rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(progressPct, 100)}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap pb-2 border-b border-lattice-border scrollbar-thin">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-t-lg transition-colors whitespace-nowrap text-sm',
                activeTab === tab.id ? 'bg-neon-purple/20 text-neon-purple border-b-2 border-neon-purple' : 'text-gray-400 hover:text-white',
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ================================================================= */}
      {/* DASHBOARD TAB                                                      */}
      {/* ================================================================= */}
      {activeTab === 'dashboard' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Level', value: level, icon: Star, color: 'text-neon-purple' },
              { label: 'Total XP', value: (profile.totalXpEarned || playerXp).toLocaleString(), icon: Zap, color: 'text-neon-yellow' },
              { label: 'Achievements', value: `${profile.achievements || effectiveAchievements.filter(a => a.unlocked).length}/${profile.totalAchievements || effectiveAchievements.length}`, icon: Trophy, color: 'text-neon-green' },
              { label: 'Day Streak', value: profile.streak || 0, icon: Flame, color: 'text-neon-pink' },
            ].map((s) => (
              <div key={s.label} className="lens-card text-center">
                <s.icon className={cn('w-8 h-8 mx-auto mb-2', s.color)} />
                <p className="text-2xl font-bold text-white">{s.value}</p>
                <p className="text-sm text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Secondary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Quests Done', value: profile.questsCompleted || quests.filter(q => q.status === 'completed').length, icon: Target, color: 'text-neon-cyan' },
              { label: 'Challenges Won', value: profile.challengesWon || 0, icon: Crown, color: 'text-neon-yellow' },
              { label: 'Completion Rate', value: `${profile.completionRate || 0}%`, icon: Activity, color: 'text-neon-green' },
              { label: 'Global Rank', value: `#${profile.rank || '--'}`, icon: ArrowUp, color: 'text-neon-blue' },
            ].map((s) => (
              <div key={s.label} className="lens-card text-center">
                <s.icon className={cn('w-6 h-6 mx-auto mb-1', s.color)} />
                <p className="text-xl font-bold text-white">{s.value}</p>
                <p className="text-xs text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Mini XP Chart on Dashboard */}
          <div className="panel p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">This Week&apos;s XP</h3>
            <div className="flex items-end gap-2 h-32">
              {xpHistory.map((d: XpHistoryEntry, dIndex: number) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-gray-500 font-mono">{d.xp}</span>
                  <motion.div
                    className="w-full rounded-t bg-gradient-to-t from-neon-purple to-neon-cyan"
                    initial={{ height: 0 }}
                    animate={{ height: `${(d.xp / xpMax) * 100}%` }}
                    transition={{ duration: 0.6, delay: 0.05 * dIndex }}
                  />
                  <span className="text-xs text-gray-400">{d.day}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Active Quests Preview */}
          <div className="panel p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-300">Active Quests</h3>
              <button onClick={() => setActiveTab('quests')} className="text-xs text-neon-cyan hover:underline">View all</button>
            </div>
            <div className="space-y-2">
              {quests.filter((q) => q.status === 'accepted').slice(0, 3).map((q) => (
                <div key={q.id} className="flex items-center justify-between bg-lattice-surface rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span>{q.icon}</span>
                    <span className="text-sm text-white">{q.name}</span>
                  </div>
                  <button onClick={() => completeQuest(q.id)} className="btn-neon text-xs py-1 px-3">Complete</button>
                </div>
              ))}
              {quests.filter((q) => q.status === 'accepted').length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">No active quests. Accept some from the Quests tab!</p>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* SKILL TREE TAB                                                     */}
      {/* ================================================================= */}
      {activeTab === 'skills' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <p className="text-sm text-gray-400">Invest XP to unlock and upgrade skills across four branches.</p>
          {(Object.entries(SKILL_TREES) as [SkillBranch, typeof SKILL_TREES[SkillBranch]][]).map(([branch, data]) => {
            const BranchIcon = data.icon;
            const isExpanded = expandedBranch === branch;
            return (
              <div key={branch} data-lens-theme="game" className="panel overflow-hidden">
                <button
                  onClick={() => setExpandedBranch(isExpanded ? null : branch)}
                  className="w-full flex items-center justify-between p-4 hover:bg-lattice-surface/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <BranchIcon className={cn('w-5 h-5', data.color)} />
                    <span className="font-semibold text-white">{data.label}</span>
                    <span className="text-xs text-gray-500">{data.nodes.filter((n) => n.unlocked).length}/{data.nodes.length} unlocked</span>
                  </div>
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                </button>
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="border-t border-lattice-border"
                    >
                      <div className="p-4 space-y-3">
                        {data.nodes.map((node) => (
                          <div key={node.id} className={cn('flex items-center gap-4 rounded-lg p-3', node.unlocked ? 'bg-lattice-surface' : 'bg-lattice-bg opacity-60')}>
                            <div className={cn('w-10 h-10 rounded-full flex items-center justify-center border-2', node.unlocked ? 'border-neon-green bg-neon-green/10' : 'border-gray-600 bg-gray-800')}>
                              {node.unlocked ? <Unlock className="w-4 h-4 text-neon-green" /> : <Lock className="w-4 h-4 text-gray-500" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-white text-sm">{node.name}</span>
                                {node.requires && <span className="text-[10px] text-gray-500">requires prev.</span>}
                              </div>
                              <p className="text-xs text-gray-400 truncate">{node.description}</p>
                              {/* Level pips */}
                              <div className="flex gap-1 mt-1">
                                {Array.from({ length: node.maxLevel }).map((_, i) => (
                                  <div key={i} className={cn('w-4 h-1.5 rounded-full', i < node.level ? 'bg-neon-green' : 'bg-gray-700')} />
                                ))}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="text-xs font-mono text-gray-400">Lv {node.level}/{node.maxLevel}</span>
                              {node.unlocked && node.level < node.maxLevel && (
                                <p className="text-[10px] text-neon-yellow mt-0.5">{node.xpCost} XP to upgrade</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* QUESTS TAB                                                         */}
      {/* ================================================================= */}
      {activeTab === 'quests' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Quest filter + create button */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-1">
              {(['all', 'daily', 'weekly', 'challenge'] as const).map((f) => (
                <button key={f} onClick={() => setQuestFilter(f)} className={cn('px-3 py-1.5 rounded text-xs font-medium transition-colors', questFilter === f ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white')}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <button onClick={() => setShowCreateChallenge(true)} className="btn-neon text-sm py-1.5 px-4 flex items-center gap-1">
              <Plus className="w-4 h-4" /> Create Challenge
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredQuests.map((quest) => (
              <motion.div
                key={quest.id}
                layout
                className={cn('lens-card', quest.status === 'completed' && 'opacity-50')}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">{quest.icon}</span>
                  <div className="flex items-center gap-2">
                    {quest.timeLeft && (
                      <span className="text-[10px] text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3" />{quest.timeLeft}</span>
                    )}
                    <span className={cn('text-xs px-2 py-0.5 rounded', difficultyStyle[quest.difficulty])}>{quest.difficulty}</span>
                    <span className={cn('text-xs px-2 py-0.5 rounded', quest.type === 'daily' ? 'bg-neon-cyan/15 text-neon-cyan' : quest.type === 'weekly' ? 'bg-neon-purple/15 text-neon-purple' : 'bg-neon-yellow/15 text-neon-yellow')}>
                      {quest.type}
                    </span>
                  </div>
                </div>
                <h4 className="font-semibold text-white">{quest.name}</h4>
                <p className="text-sm text-gray-400 mt-1">{quest.description}</p>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-lattice-border">
                  <span className="text-sm text-neon-yellow flex items-center gap-1"><Zap className="w-4 h-4" />+{quest.xpReward} XP</span>
                  {quest.status === 'available' && (
                    <button onClick={() => acceptQuest(quest.id)} className="btn-neon text-sm py-1 px-4">Accept</button>
                  )}
                  {quest.status === 'accepted' && (
                    <button onClick={() => completeQuest(quest.id)} className="btn-neon text-sm py-1 px-4 flex items-center gap-1"><Check className="w-3 h-3" />Complete</button>
                  )}
                  {quest.status === 'completed' && (
                    <span className="text-sm text-neon-green flex items-center gap-1"><Check className="w-4 h-4" />Done</span>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* ACHIEVEMENTS TAB                                                   */}
      {/* ================================================================= */}
      {activeTab === 'achievements' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <p className="text-sm text-gray-400">
            {effectiveAchievements.filter((a) => a.unlocked).length} of {effectiveAchievements.length} achievements unlocked
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {effectiveAchievements.map((ach) => (
              <motion.div
                key={ach.id}
                layout
                className={cn('lens-card relative overflow-hidden', ach.unlocked ? 'border-neon-green/40' : '')}
              >
                <AnimatePresence>
                  {unlockAnim === ach.id && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.5 }}
                      className="absolute inset-0 flex items-center justify-center bg-neon-green/10 backdrop-blur-sm z-10"
                    >
                      <div className="text-center">
                        <motion.div animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.3, 1] }} transition={{ duration: 0.6 }}>
                          <Sparkles className="w-12 h-12 text-neon-yellow mx-auto" />
                        </motion.div>
                        <p className="text-neon-green font-bold mt-2">UNLOCKED!</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="flex items-start gap-3">
                  <span className="text-3xl">{ach.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-white text-sm">{ach.name}</h4>
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded border', rarityColor[ach.rarity])}>{ach.rarity}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{ach.description}</p>
                    <p className="text-[10px] text-gray-500 mt-1">Category: {ach.category}</p>
                    {!ach.unlocked && (
                      <div className="mt-2">
                        <div className="flex justify-between text-[10px] mb-1">
                          <span className="text-gray-500">Progress</span>
                          <span className="text-gray-300">{ach.progress}/{ach.maxProgress}</span>
                        </div>
                        <div className="h-1.5 bg-lattice-bg rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-neon-blue rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${(ach.progress / ach.maxProgress) * 100}%` }}
                            transition={{ duration: 0.5 }}
                          />
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-neon-yellow flex items-center gap-0.5"><Zap className="w-3 h-3" />+{ach.xpReward} XP</span>
                      {!ach.unlocked && ach.progress >= ach.maxProgress * 0.9 && (
                        <button onClick={() => triggerUnlock(ach.id)} className="text-[10px] text-neon-green hover:underline">Claim</button>
                      )}
                      {ach.unlocked && <Trophy className="w-4 h-4 text-neon-green" />}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* LEADERBOARD TAB                                                    */}
      {/* ================================================================= */}
      {activeTab === 'leaderboard' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="flex gap-2">
            {(['weekly', 'monthly', 'alltime'] as LeaderboardPeriod[]).map((p) => (
              <button key={p} onClick={() => setLbPeriod(p)} className={cn('px-4 py-1.5 rounded text-sm transition-colors', lbPeriod === p ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white')}>
                {p === 'alltime' ? 'All Time' : p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <div className="panel overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-lattice-border">
                  <th scope="col" className="pb-3 pt-4 px-4 w-16">Rank</th>
                  <th scope="col" className="pb-3 pt-4">Player</th>
                  <th scope="col" className="pb-3 pt-4 text-right hidden md:table-cell">Title</th>
                  <th scope="col" className="pb-3 pt-4 text-right">Level</th>
                  <th scope="col" className="pb-3 pt-4 text-right">Achievements</th>
                  <th scope="col" className="pb-3 pt-4 text-right pr-4">XP</th>
                </tr>
              </thead>
              <tbody>
                {sortedLeaderboard.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-gray-500">No players on the leaderboard yet. Start a game to climb the ranks.</td></tr>
                )}
                {sortedLeaderboard.map((player, index) => (
                  <motion.tr
                    key={player.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.04 }}
                    className={cn('border-b border-lattice-border/30 transition-colors', player.isCurrentUser ? 'bg-neon-purple/10' : 'hover:bg-lattice-surface/50')}
                  >
                    <td className="py-3 px-4">
                      {sortedLeaderboard.length === 1 ? <Sparkles className="w-5 h-5 text-neon-cyan" /> : index === 0 ? <Crown className="w-5 h-5 text-neon-yellow" /> : index === 1 ? <span className="text-gray-300 font-bold">2</span> : index === 2 ? <span className="text-amber-600 font-bold">3</span> : <span className="text-gray-500">#{index + 1}</span>}
                    </td>
                    <td className="py-3 font-medium text-white text-sm">
                      {player.name}
                      {player.isCurrentUser && <span className="ml-2 text-[10px] text-neon-cyan">(you)</span>}
                    </td>
                    <td className="py-3 text-right text-xs text-gray-400 hidden md:table-cell">{player.title}</td>
                    <td className="py-3 text-right text-sm">{player.level}</td>
                    <td className="py-3 text-right text-sm">{player.achievements}</td>
                    <td className="py-3 text-right pr-4 font-mono text-neon-blue text-sm">{player.xp.toLocaleString()}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* SHOP TAB                                                           */}
      {/* ================================================================= */}
      {activeTab === 'shop' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">Spend your hard-earned XP on badges, titles, themes, and emotes.</p>
            <div className="flex items-center gap-1 text-neon-yellow font-mono text-sm">
              <Gem className="w-4 h-4" /> {playerXp.toLocaleString()} XP available
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {shopItems.map((item) => (
              <motion.div
                key={item.id}
                whileHover={{ scale: 1.02 }}
                className={cn('lens-card flex flex-col', item.owned && 'border-neon-green/30')}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-3xl">{item.icon}</span>
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded border', rarityColor[item.rarity])}>{item.rarity}</span>
                </div>
                <h4 className="font-semibold text-white text-sm">{item.name}</h4>
                <p className="text-xs text-gray-400 mt-1 flex-1">{item.description}</p>
                <span className="text-[10px] text-gray-500 mt-1 capitalize">{item.type}</span>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-lattice-border">
                  <span className="text-sm text-neon-yellow flex items-center gap-1"><Gem className="w-3 h-3" />{item.cost.toLocaleString()}</span>
                  {item.owned ? (
                    <span className="text-xs text-neon-green flex items-center gap-1"><Check className="w-3 h-3" />Owned</span>
                  ) : (
                    <button
                      onClick={() => purchaseItem(item.id)}
                      disabled={playerXp < item.cost || purchasingIds.has(item.id)}
                      className={cn('btn-neon text-xs py-1 px-3', (playerXp < item.cost || purchasingIds.has(item.id)) && 'opacity-40 cursor-not-allowed')}
                    >
                      {purchasingIds.has(item.id) ? 'Buying...' : 'Buy'}
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* XP HISTORY TAB                                                     */}
      {/* ================================================================= */}
      {activeTab === 'history' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Bar Chart */}
          <div className="panel p-6">
            <h3 className="font-semibold text-white mb-1">XP Earned This Week</h3>
            <p className="text-xs text-gray-400 mb-6">Total: {xpHistory.reduce((s: number, d: { xp: number }) => s + d.xp, 0).toLocaleString()} XP</p>
            <div className="flex items-end gap-3 h-48">
              {xpHistory.map((d: { day: string; xp: number }, i: number) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
                  <span className="text-xs text-gray-400 font-mono">{d.xp}</span>
                  <motion.div
                    className="w-full rounded-t-md bg-gradient-to-t from-neon-purple via-neon-blue to-neon-cyan"
                    initial={{ height: 0 }}
                    animate={{ height: `${(d.xp / xpMax) * 100}%` }}
                    transition={{ duration: 0.5, delay: i * 0.08 }}
                  />
                  <span className="text-xs text-gray-300 font-medium">{d.day}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="lens-card text-center">
              <p className="text-2xl font-bold text-neon-yellow">{(profile.totalXpEarned || playerXp).toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">Lifetime XP</p>
            </div>
            <div className="lens-card text-center">
              <p className="text-2xl font-bold text-neon-cyan">{Math.round(xpHistory.reduce((s: number, d: { xp: number }) => s + d.xp, 0) / Math.max(xpHistory.length, 1))}</p>
              <p className="text-xs text-gray-400 mt-1">Avg Daily XP</p>
            </div>
            <div className="lens-card text-center">
              <p className="text-2xl font-bold text-neon-green">{xpHistory.length > 0 ? Math.max(...xpHistory.map((d: { xp: number }) => d.xp)) : 0}</p>
              <p className="text-xs text-gray-400 mt-1">Best Day</p>
            </div>
            <div className="lens-card text-center">
              <p className="text-2xl font-bold text-neon-pink">{profile.longestStreak || 0}d</p>
              <p className="text-xs text-gray-400 mt-1">Longest Streak</p>
            </div>
          </div>

          {/* Recent Activity Feed */}
          <div className="panel p-4">
            <h3 className="font-semibold text-white mb-3">Recent Activity</h3>
            <div className="space-y-3">
              {[
                { time: '2h ago', text: 'Completed "Daily Mix Session" quest', xp: '+120 XP', color: 'text-neon-green' },
                { time: '5h ago', text: 'Unlocked "Plugin Collector" achievement', xp: '+350 XP', color: 'text-neon-yellow' },
                { time: '1d ago', text: 'Purchased "Fire Emote" from shop', xp: '-300 XP', color: 'text-neon-pink' },
                { time: '1d ago', text: 'Leveled up Compression skill to Lv 4', xp: '+200 XP', color: 'text-neon-cyan' },
                { time: '2d ago', text: 'Completed "Genre Explorer" weekly quest', xp: '+500 XP', color: 'text-neon-green' },
                { time: '3d ago', text: 'Reached Level 14', xp: 'Level up!', color: 'text-neon-purple' },
              ].map((entry, i) => (
                <div key={i} className="flex items-center justify-between text-sm border-b border-lattice-border/30 pb-2 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-gray-500 w-14 shrink-0">{entry.time}</span>
                    <span className="text-gray-300">{entry.text}</span>
                  </div>
                  <span className={cn('font-mono text-xs shrink-0', entry.color)}>{entry.xp}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* MINI-GAME TAB                                                      */}
      {/* ================================================================= */}
      {activeTab === 'minigame' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Target className="w-5 h-5 text-neon-purple" />
                Target Blitz
              </h3>
              <p className="text-sm text-gray-400">Click targets before they fade! Chain hits for combo multipliers. Earn XP based on your score.</p>
            </div>
            <div className="flex items-center gap-3">
              {mgState === 'idle' && (
                <button onClick={startMiniGame} className="btn-neon py-2 px-6 flex items-center gap-2">
                  <Gamepad2 className="w-4 h-4" /> Start Game
                </button>
              )}
              {mgState === 'playing' && (
                <button onClick={endMiniGame} className="text-sm text-gray-400 hover:text-white border border-gray-600 rounded px-4 py-2 transition-colors">
                  End Early
                </button>
              )}
              {mgState === 'ended' && (
                <button onClick={startMiniGame} className="btn-neon py-2 px-6 flex items-center gap-2">
                  <Gamepad2 className="w-4 h-4" /> Play Again
                </button>
              )}
            </div>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {[
              { label: 'Score', value: mgScore, color: 'text-neon-yellow' },
              { label: 'Time', value: mgState === 'playing' ? `${mgTimeLeft}s` : mgState === 'ended' ? '0s' : '30s', color: mgTimeLeft <= 5 && mgState === 'playing' ? 'text-red-400' : 'text-white' },
              { label: 'Hits', value: mgHits, color: 'text-neon-green' },
              { label: 'Misses', value: mgMisses, color: 'text-red-400' },
              { label: 'Combo', value: mgCombo > 1 ? `x${mgCombo}` : '--', color: 'text-neon-cyan' },
              { label: 'Accuracy', value: (mgHits + mgMisses) > 0 ? `${Math.round((mgHits / (mgHits + mgMisses)) * 100)}%` : '--', color: 'text-neon-blue' },
            ].map((s) => (
              <div key={s.label} className="lens-card text-center py-2">
                <p className={cn('text-lg font-bold font-mono', s.color)}>{s.value}</p>
                <p className="text-[10px] text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Canvas */}
          <div className="panel p-2 relative overflow-hidden" style={{ background: 'rgba(0,0,0,0.4)' }}>
            {mgState === 'idle' && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="text-center space-y-3">
                  <Target className="w-16 h-16 text-neon-purple/50 mx-auto" />
                  <p className="text-gray-400 text-sm">Press <span className="text-white font-semibold">Start Game</span> to begin</p>
                  <p className="text-gray-500 text-xs">30 seconds &middot; Click targets &middot; Build combos &middot; Earn XP</p>
                </div>
              </div>
            )}
            {mgState === 'ended' && (
              <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/60 backdrop-blur-sm">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-center space-y-4 p-8"
                >
                  <motion.div
                    animate={{ rotate: [0, -8, 8, -4, 4, 0], scale: [1, 1.15, 1] }}
                    transition={{ duration: 0.8 }}
                  >
                    <Trophy className="w-14 h-14 text-neon-yellow mx-auto" />
                  </motion.div>
                  <h4 className="text-2xl font-bold text-white">Game Over!</h4>
                  <div className="grid grid-cols-4 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold font-mono text-neon-yellow">{mgScore}</p>
                      <p className="text-xs text-gray-400">Score</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold font-mono text-neon-green">{mgHits}</p>
                      <p className="text-xs text-gray-400">Hits</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold font-mono text-neon-blue">
                        {(mgHits + mgMisses) > 0 ? `${Math.round((mgHits / (mgHits + mgMisses)) * 100)}%` : '--'}
                      </p>
                      <p className="text-xs text-gray-400">Accuracy</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold font-mono text-neon-purple">{mgBestCombo > 1 ? `x${mgBestCombo}` : '--'}</p>
                      <p className="text-xs text-gray-400">Best Combo</p>
                    </div>
                  </div>
                  {mgXpAwarded > 0 && (
                    <motion.div
                      initial={{ y: 10, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.3 }}
                      className="flex items-center justify-center gap-2 text-neon-yellow bg-neon-yellow/10 border border-neon-yellow/30 rounded-lg py-2 px-4"
                    >
                      <Zap className="w-5 h-5" />
                      <span className="font-bold">+{mgXpAwarded} XP earned!</span>
                    </motion.div>
                  )}
                  <p className="text-xs text-gray-500">XP has been added to your profile</p>
                </motion.div>
              </div>
            )}
            <canvas
              ref={canvasRef}
              width={800}
              height={450}
              onClick={handleCanvasClick}
              className={cn(
                'w-full rounded-lg',
                mgState === 'playing' ? 'cursor-crosshair' : 'cursor-default',
              )}
              style={{ aspectRatio: '16/9', imageRendering: 'auto' }}
            />
          </div>

          {/* How to play */}
          <div className="panel p-4">
            <h4 className="text-sm font-semibold text-gray-300 mb-2">How to Play</h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs text-gray-400">
              <div className="flex items-start gap-2">
                <Target className="w-4 h-4 text-neon-purple shrink-0 mt-0.5" />
                <span>Targets drift across the canvas. Click them before the ring timer runs out. Smaller targets are worth more points.</span>
              </div>
              <div className="flex items-start gap-2">
                <Flame className="w-4 h-4 text-neon-yellow shrink-0 mt-0.5" />
                <span>Hit consecutive targets to build combos. Each combo level adds +25% to your points. Clicking empty space breaks the chain.</span>
              </div>
              <div className="flex items-start gap-2">
                <TrendingUp className="w-4 h-4 text-neon-pink shrink-0 mt-0.5" />
                <span>Difficulty ramps up over time: targets spawn faster, shrink, and move quicker as the clock ticks down.</span>
              </div>
              <div className="flex items-start gap-2">
                <Zap className="w-4 h-4 text-neon-green shrink-0 mt-0.5" />
                <span>Your final score converts to XP (1 XP per 10 points, minimum 5 XP). XP is added to your Game Lens profile.</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* CREATE CHALLENGE MODAL                                             */}
      {/* ================================================================= */}
      <AnimatePresence>
        {showCreateChallenge && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowCreateChallenge(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="panel w-full max-w-lg p-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Create Challenge</h2>
                <button onClick={() => setShowCreateChallenge(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>

              <div>
                <label className="text-xs text-gray-400 mb-1 block">Challenge Name</label>
                <input
                  value={newChallenge.name}
                  onChange={(e) => setNewChallenge((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. 808 Bass Marathon"
                  className="input-lattice w-full"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 mb-1 block">Description</label>
                <textarea
                  value={newChallenge.description}
                  onChange={(e) => setNewChallenge((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Describe the challenge rules and goals..."
                  rows={3}
                  className="input-lattice w-full resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Difficulty</label>
                  <select
                    value={newChallenge.difficulty}
                    onChange={(e) => setNewChallenge((p) => ({ ...p, difficulty: e.target.value as Quest['difficulty'] }))}
                    className="input-lattice w-full"
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">XP Reward</label>
                  <input
                    type="number"
                    value={newChallenge.xpReward}
                    onChange={(e) => setNewChallenge((p) => ({ ...p, xpReward: Number(e.target.value) }))}
                    min={50}
                    max={2000}
                    step={50}
                    className="input-lattice w-full"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button onClick={() => setShowCreateChallenge(false)} className="text-sm text-gray-400 hover:text-white transition-colors px-4 py-2">Cancel</button>
                <button onClick={submitChallenge} disabled={!newChallenge.name.trim()} className={cn('btn-neon py-2 px-6', !newChallenge.name.trim() && 'opacity-40 cursor-not-allowed')}>
                  Create
                </button>

      {/* Real-time Data Panel */}
      <UniversalActions domain="game" artifactId={null} compact />

      {/* Game Balance Actions */}
      <div className="panel p-4 space-y-3 mx-4 mb-4">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Scale className="w-4 h-4 text-neon-purple" />
          Game Balance Tools
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { action: 'balanceCheck',    label: 'Balance Check',     icon: Scale,      color: 'text-neon-green' },
            { action: 'economySimulate', label: 'Economy Simulate',  icon: TrendingUp, color: 'text-neon-cyan' },
            { action: 'levelCurve',      label: 'Level Curve',       icon: Activity,   color: 'text-neon-purple' },
            { action: 'dropRateCalc',    label: 'Drop Rate Calc',    icon: BarChart2,  color: 'text-yellow-400' },
          ].map(({ action, label, icon: Icon, color }) => (
            <button
              key={action}
              onClick={() => handleGameAction(action)}
              disabled={!!gameRunning || !shopLensItems[0]?.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-lattice-deep border border-lattice-border text-sm hover:border-neon-purple/30 disabled:opacity-40 transition-colors"
            >
              {gameRunning === action ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className={`w-4 h-4 ${color}`} />}
              <span className="truncate text-xs">{label}</span>
            </button>
          ))}
        </div>

        {gameActionResult && (
          <div className="mt-3 rounded-lg bg-black/30 border border-white/10 p-4 relative">
            <button onClick={() => setGameActionResult(null)} className="absolute top-3 right-3 text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>

            {/* balanceCheck */}
            {gameActionResult._action === 'balanceCheck' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Balance Check</p>
                {(gameActionResult.message as string) ? <p className="text-sm text-gray-400">{gameActionResult.message as string}</p> : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: 'Avg Power', value: String(gameActionResult.avgPower ?? 0), color: 'text-white' },
                        { label: 'Variance', value: String(gameActionResult.powerVariance ?? 0), color: 'text-neon-cyan' },
                        { label: 'Strongest', value: String(gameActionResult.strongest ?? '—'), color: 'text-neon-green' },
                        { label: 'Weakest', value: String(gameActionResult.weakest ?? '—'), color: 'text-red-400' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                          <p className={`text-sm font-bold ${color}`}>{value}</p>
                          <p className="text-xs text-gray-400">{label}</p>
                        </div>
                      ))}
                    </div>
                    <div className={`text-xs px-3 py-2 rounded border ${(gameActionResult.balance as string) === 'well-balanced' ? 'bg-neon-green/10 border-neon-green/30 text-neon-green' : (gameActionResult.balance as string) === 'slightly-unbalanced' ? 'bg-yellow-400/10 border-yellow-400/30 text-yellow-400' : 'bg-red-400/10 border-red-400/30 text-red-400'}`}>
                      Balance: {(gameActionResult.balance as string)?.replace(/-/g, ' ')}
                    </div>
                    {Array.isArray(gameActionResult.units) && (
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {(gameActionResult.units as {name:string;power:number;efficiency:number;cost:number}[]).map(u => (
                          <div key={u.name} className="flex items-center gap-3 text-xs px-2 py-1 rounded bg-white/5">
                            <span className="flex-1 text-white">{u.name}</span>
                            <span className="text-gray-400">Cost: {u.cost}</span>
                            <span className="text-neon-cyan">Power: {u.power}</span>
                            <span className="text-neon-green">Eff: {u.efficiency}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* economySimulate */}
            {gameActionResult._action === 'economySimulate' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Economy Simulation</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Start Gold', value: String(gameActionResult.startGold ?? 0), color: 'text-white' },
                    { label: 'Final Gold', value: String(gameActionResult.finalGold ?? 0), color: (gameActionResult.finalGold as number) >= (gameActionResult.startGold as number) ? 'text-neon-green' : 'text-red-400' },
                    { label: 'Net Flow', value: `${(gameActionResult.netFlow as number) >= 0 ? '+' : ''}${gameActionResult.netFlow ?? 0}`, color: (gameActionResult.netFlow as number) >= 0 ? 'text-neon-green' : 'text-red-400' },
                    { label: 'Sustainable', value: gameActionResult.sustainable ? 'Yes' : 'No', color: gameActionResult.sustainable ? 'text-neon-green' : 'text-red-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                      <p className={`text-lg font-bold ${color}`}>{value}</p>
                      <p className="text-xs text-gray-400">{label}</p>
                    </div>
                  ))}
                </div>
                {!!gameActionResult.tip && <p className="text-xs text-gray-500 italic">{gameActionResult.tip as string}</p>}
                {Array.isArray(gameActionResult.timeline) && (
                  <div className="grid grid-cols-6 gap-1">
                    {(gameActionResult.timeline as {minute:number;gold:number}[]).slice(0,6).map(t => (
                      <div key={t.minute} className="bg-white/5 rounded p-2 text-center">
                        <p className="text-[10px] text-gray-400">Min {t.minute}</p>
                        <p className="text-xs font-mono text-neon-green">{t.gold}g</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* levelCurve */}
            {gameActionResult._action === 'levelCurve' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Level Curve</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Max Level', value: String(gameActionResult.maxLevel ?? 0), color: 'text-white' },
                    { label: 'Total XP', value: String((gameActionResult.totalXPToMax as number || 0).toLocaleString()), color: 'text-neon-cyan' },
                    { label: 'Midpoint', value: `Lv ${gameActionResult.midpointLevel ?? 0}`, color: 'text-neon-purple' },
                    { label: 'Growth', value: String(gameActionResult.growthFactor ?? 0), color: 'text-yellow-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                      <p className={`text-lg font-bold ${color}`}>{value}</p>
                      <p className="text-xs text-gray-400">{label}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400">Feel: <span className="text-white capitalize">{(gameActionResult.earlyGameFeels as string)?.replace(/-/g, ' ')}</span></p>
                {Array.isArray(gameActionResult.levels) && (
                  <div className="flex gap-1 overflow-x-auto pb-1">
                    {(gameActionResult.levels as {level:number;xpRequired:number}[]).map(l => (
                      <div key={l.level} className="shrink-0 bg-white/5 rounded p-2 text-center min-w-[48px]">
                        <p className="text-[10px] text-gray-400">Lv {l.level}</p>
                        <p className="text-[10px] font-mono text-neon-green">{(l.xpRequired / 1000).toFixed(1)}k</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* dropRateCalc */}
            {gameActionResult._action === 'dropRateCalc' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Drop Rate Calculator</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { label: 'Drop Rate', value: String(gameActionResult.dropRate ?? '—'), color: 'text-neon-cyan' },
                    { label: 'Expected Drops', value: String(gameActionResult.expectedDrops ?? 0), color: 'text-white' },
                    { label: 'P(≥1)', value: String(gameActionResult.probabilityAtLeastOne ?? '—'), color: 'text-neon-green' },
                    { label: '50% Chance', value: `${gameActionResult.attemptsFor50Percent ?? 0} tries`, color: 'text-yellow-400' },
                    { label: '90% Chance', value: `${gameActionResult.attemptsFor90Percent ?? 0} tries`, color: 'text-orange-400' },
                    { label: '99% Chance', value: `${gameActionResult.attemptsFor99Percent ?? 0} tries`, color: 'text-red-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                      <p className={`text-sm font-bold ${color}`}>{value}</p>
                      <p className="text-xs text-gray-400">{label}</p>
                    </div>
                  ))}
                </div>
                {!!gameActionResult.pitySystemSuggestion && (
                  <p className="text-xs text-neon-cyan bg-neon-cyan/5 border border-neon-cyan/20 rounded px-3 py-2">{gameActionResult.pitySystemSuggestion as string}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {realtimeData && (
        <RealtimeDataPanel
          domain="game"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
