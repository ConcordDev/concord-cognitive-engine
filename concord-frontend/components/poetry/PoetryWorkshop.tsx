'use client';

/**
 * PoetryWorkshop — share a poem to the shared workshop and collect
 * line-level peer critique. Wires the poetry.workshop-* macros.
 * No seed data — the workshop starts empty until users share poems.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Users, Share2, MessageSquarePlus, Loader2, ChevronLeft, Trash2,
  ThumbsUp, Lightbulb, HelpCircle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MyPoem { id: string; title: string; status: string }
interface ShareSummary {
  id: string; title: string; ownerName: string; form: string;
  lineCount: number; critiqueCount: number; note: string; updatedAt: string;
}
interface Critique {
  id: string; lineIndex: number; comment: string; kind: string;
  criticName: string; createdAt: string;
}
interface ShareDetail {
  id: string; title: string; ownerName: string; form: string;
  body: string; note: string; critiques: Critique[]; createdAt: string;
}

const CRIT_KINDS: { id: string; label: string; icon: typeof ThumbsUp }[] = [
  { id: 'praise', label: 'Praise', icon: ThumbsUp },
  { id: 'suggestion', label: 'Suggestion', icon: Lightbulb },
  { id: 'question', label: 'Question', icon: HelpCircle },
];

export function PoetryWorkshop() {
  const [myPoems, setMyPoems] = useState<MyPoem[]>([]);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [detail, setDetail] = useState<ShareDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Share form
  const [sharePoemId, setSharePoemId] = useState('');
  const [shareName, setShareName] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [sharing, setSharing] = useState(false);

  // Critique form
  const [critLine, setCritLine] = useState(0);
  const [critKind, setCritKind] = useState('suggestion');
  const [critComment, setCritComment] = useState('');
  const [critName, setCritName] = useState('');

  const loadPoems = useCallback(async () => {
    const r = await lensRun('poetry', 'poem-list', {});
    if (r.data?.ok) setMyPoems((r.data.result?.poems as MyPoem[]) || []);
  }, []);
  const loadShares = useCallback(async () => {
    const r = await lensRun('poetry', 'workshop-list', { limit: 40 });
    if (r.data?.ok) setShares((r.data.result?.shares as ShareSummary[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void loadPoems(); void loadShares(); }, [loadPoems, loadShares]);

  const openDetail = useCallback(async (id: string) => {
    setError(null);
    const r = await lensRun('poetry', 'workshop-detail', { id });
    if (r.data?.ok) { setDetail(r.data.result?.share as ShareDetail); setCritLine(0); }
    else setError((r.data?.error as string) || 'could not load shared poem');
  }, []);

  const share = useCallback(async () => {
    if (!sharePoemId) return;
    setSharing(true); setError(null);
    const r = await lensRun('poetry', 'workshop-share', {
      poemId: sharePoemId, authorName: shareName.trim(), note: shareNote.trim(),
    });
    if (r.data?.ok) { setShareNote(''); await loadShares(); }
    else setError((r.data?.error as string) || 'share failed');
    setSharing(false);
  }, [sharePoemId, shareName, shareNote, loadShares]);

  const submitCritique = useCallback(async () => {
    if (!detail || !critComment.trim()) return;
    const r = await lensRun('poetry', 'workshop-critique', {
      id: detail.id, lineIndex: critLine, comment: critComment.trim(),
      kind: critKind, criticName: critName.trim(),
    });
    if (r.data?.ok) {
      setCritComment('');
      await openDetail(detail.id);
      await loadShares();
    } else {
      setError((r.data?.error as string) || 'critique failed');
    }
  }, [detail, critComment, critLine, critKind, critName, openDetail, loadShares]);

  const unshare = useCallback(async (id: string) => {
    const r = await lensRun('poetry', 'workshop-unshare', { id });
    if (r.data?.ok) { setDetail(null); await loadShares(); }
    else setError((r.data?.error as string) || 'only the owner can unshare');
  }, [loadShares]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  const detailLines = detail ? detail.body.split('\n') : [];

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-violet-300" />
        <h3 className="text-sm font-bold text-zinc-100">Poetry Workshop</h3>
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {!detail && (
        <>
          {/* Share a poem */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
            <p className="text-xs font-semibold text-zinc-300">Share a poem for critique</p>
            {myPoems.length === 0 ? (
              <p className="text-[11px] text-zinc-400 italic">
                Write a poem in the workspace first, then share it here.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <select value={sharePoemId} onChange={e => setSharePoemId(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
                  <option value="">Select a poem…</option>
                  {myPoems.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
                <input value={shareName} onChange={e => setShareName(e.target.value)} placeholder="Your name (optional)"
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 w-40" />
                <input value={shareNote} onChange={e => setShareNote(e.target.value)} placeholder="Note for critics (optional)"
                  className="flex-1 min-w-[140px] bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
                <button onClick={share} disabled={!sharePoemId || sharing}
                  className="px-3 py-1.5 text-xs rounded bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
                  <Share2 className="w-3 h-3" /> {sharing ? 'Sharing…' : 'Share'}
                </button>
              </div>
            )}
          </div>

          {/* Shared poems list */}
          <div className="space-y-1.5">
            {shares.length === 0 && (
              <p className="text-xs text-zinc-400 italic">No poems in the workshop yet.</p>
            )}
            {shares.map(sh => (
              <button key={sh.id} onClick={() => openDetail(sh.id)}
                className="w-full text-left rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 hover:border-violet-700/50">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-zinc-100 italic">{sh.title}</p>
                  <span className="text-[11px] text-violet-300">
                    {sh.critiqueCount} critique{sh.critiqueCount === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  by {sh.ownerName} · {sh.form} · {sh.lineCount} lines
                </p>
                {sh.note && <p className="text-[11px] text-zinc-400 italic mt-1">&ldquo;{sh.note}&rdquo;</p>}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Shared poem detail with line-level critique */}
      {detail && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <button onClick={() => setDetail(null)}
              className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
              <ChevronLeft className="w-3.5 h-3.5" /> Back
            </button>
            <button onClick={() => unshare(detail.id)}
              className="inline-flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300">
              <Trash2 className="w-3 h-3" /> Unshare
            </button>
          </div>

          <div>
            <p className="text-sm font-semibold text-zinc-100 italic">{detail.title}</p>
            <p className="text-[11px] text-zinc-400">by {detail.ownerName} · {detail.form}</p>
            {detail.note && <p className="text-[11px] text-zinc-400 italic mt-0.5">&ldquo;{detail.note}&rdquo;</p>}
          </div>

          {/* Lines — click to target a critique */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 divide-y divide-zinc-800/60">
            {detailLines.map((line, i) => {
              const lineCrits = detail.critiques.filter(c => c.lineIndex === i);
              return (
                <div key={i}>
                  <button onClick={() => setCritLine(i)}
                    className={cn('w-full text-left px-3 py-1.5 flex items-center gap-2',
                      critLine === i ? 'bg-violet-600/15' : 'hover:bg-zinc-800/40')}>
                    <span className="text-[10px] text-zinc-400 w-5 text-right font-mono">{i + 1}</span>
                    <span className="text-xs text-zinc-300 font-serif flex-1">{line || ' '}</span>
                    {lineCrits.length > 0 && (
                      <span className="text-[10px] text-violet-300">{lineCrits.length}</span>
                    )}
                  </button>
                  {lineCrits.map(c => (
                    <div key={c.id} className="px-3 pb-1.5 pl-10">
                      <p className="text-[11px] text-zinc-400">
                        <span className={cn('font-semibold',
                          c.kind === 'praise' ? 'text-emerald-400'
                            : c.kind === 'question' ? 'text-sky-400' : 'text-amber-400')}>
                          {c.criticName}
                        </span>
                        : {c.comment}
                      </p>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Whole-poem critiques */}
          {detail.critiques.filter(c => c.lineIndex === -1).length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 space-y-1">
              <p className="text-[11px] font-semibold text-zinc-400">On the whole poem</p>
              {detail.critiques.filter(c => c.lineIndex === -1).map(c => (
                <p key={c.id} className="text-[11px] text-zinc-400">
                  <span className="font-semibold text-zinc-300">{c.criticName}</span>: {c.comment}
                </p>
              ))}
            </div>
          )}

          {/* Critique composer */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
            <p className="text-xs font-semibold text-zinc-300 inline-flex items-center gap-1">
              <MessageSquarePlus className="w-3.5 h-3.5" />
              Critique{' '}
              <span className="text-violet-300">
                {critLine === -1 ? 'whole poem' : `line ${critLine + 1}`}
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setCritLine(-1)}
                className={cn('px-2 py-1 rounded text-[11px] border',
                  critLine === -1 ? 'bg-violet-600/20 text-violet-300 border-violet-600/40'
                    : 'bg-zinc-900 text-zinc-400 border-zinc-800')}>
                Whole poem
              </button>
              {CRIT_KINDS.map(k => (
                <button key={k.id} onClick={() => setCritKind(k.id)}
                  className={cn('px-2 py-1 rounded text-[11px] border inline-flex items-center gap-1',
                    critKind === k.id ? 'bg-violet-600/20 text-violet-300 border-violet-600/40'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800')}>
                  <k.icon className="w-3 h-3" /> {k.label}
                </button>
              ))}
            </div>
            <input value={critName} onChange={e => setCritName(e.target.value)} placeholder="Your name (optional)"
              className="w-40 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            <textarea value={critComment} onChange={e => setCritComment(e.target.value)} rows={2}
              placeholder="Leave a constructive note…"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            <button onClick={submitCritique} disabled={!critComment.trim()}
              className="px-3 py-1.5 text-xs rounded bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-40">
              Post critique
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
