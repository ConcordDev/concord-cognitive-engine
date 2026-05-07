'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useMutation } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Target, Trophy, Coins, Clock, Users, Layers, ChevronDown, Swords, Award } from 'lucide-react';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Target,
  Trophy,
  Coins,
  Swords,
  Plus,
  Search,
  Trash2,
  X,
  BarChart3,
  Zap,
  Star,
  Shield,
  TrendingUp,
  Gift,
} from 'lucide-react';
import { LensPageShell } from '@/components/lens/LensPageShell';

type ModeTab = 'quests' | 'bounties' | 'achievements' | 'leaderboard' | 'rewards' | 'guilds';
type ArtifactType = 'Quest' | 'Bounty' | 'Achievement' | 'LeaderboardEntry' | 'Reward' | 'Guild';
type Status = 'open' | 'in_progress' | 'completed' | 'expired' | 'claimed' | 'active';
type Difficulty = 'easy' | 'medium' | 'hard' | 'legendary';

interface QuestArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  notes: string;
  reward?: number;
  difficulty?: Difficulty;
  deadline?: string;
  claimants?: number;
  category?: string;
  xpReward?: number;
  prerequisites?: string;
  completionCriteria?: string;
  maxParticipants?: number;
  minLevel?: number;
  guildName?: string;
  memberCount?: number;
  guildLevel?: number;
  achievementType?: string;
  rarity?: string;
  unlockedAt?: string;
  rank?: number;
  score?: number;
  streak?: number;
  rewardType?: string;
  rewardAmount?: number;
  rewardDescription?: string;
}

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Target; artifactType: ArtifactType }[] =
  [
    { id: 'quests', label: 'Quests', icon: Swords, artifactType: 'Quest' },
    { id: 'bounties', label: 'Bounties', icon: Target, artifactType: 'Bounty' },
    { id: 'achievements', label: 'Achievements', icon: Trophy, artifactType: 'Achievement' },
    { id: 'leaderboard', label: 'Leaderboard', icon: TrendingUp, artifactType: 'LeaderboardEntry' },
    { id: 'rewards', label: 'Rewards', icon: Gift, artifactType: 'Reward' },
    { id: 'guilds', label: 'Guilds', icon: Shield, artifactType: 'Guild' },
  ];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  open: { label: 'Open', color: 'green-400' },
  in_progress: { label: 'In Progress', color: 'blue-400' },
  completed: { label: 'Completed', color: 'emerald-400' },
  expired: { label: 'Expired', color: 'red-400' },
  claimed: { label: 'Claimed', color: 'yellow-400' },
  active: { label: 'Active', color: 'cyan-400' },
};

const DIFFICULTY_CONFIG: Record<Difficulty, { label: string; color: string }> = {
  easy: { label: 'Easy', color: 'neon-green' },
  medium: { label: 'Medium', color: 'neon-blue' },
  hard: { label: 'Hard', color: 'neon-purple' },
  legendary: { label: 'Legendary', color: 'neon-pink' },
};

const QUEST_CATEGORIES = [
  'Combat',
  'Exploration',
  'Knowledge',
  'Social',
  'Creative',
  'Technical',
  'Governance',
  'Economy',
  'Other',
];
const RARITY_TYPES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];
const REWARD_TYPES = ['DTU Tokens', 'XP', 'Badge', 'Title', 'Skin', 'Power-up', 'Access', 'Custom'];

