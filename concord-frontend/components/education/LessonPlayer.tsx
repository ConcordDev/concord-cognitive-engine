'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, CheckCircle, BookOpen, Loader2, ChevronRight, FileText, Clock } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Lesson {
  id: string;
  title: string;
  videoUrl: string;
  durationMin: number;
  kind: 'video' | 'reading' | 'quiz' | 'assignment' | 'discussion';
  order: number;
}
interface Course {
  id: string;
  title: string;
  instructor: string;
  institution: string;
  category: string;
}
interface Enrollment {
  courseId: string;
  course: Course;
  totalLessons: number;
  completedLessons: number;
  progressPct: number;
}

const KIND_ICON: Record<Lesson['kind'], typeof FileText> = {
  video: Play, reading: BookOpen, quiz: FileText, assignment: FileText, discussion: FileText,
};

export function LessonPlayer() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [position, setPosition] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const completedRef = useRef(false);

  useEffect(() => { refreshEnrollments(); }, []);
  useEffect(() => { if (courseId) loadCourse(courseId); }, [courseId]);

  async function refreshEnrollments() {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', { domain: 'education', action: 'enrollments-list', input: {} });
      const data = (res.data?.result?.enrollments || []) as Enrollment[];
      setEnrollments(data);
      if (data.length > 0 && !courseId) setCourseId(data[0].courseId);
    } catch (e) { console.error('[LessonPlayer] enrollments failed', e); }
    finally { setLoading(false); }
  }

  async function loadCourse(cid: string) {
    try {
      const res = await api.post('/api/lens/run', { domain: 'education', action: 'lessons-list', input: { courseId: cid } });
      const ls = ((res.data?.result?.lessons || []) as Lesson[]).sort((a, b) => a.order - b.order);
      setLessons(ls);
      setActiveLesson(ls[0] || null);
      completedRef.current = false;

      // Track completed lessons from enrollments aggregate (best-effort)
      const enr = enrollments.find(e => e.courseId === cid);
      if (enr && enr.completedLessons >= ls.length) {
        setCompletedIds(new Set(ls.map(l => l.id)));
      } else {
        // We don't have a per-lesson "completed" macro yet; reset on course change
        setCompletedIds(new Set());
      }
    } catch (e) { console.error('[LessonPlayer] lessons failed', e); }
  }

  async function markComplete(lessonId: string) {
    if (!courseId || completedIds.has(lessonId)) return;
    try {
      await api.post('/api/lens/run', { domain: 'education', action: 'lessons-complete', input: { courseId, lessonId } });
      setCompletedIds(prev => new Set([...prev, lessonId]));
      await refreshEnrollments();
    } catch (e) { console.error('[LessonPlayer] complete failed', e); }
  }

  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v || !activeLesson) return;
    setPosition(v.currentTime);
    if (!completedRef.current && v.duration > 0 && v.currentTime / v.duration >= 0.9) {
      completedRef.current = true;
      markComplete(activeLesson.id);
    }
  }

  function onEnded() {
    if (!activeLesson) return;
    if (!completedRef.current) {
      completedRef.current = true;
      markComplete(activeLesson.id);
    }
    const next = lessons[lessons.findIndex(l => l.id === activeLesson.id) + 1];
    if (next) {
      setActiveLesson(next);
      completedRef.current = false;
    }
  }

  const activeEnrollment = enrollments.find(e => e.courseId === courseId);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Play className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Lesson player</span>
        <select
          value={courseId || ''}
          onChange={e => setCourseId(e.target.value)}
          disabled={enrollments.length === 0}
          className="ml-auto text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white max-w-[200px] truncate"
        >
          {enrollments.length === 0 && <option value="">No enrollments</option>}
          {enrollments.map(e => (
            <option key={e.courseId} value={e.courseId}>{e.course?.title || e.courseId}</option>
          ))}
        </select>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : enrollments.length === 0 ? (
        <div className="px-3 py-10 text-center text-xs text-gray-500">
          <GraduationCapEmpty />
          Enroll in a course to start watching lessons.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-0">
          {/* Lesson list (left rail) */}
          <aside className="border-r border-white/10 max-h-[28rem] overflow-y-auto">
            {lessons.length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-gray-500">No lessons in this course yet.</div>
            ) : (
              <ul className="divide-y divide-white/5">
                {lessons.map(l => {
                  const Icon = KIND_ICON[l.kind] || FileText;
                  const done = completedIds.has(l.id);
                  const active = activeLesson?.id === l.id;
                  return (
                    <li
                      key={l.id}
                      onClick={() => { setActiveLesson(l); completedRef.current = done; }}
                      className={cn(
                        'px-3 py-2 cursor-pointer flex items-start gap-2 hover:bg-white/[0.03]',
                        active && 'bg-cyan-500/10 border-l-2 border-cyan-400',
                      )}
                    >
                      {done ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mt-0.5" /> : <Icon className="w-3.5 h-3.5 text-gray-500 mt-0.5" />}
                      <div className="flex-1 min-w-0">
                        <div className={cn('text-xs truncate', done ? 'text-gray-400 line-through' : 'text-white')}>{l.order}. {l.title}</div>
                        <div className="text-[10px] text-gray-500 flex items-center gap-1.5"><Clock className="w-2.5 h-2.5" />{l.durationMin || '—'} min · {l.kind}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* Player (right) */}
          <main className="col-span-2 p-3 space-y-2">
            {activeLesson ? (
              <>
                <div className="bg-black rounded overflow-hidden aspect-video relative">
                  {activeLesson.videoUrl ? (
                    <video
                      ref={videoRef}
                      key={activeLesson.id}
                      src={activeLesson.videoUrl}
                      controls
                      onTimeUpdate={onTimeUpdate}
                      onEnded={onEnded}
                      className="w-full h-full"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 text-xs">
                      <FileText className="w-8 h-8 mb-2 opacity-30" />
                      <div>{activeLesson.kind === 'video' ? 'No video URL set for this lesson.' : `This is a ${activeLesson.kind} lesson.`}</div>
                      <button
                        onClick={() => markComplete(activeLesson.id)}
                        disabled={completedIds.has(activeLesson.id)}
                        className="mt-3 px-3 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40"
                      >
                        {completedIds.has(activeLesson.id) ? 'Completed' : 'Mark complete'}
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm text-white font-semibold flex-1 truncate">{activeLesson.title}</h3>
                  {completedIds.has(activeLesson.id) && <span className="text-[10px] text-emerald-400 inline-flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Completed</span>}
                  <button
                    onClick={() => {
                      const next = lessons[lessons.findIndex(l => l.id === activeLesson.id) + 1];
                      if (next) { setActiveLesson(next); completedRef.current = completedIds.has(next.id); }
                    }}
                    className="text-[10px] px-2 py-1 rounded border border-white/10 text-gray-300 hover:bg-white/[0.05] inline-flex items-center gap-1"
                  >
                    Next <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
                {activeEnrollment && (
                  <div className="text-[10px] text-gray-500 flex items-center gap-2">
                    <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-400 transition-all" style={{ width: `${activeEnrollment.progressPct}%` }} />
                    </div>
                    <span className="font-mono text-cyan-300">{activeEnrollment.completedLessons}/{activeEnrollment.totalLessons}</span>
                  </div>
                )}
                {activeLesson.videoUrl && position > 0 && (
                  <div className="text-[10px] text-gray-500 font-mono">@ {Math.floor(position / 60)}:{String(Math.floor(position % 60)).padStart(2, '0')}</div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center py-16 text-xs text-gray-500">Pick a lesson to start.</div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function GraduationCapEmpty() {
  return <BookOpen className="w-6 h-6 mx-auto mb-2 opacity-30" />;
}

export default LessonPlayer;
