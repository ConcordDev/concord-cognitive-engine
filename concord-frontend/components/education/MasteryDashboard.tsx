'use client';

import { useCallback, useEffect, useState } from 'react';
import { Brain, Loader2, Flame, Trophy, Video, Zap } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';
import { cn } from '@/lib/utils';

interface SkillState {
  skillId: string; name: string; subject: string;
  mastery: string; masteryScore: number; attempts: number; lastPracticedAt: string | null;
}
interface SubjectRollup { subject: string; skills: number; avgMastery: number }
interface DayActivity { date: string; points: number; active: boolean }
interface MasteryReport {
  overallMastery: number; totalSkills: number; masteredSkills: number; proficientSkills: number;
  streak: number; bestStreak: number; bestExerciseStreak: number; videosCompleted: number;
  totalPoints: number; skillStates: SkillState[]; subjects: SubjectRollup[]; activity: DayActivity[];
}

const MASTERY_COLOR: Record<string, string> = {
  not_started: 'bg-gray-600',
  attempted: 'bg-orange-500',
  familiar: 'bg-yellow-500',
  proficient: 'bg-cyan-500',
  mastered: 'bg-neon-green',
};

/**
 * Mastery / streak dashboard — knowledge-state per skill aggregated
 * from real skill mastery, exercise streaks, video coverage and the
 * 30-day energy-point activity calendar.
 */
export function MasteryDashboard() {
  const [report, setReport] = useState<MasteryReport | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('education', 'mastery-dashboard', {});
      if (r.data?.ok) setReport(r.data.result as MasteryReport);
    } catch (e) { console.error('[Mastery] refresh failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500 py-8">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading mastery dashboard…
      </div>
    );
  }

  if (!report || report.totalSkills === 0) {
    return (
      <div className="text-center py-12 text-sm text-gray-500">
        No skill data yet. Create skills and practice them to build your knowledge state.
      </div>
    );
  }

  const activityData = report.activity.map(a => ({ date: a.date.slice(5), points: a.points }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <div className="panel p-3 border border-white/10 rounded-lg">
          <Brain className="w-4 h-4 text-neon-cyan mb-1" />
          <p className="text-2xl font-bold text-white">{report.overallMastery}%</p>
          <p className="text-[10px] text-gray-500">Overall mastery</p>
        </div>
        <div className="panel p-3 border border-white/10 rounded-lg">
          <Flame className="w-4 h-4 text-amber-400 mb-1" />
          <p className="text-2xl font-bold text-white">{report.streak}</p>
          <p className="text-[10px] text-gray-500">Day streak (best {report.bestStreak})</p>
        </div>
        <div className="panel p-3 border border-white/10 rounded-lg">
          <Trophy className="w-4 h-4 text-neon-green mb-1" />
          <p className="text-2xl font-bold text-white">{report.masteredSkills}</p>
          <p className="text-[10px] text-gray-500">Skills mastered ({report.proficientSkills} proficient+)</p>
        </div>
        <div className="panel p-3 border border-white/10 rounded-lg">
          <Video className="w-4 h-4 text-purple-400 mb-1" />
          <p className="text-2xl font-bold text-white">{report.videosCompleted}</p>
          <p className="text-[10px] text-gray-500">Videos completed</p>
        </div>
      </div>

      <div className="panel p-4 border border-white/10 rounded-lg">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-1.5">
          <Zap className="w-4 h-4 text-amber-400" /> 30-day learning activity
        </h3>
        <ChartKit
          kind="area"
          data={activityData}
          xKey="date"
          series={[{ key: 'points', label: 'Energy points', color: '#22c55e' }]}
          height={180}
          showLegend={false}
        />
      </div>

      {report.subjects.length > 0 && (
        <div className="panel p-4 border border-white/10 rounded-lg">
          <h3 className="text-sm font-bold text-white mb-3">Mastery by subject</h3>
          <div className="space-y-2">
            {report.subjects.map(s => (
              <div key={s.subject} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{s.subject} ({s.skills} skill{s.skills !== 1 ? 's' : ''})</span>
                  <span className="text-neon-cyan font-bold">{s.avgMastery}%</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-neon-cyan rounded-full" style={{ width: `${s.avgMastery}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel p-4 border border-white/10 rounded-lg">
        <h3 className="text-sm font-bold text-white mb-3">Knowledge state per skill</h3>
        <div className="space-y-2">
          {report.skillStates.map(sk => (
            <div key={sk.skillId} className="flex items-center gap-3 p-2 rounded border border-white/5 bg-white/[0.02]">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-white truncate">{sk.name}</div>
                <div className="text-[10px] text-gray-500">
                  {sk.subject} · {sk.attempts} attempt{sk.attempts !== 1 ? 's' : ''}
                  {sk.lastPracticedAt ? ` · last ${new Date(sk.lastPracticedAt).toLocaleDateString()}` : ''}
                </div>
              </div>
              <div className="w-28 shrink-0">
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full', MASTERY_COLOR[sk.mastery] || 'bg-gray-600')} style={{ width: `${sk.masteryScore}%` }} />
                </div>
              </div>
              <span className="text-[10px] text-gray-400 capitalize shrink-0 w-20 text-right">
                {sk.mastery.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default MasteryDashboard;
