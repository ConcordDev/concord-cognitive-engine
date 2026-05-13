'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Confetti from 'react-confetti';
import {
  Trophy,
  Target,
  Flame,
  Clock,
  Sparkles,
  Crown,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  iconColor: string;
  bgColor: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  progress?: number;
  maxProgress?: number;
  unlockedAt?: Date;
  xpReward: number;
}

interface AchievementsProps {
  achievements: Achievement[];
  totalXP: number;
  level: number;
  xpToNextLevel: number;
  streak: number;
  className?: string;
}

const rarityConfig = {
  common: { color: 'text-gray-400', border: 'border-gray-500', bg: 'bg-gray-500/10' },
  rare: { color: 'text-blue-400', border: 'border-blue-500', bg: 'bg-blue-500/10' },
  epic: { color: 'text-purple-400', border: 'border-purple-500', bg: 'bg-purple-500/10' },
  legendary: { color: 'text-yellow-400', border: 'border-yellow-500', bg: 'bg-yellow-500/10' }
};

export function Achievements({
  achievements,
  totalXP,
  level,
  xpToNextLevel,
  streak,
  className
}: AchievementsProps) {
  const [filter, setFilter] = useState<'all' | 'unlocked' | 'locked'>('all');

  const unlockedAchievements = achievements.filter(a => a.unlockedAt);
  const lockedAchievements = achievements.filter(a => !a.unlockedAt);

  const filteredAchievements = filter === 'all'
    ? achievements
    : filter === 'unlocked'
      ? unlockedAchievements
      : lockedAchievements;

  const xpProgress = ((totalXP % xpToNextLevel) / xpToNextLevel) * 100;

  return (
    <div className={cn('space-y-6', className)}>
      {/* Stats Header */}
      <div className="grid grid-cols-3 gap-4">
        {/* Level */}
        <div className="p-4 bg-gradient-to-br from-neon-purple/20 to-neon-cyan/20 border border-neon-purple/30 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-neon-purple/30 rounded-lg">
              <Crown className="w-6 h-6 text-neon-purple" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">Level {level}</p>
              <p className="text-xs text-gray-400">{totalXP.toLocaleString()} XP total</p>
            </div>
          </div>
          <div className="mt-3">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Progress to Level {level + 1}</span>
              <span>{Math.round(xpProgress)}%</span>
            </div>
            <div className="h-2 bg-lattice-surface rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${xpProgress}%` }}
                transition={{ duration: 0.5 }}
                className="h-full bg-gradient-to-r from-neon-purple to-neon-cyan rounded-full"
              />
            </div>
          </div>
        </div>

        {/* Streak */}
        <div className="p-4 bg-gradient-to-br from-orange-500/20 to-red-500/20 border border-orange-500/30 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/30 rounded-lg">
              <Flame className="w-6 h-6 text-orange-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{streak} Days</p>
              <p className="text-xs text-gray-400">Current streak</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-orange-400">
            {streak >= 7 ? '🔥 On fire!' : streak >= 3 ? '💪 Keep it up!' : 'Build your streak!'}
          </p>
        </div>

        {/* Achievements count */}
        <div className="p-4 bg-gradient-to-br from-green-500/20 to-emerald-500/20 border border-green-500/30 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/30 rounded-lg">
              <Trophy className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">
                {unlockedAchievements.length}/{achievements.length}
              </p>
              <p className="text-xs text-gray-400">Achievements</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-green-400">
            {Math.round((unlockedAchievements.length / achievements.length) * 100)}% complete
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        {(['all', 'unlocked', 'locked'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-4 py-2 text-sm rounded-lg transition-colors capitalize',
              filter === f
                ? 'bg-neon-cyan/20 text-neon-cyan'
                : 'text-gray-400 hover:text-white hover:bg-lattice-surface'
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Achievements grid */}
      <div className="grid grid-cols-2 gap-4">
        {filteredAchievements.map((achievement) => (
          <AchievementCard key={achievement.id} achievement={achievement} />
        ))}
      </div>
    </div>
  );
}

const AchievementCard = React.memo(function AchievementCard({ achievement }: { achievement: Achievement }) {
  const Icon = achievement.icon;
  const rarity = rarityConfig[achievement.rarity];
  const isUnlocked = !!achievement.unlockedAt;
  const hasProgress = achievement.progress !== undefined && achievement.maxProgress !== undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      className={cn(
        'p-4 rounded-xl border transition-colors',
        isUnlocked
          ? `${rarity.bg} ${rarity.border}`
          : 'bg-lattice-surface/50 border-lattice-border opacity-60'
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'p-2 rounded-lg',
            isUnlocked ? achievement.bgColor : 'bg-gray-700'
          )}
        >
          <Icon
            className={cn(
              'w-6 h-6',
              isUnlocked ? achievement.iconColor : 'text-gray-500'
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className={cn(
              'font-medium truncate',
              isUnlocked ? 'text-white' : 'text-gray-400'
            )}>
              {achievement.title}
            </h3>
            <span className={cn('text-xs capitalize', rarity.color)}>
              {achievement.rarity}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
            {achievement.description}
          </p>

          {hasProgress && !isUnlocked && (
            <div className="mt-2">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Progress</span>
                <span>{achievement.progress}/{achievement.maxProgress}</span>
              </div>
              <div className="h-1.5 bg-lattice-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-neon-cyan rounded-full"
                  style={{
                    width: `${(achievement.progress! / achievement.maxProgress!) * 100}%`
                  }}
                />
              </div>
            </div>
          )}

          {isUnlocked && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-neon-cyan">+{achievement.xpReward} XP</span>
              <span className="text-xs text-gray-500">
                {achievement.unlockedAt?.toLocaleDateString()}
              </span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
});

// Achievement unlock notification
interface AchievementNotificationProps {
  achievement: Achievement;
  isVisible: boolean;
  onClose: () => void;
}

export function AchievementNotification({
  achievement,
  isVisible,
  onClose
}: AchievementNotificationProps) {
  const [showConfetti, setShowConfetti] = useState(false);
  const Icon = achievement.icon;
  const rarity = rarityConfig[achievement.rarity];

  useEffect(() => {
    if (isVisible) {
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {showConfetti && achievement.rarity !== 'common' && (
            <Confetti
              width={window.innerWidth}
              height={window.innerHeight}
              recycle={false}
              numberOfPieces={achievement.rarity === 'legendary' ? 500 : 200}
              colors={['#22d3ee', '#a855f7', '#f59e0b', '#10b981']}
            />
          )}

          <motion.div
            initial={{ opacity: 0, y: -100, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -100, scale: 0.8 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div className={cn(
              'flex items-center gap-4 px-6 py-4 rounded-xl border shadow-2xl',
              rarity.bg,
              rarity.border
            )}>
              <motion.div
                initial={{ rotate: -180, scale: 0 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ type: 'spring', delay: 0.2 }}
                className={cn('p-3 rounded-xl', achievement.bgColor)}
              >
                <Icon className={cn('w-8 h-8', achievement.iconColor)} />
              </motion.div>

              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider">
                  Achievement Unlocked!
                </p>
                <h3 className="text-lg font-bold text-white">{achievement.title}</h3>
                <p className="text-sm text-gray-400">{achievement.description}</p>
                <p className="text-sm text-neon-cyan mt-1">+{achievement.xpReward} XP</p>
              </div>

              <button
                onClick={onClose}
                className="p-1 text-gray-400 hover:text-white transition-colors"
              aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Daily challenges component
interface DailyChallenge {
  id: string;
  title: string;
  description: string;
  progress: number;
  maxProgress: number;
  xpReward: number;
  completed: boolean;
}

interface DailyChallengesProps {
  challenges: DailyChallenge[];
  timeRemaining: string;
  className?: string;
}

export function DailyChallenges({ challenges, timeRemaining, className }: DailyChallengesProps) {
  const completedCount = challenges.filter(c => c.completed).length;

  return (
    <div className={cn('p-4 bg-lattice-surface border border-lattice-border rounded-xl', className)}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-neon-cyan" />
          <h3 className="font-medium text-white">Daily Challenges</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Clock className="w-3.5 h-3.5" />
          <span>{timeRemaining} remaining</span>
        </div>
      </div>

      <div className="space-y-3">
        {challenges.map(challenge => (
          <div
            key={challenge.id}
            className={cn(
              'p-3 rounded-lg border transition-colors',
              challenge.completed
                ? 'bg-green-500/10 border-green-500/30'
                : 'bg-lattice-bg border-lattice-border'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-sm font-medium',
                    challenge.completed ? 'text-green-400 line-through' : 'text-white'
                  )}>
                    {challenge.title}
                  </span>
                  {challenge.completed && (
                    <span className="text-xs text-green-400">✓</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{challenge.description}</p>
              </div>
              <span className="text-sm text-neon-cyan font-medium">
                +{challenge.xpReward} XP
              </span>
            </div>

            {!challenge.completed && (
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>{challenge.progress}/{challenge.maxProgress}</span>
                </div>
                <div className="h-1.5 bg-lattice-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-neon-cyan rounded-full transition-all"
                    style={{
                      width: `${(challenge.progress / challenge.maxProgress) * 100}%`
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-lattice-border">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">
            {completedCount}/{challenges.length} completed
          </span>
          {completedCount === challenges.length && (
            <span className="text-neon-cyan flex items-center gap-1">
              <Sparkles className="w-4 h-4" />
              All done!
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

