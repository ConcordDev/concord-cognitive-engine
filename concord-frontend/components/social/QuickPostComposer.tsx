'use client';

/**
 * QuickPostComposer — top-of-feed composer for posts + stories.
 *
 * Phase 10d: the "what's on your mind" surface that every consumer
 * social app puts above the feed. Mounted at the top of /lenses/social
 * to drive content creation.
 *
 *   <QuickPostComposer currentUserId={u.id} onPosted={() => …} />
 *
 * Substrate:
 *   - POST /api/social/post with { content, tags?, mediaType?, isStory?,
 *     expiresAt? } — server-side createPost serialization
 *
 * UX:
 *   - Single textarea with character counter (500 ceiling)
 *   - Toggle: regular post / 24h story (story sets isStory=true,
 *     expiresAt now+86400000)
 *   - Tags chip input (comma-separated parsed on submit)
 *   - Optimistic clear on success; honest error on failure
 *   - Loading spinner during the round-trip
 */

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Send, Hash, Sparkles, Loader2, AlertTriangle, Check,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { MentionAutocomplete } from './MentionAutocomplete';

const MAX_LEN = 500;

interface PostMutationInput {
  content: string;
  tags?: string[];
  isStory?: boolean;
  expiresAt?: string;
  mentionedUsers?: string[];
}

export interface QuickPostComposerProps {
  currentUserId: string;
  /** Called after a successful post — useful for invalidating downstream queries. */
  onPosted?: (postId: string | null) => void;
  className?: string;
}

export function QuickPostComposer({ currentUserId, onPosted, className }: QuickPostComposerProps) {
  const [content, setContent] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [mode, setMode] = useState<'post' | 'story'>('post');
  const [showSuccess, setShowSuccess] = useState(false);
  const [mentionedUsers, setMentionedUsers] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: PostMutationInput) => {
      const body: Record<string, unknown> = { content: input.content };
      if (input.tags && input.tags.length > 0) body.tags = input.tags;
      if (input.mentionedUsers && input.mentionedUsers.length > 0) body.mentionedUsers = input.mentionedUsers;
      if (input.isStory) {
        body.isStory = true;
        body.expiresAt = input.expiresAt || new Date(Date.now() + 86400000).toISOString();
      }
      const r = await api.post('/api/social/post', body);
      return r?.data as { ok: boolean; post?: { id: string }; error?: string };
    },
    onSuccess: (data) => {
      if (data?.ok) {
        setContent('');
        setTagsRaw('');
        setMentionedUsers([]);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 1500);
        // Invalidate the relevant feeds.
        queryClient.invalidateQueries({ queryKey: ['social-following-activity'] });
        queryClient.invalidateQueries({ queryKey: ['feed-for-you'] });
        queryClient.invalidateQueries({ queryKey: ['stories'] });
        onPosted?.(data.post?.id || null);
      }
    },
  });

  // Filter mentionedUsers down to those still actually @-referenced in the
  // current text (avoids leaking stale ids after the user edits a mention out).
  const liveMentionedUsers = useCallback((text: string, ids: string[]) => {
    // Build the set of @-tokens in the text.
    const tokens = new Set<string>();
    const re = /@([A-Za-z0-9_]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) tokens.add(m[1].toLowerCase());
    // Without a username→userId map we can't precisely match, so we keep the
    // ids list intact when at least one @-token exists, otherwise empty.
    return tokens.size === 0 ? [] : ids;
  }, []);

  const onSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const text = content.trim();
    if (!text || text.length > MAX_LEN) return;
    const tags = tagsRaw
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0 && t.length < 40);
    mutation.mutate({
      content: text,
      tags,
      isStory: mode === 'story',
      mentionedUsers: liveMentionedUsers(text, mentionedUsers),
    });
  }, [content, tagsRaw, mode, mutation, mentionedUsers, liveMentionedUsers]);

  const remaining = MAX_LEN - content.length;
  const overLimit = remaining < 0;
  const errorMsg = (mutation.error instanceof Error)
    ? mutation.error.message
    : (mutation.data && !mutation.data.ok) ? mutation.data.error
    : null;

  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        'rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden',
        className,
      )}
    >
      <header className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800/60">
        <button
          type="button"
          onClick={() => setMode('post')}
          className={cn(
            'text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded border transition-colors',
            mode === 'post'
              ? 'text-indigo-200 bg-indigo-500/15 border-indigo-500/40'
              : 'text-zinc-500 border-zinc-800 hover:text-zinc-300',
          )}
        >
          <Send className="inline w-2.5 h-2.5 mr-0.5" /> Post
        </button>
        <button
          type="button"
          onClick={() => setMode('story')}
          className={cn(
            'text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded border transition-colors',
            mode === 'story'
              ? 'text-rose-200 bg-rose-500/15 border-rose-500/40'
              : 'text-zinc-500 border-zinc-800 hover:text-zinc-300',
          )}
        >
          <Sparkles className="inline w-2.5 h-2.5 mr-0.5" /> 24h Story
        </button>
        <span className="ml-auto text-[10px] text-zinc-500 font-mono">
          {currentUserId === 'current-user' ? '@you' : `@${currentUserId.slice(0, 12)}`}
        </span>
      </header>

      <MentionAutocomplete
        value={content}
        onChange={setContent}
        mentionedUsers={mentionedUsers}
        onMentionedUsersChange={setMentionedUsers}
        renderInput={(props) => (
          <textarea
            {...props}
            ref={props.ref as React.Ref<HTMLTextAreaElement>}
            rows={3}
            placeholder={mode === 'story' ? "What's happening right now? (24h)" : "What's on your mind? Type @ to mention someone"}
            className="w-full px-3 py-2 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none"
          />
        )}
      />

      <div className="px-3 py-1.5 border-t border-zinc-800/40 flex items-center gap-2">
        <Hash className="w-3 h-3 text-zinc-500 shrink-0" />
        <input
          type="text"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="tags, comma-separated"
          className="flex-1 text-[11px] bg-transparent text-zinc-300 placeholder-zinc-600 focus:outline-none"
        />
        <span className={cn('text-[10px] font-mono tabular-nums', overLimit ? 'text-rose-400' : 'text-zinc-500')}>
          {remaining}
        </span>
        <button
          type="submit"
          disabled={mutation.isPending || !content.trim() || overLimit}
          className={cn(
            'inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border font-medium transition-colors',
            mode === 'story'
              ? 'bg-rose-700/40 hover:bg-rose-700/60 text-rose-100 border-rose-600/60'
              : 'bg-indigo-700/40 hover:bg-indigo-700/60 text-indigo-100 border-indigo-600/60',
            'disabled:opacity-40',
          )}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" /> Posting…
            </>
          ) : showSuccess ? (
            <>
              <Check className="w-3 h-3" /> Posted
            </>
          ) : (
            <>
              <Send className="w-3 h-3" /> {mode === 'story' ? 'Post 24h story' : 'Post'}
            </>
          )}
        </button>
      </div>

      {errorMsg && (
        <div className="px-3 py-1.5 border-t border-zinc-800/40 text-[11px] text-rose-300/80 bg-rose-500/5">
          <AlertTriangle className="inline w-3 h-3 mr-1" /> {errorMsg}
        </div>
      )}
    </form>
  );
}

export default QuickPostComposer;
