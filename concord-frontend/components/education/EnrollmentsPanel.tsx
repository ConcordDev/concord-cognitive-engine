'use client';

import { useEffect, useState } from 'react';
import { GraduationCap, Loader2, X, BookOpen } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Enrollment {
  id: string; courseId: string; enrolledAt: string; status: string;
  course: { id: string; title: string; instructor: string; institution: string; category: string };
  totalLessons: number; completedLessons: number; progressPct: number;
}

export function EnrollmentsPanel({ onSelectCourse }: { onSelectCourse?: (courseId: string) => void }) {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'education', action: 'enrollments-list', input: {} });
      setEnrollments((res.data?.result?.enrollments || []) as Enrollment[]);
    } catch (e) { console.error('[Enrollments] failed', e); }
    finally { setLoading(false); }
  }

  async function unenroll(id: string) {
    try {
      await lensRun({ domain: 'education', action: 'enrollments-unenroll', input: { id } });
      setEnrollments(prev => prev.filter(e => e.id !== id));
    } catch (e) { console.error('[Enrollments] unenroll failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <GraduationCap className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">My enrollments</span>
        <span className="ml-auto text-[10px] text-gray-500">{enrollments.length}</span>
      </header>
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : enrollments.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><GraduationCap className="w-6 h-6 mx-auto mb-2 opacity-30" />Not enrolled in any courses yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {enrollments.map(e => (
              <li key={e.id} className="px-3 py-3 hover:bg-white/[0.03] group flex items-center gap-3">
                <div className="w-12 h-10 bg-gradient-to-br from-cyan-900/40 to-violet-900/30 rounded flex items-center justify-center flex-shrink-0">
                  <BookOpen className="w-4 h-4 text-cyan-500/60" />
                </div>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelectCourse?.(e.courseId)}>
                  <div className="text-sm text-white truncate">{e.course?.title || 'Course'}</div>
                  <div className="text-[10px] text-gray-500 truncate">{e.course?.instructor || e.course?.institution}</div>
                  <div className="mt-1 h-1 bg-white/10 rounded-full overflow-hidden">
                    <div className={cn('h-full transition-all', e.progressPct >= 100 ? 'bg-emerald-400' : 'bg-cyan-400')} style={{ width: `${e.progressPct}%` }} />
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[10px] text-gray-500">
                    <span>{e.completedLessons} / {e.totalLessons} lessons</span>
                    <span className="text-cyan-300 font-mono">{e.progressPct}%</span>
                  </div>
                </div>
                <button onClick={() => unenroll(e.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-rose-500/20 text-rose-300" title="Unenroll"><X className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default EnrollmentsPanel;
