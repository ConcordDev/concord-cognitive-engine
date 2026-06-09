'use client';

import { useEffect, useState } from 'react';
import { ClipboardList, Plus, Loader2, Send, Users } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Assignment {
  id: string; courseId: string; title: string; description: string;
  dueAt: string | null; peerReviewCount: number; maxPoints: number;
}
export function AssignmentsBoard({ courseId }: { courseId?: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [submittingFor, setSubmittingFor] = useState<string | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [form, setForm] = useState({ title: '', description: '', dueAt: '', peerReviewCount: '3', maxPoints: '100' });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [courseId]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'education', action: 'assignments-list', input: courseId ? { courseId } : {} });
      setAssignments((res.data?.result?.assignments || []) as Assignment[]);
    } catch (e) { console.error('[Assignments] list failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.title.trim() || !courseId) return;
    try {
      await lensRun({
        domain: 'education', action: 'assignments-create',
        input: { courseId, title: form.title, description: form.description, dueAt: form.dueAt || undefined, peerReviewCount: Number(form.peerReviewCount) || 0, maxPoints: Number(form.maxPoints) || 100 },
      });
      setForm({ title: '', description: '', dueAt: '', peerReviewCount: '3', maxPoints: '100' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Assignments] create failed', e); }
  }

  async function submit() {
    if (!submittingFor || !submissionText.trim()) return;
    try {
      await lensRun({ domain: 'education', action: 'assignments-submit', input: { assignmentId: submittingFor, text: submissionText } });
      setSubmittingFor(null); setSubmissionText('');
      await refresh();
    } catch (e) { console.error('[Assignments] submit failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Assignments {courseId && `· ${courseId.slice(0, 12)}`}</span>
        <span className="ml-auto text-[10px] text-gray-400">{assignments.length}</span>
        {courseId && <button aria-label="Add" onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white"><Plus className="w-4 h-4" /></button>}
      </header>

      {creating && courseId && (
        <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="date" value={form.dueAt} onChange={e => setForm({ ...form, dueAt: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.maxPoints} onChange={e => setForm({ ...form, maxPoints: e.target.value })} placeholder="Max pts" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.peerReviewCount} onChange={e => setForm({ ...form, peerReviewCount: e.target.value })} placeholder="Peer reviews" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Create</button>
        </div>
      )}

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : assignments.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><ClipboardList className="w-6 h-6 mx-auto mb-2 opacity-30" />No assignments {courseId ? 'for this course' : 'yet'}.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {assignments.map(a => (
              <li key={a.id} className="px-3 py-3 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-cyan-300" />
                  <span className="text-sm font-medium text-white flex-1 truncate">{a.title}</span>
                  {a.peerReviewCount > 0 && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 inline-flex items-center gap-0.5"><Users className="w-2.5 h-2.5" />{a.peerReviewCount}×review</span>}
                  <span className="text-[10px] text-gray-400">{a.maxPoints}pts</span>
                  {a.dueAt && <span className="text-[10px] text-amber-300">due {a.dueAt}</span>}
                </div>
                {a.description && <p className="text-[11px] text-gray-400 mt-1 ml-6">{a.description}</p>}
                {submittingFor === a.id ? (
                  <div className="mt-2 ml-6 space-y-1.5">
                    <textarea value={submissionText} onChange={e => setSubmissionText(e.target.value)} placeholder="Your submission…" rows={4} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white resize-none" autoFocus />
                    <div className="flex items-center gap-2">
                      <button onClick={submit} className="px-3 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-1"><Send className="w-3 h-3" />Submit</button>
                      <button onClick={() => { setSubmittingFor(null); setSubmissionText(''); }} className="px-2 py-1 text-xs text-gray-400">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setSubmittingFor(a.id)} className="mt-1 ml-6 text-[11px] text-cyan-300 hover:text-cyan-200">+ Submit</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default AssignmentsBoard;
