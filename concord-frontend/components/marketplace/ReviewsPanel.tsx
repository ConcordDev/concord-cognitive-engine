'use client';

/**
 * ReviewsPanel — buyer reviews & ratings per listing and per shop.
 *
 * Sellers see incoming reviews with a rating distribution bar and can
 * reply to each. A composer lets you post a review against any of your
 * published listings or the shop itself. All data flows through the
 * marketplace `reviews-list` / `reviews-create` / `reviews-reply`
 * macros — no seed data.
 */

import { useCallback, useEffect, useState } from 'react';
import { Star, Loader2, MessageSquare, Send } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Review {
  id: string;
  number: string;
  sellerId: string;
  targetType: 'listing' | 'shop';
  targetId: string;
  reviewerName: string;
  rating: number;
  title: string;
  body: string;
  orderId: string;
  sellerReply: string;
  repliedAt?: string;
  createdAt: string;
}

interface Listing {
  id: string;
  title: string;
}

interface ReviewsPanelProps {
  sellerId?: string;
}

function Stars({ value, onPick }: { value: number; onPick?: (n: number) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onPick}
          onClick={() => onPick?.(n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={cn(!onPick && 'cursor-default')}
        >
          <Star
            className={cn(
              'w-3.5 h-3.5',
              n <= value ? 'fill-amber-400 text-amber-400' : 'text-gray-600',
            )}
          />
        </button>
      ))}
    </div>
  );
}

