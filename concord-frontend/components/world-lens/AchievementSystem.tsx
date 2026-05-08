'use client';

import React, { useState, useEffect } from 'react';

type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
type AchievementCategory = 'Creation' | 'Validation' | 'Citation' | 'Social' | 'Exploration' | 'Mentorship' | 'Governance' | 'Mastery';

interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  rarity: Rarity;
  category: AchievementCategory;
  unlocked: boolean;
  unlockDate?: string;
  worldImpact?: string;
}

interface AchievementProgress {
  achievementId: string;
  current: number;
  target: number;
}

interface AchievementSystemProps {
  achievements: Achievement[];
  progress: AchievementProgress[];
  onShare?: (achievement: Achievement) => void;
}

const RARITY_CONFIG: Record<Rarity, { label: string; color: string; border: string; bg: string; glow: string }> = {
  common: {
    label: 'Common',
    color: 'text-gray-400',
    border: 'border-gray-500/40',
    bg: 'bg-gray-500/10',
    glow: '',
  },
  uncommon: {
    label: 'Uncommon',
    color: 'text-green-400',
    border: 'border-green-500/40',
    bg: 'bg-green-500/10',
    glow: '',
  },
  rare: {
    label: 'Rare',
    color: 'text-blue-400',
    border: 'border-blue-500/40',
    bg: 'bg-blue-500/10',
    glow: 'shadow-[0_0_12px_rgba(59,130,246,0.3)]',
  },
  epic: {
    label: 'Epic',
    color: 'text-purple-400',
    border: 'border-purple-500/40',
    bg: 'bg-purple-500/10',
    glow: 'shadow-[0_0_16px_rgba(168,85,247,0.4)]',
  },
  legendary: {
    label: 'Legendary',
    color: 'text-amber-400',
    border: 'border-amber-500/50',
    bg: 'bg-amber-500/10',
    glow: 'shadow-[0_0_24px_rgba(245,158,11,0.5)]',
  },
};

const CATEGORIES: AchievementCategory[] = [
  'Creation', 'Validation', 'Citation', 'Social',
  'Exploration', 'Mentorship', 'Governance', 'Mastery',
];

const SEED_ACHIEVEMENTS: Achievement[] = [
  { id: 'first-validated', title: 'First Validated Structure', description: 'Successfully validate your first DTU structure.', icon: '✅', rarity: 'common', category: 'Validation', unlocked: false },
  { id: 'hundred-citations', title: 'Hundred Citations', description: 'Your work has been cited 100 times by other creators.', icon: '📚', rarity: 'rare', category: 'Citation', unlocked: false },
  { id: 'district-architect', title: 'District Architect', description: 'Design and validate 10 structures in a single district.', icon: '🏛️', rarity: 'epic', category: 'Creation', unlocked: false },
  { id: 'foundation-builder', title: 'Foundation Builder', description: 'Create a DTU that becomes the foundation for 5+ other structures.', icon: '🧱', rarity: 'uncommon', category: 'Creation', unlocked: false },
  { id: 'bridge-master', title: 'Bridge Master', description: 'Design and validate 5 bridge structures.', icon: '🌉', rarity: 'rare', category: 'Mastery', unlocked: false },
  { id: 'material-pioneer', title: 'Material Pioneer', description: 'Be the first to use a new material in a validated structure.', icon: '🔬', rarity: 'epic', category: 'Exploration', unlocked: false },
  { id: 'mentor-of-ten', title: 'Mentor of Ten', description: 'Guide 10 new creators through their first validation.', icon: '🎓', rarity: 'rare', category: 'Mentorship', unlocked: false },
  { id: 'governance-voice', title: 'Governance Voice', description: 'Participate in 20 governance votes.', icon: '🗳️', rarity: 'uncommon', category: 'Governance', unlocked: false },
  { id: 'explorer-all-districts', title: 'Explorer of All Districts', description: 'Visit and interact with every district in Concordia.', icon: '🗺️', rarity: 'rare', category: 'Exploration', unlocked: false },
  { id: 'storm-survivor', title: 'Storm Survivor', description: 'Have a structure survive a simulated environmental stress event.', icon: '⛈️', rarity: 'uncommon', category: 'Validation', unlocked: false },
  { id: 'forge-master', title: 'Forge Master', description: 'Create 50 validated DTUs.', icon: '🔥', rarity: 'epic', category: 'Mastery', unlocked: false },
  { id: 'economy-engine', title: 'Economy Engine', description: 'Earn 10,000 citation royalties.', icon: '💰', rarity: 'legendary', category: 'Citation', unlocked: false },
  { id: 'social-butterfly', title: 'Social Butterfly', description: 'Collaborate with 25 different creators.', icon: '🦋', rarity: 'uncommon', category: 'Social', unlocked: false },
  { id: 'perfect-score', title: 'Perfect Score', description: 'Achieve a perfect validation score on a complex structure.', icon: '💯', rarity: 'epic', category: 'Validation', unlocked: false },
  { id: 'legendary-creator', title: 'Legendary Creator', description: 'Reach the highest creator tier in Concordia. Your name echoes through the world.', icon: '👑', rarity: 'legendary', category: 'Mastery', unlocked: false },
];

