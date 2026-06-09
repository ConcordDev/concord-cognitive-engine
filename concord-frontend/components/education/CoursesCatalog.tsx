'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Plus, Trash2, Loader2, Search, Star } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Course {
  id: string; title: string; description: string; category: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  durationHours: number; instructor: string; institution: string;
  kind: 'course' | 'specialization' | 'certificate' | 'guided_project';
  lessons: Array<{ id: string }>;
  enrollmentCount: number; rating: number;
}

const CATEGORIES = ['general', 'math', 'science', 'data', 'humanities', 'business', 'arts', 'languages', 'coding'];
const KINDS = ['course', 'specialization', 'certificate', 'guided_project'];

export function CoursesCatalog({ onSelect, onEnroll }: { onSelect?: (c: Course) => void; onEnroll?: (c: Course) => void }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrolledIds, setEnrolledIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [form, setForm] = useState({ title: '', description: '', category: 'general', level: 'beginner', kind: 'course', durationHours: '', instructor: '', institution: '' });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [filterCategory]);

  async function refresh() {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        searchQuery.trim()
          ? lensRun({ domain: 'education', action: 'courses-search', input: { query: searchQuery } })
          : lensRun({ domain: 'education', action: 'courses-list', input: filterCategory ? { category: filterCategory } : {} }),
        lensRun({ domain: 'education', action: 'enrollments-list', input: {} }),
      ]);
      setCourses((a.data?.result?.courses || a.data?.result?.matches || []) as Course[]);
      const enrIds = new Set<string>(((b.data?.result?.enrollments || []) as Array<{ courseId: string }>).map(e => e.courseId));
      setEnrolledIds(enrIds);
    } catch (e) { console.error('[Courses] refresh failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!form.title.trim()) return;
    try {
      await lensRun({
        domain: 'education', action: 'courses-create',
        input: { ...form, durationHours: Number(form.durationHours) || 0 },
      });
      setForm({ title: '', description: '', category: 'general', level: 'beginner', kind: 'course', durationHours: '', instructor: '', institution: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Courses] add failed', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'education', action: 'courses-delete', input: { id } });
      setCourses(prev => prev.filter(c => c.id !== id));
    } catch (e) { console.error('[Courses] delete failed', e); }
  }

  async function enroll(c: Course) {
    try {
      await lensRun({ domain: 'education', action: 'enrollments-enroll', input: { courseId: c.id } });
      setEnrolledIds(prev => new Set(prev).add(c.id));
      onEnroll?.(c);
    } catch (e) { console.error('[Courses] enroll failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Course catalog</span>
        <span className="ml-auto text-[10px] text-gray-400">{courses.length}</span>
        <button aria-label="Add" onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white"><Plus className="w-4 h-4" /></button>
      </header>

      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <Search className="w-3.5 h-3.5 text-gray-400" />
        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') refresh(); }} placeholder="Search courses…" className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">{KINDS.map(k => <option key={k}>{k}</option>)}</select>
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
          <select value={form.level} onChange={e => setForm({ ...form, level: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option>beginner</option><option>intermediate</option><option>advanced</option>
          </select>
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.instructor} onChange={e => setForm({ ...form, instructor: e.target.value })} placeholder="Instructor" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.institution} onChange={e => setForm({ ...form, institution: e.target.value })} placeholder="Institution" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={add} className="col-span-6 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Add course</button>
        </div>
      )}

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : courses.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><BookOpen className="w-6 h-6 mx-auto mb-2 opacity-30" />No courses. Hit + to add one.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {courses.map(c => {
              const enrolled = enrolledIds.has(c.id);
              return (
                <li key={c.id} className="px-3 py-3 hover:bg-white/[0.03] group flex items-start gap-3">
                  <div className="w-16 h-12 bg-gradient-to-br from-cyan-900/40 to-violet-900/30 rounded flex items-center justify-center flex-shrink-0">
                    <BookOpen className="w-5 h-5 text-cyan-500/60" />
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelect?.(c)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">{c.title}</span>
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{c.kind.replace('_', ' ')}</span>
                      <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', c.level === 'advanced' ? 'bg-rose-500/15 text-rose-300' : c.level === 'intermediate' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300')}>{c.level}</span>
                    </div>
                    <div className="text-[11px] text-gray-400 line-clamp-1">{c.description}</div>
                    <div className="mt-1 flex items-center gap-3 text-[10px] text-gray-400">
                      {c.instructor && <span>{c.instructor}</span>}
                      {c.institution && <span>· {c.institution}</span>}
                      {c.durationHours > 0 && <span>· {c.durationHours}h</span>}
                      <span>· {c.lessons?.length || 0} lessons</span>
                      {c.rating > 0 && <span className="inline-flex items-center gap-0.5 text-amber-400"><Star className="w-2.5 h-2.5 fill-amber-400" />{c.rating.toFixed(1)}</span>}
                    </div>
                  </div>
                  {enrolled ? (
                    <span className="px-2 py-1 text-[10px] rounded bg-emerald-500/15 text-emerald-300 uppercase tracking-wider">Enrolled</span>
                  ) : (
                    <button onClick={() => enroll(c)} className="px-2.5 py-1 text-[11px] rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Enroll</button>
                  )}
                  <button aria-label="Delete" onClick={() => remove(c.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CoursesCatalog;
