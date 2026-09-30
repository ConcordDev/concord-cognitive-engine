'use client';

import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, apiHelpers } from '@/lib/api/client';
import type { CandidatePost } from '@/components/feed/FeedToolsPanel';

export type FeedTab = 'for-you' | 'following' | 'releases' | 'trending';

export type PostType = 'text' | 'audio' | 'release' | 'art' | 'collab';

export interface PostAuthor {
  id: string;
  name: string;
  handle: string;
  gradient: string;
  verified: boolean;
}

export interface FeedPost {
  id: string;
  type: PostType;
  author: PostAuthor;
  content: string;
  createdAt: string;
  likes: number;
  comments: number;
  reposts: number;
  shares: number;
  views: number;
  liked: boolean;
  reposted: boolean;
  bookmarked: boolean;
  audio?: { title: string; duration: string; bitrate?: number; waveform: number[] };
  release?: {
    title: string;
    artist: string;
    coverGradient: string;
    trackCount: number;
    tracks: string[];
    releaseDate: string;
  };
  art?: { images: { gradient: string; label: string }[] };
  collab?: {
    sessionName: string;
    participants: number;
    maxParticipants: number;
    genre: string;
  };
  tags?: string[];
  dtuId?: string;
  dtuSource?: string;
  dtuMeta?: Record<string, unknown>;
  taggedProducts?: {
    listingId: string;
    title: string;
    price: number;
    imageUrl?: string;
    sellerId?: string;
  }[];
  linkedDTUs?: { dtuId: string; title: string; type?: string }[];
}

const gradients = [
  'from-neon-cyan to-blue-600',
  'from-neon-purple to-pink-600',
  'from-neon-pink to-rose-600',
  'from-neon-green to-emerald-600',
  'from-amber-400 to-orange-600',
  'from-violet-500 to-indigo-600',
  'from-teal-400 to-cyan-600',
  'from-rose-400 to-red-600',
];

export const pickGrad = (i: number) => gradients[i % gradients.length];

const PAGE_SIZE = 20;

export function useFeedPosts(tab: FeedTab, fallbackItems: FeedPost[] = []) {
  const query = useInfiniteQuery<FeedPost[]>({
    queryKey: ['feed-posts', tab],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const offset = pageParam as number;
      try {
        const endpoint =
          tab === 'following'
            ? '/api/social/feed/following'
            : tab === 'trending'
              ? '/api/social/feed/explore'
              : '/api/social/feed/foryou';
        const socialRes = await api
          .get(endpoint, { params: { limit: PAGE_SIZE, offset } })
          .catch(() => null);
        const socialPosts = socialRes?.data?.posts || socialRes?.data || [];
        if (Array.isArray(socialPosts) && socialPosts.length > 0) {
          return socialPosts.map((p: Record<string, unknown>, i: number) => ({
            id: (p.id as string) || `sp-${offset + i}`,
            type: ((p.mediaType as string) || 'text') as PostType,
            author: {
              id: (p.userId as string) || 'user',
              name: (p.displayName as string) || 'User',
              handle: (p.userId as string) || 'user',
              gradient: pickGrad(offset + i),
              verified: false,
            },
            content: (p.content as string) || (p.title as string) || '',
            createdAt: (p.createdAt as string) || new Date().toISOString(),
            likes: (p.reactionCount as number) || 0,
            comments: (p.commentCount as number) || 0,
            reposts: (p.shareCount as number) || 0,
            shares: (p.shareCount as number) || 0,
            views: (p.viewCount as number) || 0,
            liked: false,
            reposted: false,
            bookmarked: false,
            tags: (p.tags as string[]) || [],
            dtuId: p.id as string,
            taggedProducts: (p.taggedProducts as FeedPost['taggedProducts']) || [],
            linkedDTUs: (p.linkedDTUs as FeedPost['linkedDTUs']) || [],
          }));
        }
        if (offset === 0) {
          const dtuRes = await apiHelpers.dtus
            .paginated({ limit: PAGE_SIZE })
            .catch(() => ({ data: { dtus: [] } }));
          if (dtuRes?.data?.dtus?.length) {
            return dtuRes.data.dtus.map((dtu: Record<string, unknown>, i: number) => ({
              id: dtu.id as string,
              type: 'text' as PostType,
              author: {
                id: (dtu.authorId as string) || 'user',
                name: (dtu.authorName as string) || 'User',
                handle: (dtu.authorHandle as string) || 'user',
                gradient: pickGrad(i),
                verified: false,
              },
              content: (dtu.content as string)?.slice(0, 400) || (dtu.title as string) || '',
              createdAt: (dtu.createdAt as string) || new Date().toISOString(),
              likes: 0,
              comments: 0,
              reposts: 0,
              shares: 0,
              views: 0,
              liked: false,
              reposted: false,
              bookmarked: false,
              dtuId: dtu.id as string,
              dtuSource: dtu.source as string | undefined,
              dtuMeta: dtu.meta as Record<string, unknown> | undefined,
            }));
          }
          return fallbackItems;
        }
        return [];
      } catch {
        if (offset === 0 && fallbackItems.length > 0) return fallbackItems;
        return [];
      }
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return allPages.reduce((sum, page) => sum + page.length, 0);
    },
  });

  const feedPosts = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);

  const candidates: CandidatePost[] = useMemo(
    () =>
      feedPosts.map((p) => ({
        id: p.id,
        authorId: p.author?.id || p.author?.handle || 'unknown',
        content: p.content,
        tags: p.tags,
        likes: p.likes,
        comments: p.comments,
        reposts: p.reposts,
        createdAt: p.createdAt,
      })),
    [feedPosts],
  );

  return { ...query, feedPosts, candidates };
}
