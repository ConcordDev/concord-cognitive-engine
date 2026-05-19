'use client';

/**
 * ClassroomShell — Khan Academy + Coursera-shape silhouette.
 *
 * Header with streak fire + energy points + level badge,
 * "Today's goal" progress bar, "Continue learning" course rail
 * with progress bars, skill-tree summary tiles, recommended-next
 * row. Drop into the education lens above the existing workbench
 * and the page reads as a learning platform inside 200ms.
 */

import React from 'react';
import { Flame, Zap, Trophy, BookOpen, Target, ChevronRight, GraduationCap, Award } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ClassroomCourse {
  id: string;
  title: string;
  instructor?: string;
  progressPct: number;
  totalLessons: number;
  completedLessons: number;
  thumbnail?: string;
  category?: string;
}

export interface ClassroomShellProps {
  streak: number;
  energyPoints: number;
  level: number;
  pointsToday: number;
  dailyGoalPoints?: number;
  proficientSkills: number;
  totalSkills: number;
  certificates: number;
  enrolledCourses: ClassroomCourse[];
  recommendedCourses?: ClassroomCourse[];
  onSelectCourse?: (c: ClassroomCourse) => void;
  className?: string;
}

export function ClassroomShell({
  streak, energyPoints, level, pointsToday,
  dailyGoalPoints = 200,
  proficientSkills, totalSkills, certificates,
  enrolledCourses, recommendedCourses = [],
  onSelectCourse, className,
}: ClassroomShellProps) {
  const goalPct = Math.min(100, (pointsToday / dailyGoalPoints) * 100);
  return (
    <div className={cn('flex flex-col gap-4 p-5 bg-[#0e1117] text-gray-100', className)}>
      {/* Top hero: streak + points + level */}
      <header className="grid grid-cols-3 gap-3">
        <HeroTile icon={Flame} label="Day streak" value={streak.toString()} caption={streak === 0 ? 'Start today!' : `${streak} day${streak > 1 ? 's' : ''} in a row`} tone="orange" />
        <HeroTile icon={Zap} label="Energy points" value={energyPoints.toLocaleString()} caption={`+${pointsToday} today`} tone="amber" />
        <HeroTile icon={Trophy} label="Level" value={level.toString()} caption={`${proficientSkills}/${(level) * 5} skill points`} tone="violet" />
      </header>

      {/* Daily goal */}
      <section className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Target className="w-4 h-4 text-emerald-400" />
          <span className="text-xs uppercase tracking-wider text-gray-400">Today's goal</span>
          <span className="ml-auto text-xs font-mono tabular-nums text-emerald-300">{pointsToday} / {dailyGoalPoints} points</span>
        </div>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all" style={{ width: `${goalPct}%` }} />
        </div>
        {goalPct >= 100 && <div className="mt-1.5 text-[11px] text-emerald-300">🎉 Goal hit! You can keep going.</div>}
      </section>

      {/* Continue learning */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-gray-400 mb-2">Continue learning</h2>
        {enrolledCourses.length === 0 ? (
          <div className="text-center text-xs text-gray-500 py-8 border border-dashed border-white/10 rounded">
            No courses in progress. Enroll from the catalog to start.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {enrolledCourses.slice(0, 6).map(c => (
              <button
                key={c.id}
                onClick={() => onSelectCourse?.(c)}
                className="text-left rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-cyan-500/30 overflow-hidden transition group"
              >
                <div className="aspect-video bg-gradient-to-br from-cyan-900/30 to-violet-900/20 flex items-center justify-center">
                  <BookOpen className="w-8 h-8 text-cyan-500/40" />
                </div>
                <div className="p-2.5">
                  <div className="text-sm font-medium text-white truncate">{c.title}</div>
                  <div className="text-[10px] text-gray-500 truncate">{c.instructor || c.category}</div>
                  <div className="mt-1.5 h-1 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-cyan-400" style={{ width: `${c.progressPct}%` }} />
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[10px] text-gray-500">
                    <span>{c.completedLessons}/{c.totalLessons} lessons</span>
                    <span className="text-cyan-300 font-mono">{c.progressPct}%</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Skill + cert tiles */}
      <section className="grid grid-cols-3 gap-3">
        <StatTile icon={Target} label="Skill points" value={proficientSkills.toString()} sub={`${totalSkills} skills total`} colour="emerald" />
        <StatTile icon={Award} label="Certificates" value={certificates.toString()} sub="earned" colour="amber" />
        <StatTile icon={GraduationCap} label="Enrolled" value={enrolledCourses.length.toString()} sub="courses in progress" colour="cyan" />
      </section>

      {/* Recommended */}
      {recommendedCourses.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-gray-400 mb-2">Recommended for you</h2>
          <ul className="space-y-1">
            {recommendedCourses.slice(0, 4).map(c => (
              <li key={c.id}>
                <button onClick={() => onSelectCourse?.(c)} className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-white/[0.03]">
                  <div className="w-10 h-10 rounded bg-gradient-to-br from-violet-900/30 to-cyan-900/20 flex items-center justify-center flex-shrink-0">
                    <BookOpen className="w-5 h-5 text-violet-300/60" />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-sm text-white truncate">{c.title}</div>
                    <div className="text-[10px] text-gray-500 truncate">{c.instructor || c.category}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-600" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const TONE: Record<string, { bg: string; text: string; icon: string }> = {
  orange: { bg: 'bg-orange-500/15 border-orange-500/30', text: 'text-orange-300', icon: 'text-orange-400' },
  amber: { bg: 'bg-amber-500/15 border-amber-500/30', text: 'text-amber-300', icon: 'text-amber-400' },
  violet: { bg: 'bg-violet-500/15 border-violet-500/30', text: 'text-violet-300', icon: 'text-violet-400' },
};

function HeroTile({ icon: Icon, label, value, caption, tone }: { icon: typeof Flame; label: string; value: string; caption: string; tone: string }) {
  const t = TONE[tone] || TONE.amber;
  return (
    <div className={cn('rounded-lg border p-3', t.bg)}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={cn('w-4 h-4', t.icon)} />
        <span className="text-[10px] uppercase tracking-wider text-gray-400">{label}</span>
      </div>
      <div className={cn('text-3xl font-mono font-bold tabular-nums', t.text)}>{value}</div>
      <div className="text-[10px] text-gray-500">{caption}</div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, sub, colour }: { icon: typeof Target; label: string; value: string; sub: string; colour: string }) {
  const colourClass = colour === 'emerald' ? 'text-emerald-300' : colour === 'amber' ? 'text-amber-300' : 'text-cyan-300';
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className={cn('w-3 h-3', colourClass)} />
        <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className={cn('text-xl font-mono tabular-nums', colourClass)}>{value}</div>
      <div className="text-[10px] text-gray-500">{sub}</div>
    </div>
  );
}

export default ClassroomShell;
