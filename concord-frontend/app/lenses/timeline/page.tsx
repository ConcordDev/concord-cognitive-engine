'use client';

import Link from 'next/link';
import { useState, useCallback, useRef, useMemo } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ThumbsUp,
  Heart,
  Laugh,
  Frown,
  Angry,
  MessageCircle,
  Share2,
  MoreHorizontal,
  Image as ImageIcon,
  Video,
  Smile,
  Users,
  Globe,
  Lock,
  Clock,
  Home,
  Tv,
  Store,
  Users2,
  Bookmark,
  CalendarDays,
  Flag,
  Zap,
  X,
  LayoutList,
  GitBranch
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

interface Post {
  id: string;
  author: {
    id: string;
    name: string;
    avatar?: string;
  };
  content: string;
  images?: string[];
  createdAt: string;
  privacy: 'public' | 'friends' | 'private';
  reactions: {
    like: number;
    love: number;
    haha: number;
    sad: number;
    angry: number;
  };
  userReaction?: string;
  comments: number;
  shares: number;
  dtuId?: string;
}

interface Friend {
  id: string;
  name: string;
  avatar?: string;
  mutualFriends: number;
  online: boolean;
}

interface Story {
  id: string;
  author: {
    name: string;
    avatar?: string;
  };
  preview?: string;
  viewed: boolean;
}

const REACTIONS = [
  { id: 'like', icon: ThumbsUp, color: 'text-blue-500', label: 'Like' },
  { id: 'love', icon: Heart, color: 'text-red-500', label: 'Love' },
  { id: 'haha', icon: Laugh, color: 'text-yellow-500', label: 'Haha' },
  { id: 'sad', icon: Frown, color: 'text-yellow-500', label: 'Sad' },
  { id: 'angry', icon: Angry, color: 'text-orange-500', label: 'Angry' },
];

export default function TimelineLensPage() {
  useLensNav('timeline');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('timeline');
  const queryClient = useQueryClient();

  const [newPost, setNewPost] = useState('');
  const [showReactions, setShowReactions] = useState<string | null>(null);
  const [limit, setLimit] = useState(30);
  const [showPostModal, setShowPostModal] = useState(false);
  const [postContent, setPostContent] = useState('');
  const [feedSearch, setFeedSearch] = useState('');
  const feedSearchInputRef = useRef<HTMLInputElement>(null);
  // Privacy choice for new posts. Defaults to 'private' so posts only become
  // visible to NPCs (via the social-npc-bridge) when the user explicitly
  // opts in. The "NPCs are listening" indicator surfaces next to the toggle
  // when 'public' is selected.
  const [postPrivacy, setPostPrivacy] = useState<'public' | 'friends' | 'private'>('private');
  const [viewMode, setViewMode] = useState<'timeline' | 'feed'>('timeline');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);

  const { items: timelineItems } = useLensData<Record<string, unknown>>('timeline', 'event');
  const runTimelineAction = useRunArtifact('timeline');
  const [timelineActionResult, setTimelineActionResult] = useState<{ action: string; result: Record<string, unknown> } | null>(null);
  const [timelineActiveAction, setTimelineActiveAction] = useState<string | null>(null);

  const handleTimelineAction = useCallback(async (action: string) => {
    const id = timelineItems[0]?.id;
    if (!id) return;
    setTimelineActiveAction(action);
    try {
      const res = await runTimelineAction.mutateAsync({ id, action });
      if (res.ok) setTimelineActionResult({ action, result: res.result as Record<string, unknown> });
    } finally {
      setTimelineActiveAction(null);
    }
  }, [timelineItems, runTimelineAction]);


  const { data: postsData, isLoading, isError: isError, error: error, refetch: refetch,} = useQuery({
    queryKey: ['timeline-posts', limit],
    queryFn: () => apiHelpers.dtus.paginated({ limit, offset: 0, tags: 'timeline' }).then(r => r.data),
  });

  const posts = useMemo(
    () =>
      postsData?.items?.map((dtu: Record<string, unknown>) => ({
        id: dtu.id,
        author: {
          id: dtu.authorId || 'user',
          name: dtu.authorName || 'Concord User',
        },
        content: dtu.content || dtu.title,
        createdAt: dtu.createdAt,
        privacy: 'public',
        reactions: {
          like: (dtu.reactions as Record<string, number>)?.like || 0,
          love: (dtu.reactions as Record<string, number>)?.love || 0,
          haha: (dtu.reactions as Record<string, number>)?.haha || 0,
          sad: (dtu.reactions as Record<string, number>)?.sad || 0,
          angry: (dtu.reactions as Record<string, number>)?.angry || 0,
        },
        comments: (dtu.comments as number) || 0,
        shares: (dtu.shares as number) || 0,
        dtuId: dtu.id,
      })) || [],
    [postsData],
  );

  // Filtered feed for search.  Matches against author + content so a
  // user looking for a half-remembered post by either dimension finds
  // it.  No-op when query is empty so we don't pay the filter cost.
  const visiblePosts = useMemo(() => {
    const q = feedSearch.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter((p: Post) =>
      String(p.author?.name || '').toLowerCase().includes(q) ||
      String(p.content || '').toLowerCase().includes(q)
    );
  }, [posts, feedSearch]);

  // Twitter / Facebook idiom: 'n' new post, '/' focuses search, 'v'
  // toggles view, 'g f' jumps to feed (timeline default).
  useLensCommand(
    [
      { id: 'new-post',     keys: 'n',   description: 'New post',           category: 'actions',    action: () => setShowPostModal(true), global: true },
      { id: 'focus-search', keys: '/',   description: 'Search feed',        category: 'navigation', action: () => feedSearchInputRef.current?.focus() },
      { id: 'view-toggle',  keys: 'v',   description: 'Toggle timeline / feed', category: 'view', action: () => setViewMode((m) => (m === 'timeline' ? 'feed' : 'timeline')) },
      { id: 'goto-feed',    keys: 'g f', description: 'Go to Feed',         category: 'navigation', action: () => setViewMode('feed') },
      { id: 'goto-timeline',keys: 'g t', description: 'Go to Timeline',     category: 'navigation', action: () => setViewMode('timeline') },
      { id: 'load-more',    keys: 'm',   description: 'Load 30 more posts', category: 'actions',    action: () => setLimit((n) => n + 30) },
    ],
    { lensId: 'timeline' }
  );


  const { data: friends, isError: isError2, error: error2, refetch: refetch2,} = useQuery({
    queryKey: ['friends'],
    queryFn: async () => {
      try {
        const res = await apiHelpers.personas.list();
        const personas = res.data?.personas || [];
        return personas.map((p: Record<string, unknown>, i: number) => ({
          id: String(p.id || i),
          name: String(p.name || `User ${i + 1}`),
          mutualFriends: (p.mutualFriends as number) || 0,
          online: i % 2 === 0,
        })) as Friend[];
      } catch {
        return [] as Friend[];
      }
    },
  });

  const { data: stories, isError: isError3, error: error3, refetch: refetch3,} = useQuery({
    queryKey: ['stories'],
    queryFn: async () => {
      try {
        const res = await apiHelpers.dtus.paginated({ limit: 5, tags: 'story' });
        const dtus = res.data?.dtus || [];
        const storyItems: Story[] = [
          { id: 'yours', author: { name: 'Your Story' }, viewed: false },
          ...dtus.map((d: Record<string, unknown>) => ({
            id: String(d.id),
            author: { name: String(d.authorName || 'User') },
            viewed: false,
          })),
        ];
        return storyItems;
      } catch {
        return [{ id: 'yours', author: { name: 'Your Story' }, viewed: false }] as Story[];
      }
    },
  });

  const postMutation = useMutation({
    mutationFn: (content: string) => apiHelpers.dtus.create({
      content,
      tags: ['timeline'],
      // Persist privacy in body_json so the server-side social-npc-bridge can
      // gate on data.privacy === 'public' (with a JS-side defense-in-depth
      // re-check). 'private' is the failsafe default.
      meta: { privacy: postPrivacy },
    } as Parameters<typeof apiHelpers.dtus.create>[0]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline-posts'] });
      setNewPost('');
      setPostContent('');
      setShowPostModal(false);
    },
    onError: (err) => {
      console.error('Failed to create post:', err instanceof Error ? err.message : err);
    },
  });

  const handleCreatePost = () => {
    if (!postContent.trim() || postMutation.isPending) return;
    postMutation.mutate(postContent.trim());
  };

  const reactMutation = useMutation({
    mutationFn: ({ postId, reaction }: { postId: string; reaction: string }) => apiHelpers.dtus.update(postId, { reaction }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timeline-posts'] }),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const shareMutation = useMutation({
    mutationFn: async (postId: string) => {
      await navigator.clipboard.writeText(`${window.location.origin}/lenses/timeline?post=${postId}`);
      useUIStore.getState().addToast({ type: 'success', message: 'Link copied' });
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const friendAction = useMutation({
    mutationFn: ({ friendId, action: _action }: { friendId: string; action: string }) => apiHelpers.social.follow(friendId),
    onSuccess: (_, { action }) => useUIStore.getState().addToast({ type: 'success', message: action === 'confirm' ? 'Friend request accepted' : 'Request removed' }),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString();
  };

  const getTotalReactions = (reactions: Post['reactions']) => {
    return Object.values(reactions).reduce((a, b) => a + b, 0);
  };

  const getTopReactions = (reactions: Post['reactions']) => {
    return Object.entries(reactions)
      .filter(([_, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([type]) => REACTIONS.find(r => r.id === type));
  };

  // --- Timeline visualization helpers ---
  const EVENT_TYPE_COLORS: Record<string, { bg: string; border: string; text: string; dot: string; hex: string }> = {
    public: { bg: 'bg-blue-500/20', border: 'border-blue-500', text: 'text-blue-400', dot: 'bg-blue-500', hex: '#3b82f6' },
    friends: { bg: 'bg-green-500/20', border: 'border-green-500', text: 'text-green-400', dot: 'bg-green-500', hex: '#22c55e' },
    private: { bg: 'bg-purple-500/20', border: 'border-purple-500', text: 'text-purple-400', dot: 'bg-purple-500', hex: '#a855f7' },
  };

  const getEventColor = (privacy: string) => EVENT_TYPE_COLORS[privacy] || EVENT_TYPE_COLORS.public;

  const sortedEvents = useMemo(() => {
    if (!posts || posts.length === 0) return [];
    return [...posts]
      .filter((p: Post) => p.createdAt)
      .sort((a: Post, b: Post) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [posts]);

  const timelineBounds = useMemo(() => {
    if (sortedEvents.length === 0) return { min: Date.now(), max: Date.now(), range: 1 };
    const times = sortedEvents.map((e: Post) => new Date(e.createdAt).getTime());
    const min = Math.min(...times);
    const max = Math.max(...times);
    const range = max - min || 1; // avoid division by zero
    return { min, max, range };
  }, [sortedEvents]);

  const getEventPosition = (dateStr: string) => {
    const t = new Date(dateStr).getTime();
    return ((t - timelineBounds.min) / timelineBounds.range) * 100;
  };

  const formatDateLabel = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const formatDateTimeFull = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // Generate evenly-spaced date tick marks for the axis
  const timelineTicks = useMemo(() => {
    const TICK_COUNT = 8;
    const ticks: { label: string; pct: number }[] = [];
    for (let i = 0; i <= TICK_COUNT; i++) {
      const pct = (i / TICK_COUNT) * 100;
      const time = timelineBounds.min + (i / TICK_COUNT) * timelineBounds.range;
      ticks.push({ label: formatDateLabel(new Date(time).toISOString()), pct });
    }
    return ticks;
  }, [timelineBounds]);


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="timeline" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2 || isError3) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message || error3?.message} onRetry={() => { refetch(); refetch2(); refetch3(); }} />
      </div>
    );
  }
  return (
    <LensShell lensId="timeline" asMain={false}>
      <ManifestActionBar />
    <div data-lens-theme="timeline" className="min-h-full bg-[#18191a]">
      <div className="max-w-7xl mx-auto px-4 pt-4">
        <div className="bg-[#242526] rounded-lg p-3 flex items-center justify-between text-sm">
          <span className="text-gray-300">Timeline defaults to 30 posts for speed.</span>
          <Link href="/lenses/global" className="text-blue-400 hover:text-blue-300">View all in Global</Link>
        </div>
      </div>
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#242526] shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-3xl">📅</span>
            <span className="text-2xl font-bold text-blue-500">Timeline Lens</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="p-2 bg-[#3a3b3c] rounded-full hover:bg-[#4a4b4c] transition-colors" aria-label="Home">
              <Home className="w-5 h-5 text-white" />
            </button>
            <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Watch section' })} className="p-2 bg-[#3a3b3c] rounded-full hover:bg-[#4a4b4c] transition-colors" aria-label="Tv">
              <Tv className="w-5 h-5 text-gray-400" />
            </button>
            <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Marketplace' })} className="p-2 bg-[#3a3b3c] rounded-full hover:bg-[#4a4b4c] transition-colors" aria-label="Store">
              <Store className="w-5 h-5 text-gray-400" />
            </button>
            <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Groups' })} className="p-2 bg-[#3a3b3c] rounded-full hover:bg-[#4a4b4c] transition-colors" aria-label="Users2">
              <Users2 className="w-5 h-5 text-gray-400" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500" />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-4 flex gap-4">
        {/* Left Sidebar */}
        <aside className="w-64 hidden lg:block space-y-1">
          {[
            { icon: Users, label: 'Friends' },
            { icon: Users2, label: 'Groups' },
            { icon: Tv, label: 'Watch' },
            { icon: Clock, label: 'Memories' },
            { icon: Bookmark, label: 'Saved' },
            { icon: CalendarDays, label: 'Events' },
            { icon: Flag, label: 'Pages' },
          ].map(item => (
            <button
              key={item.label}
              onClick={() => useUIStore.getState().addToast({ type: 'info', message: `${item.label} section` })}
              className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-[#3a3b3c] transition-colors"
            >
              <div className="w-9 h-9 rounded-full bg-[#3a3b3c] flex items-center justify-center">
                <item.icon className="w-5 h-5 text-blue-500" />
              </div>
              <span className="text-white text-sm font-medium">{item.label}</span>
            </button>
          ))}
        </aside>

        {/* Main Feed */}
        <main className="flex-1 max-w-xl mx-auto space-y-4">
          {/* Stories */}
          <div className="bg-[#242526] rounded-lg p-4">
            <div className="flex gap-2 flex-wrap no-scrollbar">
              {stories?.map((story, i) => (
                <button
                  key={story.id}
                  onClick={() => i === 0 ? setShowPostModal(true) : useUIStore.getState().addToast({ type: 'info', message: `Viewing ${story.author.name}'s story` })}
                  className={cn(
                    'flex-shrink-0 w-28 h-48 rounded-xl overflow-hidden relative',
                    i === 0 ? 'bg-[#3a3b3c]' : 'bg-gradient-to-br from-blue-500 to-purple-500'
                  )}
                >
                  {i === 0 ? (
                    <div className="h-full flex flex-col items-center justify-end pb-3">
                      <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center border-4 border-[#242526] -mt-5">
                        <span className="text-white text-2xl">+</span>
                      </div>
                      <span className="text-white text-xs mt-2">Create story</span>
                    </div>
                  ) : (
                    <>
                      <div className={cn(
                        'absolute top-2 left-2 w-10 h-10 rounded-full border-4',
                        story.viewed ? 'border-gray-600' : 'border-blue-500'
                      )}>
                        <div className="w-full h-full rounded-full bg-gray-700" />
                      </div>
                      <div className="absolute bottom-2 left-2 right-2">
                        <span className="text-white text-xs font-medium">{story.author.name}</span>
                      </div>
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Create Post */}
          <div className="bg-[#242526] rounded-lg p-4">
            <div className="flex gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex-shrink-0" />
              <input
                type="text"
                value={newPost}
                onChange={e => setNewPost(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newPost.trim()) {
                    postMutation.mutate(newPost.trim());
                  }
                }}
                placeholder="What's on your mind?"
                className="flex-1 px-4 py-2.5 bg-[#3a3b3c] rounded-full text-left text-gray-300 placeholder-gray-400 hover:bg-[#4a4b4c] focus:bg-[#4a4b4c] outline-none transition-colors"
              />
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-700">
              <button onClick={() => setShowPostModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-[#3a3b3c] transition-colors">
                <Video className="w-5 h-5 text-red-500" />
                <span className="text-gray-300 text-sm">Live video</span>
              </button>
              <button onClick={() => setShowPostModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-[#3a3b3c] transition-colors">
                <ImageIcon className="w-5 h-5 text-green-500" />
                <span className="text-gray-300 text-sm">Photo/video</span>
              </button>
              <button onClick={() => setShowPostModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-[#3a3b3c] transition-colors">
                <Smile className="w-5 h-5 text-yellow-500" />
                <span className="text-gray-300 text-sm">Feeling</span>
              </button>
            </div>
          </div>

          {/* View Toggle */}
          <div className="bg-[#242526] rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('timeline')}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  viewMode === 'timeline' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-[#3a3b3c]'
                )}
              >
                <GitBranch className="w-4 h-4" />
                Timeline
              </button>
              <button
                onClick={() => setViewMode('feed')}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  viewMode === 'feed' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-[#3a3b3c]'
                )}
              >
                <LayoutList className="w-4 h-4" />
                Feed
              </button>
            </div>
            <div className="flex items-center gap-2">
              {viewMode === 'timeline' && (
                <span className="text-xs text-gray-500">{sortedEvents.length} events</span>
              )}
              <div className="flex gap-2">
                {Object.entries(EVENT_TYPE_COLORS).map(([key, c]) => (
                  <span key={key} className="flex items-center gap-1 text-xs text-gray-400">
                    <span className={cn('w-2 h-2 rounded-full', c.dot)} />
                    {key}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Interactive Timeline Visualization */}
          {viewMode === 'timeline' && sortedEvents.length > 0 && (
            <div className="bg-[#242526] rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-cyan-400" />
                  Interactive Timeline
                </h3>
                <span className="text-[10px] text-gray-500 italic">Scroll horizontally to explore</span>
              </div>

              {/* Scrollable timeline container */}
              <div
                ref={timelineContainerRef}
                className="relative overflow-x-auto pb-2 scrollbar-thin"
                style={{ minHeight: 320 }}
              >
                {/* Left/right fade overlays for scroll hint */}
                <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-r from-[#242526] to-transparent" />
                <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-l from-[#242526] to-transparent" />

                <div className="relative" style={{ minWidth: Math.max(900, sortedEvents.length * 120), height: 300 }}>
                  {/* Background grid lines */}
                  {timelineTicks.map((tick, i) => (
                    <div
                      key={`grid-${i}`}
                      className="absolute top-0 bottom-0 w-[1px] bg-gray-700/30"
                      style={{ left: `${tick.pct}%` }}
                    />
                  ))}

                  {/* Main horizontal axis line with gradient */}
                  <div
                    className="absolute left-0 right-0 h-[3px] rounded-full"
                    style={{
                      top: 148,
                      background: 'linear-gradient(90deg, #3b82f6, #06b6d4, #8b5cf6)',
                      opacity: 0.6,
                    }}
                  />
                  {/* Axis start/end caps */}
                  <div className="absolute w-3 h-3 rounded-full bg-blue-500 border-2 border-[#242526]" style={{ left: -2, top: 144 }} />
                  <div className="absolute w-3 h-3 rounded-full bg-purple-500 border-2 border-[#242526]" style={{ right: -2, top: 144 }} />

                  {/* Tick marks and date labels */}
                  {timelineTicks.map((tick, i) => (
                    <div
                      key={`tick-${i}`}
                      className="absolute flex flex-col items-center"
                      style={{ left: `${tick.pct}%`, top: 138, transform: 'translateX(-50%)' }}
                    >
                      <div className="w-[1px] h-[24px] bg-gray-500/60" />
                      <span className="text-[10px] text-gray-400 mt-1 whitespace-nowrap font-mono">{tick.label}</span>
                    </div>
                  ))}

                  {/* Connector lines between consecutive events along the axis */}
                  {sortedEvents.map((event: Post, i: number) => {
                    if (i === 0) return null;
                    const prevPct = getEventPosition(sortedEvents[i - 1].createdAt);
                    const curPct = getEventPosition(event.createdAt);
                    return (
                      <div
                        key={`connector-${event.id}`}
                        className="absolute h-[3px] rounded-full"
                        style={{
                          left: `${prevPct}%`,
                          width: `${curPct - prevPct}%`,
                          top: 148,
                          background: 'linear-gradient(90deg, rgba(59,130,246,0.7), rgba(6,182,212,0.7))',
                        }}
                      />
                    );
                  })}

                  {/* Event nodes */}
                  {sortedEvents.map((event: Post, i: number) => {
                    const pct = getEventPosition(event.createdAt);
                    const color = getEventColor(event.privacy);
                    const isSelected = selectedEventId === event.id;
                    const isHovered = hoveredEventId === event.id;
                    const isActive = isSelected || isHovered;
                    // Stagger above/below with varying distances to reduce overlap
                    const isAbove = i % 2 === 0;
                    // Use 3 lane depths to spread cards out
                    const lane = i % 3;
                    const cardOffset = isAbove
                      ? 4 + lane * 34
                      : 170 + lane * 34;
                    const stemLength = isAbove
                      ? 148 - cardOffset - 60
                      : cardOffset - 150;

                    return (
                      <div
                        key={event.id}
                        className="absolute"
                        style={{
                          left: `${pct}%`,
                          top: 0,
                          transform: 'translateX(-50%)',
                          zIndex: isActive ? 30 : 10,
                          width: 0,
                        }}
                      >
                        {/* Vertical stem connecting card to axis dot */}
                        <div
                          className="absolute left-1/2"
                          style={{
                            width: 1,
                            transform: 'translateX(-0.5px)',
                            top: isAbove ? cardOffset + 60 : 150,
                            height: Math.max(stemLength, 0),
                            borderLeft: `1px dashed ${isActive ? color.hex : 'rgba(107,114,128,0.3)'}`,
                            transition: 'border-color 0.2s',
                          }}
                        />

                        {/* Dot on the axis */}
                        <div
                          className="absolute left-1/2"
                          style={{ top: 143, transform: 'translateX(-50%)' }}
                        >
                          <div
                            className={cn(
                              'w-[14px] h-[14px] rounded-full border-[2.5px] cursor-pointer transition-all duration-200',
                              color.dot,
                              color.border,
                              isActive && 'scale-150 shadow-lg',
                              isSelected && 'ring-2 ring-cyan-400/60 ring-offset-1 ring-offset-[#242526]',
                              isHovered && !isSelected && 'ring-2 ring-white/30 ring-offset-1 ring-offset-[#242526]'
                            )}
                            style={{
                              boxShadow: isActive ? `0 0 10px ${color.hex}80` : undefined,
                            }}
                            onClick={() => setSelectedEventId(isSelected ? null : event.id)}
                            onMouseEnter={() => setHoveredEventId(event.id)}
                            onMouseLeave={() => setHoveredEventId(null)}
                          />
                        </div>

                        {/* Event card */}
                        <div
                          className="absolute left-1/2"
                          style={{
                            top: isAbove ? cardOffset : cardOffset,
                            transform: 'translateX(-50%)',
                          }}
                        >
                          <div
                            className={cn(
                              'w-[140px] rounded-lg p-2.5 cursor-pointer border transition-all duration-200',
                              color.bg,
                              color.border,
                              isActive
                                ? 'shadow-xl shadow-black/40 scale-110 opacity-100'
                                : 'opacity-70 hover:opacity-90'
                            )}
                            onClick={() => setSelectedEventId(isSelected ? null : event.id)}
                            onMouseEnter={() => setHoveredEventId(event.id)}
                            onMouseLeave={() => setHoveredEventId(null)}
                          >
                            <div className="flex items-center gap-1 mb-1">
                              <Clock className={cn('w-3 h-3 flex-shrink-0', color.text)} />
                              <p className={cn('text-[10px] font-semibold', color.text)}>
                                {formatDateLabel(event.createdAt)}
                              </p>
                            </div>
                            <p className="text-xs text-white font-medium truncate">{event.author.name}</p>
                            <p className="text-[10px] text-gray-400 truncate mt-0.5">{String(event.content).slice(0, 50)}</p>
                            {isActive && (
                              <div className="flex items-center gap-2 mt-1.5 pt-1 border-t border-white/10 text-[9px] text-gray-500">
                                <span>{getTotalReactions(event.reactions)} reactions</span>
                                <span>{event.comments} comments</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Expanded detail for selected event */}
              <AnimatePresence>
                {selectedEventId && (() => {
                  const event = sortedEvents.find((e: Post) => e.id === selectedEventId);
                  if (!event) return null;
                  const color = getEventColor(event.privacy);
                  return (
                    <motion.div
                      key={selectedEventId}
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className={cn('rounded-lg p-4 border mt-2', color.bg, color.border)}>
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h4 className="text-white font-semibold text-base">{event.author.name}</h4>
                            <p className="text-xs text-gray-400 mt-0.5">{formatDateTimeFull(event.createdAt)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={cn('text-xs px-2 py-0.5 rounded-full', color.bg, color.text, 'border', color.border)}>
                              {event.privacy}
                            </span>
                            <button
                              onClick={() => setSelectedEventId(null)}
                              className="p-1 rounded hover:bg-white/10 text-gray-400 transition-colors"
                            aria-label="Close">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-gray-200 whitespace-pre-wrap mb-3 leading-relaxed">{event.content}</p>
                        <div className="flex items-center gap-4 text-xs text-gray-400 pt-2 border-t border-white/10">
                          <span className="flex items-center gap-1">
                            <ThumbsUp className="w-3 h-3" /> {getTotalReactions(event.reactions)} reactions
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageCircle className="w-3 h-3" /> {event.comments} comments
                          </span>
                          <span className="flex items-center gap-1">
                            <Share2 className="w-3 h-3" /> {event.shares} shares
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })()}
              </AnimatePresence>
            </div>
          )}

          {viewMode === 'timeline' && sortedEvents.length === 0 && !isLoading && (
            <div className="bg-[#242526] rounded-lg p-8 text-center text-gray-500">
              <GitBranch className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No timeline events to display.</p>
            </div>
          )}

          {/* Posts Feed (shown only in feed mode) */}
          {viewMode === 'feed' && (
            <>
              <div className="bg-[#242526] rounded-lg p-3 flex items-center gap-2 text-xs text-gray-400 flex-wrap">
                <input
                  ref={feedSearchInputRef}
                  type="text"
                  value={feedSearch}
                  onChange={(e) => setFeedSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setFeedSearch(''); feedSearchInputRef.current?.blur(); } }}
                  placeholder="Search feed by author or content…  / focuses"
                  className="flex-1 min-w-[200px] bg-[#3a3b3c] rounded px-2 py-1.5 text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="whitespace-nowrap">
                  {feedSearch
                    ? `${visiblePosts.length} of ${posts.length} match`
                    : `${posts.length} of ${postsData?.total || posts.length} loaded`}
                </span>
                <button
                  className="px-3 py-1.5 rounded bg-[#3a3b3c] text-white disabled:opacity-50"
                  disabled={posts.length >= Number(postsData?.total || 0)}
                  onClick={() => setLimit((v) => v + 30)}
                >
                  Load more
                </button>
              </div>
            {visiblePosts?.map((post: Post) => (
              <article key={post.id} className="bg-[#242526] rounded-lg">
                {/* Post Header */}
                <div className="p-4 pb-0">
                  <div className="flex items-start justify-between">
                    <div className="flex gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500" />
                      <div>
                        <h3 className="font-semibold text-white hover:underline cursor-pointer">
                          {post.author.name}
                        </h3>
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <span>{formatTime(post.createdAt)}</span>
                          <span>·</span>
                          {post.privacy === 'public' ? (
                            <Globe className="w-3 h-3" />
                          ) : post.privacy === 'friends' ? (
                            <Users className="w-3 h-3" />
                          ) : (
                            <Lock className="w-3 h-3" />
                          )}
                        </div>
                      </div>
                    </div>
                    <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Post options' })} className="p-2 rounded-full hover:bg-[#3a3b3c] transition-colors" aria-label="More options">
                      <MoreHorizontal className="w-5 h-5 text-gray-400" />
                    </button>
                  </div>
                </div>

                {/* Post Content */}
                <div className="px-4 py-3">
                  <p className="text-white whitespace-pre-wrap">{post.content}</p>
                </div>

                {/* Reactions Bar */}
                <div className="px-4 py-2 flex items-center justify-between text-gray-400 text-sm border-b border-gray-700">
                  <div className="flex items-center gap-1">
                    <div className="flex -space-x-1">
                      {getTopReactions(post.reactions).map(reaction => reaction && (
                        <div
                          key={reaction.id}
                          className={cn('w-5 h-5 rounded-full bg-[#3a3b3c] flex items-center justify-center', reaction.color)}
                        >
                          <reaction.icon className="w-3 h-3" />
                        </div>
                      ))}
                    </div>
                    <span className="ml-1">{getTotalReactions(post.reactions)}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span>{post.comments} comments</span>
                    <span>{post.shares} shares</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="px-4 py-1 flex items-center">
                  <div
                    className="relative flex-1"
                    onMouseEnter={() => setShowReactions(post.id)}
                    onMouseLeave={() => setShowReactions(null)}
                  >
                    <button onClick={() => reactMutation.mutate({ postId: post.id, reaction: 'like' })} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg hover:bg-[#3a3b3c] transition-colors">
                      <ThumbsUp className="w-5 h-5 text-gray-400" />
                      <span className="text-gray-400 font-medium">Like</span>
                    </button>

                    {/* Reactions Popup */}
                    <AnimatePresence>
                      {showReactions === post.id && (
                        <motion.div
                          initial={{ opacity: 0, y: 10, scale: 0.9 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.9 }}
                          className="absolute bottom-full left-0 mb-2 flex gap-1 p-2 bg-[#242526] rounded-full shadow-xl border border-gray-700"
                        >
                          {REACTIONS.map(reaction => (
                            <button
                              key={reaction.id}
                              onClick={() => { reactMutation.mutate({ postId: post.id, reaction: reaction.id }); setShowReactions(null); }}
                              className="p-2 rounded-full hover:bg-[#3a3b3c] hover:scale-125 transition-all"
                              title={reaction.label}
                            >
                              <reaction.icon className={cn('w-6 h-6', reaction.color)} />
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Comment section' })} className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg hover:bg-[#3a3b3c] transition-colors">
                    <MessageCircle className="w-5 h-5 text-gray-400" />
                    <span className="text-gray-400 font-medium">Comment</span>
                  </button>

                  <button onClick={() => shareMutation.mutate(post.id)} className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg hover:bg-[#3a3b3c] transition-colors">
                    <Share2 className="w-5 h-5 text-gray-400" />
                    <span className="text-gray-400 font-medium">Share</span>
                  </button>
                </div>

                {/* Comment Input */}
                <div className="px-4 py-3 flex gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex-shrink-0" />
                  <div className="flex-1 flex items-center bg-[#3a3b3c] rounded-full px-4">
                    <input
                      type="text"
                      placeholder="Write a comment..."
                      className="flex-1 py-2 bg-transparent text-white placeholder-gray-500 focus:outline-none text-sm"
                    />
                    <div className="flex items-center gap-1">
                      <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Emoji picker' })} className="p-1 text-gray-400 hover:text-gray-300" aria-label="Smile">
                        <Smile className="w-5 h-5" />
                      </button>
                      <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Attach image to comment' })} className="p-1 text-gray-400 hover:text-gray-300" aria-label="Image icon">
                        <ImageIcon className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
            </>
          )}
        </main>

        {/* Right Sidebar */}
        <aside className="w-72 hidden xl:block space-y-4">
          {/* Friend Requests */}
          <div className="bg-[#242526] rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white">Friend Requests</h3>
              <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'View all friend requests' })} className="text-blue-500 text-sm hover:underline">See all</button>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-500 to-teal-500" />
              <div className="flex-1">
                <p className="font-medium text-white text-sm">New User</p>
                <p className="text-xs text-gray-400">5 mutual friends</p>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => friendAction.mutate({ friendId: 'new-user', action: 'confirm' })} className="px-3 py-1.5 bg-blue-500 text-white text-xs font-medium rounded-md hover:bg-blue-600">
                    Confirm
                  </button>
                  <button onClick={() => friendAction.mutate({ friendId: 'new-user', action: 'delete' })} className="px-3 py-1.5 bg-[#3a3b3c] text-white text-xs font-medium rounded-md hover:bg-[#4a4b4c]">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Contacts */}
          <div className="bg-[#242526] rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white">Contacts</h3>
            </div>
            <div className="space-y-1">
              {friends?.map((friend: Friend) => (
                <button
                  key={friend.id}
                  onClick={() => useUIStore.getState().addToast({ type: 'info', message: `Chat with ${friend.name}` })}
                  className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-[#3a3b3c] transition-colors"
                >
                  <div className="relative">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-500 to-red-500" />
                    {friend.online && (
                      <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#242526]" />
                    )}
                  </div>
                  <span className="text-white text-sm">{friend.name}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* Create Post Modal */}
      <AnimatePresence>
        {showPostModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowPostModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#242526] border border-gray-700 rounded-xl w-full max-w-lg p-6 space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Create Post</h3>
                <button onClick={() => setShowPostModal(false)} className="text-gray-400 hover:text-white" aria-label="More options">
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </div>
              <div className="flex gap-3 items-start">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex-shrink-0" />
                <textarea
                  value={postContent}
                  onChange={e => setPostContent(e.target.value)}
                  placeholder="What's on your mind?"
                  rows={4}
                  autoFocus
                  className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none resize-none text-lg"
                />
              </div>
              <div className="flex items-center gap-3 pt-3 border-t border-gray-700">
                <label className="text-xs text-gray-400">Visibility</label>
                <select
                  value={postPrivacy}
                  onChange={(e) => setPostPrivacy(e.target.value as 'public' | 'friends' | 'private')}
                  className="bg-[#3a3b3c] text-white text-xs rounded-md px-2 py-1.5 border border-gray-600 focus:border-blue-500 outline-none"
                >
                  <option value="private">Only me</option>
                  <option value="friends">Friends</option>
                  <option value="public">Public</option>
                </select>
                {postPrivacy === 'public' && (
                  <span className="text-[11px] text-amber-400/80 inline-flex items-center gap-1">
                    NPCs are listening
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-gray-700">
                <div className="flex items-center gap-2">
                  <button onClick={() => setPostContent(prev => prev + ' [Photo]')} className="p-2 rounded-lg hover:bg-[#3a3b3c] text-green-500 transition-colors" aria-label="Image icon">
                    <ImageIcon className="w-5 h-5" />
                  </button>
                  <button onClick={() => setPostContent(prev => prev + ' :)')} className="p-2 rounded-lg hover:bg-[#3a3b3c] text-yellow-500 transition-colors" aria-label="Smile">
                    <Smile className="w-5 h-5" />
                  </button>
                </div>
                <button
                  onClick={handleCreatePost}
                  disabled={!postContent.trim() || postMutation.isPending}
                  className={cn(
                    'px-6 py-2 rounded-lg font-medium text-sm transition-colors',
                    postContent.trim() && !postMutation.isPending
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  )}
                >
                  {postMutation.isPending ? 'Posting...' : 'Post'}
                </button>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="timeline"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}

      {/* Timeline Actions Panel */}
      <div className="p-4 border-t border-[#3a3b3c] bg-[#18191a]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-400" />
            Timeline Actions
          </h3>
          {timelineActionResult && (
            <button onClick={() => setTimelineActionResult(null)} className="p-1 rounded hover:bg-[#3a3b3c] text-gray-400" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {(['criticalPath', 'ganttSchedule', 'temporalClustering', 'trendAnalysis'] as const).map((action) => (
            <button
              key={action}
              onClick={() => handleTimelineAction(action)}
              disabled={!timelineItems[0]?.id || timelineActiveAction !== null}
              className="px-3 py-1.5 text-sm rounded-lg bg-blue-600/10 text-blue-400 border border-blue-600/30 hover:bg-blue-600/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {timelineActiveAction === action ? (
                <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
              ) : null}
              {action === 'criticalPath' ? 'Critical Path' : action === 'ganttSchedule' ? 'Gantt Schedule' : action === 'temporalClustering' ? 'Temporal Cluster' : 'Trend Analysis'}
            </button>
          ))}
        </div>
        {timelineActionResult && (
          <div className="bg-[#242526] border border-[#3a3b3c] rounded-lg p-3 space-y-2 text-sm">
            {timelineActionResult.action === 'criticalPath' && (() => {
              const r = timelineActionResult.result;
              const path = Array.isArray(r.criticalPath) ? r.criticalPath as Array<Record<string, unknown>> : [];
              return (
                <div className="space-y-2">
                  <div className="flex gap-4 text-xs">
                    <span className="text-gray-400">Duration: <span className="text-white font-medium">{String(r.projectDuration ?? 0)}</span></span>
                    <span className="text-gray-400">Critical Tasks: <span className="text-white font-medium">{String(r.criticalTaskCount ?? 0)}</span></span>
                    <span className="text-gray-400">Total Tasks: <span className="text-white font-medium">{String(r.totalTasks ?? 0)}</span></span>
                    <span className="text-gray-400">Avg Slack: <span className="text-white font-medium">{String(r.averageSlack ?? 0)}</span></span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {path.slice(0, 6).map((t, i) => (
                      <span key={i} className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
                        {String(t.name ?? t.id)} ({String(t.duration ?? 0)})
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
            {timelineActionResult.action === 'ganttSchedule' && (() => {
              const r = timelineActionResult.result;
              const schedule = Array.isArray(r.schedule) ? r.schedule as Array<Record<string, unknown>> : [];
              return (
                <div className="space-y-2">
                  <div className="flex gap-4 text-xs">
                    <span className="text-gray-400">Duration: <span className="text-white font-medium">{String(r.projectDuration ?? 0)}</span></span>
                    <span className="text-gray-400">Peak Parallel: <span className="text-white font-medium">{String(r.peakParallelism ?? 0)}</span></span>
                    <span className="text-gray-400">Avg Duration: <span className="text-white font-medium">{String(r.averageDuration ?? 0)}</span></span>
                  </div>
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {schedule.slice(0, 4).map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-gray-300 truncate flex-1">{String(t.name ?? t.id)}</span>
                        <span className="text-gray-500">start: {String(t.start ?? 0)}</span>
                        <span className="text-gray-500">end: {String(t.end ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            {timelineActionResult.action === 'temporalClustering' && (() => {
              const r = timelineActionResult.result;
              return (
                <div className="space-y-2">
                  <div className="flex gap-4 text-xs">
                    <span className="text-gray-400">Clusters: <span className="text-white font-medium">{String(r.totalClusters ?? 0)}</span></span>
                    <span className="text-gray-400">Events: <span className="text-white font-medium">{String(r.totalEvents ?? 0)}</span></span>
                    <span className="text-gray-400">Periodic: <span className={(r.periodicity as Record<string, unknown>)?.detected ? 'text-green-400' : 'text-gray-400'}>
                      {(r.periodicity as Record<string, unknown>)?.detected ? 'Yes' : 'No'}
                    </span></span>
                  </div>
                </div>
              );
            })()}
            {timelineActionResult.action === 'trendAnalysis' && (() => {
              const r = timelineActionResult.result;
              const trend = r.trend as Record<string, unknown> | undefined;
              const dir = String(trend?.direction ?? 'flat');
              const dirColor = dir === 'increasing' ? 'text-neon-green' : dir === 'decreasing' ? 'text-red-400' : 'text-gray-300';
              return (
                <div className="space-y-2">
                  <div className="flex gap-4 text-xs">
                    <span className="text-gray-400">Trend: <span className={`font-semibold ${dirColor}`}>{dir}</span></span>
                    <span className="text-gray-400">R²: <span className="text-white">{String(trend?.rSquared ?? 0)}</span></span>
                    <span className="text-gray-400">Anomalies: <span className="text-white">{String(r.anomalyCount ?? 0)}</span></span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </LensShell>
  );
}
