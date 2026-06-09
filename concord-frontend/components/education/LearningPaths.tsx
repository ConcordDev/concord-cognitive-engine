'use client';

import { useCallback, useEffect, useState } from 'react';
import { Route, Plus, Loader2, Lock, Unlock, CheckCircle, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PathStep {
  courseId: string; courseTitle: string; totalLessons: number;
  completedLessons: number; progressPct: number; courseComplete: boolean; unlocked: boolean;
}
interface LearningPath {
  id: string; title: string; description: string;
  steps: PathStep[]; totalSteps: number; completedSteps: number;
  progressPct: number; complete: boolean;
}
interface CourseOpt { id: string; title: string }

/**
 * Learning paths — prerequisite-sequenced course chains. A step
 * unlocks only when every prior step's course is fully completed.
 */
export function LearningPaths() {
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [courses, setCourses] = useState<CourseOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        lensRun('education', 'paths-list', {}),
        lensRun('education', 'courses-list', {}),
      ]);
      if (p.data?.ok) setPaths((p.data.result as { paths: LearningPath[] }).paths || []);
      if (c.data?.ok) setCourses(((c.data.result as { courses: CourseOpt[] }).courses || []).map(x => ({ id: x.id, title: x.title })));
    } catch (e) { console.error('[Paths] refresh failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function createPath() {
    if (!title.trim() || picked.length === 0) return;
    try {
      const r = await lensRun('education', 'paths-create', {
        title: title.trim(), description: description.trim(), courseIds: picked,
      });
      if (r.data?.ok) {
        setTitle(''); setDescription(''); setPicked([]); setCreating(false);
        await refresh();
      }
    } catch (e) { console.error('[Paths] create failed', e); }
  }

  async function deletePath(id: string) {
    try {
      const r = await lensRun('education', 'paths-delete', { id });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[Paths] delete failed', e); }
  }

  async function reorder(path: LearningPath, idx: number, dir: -1 | 1) {
    const ids = path.steps.map(s => s.courseId);
    const swap = idx + dir;
    if (swap < 0 || swap >= ids.length) return;
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    try {
      const r = await lensRun('education', 'paths-reorder', { id: path.id, courseIds: ids });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[Paths] reorder failed', e); }
  }

  function togglePick(id: string) {
    setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
          <Route className="w-4 h-4 text-neon-cyan" /> Learning paths
        </h3>
        <button
          onClick={() => setCreating(c => !c)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 font-bold"
        >
          <Plus className="w-3.5 h-3.5" /> {creating ? 'Cancel' : 'New path'}
        </button>
      </div>

      {creating && (
        <div className="panel p-4 space-y-3 border border-neon-cyan/20 rounded-lg">
          <input
            value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Path title (e.g. Data Science Track)"
            className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-sm text-white"
          />
          <input
            value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-xs text-white"
          />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
              Pick courses in prerequisite order ({picked.length} selected)
            </p>
            {courses.length === 0 ? (
              <p className="text-xs text-gray-400">No courses exist yet. Create courses first.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {courses.map(c => {
                  const order = picked.indexOf(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => togglePick(c.id)}
                      className={cn(
                        'w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 border transition-colors',
                        order >= 0 ? 'bg-neon-cyan/10 border-neon-cyan/30' : 'border-white/10 hover:bg-white/5',
                      )}
                    >
                      {order >= 0 && (
                        <span className="w-5 h-5 rounded-full bg-neon-cyan text-black text-[10px] font-bold flex items-center justify-center shrink-0">
                          {order + 1}
                        </span>
                      )}
                      <span className="text-gray-200">{c.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            onClick={createPath}
            disabled={!title.trim() || picked.length === 0}
            className="text-xs px-3 py-1.5 rounded bg-neon-cyan text-black font-bold disabled:opacity-40"
          >
            Create path
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-6">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading paths…
        </div>
      ) : paths.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No learning paths yet. Sequence courses into a prerequisite track.</p>
      ) : (
        <div className="space-y-4">
          {paths.map(path => (
            <div key={path.id} className="panel p-4 space-y-3 border border-white/10 rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-sm font-bold text-white">{path.title}</h4>
                  {path.description && <p className="text-xs text-gray-400">{path.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('text-xs font-bold', path.complete ? 'text-neon-green' : 'text-gray-400')}>
                    {path.completedSteps}/{path.totalSteps} · {path.progressPct}%
                  </span>
                  <button aria-label="Delete" onClick={() => deletePath(path.id)} className="text-gray-400 hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-neon-cyan rounded-full" style={{ width: `${path.progressPct}%` }} />
              </div>
              <div className="space-y-2">
                {path.steps.map((step, idx) => (
                  <div
                    key={step.courseId}
                    className={cn(
                      'flex items-center gap-3 p-2.5 rounded border',
                      step.courseComplete ? 'bg-neon-green/[0.06] border-neon-green/20'
                        : step.unlocked ? 'bg-white/[0.02] border-white/10'
                        : 'bg-black/30 border-white/5 opacity-60',
                    )}
                  >
                    <div className="shrink-0">
                      {step.courseComplete ? <CheckCircle className="w-4 h-4 text-neon-green" />
                        : step.unlocked ? <Unlock className="w-4 h-4 text-neon-cyan" />
                        : <Lock className="w-4 h-4 text-gray-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        {idx + 1}. {step.courseTitle}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {step.completedLessons}/{step.totalLessons} lessons · {step.progressPct}%
                        {!step.unlocked && ' · locked until prior step complete'}
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => reorder(path, idx, -1)}
                        disabled={idx === 0}
                        className="text-gray-400 hover:text-white disabled:opacity-20"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => reorder(path, idx, 1)}
                        disabled={idx === path.steps.length - 1}
                        className="text-gray-400 hover:text-white disabled:opacity-20"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LearningPaths;