export function ReviewsPanel({ sellerId }: ReviewsPanelProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [avg, setAvg] = useState<number | null>(null);
  const [dist, setDist] = useState<Record<string, number>>({});
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'listing' | 'shop'>('all');
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [composer, setComposer] = useState({
    targetType: 'shop' as 'listing' | 'shop',
    targetId: '',
    rating: 5,
    title: '',
    body: '',
    reviewerName: '',
  });
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const input: Record<string, unknown> = {};
      if (sellerId) input.sellerId = sellerId;
      if (filter !== 'all') input.targetType = filter;
      const r = await lensRun('marketplace', 'reviews-list', input);
      if (r.data?.ok) {
        setReviews((r.data.result?.reviews || []) as Review[]);
        setAvg((r.data.result?.avgRating as number | null) ?? null);
        setDist((r.data.result?.distribution || {}) as Record<string, number>);
      }
    } catch (e) {
      console.error('[Reviews] list failed', e);
    } finally {
      setLoading(false);
    }
  }, [sellerId, filter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    lensRun('marketplace', 'listings-list', { status: 'published' })
      .then((r) => {
        if (r.data?.ok) {
          setListings(
            ((r.data.result?.listings || []) as Array<{ id: string; title: string }>).map((l) => ({
              id: l.id,
              title: l.title,
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  async function postReview() {
    if (!composer.body.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const input: Record<string, unknown> = {
        targetType: composer.targetType,
        rating: composer.rating,
        title: composer.title.trim(),
        body: composer.body.trim(),
        reviewerName: composer.reviewerName.trim() || undefined,
      };
      if (sellerId) input.sellerId = sellerId;
      if (composer.targetType === 'listing') input.targetId = composer.targetId;
      const r = await lensRun('marketplace', 'reviews-create', input);
      if (r.data?.ok === false) {
        setError(r.data.error || 'Could not post review');
        return;
      }
      setComposer({ ...composer, title: '', body: '', rating: 5 });
      await refresh();
    } catch (e) {
      console.error('[Reviews] create failed', e);
      setError('Could not post review');
    } finally {
      setPosting(false);
    }
  }

  async function reply(id: string) {
    const text = (replyDraft[id] || '').trim();
    if (!text) return;
    try {
      await lensRun('marketplace', 'reviews-reply', { id, reply: text });
      setReplyDraft((d) => ({ ...d, [id]: '' }));
      await refresh();
    } catch (e) {
      console.error('[Reviews] reply failed', e);
    }
  }

  const total = Object.values(dist).reduce((s, n) => s + n, 0);

  return (
    <div className="space-y-3">
      <div className="bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Star className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-semibold text-gray-200">Reviews &amp; ratings</span>
          <span className="text-[10px] text-gray-400">{reviews.length}</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="ml-auto text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white"
          >
            <option value="all">All</option>
            <option value="listing">Listing</option>
            <option value="shop">Shop</option>
          </select>
        </header>

        {/* Rating summary */}
        {avg !== null && (
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-300">{avg.toFixed(1)}</div>
              <Stars value={Math.round(avg)} />
              <div className="text-[10px] text-gray-400 mt-0.5">{total} ratings</div>
            </div>
            <div className="flex-1 space-y-1">
              {[5, 4, 3, 2, 1].map((n) => {
                const count = dist[String(n)] || 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div key={n} className="flex items-center gap-2 text-[10px]">
                    <span className="w-3 text-gray-400">{n}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-6 text-right text-gray-400">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Composer */}
        <div className="px-4 py-3 border-b border-white/10 grid grid-cols-12 gap-2">
          <select
            value={composer.targetType}
            onChange={(e) =>
              setComposer({ ...composer, targetType: e.target.value as 'listing' | 'shop' })
            }
            className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          >
            <option value="shop">Shop review</option>
            <option value="listing">Listing review</option>
          </select>
          {composer.targetType === 'listing' && (
            <select
              value={composer.targetId}
              onChange={(e) => setComposer({ ...composer, targetId: e.target.value })}
              className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            >
              <option value="">Select listing…</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          )}
          <div className="col-span-2 flex items-center">
            <Stars value={composer.rating} onPick={(n) => setComposer({ ...composer, rating: n })} />
          </div>
          <input
            value={composer.reviewerName}
            onChange={(e) => setComposer({ ...composer, reviewerName: e.target.value })}
            placeholder="Your name (optional)"
            className={cn(
              'px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white',
              composer.targetType === 'listing' ? 'col-span-3' : 'col-span-7',
            )}
          />
          <input
            value={composer.title}
            onChange={(e) => setComposer({ ...composer, title: e.target.value })}
            placeholder="Review title"
            className="col-span-12 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <textarea
            value={composer.body}
            onChange={(e) => setComposer({ ...composer, body: e.target.value })}
            placeholder="Write your review…"
            rows={2}
            className="col-span-12 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          {error && <div className="col-span-12 text-xs text-rose-300">{error}</div>}
          <button
            onClick={postReview}
            disabled={posting || !composer.body.trim()}
            className="col-span-12 px-3 py-1.5 text-xs rounded bg-orange-500 text-black font-bold hover:bg-orange-400 disabled:opacity-40 inline-flex items-center justify-center gap-1"
          >
            {posting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Post review
          </button>
        </div>

        {/* Review list */}
        <div className="max-h-[28rem] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-xs text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
            </div>
          ) : reviews.length === 0 ? (
            <div className="px-3 py-10 text-center text-xs text-gray-400">
              <Star className="w-6 h-6 mx-auto mb-2 opacity-30" />
              No reviews yet.
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {reviews.map((rv) => (
                <li key={rv.id} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Stars value={rv.rating} />
                    <span className="text-xs text-white font-medium">{rv.title || 'Review'}</span>
                    <span className="text-[10px] text-gray-400 ml-auto">
                      {rv.reviewerName} · {new Date(rv.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-[10px] uppercase text-gray-400 font-mono">
                    {rv.targetType} · {rv.number}
                  </div>
                  {rv.body && <p className="text-xs text-gray-300">{rv.body}</p>}
                  {rv.sellerReply ? (
                    <div className="ml-3 mt-1 pl-2 border-l-2 border-orange-500/40 text-xs text-orange-200">
                      <span className="text-[10px] uppercase text-orange-400">Seller reply</span>
                      <div>{rv.sellerReply}</div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        value={replyDraft[rv.id] || ''}
                        onChange={(e) =>
                          setReplyDraft((d) => ({ ...d, [rv.id]: e.target.value }))
                        }
                        placeholder="Reply as seller…"
                        className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                      />
                      <button
                        onClick={() => reply(rv.id)}
                        className="p-1.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/30 hover:bg-orange-500/25"
                        aria-label="Send reply"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default ReviewsPanel;
