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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Send, Hash, Sparkles, Loader2, AlertTriangle, Check,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui';
import { MentionAutocomplete } from './MentionAutocomplete';
import { invalidatePostSurfaces } from './invalidate-post-surfaces';

function failureMessage(err: unknown, data?: { ok?: boolean; error?: string; message?: string } | null): string {
  if (data && data.ok === false) {
    return data.error || data.message || 'Post failed';
  }
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: { error?: string; message?: string }; status?: number } }).response;
    if (resp?.data?.error) return String(resp.data.error);
    if (resp?.data?.message) return String(resp.data.message);
    if (resp?.status) return `Post failed (${resp.status})`;
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Network error';
}

const MAX_LEN = 500;

interface PostMutationInput {
  content: string;
  tags?: string[];
  isStory?: boolean;
  expiresAt?: string;
  mentionedUsers?: string[];
  federationVisibility?: FederationVisibility;
  privacy?: 'public' | 'followers' | 'private';
  replyAudience?: 'everyone' | 'followers' | 'mentioned';
}

// Phase 11 (Item 12) — federation visibility.
// 'local'     → never leaves this instance (default — opt-in to leave)
// 'followers' → fans out to followers on federated peers
// 'public'    → world-readable; appears in federated public timelines
type FederationVisibility = 'local' | 'followers' | 'public';

export interface QuickPostComposerProps {
  currentUserId: string;
  username?: string | null;
  /** Called after a successful post — useful for invalidating downstream queries. */
  onPosted?: (postId: string | null) => void;
  className?: string;
  /** Increment to open the composer in 24h story mode. */
  storyRequest?: number;
}

