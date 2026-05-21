'use client';

/**
 * HrLearningPanel — learning management: build a course catalog,
 * assign courses to employees and track completion progress.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, BookOpen, ChevronLeft } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Employee { id: string; name: string }
interface Course {
  id: string; title: string; category: string; description: string | null;
  durationHours: number; mandatory: boolean; assignedCount: number; completedCount: number;
}
interface Assignment {
  id: string; employeeId: string; employeeName: string; courseId: string;
  courseTitle: string; dueDate: string | null; progress: number; status: string;
}

export function HrLearningPanel() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [overdue, setOverdue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courseForm, setCourseForm] = useState({ title: '', category: '', durationHours: '', mandatory: false });
  const [assignForm, setAssignForm] = useState({ employeeId: '', courseId: '', dueDate: '' });
  const [openCourse, setOpenCourse] = useState<Course | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [e, c, a] = await Promise.all([
      lensRun('hr', 'employee-list', {}),
      lensRun('hr', 'course-list', {}),
      lensRun('hr', 'course-assignment-list', {}),
    ]);
    setEmployees((e.data?.result?.employees as Employee[]) || []);
    setCourses((c.data?.result?.courses as Course[]) || []);
    setAssignments((a.data?.result?.assignments as Assignment[]) || []);
    setOverdue((a.data?.result?.overdue as number) || 0);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const addCourse = async () => {
    if (!courseForm.title.trim()) { setError('Course title is required.'); return; }
    const r = await lensRun('hr', 'course-add', {
      title: courseForm.title.trim(), category: courseForm.category.trim() || undefined,
      durationHours: Number(courseForm.durationHours) || 0, mandatory: courseForm.mandatory,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setCourseForm({ title: '', category: '', durationHours: '', mandatory: false });
    setError(null);
    await refresh();
  };
  const assign = async () => {
    if (!assignForm.employeeId || !assignForm.courseId) { setError('Select an employee and a course.'); return; }
    const r = await lensRun('hr', 'course-assign', {
      employeeId: assignForm.employeeId, courseId: assignForm.courseId,
      dueDate: assignForm.dueDate || undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setAssignForm({ employeeId: '', courseId: '', dueDate: '' });
    setError(null);
    await refresh();
  };
  const setProgress = async (id: string, progress: number) => {
    const r = await lensRun('hr', 'course-progress', { id, progress });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const visibleAssignments = openCourse
    ? assignments.filter((a) => a.courseId === openCourse.id)
    : assignments;

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {openCourse ? (
        <button type="button" onClick={() => setOpenCourse(null)}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <ChevronLeft className="w-3.5 h-3.5" /> All courses
        </button>
      ) : (
        <>
          {/* Course catalog */}
          <section>
            <h3 className="text-xs font-semibold text-zinc-300 mb-2">Course catalog</h3>
            <div className="grid grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <input placeholder="Course title" value={courseForm.title}
                onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Category" value={courseForm.category}
                onChange={(e) => setCourseForm({ ...courseForm, category: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Hours" inputMode="decimal" value={courseForm.durationHours}
                onChange={(e) => setCourseForm({ ...courseForm, durationHours: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <label className="flex items-center gap-1.5 text-xs text-zinc-300">
                <input type="checkbox" checked={courseForm.mandatory}
                  onChange={(e) => setCourseForm({ ...courseForm, mandatory: e.target.checked })} />
                Mandatory
              </label>
              <button type="button" onClick={addCourse}
                className="col-span-4 flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
                <Plus className="w-3.5 h-3.5" /> Add course
              </button>
            </div>
            {courses.length > 0 && (
              <ul className="space-y-1 mt-2">
                {courses.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setOpenCourse(c)}
                      className="w-full text-left flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2 hover:border-zinc-700">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
                        <div>
                          <p className="text-xs text-zinc-100">{c.title}
                            {c.mandatory && <span className="ml-1 text-[9px] text-amber-400">MANDATORY</span>}</p>
                          <p className="text-[10px] text-zinc-500">{c.category} · {c.durationHours}h</p>
                        </div>
                      </div>
                      <span className="text-[10px] text-zinc-400">{c.completedCount}/{c.assignedCount} done</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Assignment */}
          <section>
            <h3 className="text-xs font-semibold text-zinc-300 mb-2">Assign training</h3>
            <div className="grid grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <select value={assignForm.employeeId} onChange={(e) => setAssignForm({ ...assignForm, employeeId: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                <option value="">— employee —</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <select value={assignForm.courseId} onChange={(e) => setAssignForm({ ...assignForm, courseId: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                <option value="">— course —</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
              <input type="date" value={assignForm.dueDate} onChange={(e) => setAssignForm({ ...assignForm, dueDate: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <button type="button" onClick={assign}
                className="flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
                <Plus className="w-3.5 h-3.5" /> Assign
              </button>
            </div>
          </section>
        </>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-zinc-300">
            {openCourse ? `Assignments — ${openCourse.title}` : 'Active assignments'}
          </h3>
          {overdue > 0 && <span className="text-[10px] text-rose-400">{overdue} overdue</span>}
        </div>
        {visibleAssignments.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No assignments yet.</p>
        ) : (
          <ul className="space-y-1">
            {visibleAssignments.map((a) => (
              <li key={a.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-zinc-200">{a.employeeName} · {a.courseTitle}</p>
                  <span className={cn('text-[10px] capitalize',
                    a.status === 'completed' ? 'text-emerald-300' : a.status === 'in_progress' ? 'text-amber-300' : 'text-zinc-500')}>
                    {a.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${a.progress}%` }} />
                  </div>
                  <span className="text-[10px] text-zinc-400 w-9 text-right">{a.progress}%</span>
                </div>
                <div className="flex gap-1 mt-1.5">
                  {[0, 25, 50, 75, 100].map((p) => (
                    <button key={p} type="button" onClick={() => setProgress(a.id, p)}
                      className={cn('text-[10px] px-1.5 py-0.5 rounded',
                        a.progress === p ? 'bg-emerald-700/40 text-emerald-200' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200')}>
                      {p}%
                    </button>
                  ))}
                  {a.dueDate && <span className="ml-auto text-[10px] text-zinc-500">due {a.dueDate}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
