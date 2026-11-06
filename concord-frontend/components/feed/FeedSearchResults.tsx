'use client';

/**
 * FeedSearchResults — Feed's Explore search, wired to the platform's
 * social search (GET /api/social/search → searchSocial over the social
 * graph store: people by handle/name, posts by content/hashtags,
 * visibility + block filtered). Until this panel existed, Feed's search
 * box only filtered the ≤20 posts already loaded into the timeline, so
 * a true query whose post was never loaded answered "No results found"
 * while the same post sat in Trending (R4 Feed F1). Social's Explore
 * queries this same endpoint (Social build D2) — one wired search
 * across both lenses (the Lead compilation's D1 floor).
 */

import { useQuery } from '@tanstack/react-query';
import { Hash, Loader2, Users } from 'lucide-react';
import { api } from '@/lib/api/client';

export interface FeedSocialSearchData {
  people: Array<{ id: string; username: string; displayName: string }>;
  posts: Array<{ id: string; userId: string; content: string; createdAt: string }>;
  hashtags: Array<{ tag: string; count: number }>;
}

export const EMPTY_FEED_SEARCH: FeedSocialSearchData = { people: [], posts: [], hashtags: [] };

export function FeedSearchResults({
  query,
  onNavigateToUser,
}: {
  query: string;
  onNavigateToUser?: (uid: string) => void;
}) {
  const q = query.trim();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['feed-social-search', q],
    queryFn: async (): Promise<FeedSocialSearchData> => {
      if (q.length < 2) return EMPTY_FEED_SEARCH;
      const res = await api.get('/api/social/search', { params: { q } });
      const d = (res.data || {}) as Partial<FeedSocialSearchData>;
      return {
        people: Array.isArray(d.people) ? d.people : [],
        posts: Array.isArray(d.posts) ? d.posts : [],
        hashtags: Array.isArray(d.hashtags) ? d.hashtags : [],
      };
    },
    enabled: q.length >= 2,
  });

  if (q.length < 2) {
    return (
      <div className="py-10 text-center text-sm text-gray-400">
        Type at least 2 characters to search people, posts and topics across the instance.
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-neon-cyan" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="py-10 text-center text-sm text-gray-400">
        Search could not run just now — try again in a moment.
      </div>
    );
  }
  const results = data || EMPTY_FEED_SEARCH;
  const total = results.people.length + results.posts.length + results.hashtags.length;
  if (total === 0) {
    return (
      <div className="py-10 text-center text-sm text-gray-400">
        No results found for &ldquo;{q}&rdquo; — no person, post or topic on this instance matches.
      </div>
    );
  }
  return (
    <div>
      {results.people.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-gray-500">
            <Users className="w-3 h-3" /> People
          </p>
          {results.people.map((person) => (
            <button
              key={person.id}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-lattice-deep transition-colors text-left"
              onClick={() => onNavigateToUser?.(person.username || person.id)}
            >
              <span className="w-8 h-8 rounded-full bg-gradient-to-br from-neon-cyan to-neon-purple flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                {(person.displayName || person.username || '?').charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-white truncate">
                  {person.displayName || person.username}
                </span>
                {person.username && (
                  <span className="block text-xs text-gray-400 truncate">@{person.username}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      {results.posts.length > 0 && (
        <div>
          <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-gray-500">Posts</p>
          {results.posts.map((post) => (
            <div key={post.id} className="px-4 py-2.5 border-b border-lattice-border/50">
              <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">{post.content}</p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                {new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          ))}
        </div>
      )}
      {results.hashtags.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-gray-500">
            <Hash className="w-3 h-3" /> Topics
          </p>
          <div className="flex flex-wrap gap-1.5 px-4 pb-3">
            {results.hashtags.map((h) => (
              <span
                key={h.tag}
                className="rounded-full bg-white/5 border border-lattice-border px-2.5 py-1 text-xs text-gray-300"
              >
                #{h.tag} · {h.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
