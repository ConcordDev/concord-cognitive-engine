'use client';

import { useCallback, useState } from 'react';
import { MessageSquare, Loader2, Send, ChevronUp, CheckCircle, Clock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface QAAnswer {
  id: string; text: string; author: string;
  accepted: boolean; upvotes: number; createdAt: string;
}
interface QAThread {
  id: string; lessonId: string; text: string; timestampSec: number;
  author: string; upvotes: number; resolved: boolean;
  answers: QAAnswer[]; createdAt: string;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Course discussion Q&A threaded to a specific lesson video
 * timestamp. Questions are anchored to a second within a lesson;
 * answers thread under them with an accepted-answer marker.
 */
export function LessonQA() {
  const [lessonId, setLessonId] = useState('');
  const [activeLesson, setActiveLesson] = useState('');
  const [threads, setThreads] = useState<QAThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [askText, setAskText] = useState('');
  const [askTime, setAskTime] = useState('0');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const load = useCallback(async (id: string) => {
    if (!id.trim()) return;
    setLoading(true);
    try {
      const r = await lensRun('education', 'lesson-qa-list', { lessonId: id });
      if (r.data?.ok) {
        setThreads((r.data.result as { threads: QAThread[] }).threads || []);
        setActiveLesson(id);
      }
    } catch (e) { console.error('[LessonQA] load failed', e); }
    finally { setLoading(false); }
  }, []);

  async function ask() {
    if (!activeLesson || !askText.trim()) return;
    try {
      const ts = askText.match(/^\s*(\d+):(\d+)/);
      let timestampSec = Number(askTime) || 0;
      if (ts) timestampSec = parseInt(ts[1]) * 60 + parseInt(ts[2]);
      const r = await lensRun('education', 'lesson-qa-ask', {
        lessonId: activeLesson, text: askText.trim(), timestampSec,
      });
      if (r.data?.ok) {
        setAskText(''); setAskTime('0');
        await load(activeLesson);
      }
    } catch (e) { console.error('[LessonQA] ask failed', e); }
  }

  async function answer(threadId: string) {
    if (!replyText.trim()) return;
    try {
      const r = await lensRun('education', 'lesson-qa-answer', { threadId, text: replyText.trim() });
      if (r.data?.ok) {
        setReplyText(''); setReplyTo(null);
        await load(activeLesson);
      }
    } catch (e) { console.error('[LessonQA] answer failed', e); }
  }

  async function accept(threadId: string, answerId: string) {
    try {
      const r = await lensRun('education', 'lesson-qa-accept', { threadId, answerId });
      if (r.data?.ok) await load(activeLesson);
    } catch (e) { console.error('[LessonQA] accept failed', e); }
  }

  async function upvote(threadId: string, answerId?: string) {
    try {
      const r = await lensRun('education', 'lesson-qa-upvote', {
        threadId, answerId: answerId || undefined,
      });
      if (r.data?.ok) await load(activeLesson);
    } catch (e) { console.error('[LessonQA] upvote failed', e); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[200px]">
          <label className="text-[10px] uppercase tracking-wider text-gray-400">Lesson ID</label>
          <input
            value={lessonId}
            onChange={e => setLessonId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') load(lessonId); }}
            placeholder="Lesson ID for its Q&A thread"
            className="w-full mt-1 px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-sm text-white"
          />
        </div>
        <button
          onClick={() => load(lessonId)}
          disabled={!lessonId.trim() || loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 font-bold disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
          Open Q&A
        </button>
      </div>

      {!activeLesson && (
        <p className="text-sm text-gray-400 py-8 text-center">
          Enter a lesson ID to view and post timestamp-anchored questions.
        </p>
      )}

      {activeLesson && (
        <>
          <div className="panel p-3 space-y-2 border border-neon-cyan/20 rounded-lg">
            <p className="text-xs font-bold text-white">Ask a question</p>
            <textarea
              value={askText}
              onChange={e => setAskText(e.target.value)}
              rows={2}
              placeholder="Type your question (start with mm:ss to set the timestamp)"
              className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-sm text-white resize-none"
            />
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-gray-400 flex items-center gap-1">
                <Clock className="w-3 h-3" /> at
                <input
                  type="number" min={0} value={askTime}
                  onChange={e => setAskTime(e.target.value)}
                  className="w-20 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white"
                />
                sec
              </label>
              <button
                onClick={ask}
                disabled={!askText.trim()}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-neon-cyan text-black font-bold disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" /> Post question
              </button>
            </div>
          </div>

          {threads.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No questions on this lesson yet.</p>
          ) : (
            <div className="space-y-3">
              {threads.map(t => (
                <div key={t.id} className={cn(
                  'panel p-3 space-y-2 border rounded-lg',
                  t.resolved ? 'border-neon-green/20 bg-neon-green/[0.03]' : 'border-white/10',
                )}>
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => upvote(t.id)}
                      className="flex flex-col items-center text-gray-400 hover:text-neon-cyan shrink-0"
                    >
                      <ChevronUp className="w-4 h-4" />
                      <span className="text-[10px] font-bold">{t.upvotes}</span>
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neon-cyan/15 text-neon-cyan">
                          {fmtTime(t.timestampSec)}
                        </span>
                        {t.resolved && (
                          <span className="text-[10px] text-neon-green flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Resolved
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-200 mt-1">{t.text}</p>
                      <p className="text-[10px] text-gray-400">{t.author}</p>
                    </div>
                  </div>

                  {t.answers.length > 0 && (
                    <div className="space-y-2 pl-6 border-l border-white/5">
                      {t.answers.map(a => (
                        <div key={a.id} className={cn(
                          'p-2 rounded text-xs',
                          a.accepted ? 'bg-neon-green/10 border border-neon-green/30' : 'bg-white/[0.02] border border-white/5',
                        )}>
                          <div className="flex items-start gap-2">
                            <button
                              onClick={() => upvote(t.id, a.id)}
                              className="flex flex-col items-center text-gray-400 hover:text-neon-cyan shrink-0"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                              <span className="text-[10px] font-bold">{a.upvotes}</span>
                            </button>
                            <div className="flex-1 min-w-0">
                              {a.accepted && (
                                <span className="text-[10px] text-neon-green flex items-center gap-1 mb-0.5">
                                  <CheckCircle className="w-3 h-3" /> Accepted answer
                                </span>
                              )}
                              <p className="text-gray-200">{a.text}</p>
                              <p className="text-[10px] text-gray-400">{a.author}</p>
                            </div>
                            {!t.resolved && (
                              <button
                                onClick={() => accept(t.id, a.id)}
                                className="text-[10px] px-2 py-0.5 rounded border border-neon-green/30 text-neon-green hover:bg-neon-green/10 shrink-0"
                              >
                                Accept
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {replyTo === t.id ? (
                    <div className="pl-6 space-y-2">
                      <textarea
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        rows={2}
                        placeholder="Write an answer…"
                        className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs text-white resize-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => answer(t.id)}
                          disabled={!replyText.trim()}
                          className="text-[11px] px-2.5 py-1 rounded bg-neon-cyan text-black font-bold disabled:opacity-40"
                        >
                          Post answer
                        </button>
                        <button
                          onClick={() => { setReplyTo(null); setReplyText(''); }}
                          className="text-[11px] px-2.5 py-1 rounded border border-white/10 text-gray-400 hover:bg-white/5"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setReplyTo(t.id); setReplyText(''); }}
                      className="ml-6 text-[11px] text-neon-cyan hover:underline"
                    >
                      Answer this question
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default LessonQA;
