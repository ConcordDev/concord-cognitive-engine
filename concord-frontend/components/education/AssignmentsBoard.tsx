'use client';

import { useEffect, useState } from 'react';
import { ClipboardList, Plus, Loader2, Send, Users, ChevronDown, ChevronRight, Star, MessageSquare } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Assignment {
  id: string; courseId: string; title: string; description: string;
  dueAt: string | null; peerReviewCount: number; maxPoints: number;
}
interface PeerReview { reviewerId: string; score: number; feedback: string; reviewedAt: string }
interface Submission {
  id: string; assignmentId: string; text: string; submittedAt: string;
  grade: number | null; peerReviews: PeerReview[]; status: string;
}

const STATUS_TONE: Record<string, string> = {
  submitted: 'bg-cyan-500/15 text-cyan-300',
  awaiting_peer_review: 'bg-violet-500/15 text-violet-300',
};

export function AssignmentsBoard({ courseId }: { courseId?: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [submittingFor, setSubmittingFor] = useState<string | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [form, setForm] = useState({ title: '', description: '', dueAt: '', peerReviewCount: '3', maxPoints: '100' });

  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const [subsByAssignment, setSubsByAssignment] = useState<Record<string, Submission[]>>({});
  const [subsLoading, setSubsLoading] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewScore, setReviewScore] = useState('80');
  const [reviewFeedback, setReviewFeedback] = useState('');

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
      if (expandedFor === submittingFor) await loadSubmissions(submittingFor);
      await refresh();
    } catch (e) { console.error('[Assignments] submit failed', e); }
  }

  async function loadSubmissions(assignmentId: string) {
    setSubsLoading(assignmentId);
    try {
      const res = await lensRun({ domain: 'education', action: 'assignments-submissions', input: { assignmentId } });
      setSubsByAssignment(prev => ({ ...prev, [assignmentId]: (res.data?.result?.submissions || []) as Submission[] }));
    } catch (e) { console.error('[Assignments] submissions failed', e); }
    finally { setSubsLoading(null); }
  }

  async function toggleSubmissions(assignmentId: string) {
    if (expandedFor === assignmentId) { setExpandedFor(null); return; }
    setExpandedFor(assignmentId);
    if (!subsByAssignment[assignmentId]) await loadSubmissions(assignmentId);
  }

  async function submitReview(assignmentId: string, submissionId: string) {
    const feedback = reviewFeedback.trim();
    if (!feedback) return;
    try {
      await lensRun({ domain: 'education', action: 'assignments-peer-review', input: { submissionId, score: Number(reviewScore) || 0, feedback } });
      setReviewingId(null); setReviewFeedback(''); setReviewScore('80');
      await loadSubmissions(assignmentId);
    } catch (e) { console.error('[Assignments] peer-review failed', e); }
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

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : assignments.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><ClipboardList className="w-6 h-6 mx-auto mb-2 opacity-30" />No assignments {courseId ? 'for this course' : 'yet'}.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {assignments.map(a => {
              const subs = subsByAssignment[a.id] || [];
              const expanded = expandedFor === a.id;
              return (
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
                  <div className="mt-1 ml-6 flex items-center gap-3">
                    <button onClick={() => setSubmittingFor(a.id)} className="text-[11px] text-cyan-300 hover:text-cyan-200">+ Submit</button>
                    <button onClick={() => toggleSubmissions(a.id)} className="text-[11px] text-gray-400 hover:text-white inline-flex items-center gap-0.5">
                      {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      Submissions {subs.length > 0 && `(${subs.length})`}
                    </button>
                  </div>
                )}

                {expanded && (
                  <div className="mt-2 ml-6 space-y-2 border-l border-white/10 pl-3">
                    {subsLoading === a.id ? (
                      <div className="flex items-center gap-2 text-[11px] text-gray-400 py-2"><Loader2 className="w-3 h-3 animate-spin" />Loading submissions…</div>
                    ) : subs.length === 0 ? (
                      <div className="text-[11px] text-gray-400 py-2">No submissions yet.</div>
                    ) : (
                      subs.map(sub => (
                        <div key={sub.id} className="rounded border border-white/10 bg-white/[0.02] p-2">
                          <div className="flex items-center gap-2">
                            <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', STATUS_TONE[sub.status] || 'bg-white/10 text-gray-300')}>{sub.status.replace(/_/g, ' ')}</span>
                            <span className="text-[10px] text-gray-400 ml-auto">{new Date(sub.submittedAt).toLocaleString()}</span>
                          </div>
                          <p className="text-[11px] text-gray-200 mt-1 whitespace-pre-wrap">{sub.text}</p>
                          {sub.peerReviews.length > 0 && (
                            <div className="mt-1.5 space-y-1">
                              {sub.peerReviews.map((r, i) => (
                                <div key={i} className="flex items-start gap-1.5 text-[10px] text-emerald-300">
                                  <Star className="w-2.5 h-2.5 mt-0.5 fill-emerald-300" />
                                  <span className="font-mono font-bold">{r.score}</span>
                                  <span className="text-gray-300 flex-1">{r.feedback}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {reviewingId === sub.id ? (
                            <div className="mt-2 space-y-1.5">
                              <div className="flex items-center gap-2">
                                <label className="text-[10px] text-gray-400">Score</label>
                                <input type="number" min="0" max="100" value={reviewScore} onChange={e => setReviewScore(e.target.value)} className="w-16 px-1.5 py-0.5 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white" />
                              </div>
                              <textarea value={reviewFeedback} onChange={e => setReviewFeedback(e.target.value)} placeholder="Feedback…" rows={2} className="w-full px-2 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white resize-none" autoFocus />
                              <div className="flex items-center gap-2">
                                <button onClick={() => submitReview(a.id, sub.id)} className="px-2.5 py-1 text-[10px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Save review</button>
                                <button onClick={() => { setReviewingId(null); setReviewFeedback(''); }} className="px-2 py-1 text-[10px] text-gray-400">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <button onClick={() => { setReviewingId(sub.id); setReviewScore('80'); setReviewFeedback(''); }} className="mt-1.5 text-[10px] text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
                              <MessageSquare className="w-2.5 h-2.5" />Peer review
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </li>
            );})}
          </ul>
        )}
      </div>
    </div>
  );
}

export default AssignmentsBoard;
