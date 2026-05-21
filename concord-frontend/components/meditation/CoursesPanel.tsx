'use client';

/**
 * CoursesPanel — multi-session courses / structured day-by-day programs.
 * Wires meditation.courses (list + enrollment state), meditation.enrollCourse,
 * meditation.courseProgress (per-day detail) and meditation.completeCourseDay.
 */

import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Loader2, Check, ChevronRight, CircleDot } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface CourseSummary {
  id: string; title: string; subtitle: string; goal: string;
  dayCount: number; enrolled: boolean; completedDays: number; startedAt: string | null;
}
interface CourseDay { day: number; title: string; sessionId: string; note: string; completed: boolean }
interface CourseDetail {
  courseId: string; title: string; subtitle: string; goal: string;
  startedAt: string | null; enrolled: boolean; days: CourseDay[];
  completedCount: number; dayCount: number; nextDay: number | null; finished: boolean;
}

export function CoursesPanel() {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCourses = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('meditation', 'courses', {});
    setCourses((r.data?.result?.courses as CourseSummary[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { void loadCourses(); }, [loadCourses]);

  const openCourse = useCallback(async (id: string) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id);
    setDetail(null);
    const r = await lensRun('meditation', 'courseProgress', { courseId: id });
    setDetail((r.data?.result as CourseDetail) || null);
  }, [openId]);

  const enroll = useCallback(async (id: string) => {
    setBusy(true);
    await lensRun('meditation', 'enrollCourse', { courseId: id });
    await loadCourses();
    if (openId === id) {
      const r = await lensRun('meditation', 'courseProgress', { courseId: id });
      setDetail((r.data?.result as CourseDetail) || null);
    }
    setBusy(false);
  }, [loadCourses, openId]);

  const completeDay = useCallback(async (courseId: string, day: number) => {
    setBusy(true);
    await lensRun('meditation', 'completeCourseDay', { courseId, day });
    const r = await lensRun('meditation', 'courseProgress', { courseId });
    setDetail((r.data?.result as CourseDetail) || null);
    await loadCourses();
    setBusy(false);
  }, [loadCourses]);

  if (loading) {
    return <div className="flex items-center justify-center py-8 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }

  return (
    <div className="rounded-2xl border border-amber-900/40 bg-gradient-to-b from-amber-950/15 to-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <GraduationCap className="w-4 h-4 text-amber-300" />
        <h3 className="text-sm font-bold text-zinc-100">Courses &amp; Programs</h3>
        <span className="text-[11px] text-zinc-500">structured day-by-day paths</span>
      </div>

      <div className="space-y-2">
        {courses.map((c) => {
          const open = openId === c.id;
          const pct = c.dayCount ? Math.round((c.completedDays / c.dayCount) * 100) : 0;
          return (
            <div key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
              <button type="button" onClick={() => openCourse(c.id)}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-zinc-800/40">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-100 truncate">{c.title}</span>
                    {c.enrolled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-600/30 text-amber-200">
                        {c.completedDays}/{c.dayCount}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500 truncate">{c.subtitle}</p>
                  {c.enrolled && (
                    <div className="mt-1.5 h-1 rounded-full bg-zinc-800 overflow-hidden">
                      <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
                <ChevronRight className={cn('w-4 h-4 text-zinc-500 transition-transform', open && 'rotate-90')} />
              </button>

              {open && (
                <div className="border-t border-zinc-800 p-3">
                  {!detail ? (
                    <div className="flex items-center justify-center py-3 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
                  ) : (
                    <>
                      {!detail.enrolled ? (
                        <button type="button" onClick={() => enroll(c.id)} disabled={busy}
                          className="w-full px-3 py-2 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50">
                          Enroll in {detail.title}
                        </button>
                      ) : (
                        <ol className="space-y-1.5">
                          {detail.days.map((d) => {
                            const isNext = detail.nextDay === d.day;
                            return (
                              <li key={d.day}
                                className={cn('flex items-center gap-2.5 rounded px-2 py-1.5',
                                  d.completed ? 'bg-emerald-950/30' : isNext ? 'bg-amber-950/30' : 'bg-zinc-950/40')}>
                                {d.completed
                                  ? <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                                  : <CircleDot className={cn('w-3.5 h-3.5 flex-shrink-0', isNext ? 'text-amber-400' : 'text-zinc-600')} />}
                                <div className="flex-1 min-w-0">
                                  <p className="text-[12px] text-zinc-200">
                                    <span className="text-zinc-500">Day {d.day} ·</span> {d.title}
                                  </p>
                                  <p className="text-[10px] text-zinc-500 truncate">{d.note}</p>
                                </div>
                                {!d.completed && (
                                  <button type="button" onClick={() => completeDay(c.id, d.day)} disabled={busy}
                                    className="text-[10px] px-2 py-0.5 rounded bg-amber-600/80 hover:bg-amber-500 text-white disabled:opacity-50 flex-shrink-0">
                                    Complete
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      )}
                      {detail.enrolled && detail.finished && (
                        <p className="mt-2 text-center text-xs text-emerald-300">Course complete — beautifully done.</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
