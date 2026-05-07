'use client';

import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────────

interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastPostDate: string;
}

interface StreakIndicatorProps {
  userId: string;
  className?: string;
}

// ── Milestone check ──────────────────────────────────────────────────────────

const MILESTONES = [7, 30, 100, 365];

function isMilestone(streak: number): boolean {
  return MILESTONES.includes(streak);
}

function getMilestoneLabel(streak: number): string | null {
  if (streak >= 365) return 'Legendary';
  if (streak >= 100) return 'On Fire';
  if (streak >= 30) return 'Dedicated';
  if (streak >= 7) return 'Getting Started';
  return null;
}

// ── Main Component ───────────────────────────────────────────────────────────

export function StreakIndicator({ userId, className }: StreakIndicatorProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['streak', userId],
    queryFn: async () => {
      const res = await api.get('/api/social/streak', {
        params: { userId },
      });
      return res.data as StreakData;
    },
    enabled: !!userId,
  });

  if (isLoading) {
    return (
      <div className={cn('inline-flex items-center gap-1', className)}>
        <Loader2 className="w-3.5 h-3.5 text-orange-400 animate-spin" />
      </div>
    );
  }

  if (!data || data.currentStreak === 0) return null;

  const milestone = isMilestone(data.currentStreak);
  const label = getMilestoneLabel(data.currentStreak);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
          milestone
            ? 'bg-orange-500/15 border border-orange-500/30'
            : 'bg-orange-500/10 border border-orange-500/20',
          className
        )}
      >
        {/* Fire emoji with animation on milestones */}
        <motion.span
          animate={
            milestone
              ? {
                  scale: [1, 1.3, 1],
                  rotate: [0, -10, 10, 0],
                }
              : {}
          }
          transition={
            milestone
              ? {
                  duration: 0.6,
                  repeat: Infinity,
                  repeatDelay: 2,
                }
              : {}
          }
          className="text-sm"
          role="img"
          aria-label="fire"
        >
          <Flame className={cn(
            'w-3.5 h-3.5',
            milestone ? 'text-orange-400' : 'text-orange-500/70'
          )} />
        </motion.span>

        <span className={cn(
          milestone ? 'text-orange-300' : 'text-orange-400/80'
        )}>
          {data.currentStreak} day streak
        </span>

        {/* Milestone badge */}
        {milestone && label && (
          <motion.span
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            className="px-1.5 py-0.5 rounded bg-orange-500/20 text-[9px] text-orange-300 font-semibold whitespace-nowrap"
          >
            {label}
          </motion.span>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

export default StreakIndicator;
