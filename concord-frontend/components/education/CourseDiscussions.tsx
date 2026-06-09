'use client';

import { useEffect, useState } from 'react';
import { MessagesSquare, Send, ThumbsUp, Loader2, Reply } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Post { id: string; courseId: string; text: string; author: string; replyTo: string | null; upvotes: number; createdAt: string }

export function CourseDiscussions({ courseId }: { courseId?: string }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [courseId]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'education', action: 'discussions-list', input: courseId ? { courseId } : {} });
      setPosts((res.data?.result?.discussions || []) as Post[]);
    } catch (e) { console.error('[Discussions] failed', e); }
    finally { setLoading(false); }
  }

  async function post() {
    if (!draft.trim() || !courseId) return;
    try {
      await lensRun({ domain: 'education', action: 'discussions-post', input: { courseId, text: draft, replyTo: replyTo || undefined } });
      setDraft(''); setReplyTo(null);
      await refresh();
    } catch (e) { console.error('[Discussions] post failed', e); }
  }

  async function upvote(id: string) {
    try {
      await lensRun({ domain: 'education', action: 'discussions-upvote', input: { id } });
      await refresh();
    } catch (e) { console.error('[Discussions] upvote failed', e); }
  }

  const topLevel = posts.filter(p => !p.replyTo);
  const repliesFor = (id: string) => posts.filter(p => p.replyTo === id);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <MessagesSquare className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Discussions{courseId ? ` · ${courseId.slice(0, 12)}` : ' (all)'}</span>
        <span className="ml-auto text-[10px] text-gray-400">{posts.length}</span>
      </header>

      {courseId && (
        <div className="p-3 border-b border-white/10 space-y-2">
          {replyTo && <div className="text-[10px] text-cyan-300 flex items-center gap-1"><Reply className="w-3 h-3" />Replying to {replyTo.slice(0, 12)}… <button onClick={() => setReplyTo(null)} className="ml-1 text-gray-400 hover:text-rose-400">×</button></div>}
          <div className="flex items-center gap-2">
            <textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder={replyTo ? 'Your reply…' : 'Ask the class a question…'} rows={2} className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white resize-none" />
            <button aria-label="Send" onClick={post} disabled={!draft.trim()} className="p-2 rounded bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-40"><Send className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : topLevel.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><MessagesSquare className="w-6 h-6 mx-auto mb-2 opacity-30" />No discussions {courseId ? 'in this course' : 'yet'}.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {topLevel.map(p => (
              <li key={p.id} className="px-3 py-2 hover:bg-white/[0.03]">
                <div className="flex items-start gap-2">
                  <div className="w-7 h-7 rounded-full bg-violet-500/20 text-violet-300 flex items-center justify-center text-xs font-bold flex-shrink-0">{p.author.slice(0, 1).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-100 whitespace-pre-wrap break-words">{p.text}</div>
                    <div className="mt-1 flex items-center gap-3 text-[10px] text-gray-400">
                      <span>{p.author}</span>
                      <span>· {new Date(p.createdAt).toLocaleString()}</span>
                      <button onClick={() => upvote(p.id)} className="inline-flex items-center gap-0.5 text-cyan-300 hover:text-cyan-200"><ThumbsUp className="w-2.5 h-2.5" />{p.upvotes}</button>
                      {courseId && <button onClick={() => setReplyTo(p.id)} className="text-violet-300 hover:text-violet-200">Reply</button>}
                    </div>
                  </div>
                </div>
                {repliesFor(p.id).map(r => (
                  <div key={r.id} className="ml-9 mt-1.5 pl-3 border-l border-violet-500/20">
                    <div className="text-xs text-gray-200 whitespace-pre-wrap break-words">{r.text}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-400">
                      <span>{r.author}</span>
                      <button onClick={() => upvote(r.id)} className={cn('inline-flex items-center gap-0.5 text-cyan-300 hover:text-cyan-200')}><ThumbsUp className="w-2.5 h-2.5" />{r.upvotes}</button>
                    </div>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CourseDiscussions;