export default function QuestmarketLensPage() {
  const [activeTab, setActiveTab] = useState<ModeTab>('quests');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<QuestArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);

  const [filter, setFilter] = useState<string>('all');
  const [showFeatures, setShowFeatures] = useState(true);

  const activeArtifactType = MODE_TABS.find((t) => t.id === activeTab)?.artifactType || 'Quest';
  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<QuestArtifact>('questmarket', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('questmarket');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.data as unknown as QuestArtifact).description?.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all')
      result = result.filter((i) => (i.data as unknown as QuestArtifact).status === filterStatus);
    return result;
  }, [items, searchQuery, filterStatus]);

  const handleAction = useCallback(
    async (action: string, artifactId?: string) => {
      const targetId = artifactId || filtered[0]?.id;
      if (!targetId) return;
      try {
        await runAction.mutateAsync({ id: targetId, action });
      } catch (err) {
        console.error('Action failed:', err);
      }
    },
    [filtered, runAction]
  );

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormStatus('open');
    setFormNotes('');
    setFormReward('');
    setFormDifficulty('medium');
    setFormDeadline('');
    setFormCategory(QUEST_CATEGORIES[0]);
    setFormXpReward('');
    setFormPrerequisites('');
    setFormCompletionCriteria('');
    setFormMaxParticipants('');
    setFormMinLevel('');
    setFormGuildName('');
    setFormMemberCount('');
    setFormRarity(RARITY_TYPES[0]);
    setFormScore('');
    setFormRewardType(REWARD_TYPES[0]);
    setFormRewardAmount('');
  };

  const openCreate = () => {
    setEditingItem(null);
    resetForm();
    setEditorOpen(true);
  };
  const openEdit = (item: LensItem<QuestArtifact>) => {
    const d = item.data as unknown as QuestArtifact;
    setEditingItem(item);
    setFormName(d.name || '');
    setFormDescription(d.description || '');
    setFormStatus(d.status || 'open');
    setFormNotes(d.notes || '');
    setFormReward(d.reward?.toString() || '');
    setFormDifficulty(d.difficulty || 'medium');
    setFormDeadline(d.deadline || '');
    setFormCategory(d.category || QUEST_CATEGORIES[0]);
    setFormXpReward(d.xpReward?.toString() || '');
    setFormPrerequisites(d.prerequisites || '');
    setFormCompletionCriteria(d.completionCriteria || '');
    setFormMaxParticipants(d.maxParticipants?.toString() || '');
    setFormMinLevel(d.minLevel?.toString() || '');
    setFormGuildName(d.guildName || '');
    setFormMemberCount(d.memberCount?.toString() || '');
    setFormRarity(d.rarity || RARITY_TYPES[0]);
    setFormScore(d.score?.toString() || '');
    setFormRewardType(d.rewardType || REWARD_TYPES[0]);
    setFormRewardAmount(d.rewardAmount?.toString() || '');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, unknown> = {
      name: formName,
      type: activeArtifactType,
      status: formStatus,
      description: formDescription,
      notes: formNotes,
      category: formCategory,
      reward: formReward ? parseInt(formReward) : undefined,
      difficulty: formDifficulty,
      deadline: formDeadline,
      xpReward: formXpReward ? parseInt(formXpReward) : undefined,
      prerequisites: formPrerequisites,
      completionCriteria: formCompletionCriteria,
      maxParticipants: formMaxParticipants ? parseInt(formMaxParticipants) : undefined,
      minLevel: formMinLevel ? parseInt(formMinLevel) : undefined,
      guildName: formGuildName,
      memberCount: formMemberCount ? parseInt(formMemberCount) : undefined,
      rarity: formRarity,
      score: formScore ? parseInt(formScore) : undefined,
      rewardType: formRewardType,
      rewardAmount: formRewardAmount ? parseInt(formRewardAmount) : undefined,
    };
    if (editingItem)
      await update(editingItem.id, {
        title: formName,
        data,
        meta: { tags: [], status: formStatus, visibility: 'private' },
      });
    else
      await create({
        title: formName,
        data,
        meta: { tags: [], status: formStatus, visibility: 'private' },
      });
    setEditorOpen(false);
  };

  const renderDashboard = () => {
    const all = items.map((i) => i.data as unknown as QuestArtifact);
    const totalRewards = all.reduce((s, q) => s + (q.reward || 0), 0);
    const completed = all.filter((q) => q.status === 'completed').length;
    const legendary = all.filter(
      (q) => q.difficulty === 'legendary' || q.rarity === 'Legendary'
    ).length;
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}>
          <Swords className="w-5 h-5 text-neon-purple mb-2" />
          <p className={ds.textMuted}>Total Items</p>
          <p className="text-xl font-bold text-white">{items.length}</p>
        </div>
        <div className={ds.panel}>
          <Trophy className="w-5 h-5 text-neon-green mb-2" />
          <p className={ds.textMuted}>Completed</p>
          <p className="text-xl font-bold text-white">{completed}</p>
        </div>
        <div className={ds.panel}>
          <Coins className="w-5 h-5 text-yellow-400 mb-2" />
          <p className={ds.textMuted}>Rewards Pool</p>
          <p className="text-xl font-bold text-white">{totalRewards.toLocaleString()}</p>
        </div>
        <div className={ds.panel}>
          <Star className="w-5 h-5 text-neon-pink mb-2" />
          <p className={ds.textMuted}>Legendary</p>
          <p className="text-xl font-bold text-white">{legendary}</p>
        </div>
      </div>
    );
  };

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />
      </div>
    );
  }
  return (
    <div data-lens-theme="questmarket" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎯</span>
          <div>
            <h1 className="text-xl font-bold">Questmarket Lens</h1>
            <p className="text-sm text-gray-400">
              Bounty board for DTU tasks and challenges
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="questmarket" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-neon-green" />
          <span className="font-bold">{myQuests?.filter((q: Record<string, unknown>) => q.status === 'completed').length || 0}</span>
          <span className="text-gray-400 text-sm">completed</span>
        </div>
      </header>


      {/* AI Actions */}
      <UniversalActions domain="questmarket" artifactId={questItems[0]?.id} compact />

      {/* Stats Row */}
      {(() => { const available = quests.filter(q => q.status === 'open').length; const completed = quests.filter(q => q.status === 'completed').length; const totalReward = quests.reduce((s, q) => s + (q.reward || 0), 0); return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="lens-card"><Swords className="w-5 h-5 text-neon-purple mb-2" /><p className="text-2xl font-bold">{available}</p><p className="text-sm text-gray-400">Quests Available</p></div>
          <div className="lens-card"><Trophy className="w-5 h-5 text-neon-green mb-2" /><p className="text-2xl font-bold">{completed}</p><p className="text-sm text-gray-400">Completed</p></div>
          <div className="lens-card"><Coins className="w-5 h-5 text-yellow-400 mb-2" /><p className="text-2xl font-bold">{totalReward.toLocaleString()}</p><p className="text-sm text-gray-400">Reward Total</p></div>
          <div className="lens-card"><Award className="w-5 h-5 text-neon-cyan mb-2" /><p className="text-2xl font-bold">{quests.filter(q => q.difficulty === 'legendary').length}</p><p className="text-sm text-gray-400">Legendary</p></div>
        </div>
      ); })()}

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {['all', 'open', 'in_progress', 'completed'].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              filter === status
                ? 'bg-neon-blue/20 text-neon-blue border border-neon-blue/30'
                : 'bg-lattice-surface text-gray-400 hover:text-white'
            }`}
          >
            {status.replace('_', ' ').charAt(0).toUpperCase() +
              status.replace('_', ' ').slice(1)}
          </button>
        ))}
      </div>

      {/* Quest Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {quests?.length === 0 ? (
          <p className="col-span-full text-center py-12 text-gray-500">
            No quests available. Check back later!
          </p>
        ) : (
          quests?.map((quest: Quest, index: number) => (
            <motion.div
              key={quest.id}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}
              className="lens-card hover:glow-purple relative overflow-hidden"
            >
              {/* Difficulty Badge */}
              <div className="absolute top-2 right-2">
                <span
                  className={`text-xs px-2 py-1 rounded border ${
                    difficultyColors[quest.difficulty]
                  }`}
                >
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Category</label>
                <select
                  className={ds.select}
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                >
                  {QUEST_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </motion.div>
          ))
        )}

            {(activeArtifactType === 'Quest' || activeArtifactType === 'Bounty') && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Difficulty</label>
                    <select
                      className={ds.select}
                      value={formDifficulty}
                      onChange={(e) => setFormDifficulty(e.target.value as Difficulty)}
                    >
                      {Object.entries(DIFFICULTY_CONFIG).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Reward (DTU)</label>
                    <input
                      type="number"
                      className={ds.input}
                      value={formReward}
                      onChange={(e) => setFormReward(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>XP Reward</label>
                    <input
                      type="number"
                      className={ds.input}
                      value={formXpReward}
                      onChange={(e) => setFormXpReward(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Deadline</label>
                    <input
                      type="date"
                      className={ds.input}
                      value={formDeadline}
                      onChange={(e) => setFormDeadline(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Max Participants</label>
                    <input
                      type="number"
                      className={ds.input}
                      value={formMaxParticipants}
                      onChange={(e) => setFormMaxParticipants(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Min Level</label>
                    <input
                      type="number"
                      className={ds.input}
                      value={formMinLevel}
                      onChange={(e) => setFormMinLevel(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Completion Criteria</label>
                  <textarea
                    className={ds.textarea}
                    rows={2}
                    value={formCompletionCriteria}
                    onChange={(e) => setFormCompletionCriteria(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Prerequisites</label>
                  <input
                    className={ds.input}
                    value={formPrerequisites}
                    onChange={(e) => setFormPrerequisites(e.target.value)}
                  />
                </div>
              </>
            )}

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="questmarket" />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEditorOpen(false)} className={ds.btnSecondary}>
              Cancel
            </button>
            <button onClick={handleSave} className={ds.btnPrimary} disabled={!formName.trim()}>
              Save
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderLibrary = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            className={cn(ds.input, 'pl-10')}
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className={cn(ds.select, 'w-auto')}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="all">All Status</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button onClick={openCreate} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> New
        </button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-neon-purple border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <Target className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No {activeArtifactType} items yet</p>
          <button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}>
            <Plus className="w-4 h-4" /> Create First
          </button>
        </div>
      ) : (
        filtered.map((item, index) => {
          const d = item.data as unknown as QuestArtifact;
          const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.open;
          const dc = d.difficulty ? DIFFICULTY_CONFIG[d.difficulty] : null;
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={ds.panelHover}
              onClick={() => openEdit(item)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Target className="w-5 h-5 text-neon-purple" />
                  <div>
                    <p className="text-white font-medium">{d.name || item.title}</p>
                    <p className={ds.textMuted}>
                      {d.category && <span>{d.category} </span>}
                      {d.guildName && <span>{d.guildName} </span>}
                      {d.rarity && <span>&middot; {d.rarity} </span>}
                      {d.completionCriteria && (
                        <span>&middot; {d.completionCriteria.slice(0, 40)}... </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {d.reward && (
                    <span className="text-xs text-neon-green font-bold flex items-center gap-1">
                      <Coins className="w-3 h-3" />
                      {d.reward}
                    </span>
                  )}
                  {d.score && (
                    <span className="text-xs text-neon-cyan">{d.score.toLocaleString()}pts</span>
                  )}
                  {dc && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full bg-${dc.color}/20 text-${dc.color}`}
                    >
                      {dc.label}
                    </span>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}
                  >
                    {sc.label}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAction('claim', item.id);
                    }}
                    className={ds.btnGhost}
                  >
                    <Zap className="w-4 h-4 text-neon-purple" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(item.id);
                    }}
                    className={ds.btnGhost}
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })
      )}
    </div>
  );

  return (
    <LensPageShell
      domain="questmarket"
      title="Questmarket"
      description="Quests, bounties, achievements, leaderboards, rewards, and guilds"
      headerIcon={<Target className="w-5 h-5 text-white" />}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={refetch}
      actions={
        <>
          {runAction.isPending && (
            <span className="text-xs text-neon-purple animate-pulse">AI processing...</span>
          )}
          <button
            onClick={() => setShowDashboard(!showDashboard)}
            className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}
          >
            <BarChart3 className="w-4 h-4" /> Dashboard
          </button>
        </>
      }
    >
      <UniversalActions domain="questmarket" artifactId={items[0]?.id} compact />

      {(() => {
        const all = items.map((i) => i.data as unknown as QuestArtifact);
        const totalRewards = all.reduce((s, q) => s + (q.reward || 0), 0);
        const completed = all.filter((q) => q.status === 'completed').length;
        const legendary = all.filter(
          (q) => q.difficulty === 'legendary' || q.rarity === 'Legendary'
        ).length;
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className={ds.panel}>
              <Swords className="w-5 h-5 text-neon-purple mb-2" />
              <p className={ds.textMuted}>Total Items</p>
              <p className="text-xl font-bold text-white">{items.length}</p>
            </div>
            <div className={ds.panel}>
              <Trophy className="w-5 h-5 text-neon-green mb-2" />
              <p className={ds.textMuted}>Completed</p>
              <p className="text-xl font-bold text-white">{completed}</p>
            </div>
            <div className={ds.panel}>
              <Coins className="w-5 h-5 text-yellow-400 mb-2" />
              <p className={ds.textMuted}>Reward Pool</p>
              <p className="text-xl font-bold text-white">{totalRewards.toLocaleString()}</p>
            </div>
            <div className={ds.panel}>
              <Star className="w-5 h-5 text-neon-pink mb-2" />
              <p className={ds.textMuted}>Legendary</p>
              <p className="text-xl font-bold text-white">{legendary}</p>
            </div>
          </div>
        );
      })()}

      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setShowDashboard(false);
            }}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
              activeTab === tab.id && !showDashboard
                ? 'bg-neon-purple/20 text-neon-purple'
                : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </nav>
      {showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}
    </LensPageShell>
  );
}
