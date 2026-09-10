'use client';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Flame, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';

export const MASTERY_LEVELS = [
  { key: 'beginner',     label: 'Beginner',     color: 'text-gray-400    bg-gray-400/10    border-gray-400/30',    min: 0   },
  { key: 'intermediate', label: 'Intermediate', color: 'text-cyan-400    bg-cyan-400/10    border-cyan-400/30',    min: 40  },
  { key: 'advanced',     label: 'Advanced',     color: 'text-neon-green  bg-neon-green/10  border-neon-green/30',  min: 70  },
  { key: 'expert',       label: 'Expert',       color: 'text-amber-400   bg-amber-400/10   border-amber-400/30',   min: 90  },
] as const;

export function getMasteryLevel(score: number) {
  for (let i = MASTERY_LEVELS.length - 1; i >= 0; i--) {
    if (score >= MASTERY_LEVELS[i].min) return MASTERY_LEVELS[i];
  }
  return MASTERY_LEVELS[0];
}

export function MasteryBadge({ score }: { score: number }) {
  const lvl = getMasteryLevel(score);
  return (
    <span className={cn('px-2 py-0.5 rounded text-xs font-semibold border', lvl.color)}>
      {lvl.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Learning Streak Indicator                                          */
/* ------------------------------------------------------------------ */

export function LearningStreak({ streak = 5, best = 21 }: { streak?: number; best?: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
      <Flame className="w-4 h-4 text-amber-400 shrink-0" />
      <div>
        <span className="text-sm font-bold text-amber-400">{streak}-day streak</span>
        <span className="text-xs text-gray-400 ml-2">Best: {best}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Course Progress Bar                                                */
/* ------------------------------------------------------------------ */

export function CourseProgressBar({ label, pct, color = 'neon-cyan' }: { label: string; pct: number; color?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-300">{label}</span>
        <span className={`text-${color} font-semibold`}>{Math.round(pct)}%</span>
      </div>
      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          className={`h-full bg-${color} rounded-full`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Study Session Timer                                                */
/* ------------------------------------------------------------------ */

export function StudySessionTimer() {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [sessions, setSessions] = useState(0);
  const [goal, setGoal] = useState(25 * 60); // 25 min pomodoro
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setElapsed(e => {
          if (e + 1 >= goal) {
            setRunning(false);
            setSessions(s => s + 1);
            return 0;
          }
          return e + 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running, goal]);

  const pct = goal > 0 ? (elapsed / goal) * 100 : 0;
  const mm = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const ss = (elapsed % 60).toString().padStart(2, '0');
  const totalMin = Math.floor(goal / 60);
  const circumference = 2 * Math.PI * 28;
  const dash = (pct / 100) * circumference;

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Timer className="w-4 h-4 text-neon-cyan" /> Study Timer
        </h3>
        <span className="text-xs text-gray-400">{sessions} session{sessions !== 1 ? 's' : ''} today</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative w-16 h-16 shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
            <circle cx="32" cy="32" r="28" fill="none"
              stroke={running ? '#06b6d4' : '#6b7280'} strokeWidth="5" strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              style={{ transition: 'stroke-dasharray 0.5s linear' }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-mono font-bold text-white">{mm}:{ss}</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <select value={totalMin} onChange={e => { setGoal(parseInt(e.target.value)*60); setElapsed(0); setRunning(false); }}
              className="text-xs bg-white/5 border border-white/10 rounded px-2 py-1">
              <option value={5}>5 min</option>
              <option value={15}>15 min</option>
              <option value={25}>25 min (Pomodoro)</option>
              <option value={45}>45 min</option>
              <option value={60}>60 min</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setRunning(r => !r)}
              className={cn('px-3 py-1 rounded text-xs font-medium transition-colors',
                running ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                        : 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30')}>
              {running ? 'Pause' : 'Start'}
            </button>
            <button onClick={() => { setElapsed(0); setRunning(false); }}
              className="px-3 py-1 rounded text-xs bg-white/5 border border-white/10 hover:bg-white/10">
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */

