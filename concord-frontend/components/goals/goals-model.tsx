'use client';

/**
 * Shared types/helpers for the goals lens panels.
 * Extracted from page.tsx — no behavior changes.
 */

import { motion } from 'framer-motion';
import {
  Target, Sparkles, Flame, Trophy, Star, Award, Zap, Flag, Users, TrendingUp,
} from 'lucide-react';

export interface SubTask {
  id: string;
  label: string;
  done: boolean;
}

export interface Goal {
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

export interface Challenge {
  id: string;
  title: string;
  description: string;
  type: 'daily' | 'weekly' | 'community';
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Legendary';
  xp: number;
  progress: number;
  target: number;
  deadline?: string;
  accepted?: boolean;
}

export type GoalTab = 'goals' | 'challenges' | 'milestones' | 'okr' | 'analytics' | 'autonomy' | 'feed';

// --------------- Seed Data (empty — populated from backend) ---------------

export const GOALS_FALLBACK: Goal[] = [];

export const CHALLENGES_FALLBACK: Challenge[] = [];


// --------------- Style Mappings ---------------

export const categoryColors: Record<string, string> = {
  Career: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  Health: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  Learning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  Creative: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  Financial: 'bg-green-500/20 text-green-400 border-green-500/30',
  Personal: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
};

export const categoryDotColors: Record<string, string> = {
  Career: 'bg-purple-400',
  Health: 'bg-blue-400',
  Learning: 'bg-yellow-400',
  Creative: 'bg-pink-400',
  Financial: 'bg-green-400',
  Personal: 'bg-cyan-400',
};

export const difficultyColors: Record<string, string> = {
  Easy: 'bg-green-500/20 text-green-400',
  Medium: 'bg-yellow-500/20 text-yellow-400',
  Hard: 'bg-orange-500/20 text-orange-400',
  Legendary: 'bg-red-500/20 text-red-400',
};

export const priorityFlame: Record<string, string> = {
  low: 'text-gray-400',
  medium: 'text-yellow-400',
  high: 'text-red-400',
};


// --------------- Helpers ---------------

export function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

export function getLevel(xp: number): { label: string; color: string; next: number } {
  if (xp >= 5000) return { label: 'Legend', color: 'text-red-400', next: 10000 };
  if (xp >= 3000) return { label: 'Pro', color: 'text-purple-400', next: 5000 };
  if (xp >= 1000) return { label: 'Rising', color: 'text-cyan-400', next: 3000 };
  return { label: 'Beginner', color: 'text-gray-400', next: 1000 };
}

export function getLevelFloor(xp: number): number {
  if (xp >= 5000) return 5000;
  if (xp >= 3000) return 3000;
  if (xp >= 1000) return 1000;
  return 0;
}


// --------------- Sub-Components ---------------

export function ProgressRing({ radius, stroke, progress, color = '#22d3ee', size }: { radius: number; stroke: number; progress: number; color?: string; size: number }) {
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

export function XpLevelBar({ xp }: { xp: number }) {
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

export function WeeklyActivityBar({ goals }: { goals: Goal[] }) {
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

export function resolveIcon(iconName: string) {
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


