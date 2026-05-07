'use client';

import { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api/client';
import { cn, formatNumber, formatRelativeTime } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import {
  Brain, Sparkles, Compass, Zap, BookOpen, Database,
  Clock, Tag, Users, UserPlus, UserMinus,
  Eye, Quote, Heart, Video, FileText,
  Image as ImageIcon, Music, Pin, Loader2,
  Calendar, Link2, Share2, Check, Copy,
  MoreHorizontal, ExternalLink, Mail,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface PublicProfile {
  userId: string;
  username: string;
  displayName: string;
  bio: string;
  avatar: string;
  isCreator: boolean;
  website: string;
  createdAt: string;
  isFollowing: boolean;
  stats: {
    followerCount: number;
    followingCount: number;
    dtuCount: number;
    citationCount: number;
    ccEarned: number;
  };
  cognitiveSignature?: {
    description: string;
    topArchetypes: Array<{ name: string; score: number }>;
    diversityScore: number;
  };
}

interface PublicPost {
  id: string;
  dtuId: string;
  title: string;
  content: string;
  authorId: string;
  authorName: string;
  tags: string[];
  tier: string;
  createdAt: string;
  citationCount: number;
  mediaType?: string;
  pinned?: boolean;
  engagement?: {
    views: number;
    likes: number;
    comments: number;
  };
}

type TabId = 'posts' | 'media' | 'dtus';

// ── Constants ───────────────────────────────────────────────────────────────

const ARCHETYPE_COLORS: Record<string, string> = {
  analytical: 'text-neon-blue',
  creative: 'text-neon-purple',
  philosophical: 'text-neon-cyan',
  practical: 'text-neon-green',
  social: 'text-neon-pink',
  scientific: 'text-yellow-400',
};

const MEDIA_TYPE_ICONS: Record<string, typeof Music> = {
  audio: Music,
  video: Video,
  image: ImageIcon,
  document: FileText,
};

const gradients = [
  'from-neon-cyan to-blue-600',
  'from-neon-purple to-pink-600',
  'from-neon-pink to-rose-600',
  'from-amber-400 to-orange-600',
  'from-violet-500 to-indigo-600',
  'from-teal-400 to-cyan-600',
];

function pickGradient(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return gradients[Math.abs(hash) % gradients.length];
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function PublicProfilePage() {
  const params = useParams();
  const username = params.username as string;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabId>('posts');
  const [linkCopied, setLinkCopied] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);

  // ── Profile data ──────────────────────────────────────────────────────

  const {
    data: profile,
    isLoading: profileLoading,
    isError,
  } = useQuery({
    queryKey: ['public-profile', username],
    queryFn: async () => {
      const res = await api.get(`/api/social/profile/${username}`);
      return res.data.profile as PublicProfile;
    },
    retry: 2,
  });

  // ── Pinned posts ──────────────────────────────────────────────────────

  const { data: pinnedData } = useQuery({
    queryKey: ['pinned-posts', profile?.userId],
    queryFn: async () => {
      const res = await api.get(`/api/social/pins/${profile!.userId}`);
      return (res.data.pins || []) as PublicPost[];
    },
    enabled: !!profile?.userId,
  });

  // ── Follow mutation ───────────────────────────────────────────────────

  const followMutation = useMutation({
    mutationFn: async (action: 'follow' | 'unfollow') => {
      if (action === 'follow') {
        return api.post('/api/social/follow', { followedId: profile?.userId });
      }
      return api.post('/api/social/unfollow', { followedId: profile?.userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public-profile', username] });
    },
  });

  const handleFollowToggle = useCallback(() => {
    if (!profile) return;
    followMutation.mutate(profile.isFollowing ? 'unfollow' : 'follow');
  }, [profile, followMutation]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // clipboard API not available
    }
  }, []);

  const gradient = profile ? pickGradient(profile.userId) : gradients[0];
  const pinnedPosts = pinnedData || [];

  // ── Tab definitions ───────────────────────────────────────────────────

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
    { id: 'posts', label: 'Posts', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'media', label: 'Media', icon: <Video className="w-4 h-4" /> },
    { id: 'dtus', label: 'DTUs', icon: <Database className="w-4 h-4" /> },
  ];

  // ── Loading state ─────────────────────────────────────────────────────

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-lattice-void flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-neon-cyan animate-spin" />
      </div>
    );
  }

  // ── Error / not found ─────────────────────────────────────────────────

  if (isError || !profile) {
    return (
      <div className="min-h-screen bg-lattice-void flex items-center justify-center">
        <div className="text-center">
          <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Profile Not Found</h2>
          <p className="text-gray-400 text-sm max-w-sm">
            The user @{username} does not exist or their profile is private.
          </p>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-lattice-void text-white">
      {/* ── Header / Profile Card ─────────────────────────────────────── */}
      <header className="bg-lattice-surface border-b border-lattice-border">
        {/* Banner */}
        <div className={cn('h-40 bg-gradient-to-br relative', gradient)}>
          <div className="absolute inset-0 bg-black/20" />

          {/* Action buttons (top right) */}
          <div className="absolute top-3 right-3 flex items-center gap-2">
            <button
              onClick={handleCopyLink}
              className="p-2 rounded-lg bg-black/30 backdrop-blur-sm text-white/80 hover:text-white transition-colors"
              title="Copy profile link"
            >
              {linkCopied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
            </button>
            <div className="relative">
              <button
                onClick={() => setShowOptions((p) => !p)}
                className="p-2 rounded-lg bg-black/30 backdrop-blur-sm text-white/80 hover:text-white transition-colors"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              <AnimatePresence>
                {showOptions && (
                  <motion.div
                    initial={{ opacity: 0, y: -5, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -5, scale: 0.95 }}
                    className="absolute right-0 top-full mt-1 bg-lattice-surface border border-lattice-border rounded-lg overflow-hidden z-50 min-w-[160px] shadow-xl"
                  >
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(profile.userId);
                        setShowOptions(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-lattice-deep transition-colors"
                    >
                      <Copy className="w-4 h-4" /> Copy ID
                    </button>
                    {profile.website && (
                      <a
                        href={profile.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-lattice-deep transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" /> Website
                      </a>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          {/* Avatar + Follow button row */}
          <div className="flex items-end justify-between -mt-14 mb-4">
            {/* Avatar */}
            <div
              className={cn(
                'relative w-28 h-28 rounded-full ring-4 ring-lattice-surface flex items-center justify-center text-3xl font-bold text-white overflow-hidden bg-gradient-to-br',
                gradient
              )}
            >
              {profile.avatar ? (
                <Image
                  src={profile.avatar}
                  alt={profile.displayName}
                  fill
                  className="rounded-full object-cover"
                  unoptimized
                />
              ) : (
                <span>{profile.displayName.charAt(0).toUpperCase()}</span>
              )}
            </div>

            {/* Follow / Unfollow button */}
            <div className="mt-14">
              <button
                onClick={handleFollowToggle}
                disabled={followMutation.isPending}
                className={cn(
                  'flex items-center gap-2 px-6 py-2.5 rounded-full font-medium text-sm transition-all',
                  profile.isFollowing
                    ? 'bg-lattice-deep border border-lattice-border text-gray-300 hover:border-red-500/50 hover:text-red-400'
                    : 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/30'
                )}
              >
                {followMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : profile.isFollowing ? (
                  <>
                    <UserMinus className="w-4 h-4" />
                    Following
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    Follow
                  </>
                )}
              </button>
              {/* Newsletter subscription toggle */}
              {profile.isCreator && (
                <label className="flex items-center gap-2 mt-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={newsletterOptIn}
                    onChange={() => {
                      const next = !newsletterOptIn;
                      setNewsletterOptIn(next);
                      api.post('/api/social/newsletter-subscribe', {
                        creatorId: profile.userId,
                        emailOptIn: next,
                      }).catch(() => setNewsletterOptIn(!next));
                    }}
                    className="w-4 h-4 rounded border-gray-600 bg-white/5 text-neon-cyan focus:ring-neon-cyan/50 accent-neon-cyan"
                  />
                  <Mail className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-300 transition-colors" />
                  <span className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">
                    Get email updates
                  </span>
                </label>
              )}
            </div>
          </div>

          {/* Name, handle, badge, bio */}
          <div className="pb-4">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-white">{profile.displayName}</h1>
              {profile.isCreator && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-neon-purple/20 text-neon-purple text-xs font-medium"
                >
                  <Sparkles className="w-3 h-3" />
                  Creator
                </motion.span>
              )}
            </div>
            <p className="text-sm text-gray-400 mt-0.5">@{profile.username}</p>
            {profile.bio && (
              <p className="text-gray-300 text-sm mt-2 max-w-xl leading-relaxed">
                {profile.bio}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-gray-500">
              {profile.website && (
                <a
                  href={profile.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-neon-cyan hover:underline"
                >
                  <Link2 className="w-3 h-3" />
                  {(() => { try { return new URL(profile.website).hostname; } catch { return profile.website; } })()}
                </a>
              )}
              {profile.createdAt && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Joined {new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                </span>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-5 gap-2 pb-4">
            <StatsCell
              label="Followers"
              value={profile.stats.followerCount}
              icon={<Users className="w-3.5 h-3.5" />}
              color="text-neon-cyan"
            />
            <StatsCell
              label="Following"
              value={profile.stats.followingCount}
              icon={<UserPlus className="w-3.5 h-3.5" />}
              color="text-neon-blue"
            />
            <StatsCell
              label="DTUs"
              value={profile.stats.dtuCount}
              icon={<Database className="w-3.5 h-3.5" />}
              color="text-neon-purple"
            />
            <StatsCell
              label="Citations"
              value={profile.stats.citationCount}
              icon={<Quote className="w-3.5 h-3.5" />}
              color="text-neon-green"
            />
            <StatsCell
              label="CC Earned"
              value={profile.stats.ccEarned}
              icon={<Zap className="w-3.5 h-3.5" />}
              color="text-yellow-400"
            />
          </div>

          {/* Cognitive signature (if public) */}
          {profile.cognitiveSignature && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 p-3 rounded-xl bg-lattice-deep/50 border border-lattice-border/50"
            >
              <div className="flex items-center gap-2 mb-1">
                <Brain className="w-4 h-4 text-neon-purple" />
                <span className="text-xs font-medium text-gray-300">Cognitive Signature</span>
              </div>
              <p className="text-xs text-gray-400 line-clamp-2">
                {profile.cognitiveSignature.description}
              </p>
              <div className="flex items-center gap-3 mt-2">
                {profile.cognitiveSignature.topArchetypes.map((a) => (
                  <span
                    key={a.name}
                    className={cn(
                      'text-xs flex items-center gap-1',
                      ARCHETYPE_COLORS[a.name] || 'text-gray-400'
                    )}
                  >
                    <span className="capitalize">{a.name}</span>
                    <span className="text-gray-500">{a.score}%</span>
                  </span>
                ))}
                <span className="text-xs text-gray-500">
                  <Compass className="w-3 h-3 inline mr-1" />
                  {profile.cognitiveSignature.diversityScore}% diversity
                </span>
              </div>
            </motion.div>
          )}

          {/* Tab bar */}
          <div className={ds.tabBar}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={activeTab === tab.id ? ds.tabActive('neon-cyan') : ds.tabInactive}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Pinned posts */}
        {pinnedPosts.length > 0 && (
          <PinnedPostsSection posts={pinnedPosts} />
        )}

        {/* Tab content */}
        {activeTab === 'posts' && (
          <PublicPostsTab userId={profile.userId} />
        )}
        {activeTab === 'media' && (
          <PublicMediaTab userId={profile.userId} />
        )}
        {activeTab === 'dtus' && (
          <PublicDTUsTab userId={profile.userId} />
        )}
      </main>
    </div>
  );
}

// ── Stats Cell ──────────────────────────────────────────────────────────────

function StatsCell({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="text-center p-2 rounded-lg bg-lattice-deep/50 border border-lattice-border/50">
      <div className={cn('flex items-center justify-center gap-1 mb-0.5', color)}>
        {icon}
        <span className="text-lg font-bold text-white">{formatNumber(value)}</span>
      </div>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

// ── Pinned Posts Section ────────────────────────────────────────────────────

function PinnedPostsSection({ posts }: { posts: PublicPost[] }) {
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium text-gray-400">
        <Pin className="w-4 h-4" />
        Pinned
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {posts.map((post) => (
          <motion.div
            key={post.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              ds.panel,
              'border-l-2 border-l-neon-cyan/50 hover:border-neon-cyan/40 transition-colors'
            )}
          >
            <div className="flex items-start gap-3">
              <Pin className="w-4 h-4 text-neon-cyan flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h4 className="text-white font-medium truncate">{post.title}</h4>
                {post.content && (
                  <p className="text-sm text-gray-400 line-clamp-2 mt-1">{post.content}</p>
                )}
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                  {post.createdAt && (
                    <span>{formatRelativeTime(post.createdAt)}</span>
                  )}
                  {post.engagement && (
                    <>
                      <span className="flex items-center gap-1">
                        <Heart className="w-3 h-3" />
                        {formatNumber(post.engagement.likes)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        {formatNumber(post.engagement.views)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Post Card ───────────────────────────────────────────────────────────────

function PostCard({ post }: { post: PublicPost }) {
  const MediaIcon = post.mediaType
    ? MEDIA_TYPE_ICONS[post.mediaType] || FileText
    : BookOpen;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(ds.panel, 'hover:border-gray-600 transition-colors')}
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-lattice-deep">
          <MediaIcon className="w-5 h-5 text-neon-cyan" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-white font-medium truncate">{post.title}</h4>
          {post.content && (
            <p className="text-sm text-gray-400 line-clamp-2 mt-1">{post.content}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            {post.createdAt && (
              <span className="text-xs text-gray-500">
                {formatRelativeTime(post.createdAt)}
              </span>
            )}
            {post.tier && post.tier !== 'regular' && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-neon-purple/10 text-neon-purple">
                {post.tier}
              </span>
            )}
            {post.citationCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Quote className="w-3 h-3" />
                {post.citationCount}
              </span>
            )}
          </div>
          {post.tags && post.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {post.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="text-xs text-neon-cyan/70 bg-neon-cyan/5 px-1.5 py-0.5 rounded-full"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {post.engagement && (
          <div className="flex flex-col items-end gap-1 text-xs text-gray-500 flex-shrink-0">
            <span className="flex items-center gap-1">
              <Eye className="w-3 h-3" />
              {formatNumber(post.engagement.views)}
            </span>
            <span className="flex items-center gap-1">
              <Heart className="w-3 h-3" />
              {formatNumber(post.engagement.likes)}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Public Posts Tab ─────────────────────────────────────────────────────────

function PublicPostsTab({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['public-posts', userId],
    queryFn: async () => {
      const res = await api.get(`/api/social/posts/${userId}`);
      return (res.data.posts || []) as PublicPost[];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
      </div>
    );
  }

  const posts = data || [];

  if (posts.length === 0) {
    return (
      <div className={cn(ds.panel, 'text-center py-16')}>
        <BookOpen className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-300 mb-2">No public posts</h3>
        <p className="text-gray-500 text-sm">This user hasn't published any posts yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}

// ── Public Media Tab ────────────────────────────────────────────────────────

function PublicMediaTab({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['public-media', userId],
    queryFn: async () => {
      const res = await api.get(`/api/social/posts/${userId}`, {
        params: { mediaOnly: true },
      });
      return (res.data.posts || []) as PublicPost[];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
      </div>
    );
  }

  const posts = data || [];

  if (posts.length === 0) {
    return (
      <div className={cn(ds.panel, 'text-center py-16')}>
        <ImageIcon className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-300 mb-2">No media</h3>
        <p className="text-gray-500 text-sm">This user hasn't shared any media content yet.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}

// ── Public DTUs Tab ─────────────────────────────────────────────────────────

function PublicDTUsTab({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['public-dtus', userId],
    queryFn: async () => {
      const res = await api.get(`/api/social/posts/${userId}`, {
        params: { type: 'dtu' },
      });
      return (res.data.posts || []) as PublicPost[];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
      </div>
    );
  }

  const dtus = data || [];

  if (dtus.length === 0) {
    return (
      <div className={cn(ds.panel, 'text-center py-16')}>
        <Database className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-300 mb-2">No public DTUs</h3>
        <p className="text-gray-500 text-sm">This user hasn't published any DTUs yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {dtus.map((dtu) => (
        <motion.div
          key={dtu.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(ds.panel, 'hover:border-gray-600 transition-colors')}
        >
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded uppercase font-medium flex-shrink-0 mt-0.5',
                dtu.tier === 'mega' ? 'bg-neon-purple/20 text-neon-purple' :
                dtu.tier === 'hyper' ? 'bg-neon-pink/20 text-neon-pink' :
                dtu.tier === 'shadow' ? 'bg-gray-500/20 text-gray-400' :
                'bg-neon-blue/20 text-neon-blue'
              )}
            >
              {dtu.tier}
            </span>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-medium text-gray-200 truncate">{dtu.title}</h4>
              {dtu.content && (
                <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{dtu.content}</p>
              )}
              <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-600">
                {dtu.createdAt && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatRelativeTime(dtu.createdAt)}
                  </span>
                )}
                {dtu.citationCount > 0 && (
                  <span className="flex items-center gap-1">
                    <Quote className="w-3 h-3" />
                    {dtu.citationCount} citations
                  </span>
                )}
                {dtu.tags && dtu.tags.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    {dtu.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}
                  </span>
                )}
              </div>
            </div>

            {dtu.engagement && (
              <div className="flex items-center gap-2 text-xs text-gray-500 flex-shrink-0">
                <span className="flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  {formatNumber(dtu.engagement.views)}
                </span>
              </div>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
