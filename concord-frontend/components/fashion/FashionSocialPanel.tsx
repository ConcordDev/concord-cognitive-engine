'use client';

/**
 * FashionSocialPanel — community outfit feed: share saved outfits,
 * like / save / browse others' looks. Backed by fashion.social-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Heart, Bookmark, Share2, Trash2, Users, Copy, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Outfit { id: string; name: string }
interface CommunityPost {
  id: string; ownerLabel: string; caption: string; occasion: string; season: string;
  itemNames: string[]; itemIds: string[]; likes: number; saves: number; likedByMe: boolean;
  savedByMe: boolean; mine: boolean; createdAt: string;
}
type FeedFilter = 'recent' | 'popular' | 'mine' | 'saved';

export function FashionSocialPanel() {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [filter, setFilter] = useState<FeedFilter>('recent');
  // Friends-scoped feed toggle (fashion-capability-map.md #16 — the feed
  // was global-only; this piggybacks on Concord's real friends graph via
  // fashion.social-feed's new `friendsOnly` param, never a client-side
  // filter over the global list).
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareOutfitId, setShareOutfitId] = useState('');
  const [caption, setCaption] = useState('');
  const [sharing, setSharing] = useState(false);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [clonedIds, setClonedIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    const feedParams: Record<string, unknown> =
      filter === 'mine' ? { mine: true }
        : filter === 'saved' ? { savedOnly: true }
          : { sort: filter };
    if (friendsOnly) feedParams.friendsOnly = true;
    const [f, o] = await Promise.all([
      lensRun('fashion', 'social-feed', feedParams),
      lensRun('fashion', 'outfit-list', {}),
    ]);
    setPosts((f.data?.result?.posts as CommunityPost[]) || []);
    setOutfits((o.data?.result?.outfits as Outfit[]) || []);
    setLoading(false);
  }, [filter, friendsOnly]);

  useEffect(() => { void refresh(); }, [refresh]);

  const share = async () => {
    if (!shareOutfitId) { setError('Choose an outfit to share.'); return; }
    setSharing(true);
    const r = await lensRun('fashion', 'social-share-outfit', {
      outfitId: shareOutfitId, caption: caption.trim(),
    });
    setSharing(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setShareOutfitId(''); setCaption(''); setError(null);
    await refresh();
  };

  const like = async (id: string) => {
    const r = await lensRun('fashion', 'social-like', { id });
    if (r.data?.ok !== false) {
      const updated = r.data?.result?.post as CommunityPost;
      setPosts((ps) => ps.map((p) => (p.id === id ? updated : p)));
    }
  };
  const save = async (id: string) => {
    const r = await lensRun('fashion', 'social-save', { id });
    if (r.data?.ok !== false) {
      const updated = r.data?.result?.post as CommunityPost;
      if (filter === 'saved' && !updated.savedByMe) { setPosts((ps) => ps.filter((p) => p.id !== id)); return; }
      setPosts((ps) => ps.map((p) => (p.id === id ? updated : p)));
    }
  };
  const del = async (id: string) => {
    await lensRun('fashion', 'social-delete', { id });
    await refresh();
  };

  // Clone a single shared item straight into the caller's own closet
  // (fashion.social-clone-item). Creates a genuine independent item —
  // never a reference back to the friend's — so nothing here can mutate
  // the source. Keyed by itemId so multiple clone buttons on one post
  // each show their own pending/done state.
  const cloneItem = async (postId: string, itemId: string) => {
    setCloningId(itemId);
    const r = await lensRun('fashion', 'social-clone-item', { postId, itemId });
    setCloningId(null);
    if (r.data?.ok === false) { setError(r.data?.error || 'Clone failed'); return; }
    setError(null);
    setClonedIds((prev) => new Set(prev).add(itemId));
  };

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Share */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
          <Share2 className="w-4 h-4 text-fuchsia-400" /> Share an outfit
        </h3>
        {outfits.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">Create an outfit first to share it.</p>
        ) : (
          <>
            <select value={shareOutfitId} onChange={(e) => setShareOutfitId(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              <option value="">— choose outfit —</option>
              {outfits.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption (optional)"
              maxLength={280}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={share} disabled={sharing}
              className="w-full flex items-center justify-center gap-1.5 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg px-2 py-1.5">
              {sharing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
              Post to community feed
            </button>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1">
        {(['recent', 'popular', 'mine', 'saved'] as FeedFilter[]).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={cn('text-[11px] px-2.5 py-1 rounded-full border capitalize',
              filter === f ? 'border-fuchsia-700/50 bg-fuchsia-950/40 text-fuchsia-300' : 'border-zinc-700 text-zinc-400')}>
            {f}
          </button>
        ))}
        <button type="button" onClick={() => setFriendsOnly((v) => !v)}
          aria-pressed={friendsOnly}
          className={cn('flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border ml-auto',
            friendsOnly ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300' : 'border-zinc-700 text-zinc-400')}>
          <Users className="w-3 h-3" /> Friends only
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : posts.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          {friendsOnly ? 'No looks from friends yet — add friends, or turn off "Friends only" to browse the full feed.'
            : filter === 'saved' ? 'No saved looks yet.'
              : filter === 'mine' ? 'You have not shared any outfits.'
                : 'No community looks yet — be the first to share.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {posts.map((p) => (
            <li key={p.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-100">{p.ownerLabel}</span>
                <span className="text-[10px] text-zinc-400 capitalize">{p.occasion} · {p.season}</span>
              </div>
              <p className="text-sm text-zinc-200 mt-0.5">{p.caption}</p>
              {p.itemNames.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {p.itemNames.map((n, idx) => {
                    const itemId = p.itemIds?.[idx];
                    const cloned = itemId ? clonedIds.has(itemId) : false;
                    return (
                      <span key={idx} className="inline-flex items-center gap-1 text-[10px] pl-1.5 pr-1 py-0.5 rounded bg-zinc-800 text-zinc-300">
                        {n}
                        {!p.mine && itemId && (
                          <button type="button" onClick={() => cloneItem(p.id, itemId)}
                            disabled={cloningId === itemId || cloned}
                            title={cloned ? 'Cloned to your closet' : 'Clone to my closet'}
                            aria-label={`Clone ${n} to my closet`}
                            className="text-zinc-500 hover:text-fuchsia-400 disabled:opacity-60 disabled:hover:text-zinc-500">
                            {cloningId === itemId ? <Loader2 className="w-3 h-3 animate-spin" />
                              : cloned ? <Check className="w-3 h-3 text-emerald-400" />
                                : <Copy className="w-3 h-3" />}
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center gap-3 mt-2">
                <button type="button" onClick={() => like(p.id)}
                  className={cn('flex items-center gap-1 text-[11px]', p.likedByMe ? 'text-rose-400' : 'text-zinc-400 hover:text-rose-300')}>
                  <Heart className={cn('w-3.5 h-3.5', p.likedByMe && 'fill-rose-400')} /> {p.likes}
                </button>
                <button type="button" onClick={() => save(p.id)}
                  className={cn('flex items-center gap-1 text-[11px]', p.savedByMe ? 'text-amber-400' : 'text-zinc-400 hover:text-amber-300')}>
                  <Bookmark className={cn('w-3.5 h-3.5', p.savedByMe && 'fill-amber-400')} /> {p.saves}
                </button>
                {p.mine && (
                  <button aria-label="Delete" type="button" onClick={() => del(p.id)}
                    className="ml-auto text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
