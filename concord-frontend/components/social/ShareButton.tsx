'use client';

/**
 * ShareButton — repost / quote-share a DTU or post with optional
 * commentary. Drop-in for any DTU surface alongside ReactionBar +
 * CommentThread.
 *
 * Phase 10f: closes the share-gap. Backend has POST /api/social/share
 * with { postId, commentary? } since forever but no UI surfaced it.
 *
 *   <ShareButton postId={dtu.id} />
 *
 * Click opens an inline composer with optional commentary; submit
 * fires the share + invalidates the shares query so the local count
 * updates immediately.
 */

import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Repeat2, Send, Loader2, Check, X, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface SharesResponse { ok: boolean; shares?: Array<{ userId: string; createdAt: string }>; total?: number; }

export interface ShareButtonProps {
  postId: string;
  /** Compact mode: small chip with count only when shares exist. Default true. */
  compact?: boolean;
  /** Hide entirely when shares count is 0 and user hasn't opened the composer. Default false. */
  hideWhenEmpty?: boolean;
  className?: string;
}

export function ShareButton({ postId, compact = true, hideWhenEmpty = false, className }: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [commentary, setCommentary] = useState('');
  const [justShared, setJustShared] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useQuery<SharesResponse | null>({
    queryKey: ['social-shares', postId],
    queryFn: async () => {
      try { const r = await api.get<SharesResponse>(`/api/social/shares/${encodeURIComponent(postId)}`); return r?.data; }
      catch { return null; }
    },
    enabled: !!postId,
    staleTime: 30_000,
  });
  const count = data?.total ?? (data?.shares?.length || 0);

  const shareMut = useMutation({
    mutationFn: async () => {
      const r = await api.post('/api/social/share', { postId, commentary: commentary.trim() || undefined });
      return r?.data;
    },
    onSuccess: () => {
      setOpen(false);
      setCommentary('');
      setJustShared(true);
      setTimeout(() => setJustShared(false), 1500);
      queryClient.invalidateQueries({ queryKey: ['social-shares', postId] });
      queryClient.invalidateQueries({ queryKey: ['social-following-activity'] });
    },
  });

  const onSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    shareMut.mutate();
  }, [shareMut]);

  if (hideWhenEmpty && count === 0 && !open) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Share"
        className={cn(
          'inline-flex items-center gap-1 rounded border bg-zinc-900/40 transition-colors',
          'text-emerald-300 hover:bg-emerald-500/10 border-emerald-500/30',
          compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
          className,
        )}
      >
        {justShared ? <Check className={cn(compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} /> : <Repeat2 className={cn(compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />}
        {count > 0 && <span className="tabular-nums font-mono">{count}</span>}
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className={cn('inline-flex flex-col items-stretch gap-1 rounded border border-emerald-500/30 bg-emerald-500/5 p-2 w-full max-w-md', className)}
    >
      <div className="flex items-center gap-1 mb-0.5">
        <Repeat2 className="w-3 h-3 text-emerald-300" />
        <span className="text-[10px] uppercase tracking-wider text-emerald-300 font-mono">Share with commentary</span>
        <button
          type="button"
          onClick={() => { setOpen(false); setCommentary(''); }}
          className="ml-auto text-zinc-500 hover:text-zinc-200"
          aria-label="Cancel"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <textarea
        value={commentary}
        onChange={(e) => setCommentary(e.target.value)}
        rows={2}
        placeholder="Optional commentary…"
        autoFocus
        maxLength={500}
        className="text-xs bg-zinc-950/60 border border-zinc-800 rounded px-2 py-1 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 resize-none"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={shareMut.isPending}
          className="text-xs px-2 py-1 rounded bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-100 border border-emerald-600/60 disabled:opacity-40 inline-flex items-center gap-1"
        >
          {shareMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          Share
        </button>
        <span className="text-[10px] text-zinc-500 ml-auto">{commentary.length}/500</span>
      </div>
      {shareMut.error && (
        <div className="text-[10px] text-rose-300/80 mt-1">
          <AlertTriangle className="inline w-3 h-3 mr-0.5" />
          {shareMut.error instanceof Error ? shareMut.error.message : 'Share failed'}
        </div>
      )}
    </form>
  );
}

export default ShareButton;
