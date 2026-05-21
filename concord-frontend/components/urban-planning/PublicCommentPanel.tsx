'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { MessagesSquare, Send, Loader2, RefreshCw, CheckCircle2 } from 'lucide-react';

interface Scenario {
  id: string;
  name: string;
}

interface Comment {
  id: string;
  subjectId: string;
  author: string;
  stance: string;
  body: string;
  status: string;
  createdAt: string;
  resolvedAt?: string;
}

interface CommentList {
  comments: Comment[];
  total: number;
  tally: Record<string, number>;
}

const STANCES = ['support', 'neutral', 'oppose'];
const STATUSES = ['open', 'reviewed', 'addressed'];

const STANCE_COLOR: Record<string, string> = {
  support: 'text-green-400 bg-green-400/10',
  oppose: 'text-red-400 bg-red-400/10',
  neutral: 'text-zinc-400 bg-zinc-400/10',
};
const STATUS_COLOR: Record<string, string> = {
  open: 'text-amber-400 bg-amber-400/10',
  reviewed: 'text-blue-400 bg-blue-400/10',
  addressed: 'text-emerald-400 bg-emerald-400/10',
};

export function PublicCommentPanel() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [subjectId, setSubjectId] = useState('');
  const [list, setList] = useState<CommentList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [author, setAuthor] = useState('');
  const [stance, setStance] = useState('support');
  const [body, setBody] = useState('');

  const loadScenarios = useCallback(async () => {
    const r = await lensRun<{ scenarios: Scenario[] }>('urban-planning', 'scenario-list', {});
    if (r.data.ok && r.data.result) {
      setScenarios(r.data.result.scenarios);
      if (!subjectId && r.data.result.scenarios.length > 0) {
        setSubjectId(r.data.result.scenarios[0].id);
      }
    }
  }, [subjectId]);

  const refresh = useCallback(async () => {
    const r = await lensRun<CommentList>('urban-planning', 'comment-list', {
      subjectId: subjectId || undefined,
    });
    if (r.data.ok && r.data.result) setList(r.data.result);
    else setError(r.data.error || 'failed to load comments');
  }, [subjectId]);

  useEffect(() => {
    loadScenarios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submit = useCallback(async () => {
    if (!subjectId) {
      setError('select a project / scenario to comment on');
      return;
    }
    if (!body.trim()) {
      setError('comment body is required');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await lensRun('urban-planning', 'comment-add', {
      subjectId,
      author,
      stance,
      body,
    });
    setBusy(false);
    if (r.data.ok) {
      setBody('');
      setAuthor('');
      await refresh();
    } else {
      setError(r.data.error || 'submit failed');
    }
  }, [subjectId, author, stance, body, refresh]);

  const resolve = useCallback(
    async (id: string, status: string) => {
      setBusy(true);
      await lensRun('urban-planning', 'comment-resolve', { id, status });
      setBusy(false);
      await refresh();
    },
    [refresh],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <MessagesSquare className="h-4 w-4 text-emerald-400" /> Public Comment / Stakeholder Review
        </h3>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
          >
            {scenarios.length === 0 && <option value="">No scenarios — create one first</option>}
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                Subject: {s.name}
              </option>
            ))}
          </select>
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Your name (optional)"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
          <select
            value={stance}
            onChange={(e) => setStance(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
          >
            {STANCES.map((s) => (
              <option key={s} value={s}>
                Stance: {s}
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Comment on this development proposal…"
          rows={3}
          className="mt-2 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Submit Comment
          </button>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            aria-label="Refresh comments"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        {error && (
          <div className="mt-2 rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>

      {list && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="mb-3 flex items-center gap-3 text-xs">
            <span className="font-semibold text-white">{list.total} comments</span>
            <span className={`rounded px-2 py-0.5 ${STANCE_COLOR.support}`}>
              {list.tally.support || 0} support
            </span>
            <span className={`rounded px-2 py-0.5 ${STANCE_COLOR.neutral}`}>
              {list.tally.neutral || 0} neutral
            </span>
            <span className={`rounded px-2 py-0.5 ${STANCE_COLOR.oppose}`}>
              {list.tally.oppose || 0} oppose
            </span>
          </div>
          {list.comments.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-500">
              No comments yet on this subject.
            </p>
          ) : (
            <div className="space-y-2">
              {list.comments.map((c) => (
                <div
                  key={c.id}
                  className="rounded border border-zinc-800 bg-zinc-950 p-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-zinc-200">{c.author}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${STANCE_COLOR[c.stance]}`}>
                        {c.stance}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_COLOR[c.status]}`}>
                        {c.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {STATUSES.filter((st) => st !== c.status).map((st) => (
                        <button
                          key={st}
                          onClick={() => resolve(c.id, st)}
                          className="inline-flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        >
                          <CheckCircle2 className="h-3 w-3" /> {st}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-400">{c.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
