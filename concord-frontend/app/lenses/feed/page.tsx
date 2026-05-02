'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Virtuoso } from 'react-virtuoso';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { api, apiHelpers } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart,
  MessageCircle,
  Repeat2,
  Share,
  Bookmark,
  MoreHorizontal,
  Image as ImageIcon,
  BarChart3,
  Verified,
  Home,
  Search,
  Bell,
  Mail,
  User,
  Sparkles,
  Play,
  Pause,
  Rss,
  Link2,
  PlusCircle,
  Newspaper,
  Palette,
  Users,
  TrendingUp,
  Eye,
  FileText,
  Globe,
  Link,
  Trash2,
  Send,
  Flag,
  Loader2,
  X,
  Hash,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { ErrorState } from '@/components/common/EmptyState';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useUIStore } from '@/store/ui';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { LensContextPanel } from '@/components/lens/LensContextPanel';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';
import { ProvenanceBadge } from '@/components/dtu/ProvenanceBadge';
import { ReportButton } from '@/components/common/ReportButton';
import { StoriesBar } from '@/components/social/StoriesBar';
import { SuggestedFollows } from '@/components/social/SuggestedFollows';
import { PresenceIndicator } from '@/components/social/PresenceIndicator';
import { SocialCommerceTag } from '@/components/social/SocialCommerceTag';
import { CrossPostExternal } from '@/components/social/CrossPostExternal';
import { Discovery } from '@/components/social/Discovery';
import { PostScheduler } from '@/components/social/PostScheduler';
import { TrendingTopics } from '@/components/social/TrendingTopics';
import { UserProfile } from '@/components/social/UserProfile';
import { PullToSubstrate } from '@/components/lens/PullToSubstrate';
import { FeedBanner } from '@/components/lens/FeedBanner';
import { StreakIndicator } from '@/components/social/StreakIndicator';
import { NotificationCenter } from '@/components/social/NotificationCenter';
import { DMIndicator } from '@/components/social/DMIndicator';
import { GroupCard, GroupData } from '@/components/social/GroupCard';
import { ShoppingBag, Tag } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type PostType = 'text' | 'audio' | 'release' | 'art' | 'collab';
type FeedTab = 'for-you' | 'following' | 'releases' | 'trending';

interface PostAuthor {
  id: string;
  name: string;
  handle: string;
  gradient: string;
  verified: boolean;
}

interface AudioAttachment {
  title: string;
  duration: string;
  bitrate?: number;
  waveform: number[];
}

interface ReleaseAttachment {
  title: string;
  artist: string;
  coverGradient: string;
  trackCount: number;
  tracks: string[];
  releaseDate: string;
}

interface ArtAttachment {
  images: { gradient: string; label: string }[];
}

interface CollabAttachment {
  sessionName: string;
  participants: number;
  maxParticipants: number;
  genre: string;
}

interface FeedPost {
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
  audio?: AudioAttachment;
  release?: ReleaseAttachment;
  art?: ArtAttachment;
  collab?: CollabAttachment;
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

interface TrendingTopic {
  id: string;
  tag: string;
  category: string;
  posts: number;
}

interface MiniRelease {
  id: string;
  title: string;
  artist: string;
  gradient: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

const pickGrad = (i: number) => gradients[i % gradients.length];

const generateWaveform = (len = 32): number[] =>
  Array.from({ length: len }, (_, i) => 12 + Math.floor((Math.sin(i * 0.5) * 0.5 + 0.5) * 28));

// ── Data (all from backend — no mock data) ───────────────────────────────────

const _INITIAL_AUTHORS: PostAuthor[] = [];
const INITIAL_POSTS: FeedPost[] = [];
const TRENDING_TOPICS: TrendingTopic[] = [];

const NEW_RELEASES: MiniRelease[] = [];

// ── Subcomponents ──────────────────────────────────────────────────────────────

function WaveformPlayer({
  waveform,
  duration,
  bitrate,
  title,
}: AudioAttachment & { className?: string }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const togglePlay = useCallback(() => {
    setPlaying((prev) => {
      if (!prev) {
        // simulate playback progress
        let p = progress;
        const iv = setInterval(() => {
          p += 2;
          if (p >= 100) {
            clearInterval(iv);
            setPlaying(false);
            setProgress(0);
            return;
          }
          setProgress(p);
        }, 200);
      }
      return !prev;
    });
  }, [progress]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 rounded-xl bg-lattice-deep border border-lattice-border p-3"
    >
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-neon-cyan/20 text-neon-cyan flex items-center justify-center hover:bg-neon-cyan/30 transition-colors flex-shrink-0"
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <FileText className="w-3.5 h-3.5 text-neon-cyan" />
            <span className="text-sm font-medium text-white truncate">{title}</span>
            {bitrate && <span className="text-xs text-gray-500">{bitrate} kbps</span>}
          </div>
          <div className="flex items-end gap-[2px] h-8">
            {waveform.map((h, i) => {
              const filled = (i / waveform.length) * 100 < progress;
              return (
                <div
                  key={i}
                  className={cn(
                    'flex-1 rounded-sm transition-colors duration-150',
                    filled ? 'bg-neon-cyan' : playing ? 'bg-gray-600' : 'bg-gray-700'
                  )}
                  style={{ height: `${h}%` }}
                />
              );
            })}
          </div>
        </div>
        <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">{duration}</span>
      </div>
    </motion.div>
  );
}

function ReleaseCard({ release }: { release: ReleaseAttachment }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 rounded-xl bg-lattice-deep border border-lattice-border overflow-hidden"
    >
      <div className="flex">
        <div
          className={cn(
            'w-28 h-28 flex-shrink-0 bg-gradient-to-br flex items-center justify-center',
            release.coverGradient
          )}
        >
          <Newspaper className="w-10 h-10 text-white/60" />
        </div>
        <div className="flex-1 p-3 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neon-pink bg-neon-pink/10 px-2 py-0.5 rounded-full">
              New Release
            </span>
          </div>
          <h4 className="font-bold text-white text-sm truncate">{release.title}</h4>
          <p className="text-xs text-gray-400">
            {release.artist} &middot; {release.trackCount} tracks
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {release.tracks.slice(0, 3).map((t, i) => (
              <span key={i} className="text-[11px] text-gray-500">
                {i + 1}. {t}
                {i < 2 ? ',' : ''}
              </span>
            ))}
            {release.trackCount > 3 && (
              <span className="text-[11px] text-neon-cyan">+{release.trackCount - 3} more</span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ArtGallery({ images }: { images: ArtAttachment['images'] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'mt-3 grid gap-1 rounded-xl overflow-hidden border border-lattice-border',
        images.length === 1 && 'grid-cols-1',
        images.length === 2 && 'grid-cols-2',
        images.length === 3 && 'grid-cols-2',
        images.length >= 4 && 'grid-cols-2'
      )}
    >
      {images.map((img, i) => (
        <div
          key={i}
          className={cn(
            'bg-gradient-to-br flex items-center justify-center relative group',
            img.gradient,
            images.length === 1
              ? 'h-64'
              : images.length === 3 && i === 0
                ? 'row-span-2 h-full min-h-[200px]'
                : 'h-32'
          )}
        >
          <Palette className="w-8 h-8 text-white/30" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end p-2">
            <span className="text-[10px] text-white/0 group-hover:text-white/80 transition-colors">
              {img.label}
            </span>
          </div>
        </div>
      ))}
    </motion.div>
  );
}

function CollabCard({ collab }: { collab: CollabAttachment }) {
  const spotsLeft = collab.maxParticipants - collab.participants;
  const joinMutation = useMutation({
    mutationFn: () =>
      apiHelpers.artistry.collab.sessions.join(collab.sessionName, { userId: 'current-user' }),
    onSuccess: () =>
      useUIStore
        .getState()
        .addToast({ type: 'success', message: `Joined "${collab.sessionName}"` }),
    onError: () => {
      useUIStore
        .getState()
        .addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 rounded-xl bg-gradient-to-r from-neon-purple/10 to-neon-cyan/10 border border-neon-purple/30 p-4"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-neon-purple" />
            <span className="text-sm font-bold text-white">{collab.sessionName}</span>
          </div>
          <p className="text-xs text-gray-400">
            {collab.genre} &middot; {collab.participants}/{collab.maxParticipants} joined &middot;{' '}
            {spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left
          </p>
        </div>
        <button
          onClick={() => joinMutation.mutate()}
          disabled={joinMutation.isPending || spotsLeft <= 0}
          className="px-4 py-1.5 bg-neon-purple text-white text-sm font-bold rounded-full hover:bg-neon-purple/80 transition-colors disabled:opacity-50"
        >
          {joinMutation.isPending ? 'Joining...' : 'Join'}
        </button>
      </div>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function FeedLensPage() {
  useLensNav('feed');
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('feed');

  // ── Feed presence ──────────────────────────────────────────
  // Who's on the feed right now. 30s poll against /api/presence/active
  // which is fed by the per-user activity tracker in makeCtx().
  const { data: presenceResp } = useQuery({
    queryKey: ['feed-presence'],
    queryFn: () =>
      api
        .get<{
          ok: boolean;
          users: Array<{ userId: string; displayName: string; status: 'active' | 'idle' }>;
        }>('/api/presence/active?lens=feed&windowMs=300000&limit=20')
        .then((r) => r.data),
    refetchInterval: 30_000,
  });
  const presenceUsers = presenceResp?.users || [];

  const {
    hyperDTUs,
    megaDTUs,
    regularDTUs,
    tierDistribution,
    publishToMarketplace,
    isLoading: dtusLoading,
    refetch: refetchDTUs,
  } = useLensDTUs({ lens: 'feed' });

  const queryClient = useQueryClient();

  // Backend action wiring
  const runFeedAction = useRunArtifact('feed');
  const [feedActionResult, setFeedActionResult] = useState<Record<string, unknown> | null>(null);
  const [feedRunning, setFeedRunning] = useState<string | null>(null);

  const handleFeedAction = async (action: string) => {
    const targetId = postLensItems?.[0]?.id;
    if (!targetId) return;
    setFeedRunning(action);
    try {
      const res = await runFeedAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) {
        setFeedActionResult({
          _action: action,
          message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}`,
        });
      } else {
        setFeedActionResult({ _action: action, ...(res.result as Record<string, unknown>) });
      }
    } catch (e) {
      console.error(`Feed action ${action} failed:`, e);
      setFeedActionResult({
        message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
      });
    }
    setFeedRunning(null);
  };

  const [newPost, setNewPost] = useState('');
  const [activeTab, setActiveTab] = useState<FeedTab>('for-you');
  const [searchQuery, setSearchQuery] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const composeRef = useRef<HTMLTextAreaElement>(null);

  // Product tagging state for compose
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [taggedProducts, setTaggedProducts] = useState<
    { listingId: string; title: string; price: number; imageUrl?: string; sellerId?: string }[]
  >([]);
  const [purchaseLoading, setPurchaseLoading] = useState<string | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = useState<string | null>(null);

  // Fetch marketplace listings for product tagging
  const { data: marketplaceListings } = useQuery({
    queryKey: ['marketplace-listings-picker', productSearch],
    queryFn: async () => {
      const res = await api
        .get('/api/marketplace-lens-registry/search', { params: { q: productSearch || 'all' } })
        .catch(() => null);
      return res?.data?.results || [];
    },
    enabled: showProductPicker,
  });

  const handleInlinePurchase = async (product: {
    listingId: string;
    title: string;
    price: number;
    sellerId?: string;
  }) => {
    setPurchaseLoading(product.listingId);
    setPurchaseSuccess(null);
    try {
      await api.post('/api/economy/transfer', {
        to: product.sellerId || 'platform',
        amount: product.price,
        type: 'SOCIAL_COMMERCE',
        metadata: { listingId: product.listingId, title: product.title },
      });
      setPurchaseSuccess(product.listingId);
      setTimeout(() => setPurchaseSuccess(null), 3000);
    } catch (err) {
      console.error('Inline purchase failed:', err);
    } finally {
      setPurchaseLoading(null);
    }
  };

  const {
    isError: isError,
    error: error,
    refetch: refetch,
    items: postLensItems,
    create: createLensPost,
  } = useLensData<Record<string, unknown>>('feed', 'post', {
    seed: INITIAL_POSTS.map((p) => ({
      title: p.content?.slice(0, 80) || p.id,
      data: p as unknown as Record<string, unknown>,
    })),
  });

  // Fetch feed from social API with infinite scrolling + DTU fallback
  const PAGE_SIZE = 20;
  const {
    data: feedPages,
    isLoading,
    isError: isError2,
    error: error2,
    refetch: refetch2,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<FeedPost[]>({
    queryKey: ['feed-posts', activeTab],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const offset = pageParam as number;
      try {
        const endpoint =
          activeTab === 'following'
            ? '/api/social/feed/following'
            : activeTab === 'trending'
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
        // Fallback: DTUs as posts (only on first page)
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
          return postLensItems.length > 0
            ? postLensItems.map(
                (li) =>
                  ({ id: li.id, ...(li.data as Record<string, unknown>) }) as unknown as FeedPost
              )
            : [];
        }
        return [];
      } catch {
        if (offset === 0 && postLensItems.length > 0) {
          return postLensItems.map(
            (li) => ({ id: li.id, ...(li.data as Record<string, unknown>) }) as unknown as FeedPost
          );
        }
        return [];
      }
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return allPages.reduce((sum, page) => sum + page.length, 0);
    },
  });
  const feedPosts = useMemo(() => feedPages?.pages.flat() ?? [], [feedPages]);

  const {
    data: trending,
    isError: isError3,
    error: error3,
    refetch: refetch3,
  } = useQuery<TrendingTopic[]>({
    queryKey: ['trending-topics'],
    queryFn: async () => {
      try {
        const r = await api
          .get('/api/social/topics/trending', { params: { limit: 10 } })
          .catch(() => null);
        const topics = r?.data?.topics || r?.data || [];
        if (Array.isArray(topics) && topics.length > 0) {
          return topics.map((t: Record<string, unknown>, i: number) => ({
            id: `t-${i}`,
            tag: `#${(t.tag as string) || (t.topic as string) || ''}`,
            category:
              (t.category as string) || ['News', 'Tech', 'Community', 'Creative', 'Science'][i % 5],
            posts: (t.count as number) || (t.posts as number) || 0,
          }));
        }
        // Fallback: derive from DTU tags
        const dtuR = await apiHelpers.dtus.list().catch(() => ({ data: { dtus: [] } }));
        const allTags = new Set<string>();
        (dtuR.data?.dtus || []).forEach((d: Record<string, unknown>) =>
          ((d.tags as string[]) || []).forEach((t) => allTags.add(t))
        );
        return Array.from(allTags)
          .slice(0, 5)
          .map((tag, i) => ({
            id: `t-${i}`,
            tag: `#${tag}`,
            category: ['News', 'Tech', 'Community', 'Creative', 'Science'][i % 5],
            posts: 0,
          }));
      } catch {
        return [];
      }
    },
  });

  const postMutation = useMutation({
    mutationFn: (content: string) =>
      api.post('/api/social/post', {
        content,
        mediaType: 'text',
        tags: [],
        taggedProducts: taggedProducts.length > 0 ? taggedProducts : undefined,
      }),
    onSuccess: (_data, content) => {
      queryClient.invalidateQueries({ queryKey: ['feed-posts'] });
      createLensPost({
        title: content.slice(0, 80),
        data: {
          content,
          type: 'text',
          taggedProducts,
          createdAt: new Date().toISOString(),
          likes: 0,
          comments: 0,
          reposts: 0,
          shares: 0,
          views: 0,
          liked: false,
          reposted: false,
          bookmarked: false,
        },
      });
      setTaggedProducts([]);
      setNewPost('');
    },
    onError: (err) => {
      console.error('Failed to create post:', err instanceof Error ? err.message : err);
    },
  });

  const likeMutation = useMutation({
    mutationFn: (postId: string) => api.post('/api/social/react', { postId, type: 'like' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed-posts'] }),
    onError: () => {
      useUIStore
        .getState()
        .addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const repostMutation = useMutation({
    mutationFn: (postId: string) => api.post('/api/social/share', { postId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed-posts'] });
      useUIStore.getState().addToast({ type: 'success', message: 'Reposted!' });
    },
    onError: () => {
      useUIStore
        .getState()
        .addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const bookmarkMutation = useMutation({
    mutationFn: (postId: string) => api.post('/api/social/bookmark', { postId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed-posts'] }),
    onError: () => {
      useUIStore
        .getState()
        .addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const shareMutation = useMutation({
    mutationFn: async (postId: string) => {
      if (navigator.share) {
        await navigator.share({
          title: 'Concord Post',
          url: `${window.location.origin}/lenses/feed?post=${postId}`,
        });
      } else {
        await navigator.clipboard.writeText(`${window.location.origin}/lenses/feed?post=${postId}`);
        useUIStore.getState().addToast({ type: 'success', message: 'Link copied to clipboard' });
      }
    },
    onError: () => {
      useUIStore
        .getState()
        .addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  // Comment & post options state
  const [expandedComments, setExpandedComments] = useState<string | null>(null);
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [postComments, setPostComments] = useState<
    Record<
      string,
      { id: string; userId: string; content: string; createdAt: string; replies?: unknown[] }[]
    >
  >({});
  const [postMenuOpen, setPostMenuOpen] = useState<string | null>(null);

  const commentMutation = useMutation({
    mutationFn: ({ postId, content }: { postId: string; content: string }) =>
      api.post('/api/social/comment', { postId, content }),
    onSuccess: (_data, { postId }) => {
      setCommentInputs((prev) => ({ ...prev, [postId]: '' }));
      queryClient.invalidateQueries({ queryKey: ['feed-posts'] });
      // Refetch comments for this post
      api
        .get(`/api/social/comments/${postId}`)
        .then((res) => {
          setPostComments((prev) => ({ ...prev, [postId]: res.data?.comments || [] }));
        })
        .catch((e) => {
          console.warn('Failed to refetch comments:', e);
        });
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to add comment' });
    },
  });

  const deletePostMutation = useMutation({
    mutationFn: (postId: string) => api.delete(`/api/social/post/${postId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed-posts'] });
      useUIStore.getState().addToast({ type: 'success', message: 'Post deleted' });
      setPostMenuOpen(null);
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to delete post' });
    },
  });

  const toggleComments = useCallback(
    (postId: string) => {
      if (expandedComments === postId) {
        setExpandedComments(null);
        return;
      }
      setExpandedComments(postId);
      // Fetch comments from backend
      api
        .get(`/api/social/comments/${postId}`)
        .then((res) => {
          setPostComments((prev) => ({ ...prev, [postId]: res.data?.comments || [] }));
        })
        .catch((e) => {
          console.warn('Failed to fetch comments:', e);
        });
    },
    [expandedComments]
  );

  const handleComposeHint = useCallback((hint: string) => {
    setNewPost((prev) => (prev ? `${prev}\n[${hint}]` : `[${hint}]`));
    composeRef.current?.focus();
  }, []);

  const formatTime = useCallback((dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(diff / 3600000);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(diff / 86400000);
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, []);

  const formatNumber = useCallback((num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  }, []);

  const filteredPosts = useMemo(() => {
    if (!feedPosts) return [];
    let posts = feedPosts;
    if (activeTab === 'releases') posts = posts.filter((p) => p.type === 'release');
    if (activeTab === 'trending') posts = [...posts].sort((a, b) => b.views - a.views);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      posts = posts.filter(
        (p) =>
          p.content.toLowerCase().includes(q) ||
          p.author.name.toLowerCase().includes(q) ||
          p.author.handle.toLowerCase().includes(q) ||
          p.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    return posts;
  }, [feedPosts, activeTab, searchQuery]);

  const tabs: { key: FeedTab; label: string }[] = [
    { key: 'for-you', label: 'For You' },
    { key: 'following', label: 'Following' },
    { key: 'releases', label: 'Releases' },
    { key: 'trending', label: 'Trending' },
  ];

  const sidebarNav = [
    {
      icon: Home,
      label: 'Home',
      active: activeTab === 'for-you',
      action: () => setActiveTab('for-you'),
    },
    {
      icon: Search,
      label: 'Explore',
      active: activeTab === 'trending',
      action: () => setActiveTab('trending'),
    },
    {
      icon: Bell,
      label: 'Notifications',
      active: activeTab === ('notifications' as string),
      action: () => setActiveTab('for-you' as FeedTab),
    },
    {
      icon: Mail,
      label: 'Messages',
      active: false,
      action: () => {
        window.location.href = '/messages';
      },
    },
    {
      icon: Bookmark,
      label: 'Bookmarks',
      active: activeTab === ('bookmarks' as string),
      action: () => setActiveTab('following' as FeedTab),
    },
    {
      icon: User,
      label: 'Profile',
      active: showProfile,
      action: () => setShowProfile((prev) => !prev),
    },
    {
      icon: Rss,
      label: 'Media',
      active: activeTab === 'releases',
      action: () => setActiveTab('releases'),
    },
  ];

  if (isError || isError2 || isError3) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState
          error={error?.message || error2?.message || error3?.message}
          onRetry={() => {
            refetch();
            refetch2();
            refetch3();
          }}
        />
      </div>
    );
  }
  return (
    <div className="lens-feed min-h-full bg-lattice-bg flex" data-lens-theme="feed">
      {/* ── Left Sidebar ──────────────────────────────────────────────────── */}
      <aside className="w-20 xl:w-64 border-r border-lattice-border/50 p-2 xl:p-4 flex flex-col items-center xl:items-start sticky top-0 h-screen overflow-y-auto bg-gradient-to-b from-lattice-surface to-lattice-bg">
        <div className="flex items-center gap-2 mb-8 p-3">
          <Newspaper className="w-8 h-8 text-blue-400" />
          <span className="hidden xl:inline text-lg font-bold text-white tracking-tight">
            Concord
          </span>
        </div>

        <nav className="flex flex-col gap-1 w-full">
          {sidebarNav.map((item) => (
            <button
              key={item.label}
              onClick={item.action}
              className={cn(
                'flex items-center gap-4 p-3 rounded-xl transition-colors w-full',
                item.active
                  ? 'font-bold text-white bg-lattice-surface'
                  : 'text-gray-400 hover:bg-lattice-surface/50 hover:text-white'
              )}
            >
              <item.icon className="w-6 h-6 flex-shrink-0" />
              <span className="hidden xl:inline text-[15px]">{item.label}</span>
            </button>
          ))}
        </nav>

        <button
          onClick={() => {
            composeRef.current?.focus();
            composeRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="mt-6 w-12 h-12 xl:w-full xl:h-auto xl:py-3 bg-neon-cyan text-black font-bold rounded-full hover:bg-neon-cyan/90 transition-colors flex items-center justify-center gap-2"
        >
          <PlusCircle className="w-5 h-5 xl:hidden" />
          <span className="hidden xl:inline">Create Post</span>
        </button>

        <div className="mt-auto pt-4 w-full">
          <div className="hidden xl:flex items-center gap-3 p-3 rounded-xl hover:bg-lattice-surface/50 transition-colors cursor-pointer">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-neon-cyan to-neon-purple flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">Your Name</p>
              <p className="text-xs text-gray-500 truncate">@you</p>
            </div>
            <MoreHorizontal className="w-4 h-4 text-gray-500" />
          </div>
        </div>
      </aside>

      {/* ── Main Feed ─────────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-2xl border-r border-lattice-border">
        {/* Header with tabs */}
        <header className="sticky top-0 z-10 bg-lattice-bg/80 backdrop-blur-md border-b border-lattice-border">
          <div className="flex items-center justify-between px-4 py-3">
            <h1 className="text-xl font-bold text-white">Feed</h1>
            <div className="flex items-center gap-2">
              <StreakIndicator userId="current-user" className="mr-1" />
              <DMIndicator userId="current-user" />
              {dtusLoading && (
                <span className="w-4 h-4 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
              )}
              <button
                onClick={() => refetchDTUs()}
                disabled={dtusLoading}
                className="p-1 rounded hover:bg-lattice-surface/50 disabled:opacity-50 transition-colors"
                title="Refresh DTUs"
              >
                <Sparkles className="w-5 h-5 text-neon-cyan" />
              </button>
            </div>
          </div>

          {/* Real-time Enhancement Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="feed" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex-1 py-3 text-sm font-medium transition-colors relative',
                  activeTab === tab.key ? 'text-white' : 'text-gray-500 hover:bg-lattice-surface/50'
                )}
              >
                {tab.label}
                {activeTab === tab.key && (
                  <motion.div
                    layoutId="feed-tab-indicator"
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 w-14 h-[3px] bg-neon-cyan rounded-full"
                  />
                )}
              </button>
            ))}
          </div>
        </header>

        {/* Feed Banner */}
        <div className="px-4 py-2 border-b border-lattice-border">
          <FeedBanner domain="feed" />
        </div>

        {/* Stories Bar — prominent with gradient border */}
        <StoriesBar
          currentUserId="current-user"
          className="border-b border-lattice-border bg-gradient-to-r from-blue-500/5 via-transparent to-pink-500/5 py-1"
        />

        {/* Compose Box */}
        <div className="p-4 border-b border-lattice-border">
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-neon-cyan to-neon-purple flex-shrink-0" />
            <div className="flex-1">
              <textarea
                ref={composeRef}
                value={newPost}
                onChange={(e) => setNewPost(e.target.value)}
                placeholder="Share a thought, link, or start a discussion..."
                className="w-full bg-transparent text-base text-white placeholder-gray-600 resize-none focus:outline-none min-h-[60px]"
                rows={2}
              />
              <div className="flex items-center justify-between pt-3 border-t border-lattice-border">
                <div className="flex items-center gap-0.5 text-neon-cyan">
                  <button
                    onClick={() => handleComposeHint('Link')}
                    className="p-2 rounded-full hover:bg-neon-cyan/10 transition-colors"
                    title="Attach link"
                  >
                    <Link className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleComposeHint('Audio')}
                    className="p-2 rounded-full hover:bg-neon-cyan/10 transition-colors"
                    title="Attach audio"
                  >
                    <Globe className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleComposeHint('Image')}
                    className="p-2 rounded-full hover:bg-neon-cyan/10 transition-colors"
                    title="Attach image"
                  >
                    <ImageIcon className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleComposeHint('DTU Link')}
                    className="p-2 rounded-full hover:bg-neon-cyan/10 transition-colors"
                    title="Link DTU"
                  >
                    <Link2 className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleComposeHint('Poll')}
                    className="p-2 rounded-full hover:bg-neon-cyan/10 transition-colors"
                    title="Add poll"
                  >
                    <BarChart3 className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setShowProductPicker(!showProductPicker)}
                    className={cn(
                      'p-2 rounded-full hover:bg-neon-green/10 transition-colors',
                      showProductPicker && 'bg-neon-green/10 text-neon-green'
                    )}
                    title="Tag Product"
                  >
                    <ShoppingBag className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleComposeHint('Link DTU')}
                    className="p-2 rounded-full hover:bg-neon-purple/10 transition-colors text-neon-purple"
                    title="Link DTU"
                  >
                    <Tag className="w-5 h-5" />
                  </button>
                  <VisionAnalyzeButton
                    domain="feed"
                    prompt="Describe this image for use as alt text in a social media post. Be concise but descriptive. Also suggest relevant hashtags."
                    onResult={(res) => {
                      setNewPost((prev) =>
                        prev ? `${prev}\n\n[Alt: ${res.analysis}]` : `[Alt: ${res.analysis}]`
                      );
                    }}
                  />
                </div>
                <button
                  onClick={() => postMutation.mutate(newPost)}
                  disabled={!newPost.trim() || postMutation.isPending}
                  className="px-5 py-1.5 bg-neon-cyan text-black font-bold rounded-full hover:bg-neon-cyan/90 disabled:opacity-40 transition-colors text-sm"
                >
                  {postMutation.isPending ? 'Posting...' : 'Post'}
                </button>
              </div>

              {/* Tagged Products Display */}
              {taggedProducts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {taggedProducts.map((p) => (
                    <span
                      key={p.listingId}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neon-green/10 text-neon-green text-xs font-medium border border-neon-green/20"
                    >
                      <ShoppingBag className="w-3 h-3" />
                      {p.title} ({p.price} CC)
                      <button
                        onClick={() =>
                          setTaggedProducts((prev) =>
                            prev.filter((tp) => tp.listingId !== p.listingId)
                          )
                        }
                        className="ml-0.5 hover:text-red-400"
                      >
                        <span className="text-xs">x</span>
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Product Picker */}
              {showProductPicker && (
                <div className="mt-2 p-3 rounded-xl bg-lattice-deep border border-neon-green/20">
                  <div className="flex items-center gap-2 mb-2">
                    <ShoppingBag className="w-4 h-4 text-neon-green" />
                    <span className="text-sm font-medium text-neon-green">Tag Product</span>
                  </div>
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Search marketplace listings..."
                    className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-green mb-2"
                  />
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {(
                      (marketplaceListings as {
                        id: string;
                        name: string;
                        lensNumber?: number;
                        uniqueValue?: string;
                      }[]) || []
                    )
                      .slice(0, 8)
                      .map(
                        (item: {
                          id: string;
                          name: string;
                          lensNumber?: number;
                          uniqueValue?: string;
                        }) => {
                          const alreadyTagged = taggedProducts.some((t) => t.listingId === item.id);
                          return (
                            <button
                              key={item.id}
                              disabled={alreadyTagged}
                              onClick={() => {
                                setTaggedProducts((prev) => [
                                  ...prev,
                                  {
                                    listingId: item.id,
                                    title: item.name,
                                    price: 10,
                                    sellerId: 'platform',
                                  },
                                ]);
                              }}
                              className={cn(
                                'w-full flex items-center justify-between p-2 rounded-lg text-left text-sm transition-colors',
                                alreadyTagged
                                  ? 'opacity-50 cursor-not-allowed bg-lattice-surface'
                                  : 'hover:bg-lattice-surface'
                              )}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-white font-medium truncate">{item.name}</p>
                                {item.uniqueValue && (
                                  <p className="text-xs text-gray-500 truncate">
                                    {item.uniqueValue}
                                  </p>
                                )}
                              </div>
                              {alreadyTagged ? (
                                <span className="text-xs text-neon-green ml-2">Tagged</span>
                              ) : (
                                <span className="text-xs text-gray-400 ml-2">+ Tag</span>
                              )}
                            </button>
                          );
                        }
                      )}
                    {(marketplaceListings || []).length === 0 && (
                      <p className="text-xs text-gray-500 text-center py-2">
                        Type to search marketplace listings
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setShowProductPicker(false)}
                    className="mt-2 text-xs text-gray-400 hover:text-white"
                  >
                    Close picker
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* User Profile Panel (toggled from sidebar) */}
        {showProfile && (
          <div className="border-b border-lattice-border">
            <UserProfile
              userId="current-user"
              currentUserId="current-user"
              onNavigateToUser={(uid) => {
                setSearchQuery(uid);
                setShowProfile(false);
              }}
            />
          </div>
        )}

        {/* Discovery Panel (shown on Trending / Explore tab) */}
        {activeTab === 'trending' && (
          <div className="p-4 border-b border-lattice-border">
            <Discovery
              currentUserId="current-user"
              onNavigateToUser={(uid) => setSearchQuery(uid)}
              onNavigateToContent={(cid) => setSearchQuery(cid)}
            />
          </div>
        )}

        {/* Post Feed */}
        <div>
          {isLoading ? (
            <div className="p-4 space-y-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="animate-pulse flex gap-3">
                  <div className="w-10 h-10 rounded-full bg-lattice-surface" />
                  <div className="flex-1 space-y-3">
                    <div className="h-4 bg-lattice-surface rounded w-1/3" />
                    <div className="h-4 bg-lattice-surface rounded w-4/5" />
                    <div className="h-4 bg-lattice-surface rounded w-1/2" />
                    {i % 2 === 0 && <div className="h-20 bg-lattice-surface rounded-xl" />}
                  </div>
                </div>
              ))}
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <MessageCircle className="w-16 h-16 mb-4 opacity-40" />
              <h3 className="text-lg font-medium mb-2 text-white">Nothing in your feed yet</h3>
              <p className="text-sm mb-6">
                Follow topics and sources to populate your feed, or create the first post.
              </p>
              <button
                onClick={() => setActiveTab('trending')}
                className="px-5 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30 transition-colors"
              >
                Discover sources
              </button>
            </div>
          ) : (
            <Virtuoso
              data={filteredPosts}
              useWindowScroll
              endReached={() => {
                if (hasNextPage && !isFetchingNextPage) fetchNextPage();
              }}
              overscan={400}
              itemContent={(idx, post) => (
                <motion.article
                  key={post.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(idx, 5) * 0.03, duration: 0.25 }}
                  className="p-4 border-b border-lattice-border hover:bg-lattice-surface/30 transition-colors"
                >
                  <div className="flex gap-3">
                    {/* Avatar */}
                    <div
                      className={cn(
                        'w-10 h-10 rounded-full bg-gradient-to-br flex-shrink-0',
                        post.author.gradient
                      )}
                    />

                    <div className="flex-1 min-w-0">
                      {/* Post Header */}
                      <div className="flex items-center gap-1 text-sm">
                        <span className="font-bold text-white hover:underline cursor-pointer truncate">
                          {post.author.name}
                        </span>
                        {post.author.verified && (
                          <Verified className="w-4 h-4 text-neon-cyan fill-neon-cyan flex-shrink-0" />
                        )}
                        <span className="text-gray-500 truncate">@{post.author.handle}</span>
                        <span className="text-gray-600 flex-shrink-0">&middot;</span>
                        <span className="text-gray-500 hover:underline cursor-pointer flex-shrink-0">
                          {formatTime(post.createdAt)}
                        </span>
                        {post.dtuSource && (
                          <ProvenanceBadge
                            source={post.dtuSource}
                            model={post.dtuMeta?.model as string}
                            authority={post.dtuMeta?.authority as string}
                          />
                        )}
                        <div className="ml-auto relative flex-shrink-0">
                          <button
                            onClick={() =>
                              setPostMenuOpen(postMenuOpen === post.id ? null : post.id)
                            }
                            className="p-1 text-gray-600 hover:text-neon-cyan hover:bg-neon-cyan/10 rounded-full transition-colors"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                          <AnimatePresence>
                            {postMenuOpen === post.id && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                className="absolute right-0 top-8 z-20 w-44 bg-lattice-surface border border-lattice-border rounded-xl shadow-lg overflow-hidden"
                              >
                                <button
                                  onClick={() => {
                                    deletePostMutation.mutate(post.id);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" /> Delete Post
                                </button>
                                <button
                                  onClick={() => {
                                    bookmarkMutation.mutate(post.id);
                                    setPostMenuOpen(null);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-300 hover:bg-lattice-deep transition-colors"
                                >
                                  <Bookmark className="w-4 h-4" />{' '}
                                  {post.bookmarked ? 'Remove Bookmark' : 'Bookmark'}
                                </button>
                                <button
                                  onClick={() => {
                                    shareMutation.mutate(post.id);
                                    setPostMenuOpen(null);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-300 hover:bg-lattice-deep transition-colors"
                                >
                                  <Share className="w-4 h-4" /> Copy Link
                                </button>
                                <button
                                  onClick={() => {
                                    useUIStore
                                      .getState()
                                      .addToast({ type: 'info', message: 'Post reported' });
                                    setPostMenuOpen(null);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-300 hover:bg-lattice-deep transition-colors"
                                >
                                  <Flag className="w-4 h-4" /> Report
                                </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>

                      {/* Content */}
                      <p className="text-[15px] text-gray-200 mt-1 leading-relaxed whitespace-pre-wrap">
                        {post.content}
                      </p>

                      {/* Tags */}
                      {post.tags && post.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {post.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-xs text-neon-cyan hover:underline cursor-pointer"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Type-specific Content */}
                      {post.type === 'audio' && post.audio && (
                        <WaveformPlayer
                          {...post.audio}
                          waveform={
                            post.audio.waveform?.length ? post.audio.waveform : generateWaveform()
                          }
                        />
                      )}

                      {post.type === 'release' && post.release && (
                        <ReleaseCard release={post.release} />
                      )}

                      {post.type === 'art' && post.art && <ArtGallery images={post.art.images} />}

                      {post.type === 'collab' && post.collab && <CollabCard collab={post.collab} />}

                      {/* Inline Social Commerce: Tagged Products */}
                      {post.taggedProducts && post.taggedProducts.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center gap-1.5 text-xs text-neon-green/70">
                            <ShoppingBag className="w-3 h-3" />
                            <span>Tagged Products</span>
                          </div>
                          {post.taggedProducts.map((product) => (
                            <SocialCommerceTag
                              key={product.listingId}
                              listing={{
                                listingId: product.listingId,
                                title: product.title,
                                imageUrl: product.imageUrl,
                                price: product.price,
                                currency: 'CC',
                              }}
                              onBuy={(listingId) => {
                                const p = post.taggedProducts?.find(
                                  (tp) => tp.listingId === listingId
                                );
                                if (p) handleInlinePurchase(p);
                              }}
                              onNavigateToListing={(listingId) => {
                                window.open(`/lenses/marketplace?listing=${listingId}`, '_blank');
                              }}
                              className={cn(
                                purchaseLoading === product.listingId &&
                                  'opacity-60 pointer-events-none',
                                purchaseSuccess === product.listingId &&
                                  'border-green-500/50 bg-green-500/5'
                              )}
                            />
                          ))}
                          {purchaseSuccess &&
                            post.taggedProducts.some((p) => p.listingId === purchaseSuccess) && (
                              <p className="text-xs text-green-400 flex items-center gap-1">
                                <span>Purchase complete!</span>
                              </p>
                            )}
                        </div>
                      )}

                      {/* Engagement Bar */}
                      <div className="flex items-center justify-between mt-3 max-w-md text-gray-500">
                        <button
                          onClick={() => toggleComments(post.id)}
                          className={cn(
                            'flex items-center gap-1.5 group',
                            expandedComments === post.id && 'text-blue-400'
                          )}
                        >
                          <div className="p-1.5 rounded-full group-hover:bg-blue-500/15 group-hover:text-blue-400 group-hover:scale-110 transition-all duration-200">
                            <MessageCircle
                              className={cn(
                                'w-4 h-4',
                                expandedComments === post.id && 'fill-current'
                              )}
                            />
                          </div>
                          <span className="text-xs group-hover:text-blue-400 transition-colors">
                            {formatNumber(post.comments)}
                          </span>
                        </button>

                        <button
                          onClick={() => repostMutation.mutate(post.id)}
                          className={cn(
                            'flex items-center gap-1.5 group',
                            post.reposted && 'text-neon-green'
                          )}
                        >
                          <div className="p-1.5 rounded-full group-hover:bg-neon-green/15 group-hover:text-neon-green group-hover:scale-110 transition-all duration-200">
                            <Repeat2 className="w-4 h-4" />
                          </div>
                          <span className="text-xs group-hover:text-neon-green transition-colors">
                            {formatNumber(post.reposts)}
                          </span>
                        </button>

                        <button
                          onClick={() => likeMutation.mutate(post.id)}
                          className={cn(
                            'flex items-center gap-1.5 group',
                            post.liked && 'text-neon-pink'
                          )}
                        >
                          <div className="p-1.5 rounded-full group-hover:bg-gradient-to-r group-hover:from-pink-500/15 group-hover:to-rose-500/15 group-hover:text-neon-pink group-hover:scale-110 transition-all duration-200">
                            <Heart className={cn('w-4 h-4', post.liked && 'fill-current')} />
                          </div>
                          <span className="text-xs group-hover:text-neon-pink transition-colors">
                            {formatNumber(post.likes)}
                          </span>
                        </button>

                        <div className="flex items-center gap-1.5 group" title="Views">
                          <div className="p-1.5 rounded-full group-hover:bg-neon-cyan/15 group-hover:text-neon-cyan group-hover:scale-110 transition-all duration-200">
                            <Eye className="w-4 h-4" />
                          </div>
                          <span className="text-xs group-hover:text-neon-cyan transition-colors">
                            {formatNumber(post.views)}
                          </span>
                        </div>

                        <div className="flex items-center gap-0.5">
                          <PullToSubstrate domain="feed" artifactId={post.id} compact />
                          <button
                            onClick={() => bookmarkMutation.mutate(post.id)}
                            className="p-1.5 rounded-full hover:bg-neon-cyan/15 hover:text-neon-cyan hover:scale-110 transition-all duration-200"
                          >
                            <Bookmark
                              className={cn(
                                'w-4 h-4',
                                post.bookmarked && 'fill-current text-neon-cyan'
                              )}
                            />
                          </button>
                          <button
                            onClick={() => shareMutation.mutate(post.id)}
                            className="p-1.5 rounded-full hover:bg-neon-cyan/15 hover:text-neon-cyan hover:scale-110 transition-all duration-200"
                          >
                            <Share className="w-4 h-4" />
                          </button>
                          <CrossPostExternal
                            postId={post.id}
                            title={post.content.slice(0, 80)}
                            content={post.content}
                            tags={post.tags}
                            authorName={post.author.name}
                          />
                          <ReportButton contentId={post.id} contentType="post" compact />
                        </div>
                      </div>

                      {/* Expandable Comments Section */}
                      <AnimatePresence>
                        {expandedComments === post.id && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-3 overflow-hidden"
                          >
                            <div className="border-t border-lattice-border pt-3 space-y-3">
                              {/* Comment input */}
                              <div className="flex gap-2">
                                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-neon-cyan to-neon-purple flex-shrink-0" />
                                <div className="flex-1 flex gap-2">
                                  <input
                                    type="text"
                                    value={commentInputs[post.id] || ''}
                                    onChange={(e) =>
                                      setCommentInputs((prev) => ({
                                        ...prev,
                                        [post.id]: e.target.value,
                                      }))
                                    }
                                    onKeyDown={(e) => {
                                      if (
                                        e.key === 'Enter' &&
                                        (commentInputs[post.id] || '').trim()
                                      ) {
                                        commentMutation.mutate({
                                          postId: post.id,
                                          content: commentInputs[post.id],
                                        });
                                      }
                                    }}
                                    placeholder="Write a comment..."
                                    className="flex-1 bg-lattice-surface border border-lattice-border rounded-full px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan transition-colors"
                                  />
                                  <button
                                    onClick={() => {
                                      if ((commentInputs[post.id] || '').trim()) {
                                        commentMutation.mutate({
                                          postId: post.id,
                                          content: commentInputs[post.id],
                                        });
                                      }
                                    }}
                                    disabled={
                                      !(commentInputs[post.id] || '').trim() ||
                                      commentMutation.isPending
                                    }
                                    className="p-1.5 rounded-full bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30 disabled:opacity-40 transition-colors"
                                  >
                                    <Send className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>

                              {/* Comment list */}
                              {(postComments[post.id] || []).length === 0 ? (
                                <p className="text-xs text-gray-500 text-center py-2">
                                  No comments yet. Be the first!
                                </p>
                              ) : (
                                <div className="space-y-2 max-h-60 overflow-y-auto">
                                  {(postComments[post.id] || []).map((comment) => (
                                    <div key={comment.id} className="flex gap-2">
                                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex-shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-xs font-semibold text-white">
                                            {comment.userId}
                                          </span>
                                          <span className="text-[10px] text-gray-600">
                                            {formatTime(comment.createdAt)}
                                          </span>
                                        </div>
                                        <p className="text-sm text-gray-300 leading-snug">
                                          {comment.content}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.article>
              )}
              components={{
                Footer: () => (
                  <div className="p-8 text-center text-gray-600 text-sm">
                    {isFetchingNextPage ? (
                      <div className="animate-pulse flex justify-center gap-2">
                        <div className="w-2 h-2 bg-neon-cyan rounded-full animate-bounce" />
                        <div
                          className="w-2 h-2 bg-neon-cyan rounded-full animate-bounce"
                          style={{ animationDelay: '0.15s' }}
                        />
                        <div
                          className="w-2 h-2 bg-neon-cyan rounded-full animate-bounce"
                          style={{ animationDelay: '0.3s' }}
                        />
                      </div>
                    ) : !hasNextPage && filteredPosts.length > 0 ? (
                      <>
                        <Newspaper className="w-6 h-6 mx-auto mb-2 opacity-40" />
                        You are all caught up
                      </>
                    ) : null}
                  </div>
                ),
              }}
            />
          )}
        </div>
      </main>

      {/* ── Right Sidebar ─────────────────────────────────────────────────── */}
      <aside className="w-80 p-4 hidden lg:flex flex-col gap-4 sticky top-0 h-screen overflow-y-auto">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search posts, topics, DTUs..."
            className="w-full pl-10 pr-4 py-2.5 bg-lattice-surface border border-lattice-border rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan transition-colors"
          />
        </div>

        {/* Trending Now */}
        <div className="bg-lattice-surface rounded-xl border border-lattice-border overflow-hidden">
          <div className="flex items-center gap-2 p-4 pb-2">
            <TrendingUp className="w-4 h-4 text-neon-cyan" />
            <h2 className="text-base font-bold text-white">Trending Now</h2>
          </div>
          {(trending || TRENDING_TOPICS).map((topic) => (
            <button
              key={topic.id}
              onClick={() => setSearchQuery(topic.tag.replace('#', ''))}
              className="w-full px-4 py-2.5 hover:bg-lattice-deep transition-colors text-left"
            >
              <p className="text-[11px] text-gray-500 uppercase tracking-wider">{topic.category}</p>
              <p className="font-semibold text-white text-sm">{topic.tag}</p>
              <p className="text-[11px] text-gray-500">{formatNumber(topic.posts)} posts</p>
            </button>
          ))}
          <button
            onClick={() => setActiveTab('trending')}
            className="w-full px-4 py-3 text-neon-cyan hover:bg-lattice-deep transition-colors text-left text-sm"
          >
            Show more
          </button>
        </div>

        {/* Trending Topics — live animated widget */}
        <div className="bg-lattice-surface rounded-xl border border-lattice-border overflow-hidden p-4">
          <TrendingTopics onTopicClick={(tag) => setSearchQuery(tag)} />
        </div>

        {/* Presence — who's currently browsing the feed. Sourced
            from the realtime lens hook so the avatar stack updates
            when people join / leave. */}
        <div className="bg-lattice-surface rounded-xl border border-lattice-border overflow-hidden px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              On Feed Now
            </span>
          </div>
          <PresenceIndicator
            users={(Array.isArray(presenceUsers) ? presenceUsers : []).map(
              (
                u: {
                  id?: string;
                  userId?: string;
                  name?: string;
                  displayName?: string;
                  avatar?: string;
                  status?: 'active' | 'idle' | 'viewing';
                  location?: string;
                },
                i: number
              ) => ({
                id: u.id || u.userId || `p-${i}`,
                name: u.name || u.displayName || 'Citizen',
                avatar: u.avatar,
                color: ['#06b6d4', '#8b5cf6', '#22c55e', '#f59e0b', '#ec4899'][i % 5],
                status: (u.status || 'active') as 'active' | 'idle' | 'viewing',
                location: u.location || 'feed',
              })
            )}
            maxVisible={5}
          />
        </div>

        {/* Rising Creators */}
        <RisingCreatorsSidebar />

        {/* Who to Follow — wired to real discovery data */}
        <div className="bg-lattice-surface rounded-xl border border-lattice-border overflow-hidden p-4">
          <SuggestedFollows currentUserId="current-user" />
        </div>

        {/* Post Scheduler */}
        <div className="bg-lattice-surface rounded-xl border border-lattice-border overflow-hidden p-4">
          <PostScheduler userId="current-user" />
        </div>

        {/* Notifications */}
        <div className="bg-lattice-surface rounded-xl border border-lattice-border overflow-hidden p-4">
          <NotificationCenter userId="current-user" mode="panel" />
        </div>

        {/* Groups */}
        <div className="bg-lattice-surface rounded-xl border border-lattice-border overflow-hidden p-4">
          <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-neon-purple" />
            Suggested Groups
          </h2>
          <div className="space-y-3">
            {(
              [
                {
                  groupId: 'g1',
                  name: 'Sovereignty Builders',
                  description: 'Build sovereign-first systems together',
                  memberCount: 842,
                  tags: ['sovereignty', 'dev'],
                },
                {
                  groupId: 'g2',
                  name: 'DTU Creators',
                  description: 'Share and discuss data transfer units',
                  memberCount: 1203,
                  tags: ['dtu', 'data'],
                },
                {
                  groupId: 'g3',
                  name: 'Local-First Advocates',
                  description: 'Community for local-first software',
                  memberCount: 567,
                  tags: ['local-first', 'privacy'],
                },
              ] as GroupData[]
            ).map((group) => (
              <GroupCard key={group.groupId} group={group} />
            ))}
          </div>
        </div>

        {/* New Releases Mini */}
        <div className="bg-lattice-surface rounded-xl border border-lattice-border overflow-hidden">
          <div className="flex items-center gap-2 p-4 pb-2">
            <Newspaper className="w-4 h-4 text-neon-pink" />
            <h2 className="text-base font-bold text-white">New Releases</h2>
          </div>
          {NEW_RELEASES.map((rel) => (
            <button
              key={rel.id}
              onClick={() => setSearchQuery(rel.title)}
              className="w-full px-4 py-2.5 hover:bg-lattice-deep transition-colors flex items-center gap-3 text-left"
            >
              <div
                className={cn(
                  'w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0',
                  rel.gradient
                )}
              >
                <Newspaper className="w-5 h-5 text-white/50" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{rel.title}</p>
                <p className="text-xs text-gray-500 truncate">{rel.artist}</p>
              </div>
            </button>
          ))}
          <button
            onClick={() => setActiveTab('releases')}
            className="w-full px-4 py-3 text-neon-cyan hover:bg-lattice-deep transition-colors text-left text-sm"
          >
            View all releases
          </button>
        </div>

        {/* Footer links */}
        <div className="px-4 text-[11px] text-gray-600 leading-relaxed">
          Terms &middot; Privacy &middot; Cookies &middot; Accessibility &middot; About &middot;
          Concord &copy; 2026
        </div>
      </aside>

      {/* DTU Context */}
      <div className="mt-6 space-y-3">
        <LensContextPanel
          hyperDTUs={hyperDTUs}
          megaDTUs={megaDTUs}
          regularDTUs={regularDTUs}
          tierDistribution={tierDistribution}
          onPublish={(dtu) => publishToMarketplace({ dtuId: dtu.id })}
          title="Feed DTUs"
        />
        <FeedbackWidget targetType="lens" targetId="feed" />

        {/* Real-time Data Panel */}
        <UniversalActions domain="feed" artifactId={null} compact />

        {/* Feed Analytics Actions */}
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-neon-cyan" />
            Feed Analytics
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              {
                action: 'engagementScore',
                label: 'Engagement Score',
                icon: TrendingUp,
                color: 'text-neon-green',
              },
              {
                action: 'contentCalendar',
                label: 'Content Calendar',
                icon: Eye,
                color: 'text-neon-cyan',
              },
              {
                action: 'audienceInsights',
                label: 'Audience Insights',
                icon: Users,
                color: 'text-neon-purple',
              },
              {
                action: 'hashtagAnalysis',
                label: 'Hashtag Analysis',
                icon: Hash,
                color: 'text-yellow-400',
              },
            ].map(({ action, label, icon: Icon, color }) => (
              <button
                key={action}
                onClick={() => handleFeedAction(action)}
                disabled={!!feedRunning || !postLensItems?.[0]?.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-lattice-deep border border-lattice-border text-sm hover:border-white/20 disabled:opacity-40 transition-colors"
              >
                {feedRunning === action ? (
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                ) : (
                  <Icon className={`w-4 h-4 ${color}`} />
                )}
                <span className="truncate text-xs">{label}</span>
              </button>
            ))}
          </div>

          {feedActionResult && (
            <div className="mt-3 rounded-lg bg-black/30 border border-white/10 p-4 relative">
              <button
                onClick={() => setFeedActionResult(null)}
                className="absolute top-3 right-3 text-gray-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>

              {/* engagementScore */}
              {feedActionResult._action === 'engagementScore' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                    Engagement Report
                  </p>
                  {(feedActionResult.message as string) ? (
                    <p className="text-sm text-gray-400">{feedActionResult.message as string}</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          {
                            label: 'Posts',
                            value: String(feedActionResult.totalPosts ?? 0),
                            color: 'text-white',
                          },
                          {
                            label: 'Avg Engagement',
                            value: `${feedActionResult.avgEngagement ?? 0}%`,
                            color: 'text-neon-green',
                          },
                          {
                            label: 'Top Post',
                            value: String(feedActionResult.topPost ?? '—'),
                            color: 'text-neon-cyan',
                          },
                          {
                            label: 'Total Reach',
                            value: String(
                              ((feedActionResult.totalReach as number) || 0).toLocaleString()
                            ),
                            color: 'text-neon-purple',
                          },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                            <p className={`text-sm font-bold ${color} truncate`}>{value}</p>
                            <p className="text-xs text-gray-400">{label}</p>
                          </div>
                        ))}
                      </div>
                      {Array.isArray(feedActionResult.posts) &&
                        (
                          feedActionResult.posts as {
                            title: string;
                            engagementRate: number;
                            performance: string;
                            likes: number;
                            comments: number;
                            shares: number;
                          }[]
                        )
                          .slice(0, 5)
                          .map((p) => (
                            <div
                              key={p.title}
                              className="flex items-center gap-3 text-xs px-2 py-1 rounded bg-white/5"
                            >
                              <span className="flex-1 text-white truncate">{p.title}</span>
                              <span className="text-gray-400">
                                {p.likes}♥ {p.comments}💬 {p.shares}↗
                              </span>
                              <span
                                className={`text-xs font-mono ${p.engagementRate > 5 ? 'text-neon-green' : p.engagementRate > 2 ? 'text-yellow-400' : 'text-gray-500'}`}
                              >
                                {p.engagementRate}%
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] ${p.performance === 'viral' ? 'bg-neon-green/20 text-neon-green' : p.performance === 'above-average' ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/5 text-gray-400'}`}
                              >
                                {p.performance}
                              </span>
                            </div>
                          ))}
                    </>
                  )}
                </div>
              )}

              {/* contentCalendar */}
              {feedActionResult._action === 'contentCalendar' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                    Content Calendar
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      {
                        label: 'Planned',
                        value: String(feedActionResult.planedPosts ?? 0),
                        color: 'text-neon-green',
                      },
                      {
                        label: 'Target',
                        value: String(feedActionResult.targetPosts ?? 0),
                        color: 'text-neon-cyan',
                      },
                      {
                        label: 'Coverage',
                        value: `${feedActionResult.coveragePercent ?? 0}%`,
                        color:
                          (feedActionResult.coveragePercent as number) >= 80
                            ? 'text-neon-green'
                            : 'text-yellow-400',
                      },
                      {
                        label: 'Gaps',
                        value: String(((feedActionResult.gaps as string[]) || []).length),
                        color: 'text-red-400',
                      },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                        <p className={`text-lg font-bold ${color}`}>{value}</p>
                        <p className="text-xs text-gray-400">{label}</p>
                      </div>
                    ))}
                  </div>
                  {Array.isArray(feedActionResult.upcoming) && (
                    <div className="grid grid-cols-7 gap-1">
                      {(
                        feedActionResult.upcoming as {
                          date: string;
                          day: string;
                          planned: boolean;
                          type: string | null;
                        }[]
                      )
                        .slice(0, 14)
                        .map((d) => (
                          <div
                            key={d.date}
                            className={`rounded p-1 text-center text-[10px] ${d.planned ? 'bg-neon-green/20 border border-neon-green/30 text-neon-green' : 'bg-white/5 text-gray-600'}`}
                          >
                            <p>{d.day}</p>
                            {d.type && <p className="truncate text-[9px]">{d.type}</p>}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {/* audienceInsights */}
              {feedActionResult._action === 'audienceInsights' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                    Audience Insights
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-xs text-gray-400">Total Followers</p>
                      <p className="text-xl font-bold text-neon-purple">
                        {((feedActionResult.totalFollowers as number) || 0).toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Growth: {feedActionResult.growthRate as string}
                      </p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-xs text-gray-400">Best Posting Times</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {((feedActionResult.bestPostingTimes as string[]) || []).map((t) => (
                          <span
                            key={t}
                            className="text-xs px-2 py-0.5 rounded bg-neon-cyan/20 text-neon-cyan"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  {Array.isArray(feedActionResult.demographics) &&
                    (
                      feedActionResult.demographics as {
                        group: string;
                        percent: number;
                        count: number;
                      }[]
                    ).length > 0 && (
                      <div className="space-y-1">
                        {(
                          feedActionResult.demographics as {
                            group: string;
                            percent: number;
                            count: number;
                          }[]
                        ).map((d) => (
                          <div key={d.group} className="flex items-center gap-3 text-xs">
                            <span className="text-gray-400 w-24 capitalize">{d.group}</span>
                            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-neon-purple/60 rounded-full"
                                style={{ width: `${d.percent}%` }}
                              />
                            </div>
                            <span className="text-white w-10 text-right">{d.percent}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              )}

              {/* hashtagAnalysis */}
              {feedActionResult._action === 'hashtagAnalysis' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                    Hashtag Analysis
                  </p>
                  {(feedActionResult.message as string) ? (
                    <p className="text-sm text-gray-400">{feedActionResult.message as string}</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          {
                            label: 'Unique Tags',
                            value: String(feedActionResult.totalUniqueTags ?? 0),
                            color: 'text-neon-cyan',
                          },
                          {
                            label: 'Posts Analyzed',
                            value: String(feedActionResult.postsAnalyzed ?? 0),
                            color: 'text-white',
                          },
                          {
                            label: 'Top Tag',
                            value: (feedActionResult.topTags as { tag: string }[])?.[0]?.tag
                              ? `#${(feedActionResult.topTags as { tag: string }[])[0].tag}`
                              : '—',
                            color: 'text-neon-green',
                          },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                            <p className={`text-sm font-bold ${color}`}>{value}</p>
                            <p className="text-xs text-gray-400">{label}</p>
                          </div>
                        ))}
                      </div>
                      {Array.isArray(feedActionResult.topTags) && (
                        <div className="flex flex-wrap gap-2">
                          {(feedActionResult.topTags as { tag: string; uses: number }[]).map(
                            (t) => (
                              <span
                                key={t.tag}
                                className="text-xs px-2 py-1 rounded bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan"
                              >
                                #{t.tag} <span className="text-gray-400">×{t.uses}</span>
                              </span>
                            )
                          )}
                        </div>
                      )}
                      {feedActionResult.recommendation && (
                        <p className="text-xs text-gray-500 italic">
                          {feedActionResult.recommendation as string}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {realtimeData && (
          <RealtimeDataPanel
            domain="feed"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}
      </div>
    </div>
  );
}

function RisingCreatorsSidebar() {
  const { data: creatorsData } = useQuery({
    queryKey: ['trending-creators'],
    queryFn: async () => {
      const res = await api
        .get('/api/social/trending/creators', { params: { limit: 5, days: 7 } })
        .catch(() => null);
      return (res?.data?.creators || []) as Array<{
        userId: string;
        displayName: string;
        followerCount: number;
        followerGrowth: number;
        postCount: number;
        score: number;
      }>;
    },
    staleTime: 60000,
    retry: false,
  });

  if (!creatorsData || creatorsData.length === 0) return null;

  return (
    <div className="bg-lattice-surface rounded-xl border border-lattice-border overflow-hidden">
      <div className="flex items-center gap-2 p-4 pb-2">
        <TrendingUp className="w-4 h-4 text-neon-purple" />
        <h2 className="text-base font-bold text-white">Rising Creators</h2>
      </div>
      {creatorsData.slice(0, 5).map((creator) => (
        <div
          key={creator.userId}
          className="px-4 py-2.5 hover:bg-lattice-deep transition-colors flex items-center gap-3"
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-neon-purple to-neon-cyan flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
            {creator.displayName?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white truncate">{creator.displayName}</p>
            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              <span>
                <Users className="w-3 h-3 inline" /> {creator.followerCount}
              </span>
              {creator.followerGrowth > 0 && (
                <span className="text-green-400">+{creator.followerGrowth}</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
