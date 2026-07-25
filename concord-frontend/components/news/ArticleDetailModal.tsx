'use client';

/**
 * ArticleDetailModal — the single-article detail surface for the
 * personalized-reader system. Wired to `news.article-detail` (real fetch,
 * not a re-render of whatever list row triggered it — so the read/saved
 * state shown is always the server's current truth), plus the same-article
 * actions: mark read/unread (`article-mark-read`), save/unsave
 * (`article-save`), react (`article-react`), listen (`article-audio` +
 * browser Speech Synthesis), open source, and delete (`article-delete`,
 * contributor-only — the server is the authority; a non-owner sees the
 * real 403-shaped honest error, not a silently hidden button).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, Bookmark, BookOpen, ThumbsUp, ThumbsDown, ExternalLink,
  Headphones, Play, Pause, Square, Trash2, AlertTriangle,
} from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { Skeleton } from '@/components/ui';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { useArticleDetail } from './ArticleDetailContext';

interface FullArticle {
  id: string;
  title: string;
  source: string;
  topic: string;
  summary: string | null;
  url: string | null;
  publishedAt: string;
  addedBy?: string;
  read: boolean;
  saved: boolean;
}

interface AudioScript {
  segments: string[];
  wordCount: number;
  estimatedSeconds: number;
}

export function ArticleDetailModal({ onMutated }: { onMutated?: () => void } = {}) {
  const { openArticleId, closeArticle } = useArticleDetail();
  const { user } = useAuth();
  const [article, setArticle] = useState<FullArticle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [script, setScript] = useState<AudioScript | null>(null);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [segmentIdx, setSegmentIdx] = useState(-1);
  const speechSupported = typeof window !== 'undefined' && !!window.speechSynthesis;
  const utterRef = useRef<SpeechSynthesisUtterance[]>([]);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    const r = await lensRun('news', 'article-detail', { id });
    if (r.data?.ok && r.data.result?.article) {
      setArticle(r.data.result.article as FullArticle);
    } else {
      // `r.data.result` is null on lensRun's error path (it returns
      // { ok:false, result:null, error }), so a `.result.error` read here is
      // structurally dead — the live error is `r.data.error`.
      setError(r.data?.error || 'Article not found.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!openArticleId) {
      setArticle(null);
      setError(null);
      setDeleteError(null);
      setScript(null);
      return;
    }
    void load(openArticleId);
  }, [openArticleId, load]);

  const stopAudio = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    utterRef.current = [];
    setPlaying(false);
    setPaused(false);
    setSegmentIdx(-1);
  }, []);

  useEffect(() => () => stopAudio(), [stopAudio]);

  const refresh = useCallback(async () => {
    if (openArticleId) await load(openArticleId);
  }, [openArticleId, load]);

  const markRead = async () => {
    if (!article) return;
    setBusy('read');
    await lensRun('news', 'article-mark-read', { id: article.id, unread: article.read });
    await refresh();
    setBusy(null);
    onMutated?.();
  };
  const toggleSave = async () => {
    if (!article) return;
    setBusy('save');
    await lensRun('news', 'article-save', { id: article.id });
    await refresh();
    setBusy(null);
    onMutated?.();
  };
  const react = async (kind: 'more' | 'less') => {
    if (!article) return;
    setBusy(kind);
    await lensRun('news', 'article-react', { id: article.id, kind });
    setBusy(null);
    onMutated?.();
  };

  const listen = async () => {
    if (!article) return;
    stopAudio();
    setBusy('audio');
    const r = await lensRun('news', 'article-audio', { id: article.id });
    setBusy(null);
    if (!r.data?.ok) return;
    const s = r.data.result as AudioScript;
    setScript(s);
    if (!speechSupported || s.segments.length === 0) return;
    const synth = window.speechSynthesis;
    const utterances = s.segments.map((seg, i) => {
      const u = new SpeechSynthesisUtterance(seg);
      u.rate = 1;
      u.onstart = () => setSegmentIdx(i);
      u.onend = () => { if (i === s.segments.length - 1) { setPlaying(false); setSegmentIdx(-1); } };
      return u;
    });
    utterRef.current = utterances;
    setPlaying(true);
    setPaused(false);
    for (const u of utterances) synth.speak(u);
  };
  const togglePause = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    if (paused) { window.speechSynthesis.resume(); setPaused(false); }
    else { window.speechSynthesis.pause(); setPaused(true); }
  };

  const remove = async () => {
    if (!article) return;
    setBusy('delete');
    setDeleteError(null);
    const r = await lensRun('news', 'article-delete', { id: article.id });
    setBusy(null);
    // Only `r.data.ok` / `r.data.error` are live: lensRun returns
    // { ok:false, result:null, error } on failure, so the `.result.*` reads
    // that used to sit beside these could never fire.
    if (r.data?.ok === false) {
      setDeleteError(r.data?.error || 'Could not remove this article.');
      return;
    }
    stopAudio();
    closeArticle();
    onMutated?.();
  };

  const isOwner = !!user && !!article?.addedBy && article.addedBy === user.id;
  const fmtDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <Modal isOpen={openArticleId !== null} onClose={closeArticle} title={loading ? 'Loading…' : article?.title || 'Article'} size="lg">
      {loading ? (
        <div className="space-y-3" role="status" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading article…</span>
          <Skeleton variant="line" lines={2} />
          <Skeleton variant="block" height="6rem" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      ) : article ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
            <span className="font-medium text-zinc-300">{article.source || 'Unknown source'}</span>
            <span>·</span>
            <span className="capitalize">{article.topic}</span>
            <span>·</span>
            <span>{String(article.publishedAt).slice(0, 10)}</span>
            {article.read && (
              <span className="ml-1 rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-400">
                read
              </span>
            )}
          </div>

          {article.summary ? (
            <p className="text-sm leading-relaxed text-zinc-200">{article.summary}</p>
          ) : (
            <p className="text-sm italic text-zinc-500">No summary provided for this story.</p>
          )}

          {script && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-emerald-300">
                <Headphones className="h-3.5 w-3.5" /> Listening · {script.wordCount} words · ~{fmtDuration(script.estimatedSeconds)}
              </div>
              <div className="mt-2 max-h-28 space-y-1 overflow-y-auto">
                {script.segments.map((seg, i) => (
                  <p key={i} className={cn('rounded px-1.5 py-0.5 text-[11px] leading-snug', i === segmentIdx ? 'bg-emerald-500/15 text-emerald-200' : 'text-zinc-400')}>
                    {seg}
                  </p>
                ))}
              </div>
            </div>
          )}

          {deleteError && (
            <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {deleteError}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-800 pt-3">
            <button type="button" disabled={busy === 'read'} onClick={markRead}
              className={cn('flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium disabled:opacity-40',
                article.read ? 'bg-zinc-800 text-zinc-400' : 'bg-rose-600 text-white hover:bg-rose-500')}>
              <BookOpen className="h-3.5 w-3.5" /> {article.read ? 'Mark unread' : 'Mark read'}
            </button>
            <button type="button" disabled={busy === 'save'} onClick={toggleSave}
              className={cn('flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium disabled:opacity-40',
                article.saved ? 'bg-amber-600 text-white hover:bg-amber-500' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
              <Bookmark className={cn('h-3.5 w-3.5', article.saved && 'fill-current')} /> {article.saved ? 'Saved' : 'Save'}
            </button>
            <button type="button" disabled={busy === 'more'} onClick={() => react('more')}
              className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-40">
              <ThumbsUp className="h-3.5 w-3.5" /> More like this
            </button>
            <button type="button" disabled={busy === 'less'} onClick={() => react('less')}
              className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-40">
              <ThumbsDown className="h-3.5 w-3.5" /> Less
            </button>
            <button type="button" disabled={busy === 'audio' || !speechSupported}
              onClick={() => (playing ? togglePause() : void listen())}
              title={speechSupported ? undefined : 'This browser does not support read-aloud'}
              className="flex items-center gap-1 rounded-lg bg-emerald-700/80 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-40">
              {busy === 'audio' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : playing && !paused ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {playing ? (paused ? 'Resume' : 'Pause') : 'Listen'}
            </button>
            {playing && (
              <button type="button" onClick={stopAudio}
                className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700">
                <Square className="h-3.5 w-3.5" /> Stop
              </button>
            )}
            {article.url && (
              <a href={article.url} target="_blank" rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200">
                <ExternalLink className="h-3.5 w-3.5" /> Open source
              </a>
            )}
            <button type="button" disabled={busy === 'delete'} onClick={remove}
              title={isOwner ? 'Remove this article' : 'Only the contributor can remove this article — the server will confirm'}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-40">
              {busy === 'delete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Remove
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