export default function AchievementSystem({ achievements: propAchievements, progress, onShare }: AchievementSystemProps) {
  const achievements = propAchievements.length > 0 ? propAchievements : SEED_ACHIEVEMENTS;
  const [activeCategory, setActiveCategory] = useState<AchievementCategory | 'All'>('All');
  const [notification, setNotification] = useState<Achievement | null>(null);
  const [notificationVisible, setNotificationVisible] = useState(false);

  const panelStyle = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const totalCount = achievements.length;

  const filtered = activeCategory === 'All'
    ? achievements
    : achievements.filter((a) => a.category === activeCategory);

  const getProgress = (id: string) => progress.find((p) => p.achievementId === id);

  // Simulate a notification popup for demo
  useEffect(() => {
    const recentlyUnlocked = achievements.find(
      (a) => a.unlocked && a.unlockDate && isRecent(a.unlockDate)
    );
    if (recentlyUnlocked) {
      setNotification(recentlyUnlocked);
      setNotificationVisible(true);
      const timer = setTimeout(() => setNotificationVisible(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [achievements]);

  function isRecent(dateStr: string): boolean {
    const diff = Date.now() - new Date(dateStr).getTime();
    return diff < 60000; // within last minute
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-4xl relative">
      {/* Notification Popup */}
      {notification && (
        <div
          className={`fixed top-6 right-6 z-50 transition-all duration-500 ${
            notificationVisible
              ? 'translate-x-0 opacity-100'
              : 'translate-x-full opacity-0'
          }`}
        >
          <div className={`${panelStyle} p-4 flex items-center gap-3 ${RARITY_CONFIG[notification.rarity].glow}`}>
            <div className={`w-12 h-12 rounded-lg ${RARITY_CONFIG[notification.rarity].bg} ${RARITY_CONFIG[notification.rarity].border} border flex items-center justify-center text-2xl`}>
              {notification.icon}
            </div>
            <div>
              <p className="text-xs text-amber-400 uppercase tracking-wider font-semibold">Achievement Unlocked!</p>
              <p className="text-sm text-white font-bold">{notification.title}</p>
              <p className={`text-xs ${RARITY_CONFIG[notification.rarity].color}`}>
                {RARITY_CONFIG[notification.rarity].label}
              </p>
            </div>
            <button
              onClick={() => setNotificationVisible(false)}
              className="ml-2 text-white/40 hover:text-white/70 text-sm"
            >
              x
            </button>
          </div>
        </div>
      )}

      {/* Header & Counter */}
      <div className={`${panelStyle} p-4`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Achievements</h2>
            <p className="text-sm text-white/50">Your legacy in Concordia</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-white">
              {unlockedCount} <span className="text-white/30 text-lg">/ {totalCount}</span>
            </p>
            <p className="text-xs text-white/40">achievements unlocked</p>
          </div>
        </div>
        {/* Overall progress bar */}
        <div className="mt-3 w-full h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 rounded-full transition-all duration-500"
            style={{ width: `${totalCount > 0 ? (unlockedCount / totalCount) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Category Tabs */}
      <div className={`${panelStyle} p-2 flex gap-1 overflow-x-auto`}>
        <button
          onClick={() => setActiveCategory('All')}
          className={`px-3 py-1.5 rounded text-xs whitespace-nowrap transition-all ${
            activeCategory === 'All'
              ? 'bg-cyan-400/15 text-cyan-300 border border-cyan-400/40'
              : 'text-white/50 hover:text-white/70 border border-transparent'
          }`}
        >
          All
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded text-xs whitespace-nowrap transition-all ${
              activeCategory === cat
                ? 'bg-cyan-400/15 text-cyan-300 border border-cyan-400/40'
                : 'text-white/50 hover:text-white/70 border border-transparent'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Achievement Gallery */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((achievement) => {
          const rarity = RARITY_CONFIG[achievement.rarity];
          const prog = getProgress(achievement.id);

          return (
            <div
              key={achievement.id}
              className={`${panelStyle} p-4 flex flex-col gap-2 transition-all ${
                achievement.unlocked ? rarity.glow : 'opacity-60'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-12 h-12 rounded-lg border flex items-center justify-center text-2xl shrink-0 ${
                    achievement.unlocked
                      ? `${rarity.bg} ${rarity.border}`
                      : 'bg-white/5 border-white/10 grayscale'
                  }`}
                >
                  {achievement.unlocked ? achievement.icon : '🔒'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${achievement.unlocked ? 'text-white' : 'text-white/50'}`}>
                    {achievement.title}
                  </p>
                  <p className={`text-xs ${rarity.color}`}>{rarity.label}</p>
                </div>
              </div>

              <p className="text-xs text-white/50">{achievement.description}</p>

              {/* Progress bar for in-progress achievements */}
              {!achievement.unlocked && prog && (
                <div className="mt-1">
                  <div className="flex justify-between text-[10px] text-white/40 mb-1">
                    <span>Progress</span>
                    <span>{prog.current}/{prog.target}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        achievement.rarity === 'legendary'
                          ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                          : 'bg-cyan-400'
                      }`}
                      style={{ width: `${(prog.current / prog.target) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Unlock date */}
              {achievement.unlocked && achievement.unlockDate && (
                <p className="text-[10px] text-white/30">Unlocked {achievement.unlockDate}</p>
              )}

              {/* World Impact */}
              {achievement.unlocked && achievement.worldImpact && (
                <div className="mt-1 p-2 rounded bg-amber-500/10 border border-amber-500/20">
                  <p className="text-[10px] text-amber-400/80 uppercase tracking-wider font-semibold">World Impact</p>
                  <p className="text-xs text-amber-200/70 mt-0.5">{achievement.worldImpact}</p>
                </div>
              )}

              {/* Share button */}
              {achievement.unlocked && onShare && (
                <button
                  onClick={() => onShare(achievement)}
                  className="mt-1 w-full py-1.5 rounded text-xs bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70 transition-all border border-white/5"
                >
                  Share Achievement
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* World Impact Section */}
      <div className={`${panelStyle} p-4`}>
        <h3 className="text-sm font-semibold text-amber-400/80 uppercase tracking-wider mb-3">World Impact</h3>
        <p className="text-xs text-white/50 mb-3">
          Your achievements leave a lasting mark on Concordia. Unlocked impacts are visible to all citizens.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-center">
            <div className="text-2xl mb-1">🪧</div>
            <p className="text-xs text-white/70 font-medium">Plaques</p>
            <p className="text-[10px] text-white/40 mt-0.5">Your name on validated structures</p>
          </div>
          <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-center">
            <div className="text-2xl mb-1">🗿</div>
            <p className="text-xs text-white/70 font-medium">Statues</p>
            <p className="text-[10px] text-white/40 mt-0.5">Legendary creators get statues</p>
          </div>
          <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-center">
            <div className="text-2xl mb-1">🏷️</div>
            <p className="text-xs text-white/70 font-medium">Naming Rights</p>
            <p className="text-[10px] text-white/40 mt-0.5">Name a district landmark</p>
          </div>
        </div>
      </div>
    </div>
  );
}