export function QuickPostComposer({ currentUserId, username, onPosted, className, storyRequest = 0 }: QuickPostComposerProps) {
  const [content, setContent] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [mode, setMode] = useState<'post' | 'story'>('post');
  const [storySeen, setStorySeen] = useState(storyRequest);
  const [showSuccess, setShowSuccess] = useState(false);
  const [mentionedUsers, setMentionedUsers] = useState<string[]>([]);
  const privacyKey = `concord.social.composerPrivacy.${currentUserId}`;
  const readPrivacy = useCallback((): 'public' | 'followers' | 'private' => {
    if (typeof window === 'undefined' || !currentUserId) return 'public';
    try {
      const stored = localStorage.getItem(privacyKey);
      if (stored === 'public' || stored === 'followers' || stored === 'private') return stored;
    } catch { /* private mode */ }
    return 'public';
  }, [currentUserId, privacyKey]);
  const [privacyScope, setPrivacyScope] = useState(currentUserId);
  const [privacy, setPrivacy] = useState<'public' | 'followers' | 'private'>(readPrivacy);
  if (privacyScope !== currentUserId) {
    setPrivacyScope(currentUserId);
    setPrivacy(readPrivacy());
  }
  const choosePrivacy = useCallback((value: 'public' | 'followers' | 'private') => {
    setPrivacy(value);
    try { localStorage.setItem(privacyKey, value); } catch { /* private mode */ }
  }, [privacyKey]);
  const [replyAudience, setReplyAudience] = useState<'everyone' | 'followers' | 'mentioned'>('everyone');
  const [draftNote, setDraftNote] = useState<string | null>(null);
  // Federation visibility — defaults to 'local' so users opt in to
  // federation explicitly. No surprise outbound fanout.
  const [federationVisibility, setFederationVisibility] = useState<FederationVisibility>('local');
  const queryClient = useQueryClient();

  if (storyRequest !== storySeen) {
    setStorySeen(storyRequest);
    if (storyRequest > 0) setMode('story');
  }

  const mutation = useMutation({
    mutationFn: async (input: PostMutationInput) => {
      const body: Record<string, unknown> = { content: input.content };
      if (input.tags && input.tags.length > 0) body.tags = input.tags;
      if (input.mentionedUsers && input.mentionedUsers.length > 0) body.mentionedUsers = input.mentionedUsers;
      if (input.privacy) body.privacy = input.privacy;
      if (input.replyAudience) body.replyAudience = input.replyAudience;
      if (input.federationVisibility && input.federationVisibility !== 'local') {
        body.federationVisibility = input.federationVisibility;
      }
      if (input.isStory) {
        body.isStory = true;
        body.expiresAt = input.expiresAt || new Date(Date.now() + 86400000).toISOString();
      }
      try {
        const r = await api.post('/api/social/post', body);
        const data = r?.data as { ok?: boolean; post?: { id: string }; error?: string; message?: string } | undefined;
        if (!data?.ok) {
          throw new Error(failureMessage(null, data || { ok: false, error: 'Post failed' }));
        }
        return data as { ok: boolean; post?: { id: string }; error?: string };
      } catch (err) {
        throw new Error(failureMessage(err));
      }
    },
    onSuccess: (data) => {
      setContent('');
      setTagsRaw('');
      setMentionedUsers([]);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 1500);
      useUIStore.getState().addToast({ type: 'success', message: 'Posted.' });
      // Refresh every surface that shows the viewer's posts — the feeds,
      // You > Posts, the profile post count, stories. Prefix keys only
      // (['social-for-you'], ['user-content'], …), matching the keys the
      // consumers actually declare. The old list invalidated
      // ['feed-for-you'] / ['social-feed'], which no component uses.
      void invalidatePostSurfaces(queryClient);
      queryClient.invalidateQueries({ queryKey: ['social-following'] });
      onPosted?.(data.post?.id || null);
    },
    onError: (err) => {
      const message = failureMessage(err);
      useUIStore.getState().addToast({ type: 'error', message });
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

  const publish = useCallback(() => {
    const text = content.trim();
    if (!text || text.length > MAX_LEN || mutation.isPending) return;
    const tags = tagsRaw
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0 && t.length < 40);
    mutation.mutate({
      content: text,
      tags,
      isStory: mode === 'story',
      mentionedUsers: liveMentionedUsers(text, mentionedUsers),
      federationVisibility,
      privacy,
      replyAudience,
    });
  }, [content, tagsRaw, mode, mutation, mentionedUsers, liveMentionedUsers, federationVisibility, privacy, replyAudience]);

  const onSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    publish();
  }, [publish]);

  const saveDraft = useCallback(async () => {
    const text = content.trim();
    if (!text) return;
    setDraftNote(null);
    try {
      const res = await api.post('/api/social/drafts', { content: text });
      setDraftNote(res.data?.ok === false ? (res.data.error || 'Draft was not saved.') : 'Draft saved.');
      if (res.data?.ok !== false) {
        void queryClient.invalidateQueries({ queryKey: ['social-drafts'] });
      }
    } catch {
      setDraftNote('Draft was not saved.');
    }
  }, [content, queryClient]);

  // Drafts read-back (F4): drafts persist server-side (GET /api/social/
  // drafts) — this list is the way back to them. Reopen loads the text
  // into the composer; delete is two-step and hits the standing route.
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [confirmDraftDelete, setConfirmDraftDelete] = useState<string | null>(null);
  const draftsQuery = useQuery({
    queryKey: ['social-drafts'],
    queryFn: async () => {
      const res = await api.get<{ ok?: boolean; drafts?: Array<{ id: string; content: string; updatedAt: string }> }>('/api/social/drafts');
      return res.data?.drafts || [];
    },
    enabled: draftsOpen,
  });
  const drafts = draftsQuery.data || [];

  const reopenDraft = useCallback((draft: { content: string }) => {
    setContent(draft.content);
    setDraftsOpen(false);
    setDraftNote('Draft reopened — edit and post, or save it again.');
  }, []);

  const deleteDraft = useCallback(async (draftId: string) => {
    try {
      const res = await api.delete(`/api/social/drafts/${encodeURIComponent(draftId)}`);
      if (res.data?.ok === false) {
        setDraftNote(res.data.error || 'Draft was not deleted.');
        return;
      }
      setConfirmDraftDelete(null);
      setDraftNote('Draft deleted.');
      void queryClient.invalidateQueries({ queryKey: ['social-drafts'] });
    } catch {
      setDraftNote('Draft was not deleted.');
    }
  }, [queryClient]);

  const remaining = MAX_LEN - content.length;
  const overLimit = remaining < 0;
  const errorMsg = (mutation.error instanceof Error)
    ? mutation.error.message
    : (mutation.data && !mutation.data.ok) ? mutation.data.error
    : null;

  return (
    <form
      id="social-quick-post"
      onSubmit={onSubmit}
      className={cn(
        // focus-within ring: the Create button scrolls to and focuses the
        // textarea programmatically — the ring is what makes that visible.
        'rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden',
        'focus-within:border-teal-400/60 focus-within:ring-1 focus-within:ring-teal-400/40',
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-1 px-3 py-1.5 border-b border-zinc-800/60">
        <button
          type="button"
          aria-label="Compose a regular post"
          onClick={() => setMode('post')}
          className={cn(
            'text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded border transition-colors',
            mode === 'post'
              ? 'text-indigo-200 bg-indigo-500/15 border-indigo-500/40'
              : 'text-zinc-400 border-zinc-800 hover:text-zinc-300',
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
              : 'text-zinc-400 border-zinc-800 hover:text-zinc-300',
          )}
        >
          <Sparkles className="inline w-2.5 h-2.5 mr-0.5" /> 24h Story
        </button>
        <span className="ml-auto text-[10px] text-zinc-400 font-mono">
          {username && username !== currentUserId ? `@${username}` : '@you'}
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
            aria-label="Post text"
            placeholder={mode === 'story' ? "What's happening right now? (24h)" : "What's on your mind? Type @ to mention someone"}
            className="w-full px-3 py-2 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none"
            onKeyDown={(e) => {
              props.onKeyDown?.(e);
              if (e.defaultPrevented) return;
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                publish();
              }
            }}
          />
        )}
      />

      {/* flex-wrap: at 375-414 px the selects + Save draft + Post cannot
          share one row with the tags input. Wrapping keeps every option
          reachable and the Post button visible below the fold of the row
          instead of clipped off the right edge by the form's
          overflow-hidden (rounded-corner) shell. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800/40 px-3 py-1.5">
        <Hash className="w-3 h-3 text-zinc-400 shrink-0" />
        <input
          type="text"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="tags, comma-separated"
          className="min-w-0 grow basis-32 text-[11px] bg-transparent text-zinc-300 placeholder-zinc-600 focus:outline-none"
        />
        {/* Phase 11 (Item 12) — federation visibility. Defaults to
            'local' so posts never leave the instance unless the
            user explicitly opts in. */}
        <select
          aria-label="Who can see this"
          value={privacy}
          onChange={(e) => choosePrivacy(e.target.value as 'public' | 'followers' | 'private')}
          className="max-w-full text-[10px] bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-zinc-400"
        >
          <option value="public">Public</option>
          <option value="followers">Followers</option>
          <option value="private">Private</option>
        </select>
        <select
          aria-label="Who can reply"
          value={replyAudience}
          onChange={(e) => setReplyAudience(e.target.value as 'everyone' | 'followers' | 'mentioned')}
          className="max-w-full text-[10px] bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-zinc-400"
        >
          <option value="everyone">Replies: everyone</option>
          <option value="followers">Replies: followers</option>
          <option value="mentioned">Replies: mentioned</option>
        </select>
        <button
          type="button"
          onClick={() => void saveDraft()}
          disabled={!content.trim()}
          className="text-[10px] rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 disabled:opacity-40"
        >
          Save draft
        </button>
        <button
          type="button"
          onClick={() => setDraftsOpen((v) => !v)}
          aria-expanded={draftsOpen}
          className="text-[10px] rounded border border-zinc-700 px-2 py-0.5 text-zinc-300"
        >
          Drafts{drafts.length > 0 ? ` (${drafts.length})` : ''}
        </button>
        <select
          aria-label="Federation visibility"
          value={federationVisibility}
          onChange={(e) => setFederationVisibility(e.target.value as FederationVisibility)}
          className="max-w-full text-[10px] bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-zinc-400 hover:text-zinc-200"
          title="Federation visibility"
        >
          <option value="local">🏠 This server</option>
          <option value="followers">👥 Followers (federated)</option>
          <option value="public">🌐 Public (federated)</option>
        </select>
        <span className={cn('text-[10px] font-mono tabular-nums', overLimit ? 'text-rose-400' : 'text-zinc-400')}>
          {remaining}
        </span>
        <button
          type="submit"
          aria-label={mode === 'story' ? 'Post 24h story' : 'Post'}
          disabled={mutation.isPending || !content.trim() || overLimit}
          className={cn(
            'ml-auto inline-flex min-h-[44px] min-w-[44px] items-center gap-1 text-xs px-2.5 py-1 rounded border font-medium transition-colors',
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

      {draftsOpen && (
        <div className="border-t border-zinc-800/40 px-3 py-2">
          {draftsQuery.isLoading ? (
            <p className="text-[11px] text-zinc-500">Loading drafts…</p>
          ) : drafts.length === 0 ? (
            <p className="text-[11px] text-zinc-500">No drafts yet — Save draft keeps the text here.</p>
          ) : (
            <ul className="space-y-1.5">
              {drafts.map((draft) => (
                <li key={draft.id} className="flex items-center gap-2 rounded border border-zinc-800/60 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{draft.content}</span>
                  <span className="shrink-0 text-[10px] text-zinc-500">{new Date(draft.updatedAt).toLocaleDateString()}</span>
                  <button
                    type="button"
                    onClick={() => reopenDraft(draft)}
                    className="shrink-0 text-[10px] rounded border border-zinc-700 px-2 py-0.5 text-zinc-200"
                  >
                    Reopen
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirmDraftDelete === draft.id) { void deleteDraft(draft.id); return; }
                      setConfirmDraftDelete(draft.id);
                    }}
                    className="shrink-0 text-[10px] rounded border border-rose-900/60 px-2 py-0.5 text-rose-300"
                  >
                    {confirmDraftDelete === draft.id ? 'Confirm delete' : 'Delete'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {draftNote && <p className="px-3 pb-2 text-[11px] text-zinc-400">{draftNote}</p>}
      {errorMsg && (
        <div className="px-3 py-1.5 border-t border-zinc-800/40 text-[11px] text-rose-300/80 bg-rose-500/5">
          <AlertTriangle className="inline w-3 h-3 mr-1" /> {errorMsg}
        </div>
      )}
    </form>
  );
}

export default QuickPostComposer;
