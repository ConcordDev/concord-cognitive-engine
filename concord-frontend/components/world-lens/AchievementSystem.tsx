'use client';

import React, { useState, useEffect } from 'react';
import { ds } from '@/lib/design-system';
import { api } from '@/lib/api/client';

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
  achievements?: Achievement[];
  progress?: AchievementProgress[];
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

/** Raw catalog/earned rows from /api/achievements/*. Categories + rarities
 *  arrive as free-form lowercase strings; normalize to the component sets. */
interface RawAchievement {
  id?: string;
  title?: string;
  description?: string;
  icon?: string;
  rarity?: string;
  category?: string;
  achievement_id?: string;
  earned_at?: string | number;
}

const RARITY_SET: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
function normRarity(r?: string): Rarity {
  const v = (r || '').toLowerCase();
  return (RARITY_SET as string[]).includes(v) ? (v as Rarity) : 'common';
}
function normCategory(c?: string): AchievementCategory {
  const v = (c || '').toLowerCase();
  const hit = CATEGORIES.find((cat) => cat.toLowerCase() === v);
  return hit ?? 'Mastery';
}
function fmtDate(d?: string | number): string | undefined {
  if (d == null) return undefined;
  const ms = typeof d === 'number' ? (d < 1e12 ? d * 1000 : d) : Date.parse(d);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toLocaleDateString();
}

export default function AchievementSystem({ achievements: propAchievements, progress: propProgress, onShare }: AchievementSystemProps) {
  // Real achievements: /api/achievements/catalog (all definitions) merged with
  // /api/achievements/mine (the user's earned rows). No seed fallback — an
  // empty catalog renders the honest empty state below.
  const [fetched, setFetched] = useState<Achievement[]>([]);
  const achievements = (propAchievements && propAchievements.length > 0) ? propAchievements : fetched;
  const progress = propProgress ?? [];

  useEffect(() => {
    if (propAchievements && propAchievements.length > 0) return; // caller supplied data
    let cancelled = false;
    (async () => {
      try {
        const [catRes, mineRes] = await Promise.all([
          api.get('/api/achievements/catalog'),
          api.get('/api/achievements/mine').catch(() => null),
        ]);
        if (cancelled) return;
        const catalog: RawAchievement[] = Array.isArray(catRes?.data?.catalog) ? catRes.data.catalog : [];
        const earned: RawAchievement[] = Array.isArray(mineRes?.data?.earned) ? mineRes!.data.earned : [];
        const earnedMap = new Map<string, RawAchievement>();
        for (const e of earned) earnedMap.set(String(e.achievement_id ?? e.id ?? ''), e);
        const merged: Achievement[] = catalog.map((a) => {
          const id = String(a.id ?? '');
          const e = earnedMap.get(id);
          return {
            id,
            title: a.title ?? id,
            description: a.description ?? '',
            icon: a.icon ?? '🏆',
            rarity: normRarity(a.rarity),
            category: normCategory(a.category),
            unlocked: !!e,
            unlockDate: e ? fmtDate(e.earned_at) : undefined,
          };
        });
        setFetched(merged);
      } catch { /* keep empty state */ }
    })();
    return () => { cancelled = true; };
  }, [propAchievements]);
  const [activeCategory, setActiveCategory] = useState<AchievementCategory | 'All'>('All');
  const [notification, setNotification] = useState<Achievement | null>(null);
  const [notificationVisible, setNotificationVisible] = useState(false);

  const panelStyle = ds.panelFloating;

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
      {filtered.length === 0 ? (
        <div className={`${panelStyle} p-8 text-center`}>
          <p className="text-2xl mb-2">🏆</p>
          <p className="text-sm text-white/60">No achievements yet.</p>
          <p className="text-xs text-white/40 mt-1">Your legacy in Concordia will appear here as you earn it.</p>
        </div>
      ) : (
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
      )}

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
