'use client';

import { useState, useCallback } from 'react';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn, formatNumber, formatRelativeTime } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import {
  Brain, Sparkles, Compass, Zap,
  Globe, BarChart3, BookOpen, Target,
  Database, Clock, Tag, Edit3, Save, X,
  Users, UserPlus, Eye, Quote, Heart,
  Video, FileText, Image as ImageIcon, Music,
  Bookmark, BarChart2, Pin, Loader2,
  Calendar, Link2, Award, DollarSign,
} from 'lucide-react';
import type { DTU } from '@/lib/api/generated-types';
import { DTUDetailView } from '@/components/dtu/DTUDetailView';
import { CreatorAnalytics } from '@/components/social/CreatorAnalytics';
import { StreakIndicator } from '@/components/social/StreakIndicator';

// ── Types ───────────────────────────────────────────────────────────────────

interface SocialProfile {
  userId: string;
  username: string;
  displayName: string;
  bio: string;
  avatar: string;
  isCreator: boolean;
  website: string;
  createdAt: string;
  stats: {
    followerCount: number;
    followingCount: number;
    dtuCount: number;
    citationCount: number;
    ccEarned: number;
  };
}

interface SocialPost {
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

type TabId = 'posts' | 'media' | 'dtus' | 'bookmarks' | 'analytics';

// ── Constants ───────────────────────────────────────────────────────────────

const ARCHETYPE_COLORS: Record<string, string> = {
  analytical: 'text-neon-blue',
  creative: 'text-neon-purple',
  philosophical: 'text-neon-cyan',
  practical: 'text-neon-green',
  social: 'text-neon-pink',
  scientific: 'text-yellow-400',
};

const ARCHETYPE_ICONS: Record<string, React.ReactNode> = {
  analytical: <BarChart3 className="w-5 h-5" />,
  creative: <Sparkles className="w-5 h-5" />,
  philosophical: <BookOpen className="w-5 h-5" />,
  practical: <Target className="w-5 h-5" />,
  social: <Globe className="w-5 h-5" />,
  scientific: <Compass className="w-5 h-5" />,
};

const MEDIA_TYPE_ICONS: Record<string, typeof Music> = {
  audio: Music,
  video: Video,
  image: ImageIcon,
  document: FileText,
};

// ── Main Page ───────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('posts');
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');

  // ── Social profile ────────────────────────────────────────────────────

  const { data: profileData, isLoading: profileLoading } = useQuery({
    queryKey: ['my-social-profile'],
    queryFn: async () => {
      const res = await api.get('/api/social/profile');
      return res.data.profile as SocialProfile;
    },
    retry: 1,
  });

  // ── Cognitive profile data ────────────────────────────────────────────

  const { data: personalityData } = useQuery({
    queryKey: ['personality'],
    queryFn: () => api.get('/api/universe/personality').then((r) => r.data),
    retry: 1,
  });

  const { data: statsData } = useQuery({
    queryKey: ['universe-stats'],
    queryFn: () => api.get('/api/universe/stats').then((r) => r.data),
    retry: 1,
  });

  // ── Merit Credit Score ──────────────────────────────────────────────

  const { data: meritData } = useQuery({
    queryKey: ['merit-score', profileData?.userId],
    queryFn: async () => {
      const res = await apiHelpers.economy.meritScore(profileData!.userId);
      return res.data as {
        ok: boolean;
        score: number;
        breakdown: {
          citations: { raw: number; score: number };
          sales: { raw: number; score: number };
          royalties: { raw: number; score: number };
          community: { raw: number; score: number };
        };
        level: string;
      };
    },
    enabled: !!profileData?.userId,
    retry: false,
  });

  // ── Creator Royalty Income ────────────────────────────────────────────

  const { data: royaltyData } = useQuery({
    queryKey: ['creator-royalties', profileData?.userId],
    queryFn: async () => {
      const res = await apiHelpers.economy.creatorRoyalties(profileData!.userId);
      return res.data as {
        ok: boolean;
        totalEarned: number;
        total: number;
      };
    },
    enabled: !!profileData?.userId,
    retry: false,
  });

  // ── Pinned posts ──────────────────────────────────────────────────────

  const { data: pinnedData } = useQuery({
    queryKey: ['my-pinned-posts'],
    queryFn: async () => {
      const res = await api.get(`/api/social/pins/${profileData?.userId}`);
      return (res.data.pins || []) as SocialPost[];
    },
    enabled: !!profileData?.userId,
  });

  // ── Profile update mutation ───────────────────────────────────────────

  const updateProfile = useMutation({
    mutationFn: async (data: { displayName: string; bio: string }) => {
      return api.post('/api/social/profile', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-social-profile'] });
      setIsEditing(false);
    },
  });

  const handleStartEdit = useCallback(() => {
    if (profileData) {
      setEditName(profileData.displayName);
      setEditBio(profileData.bio || '');
    }
    setIsEditing(true);
  }, [profileData]);

  const handleSaveProfile = useCallback(() => {
    updateProfile.mutate({ displayName: editName, bio: editBio });
  }, [editName, editBio, updateProfile]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  const personality = personalityData?.personality;
  const _stats = statsData?.universe || statsData;
  const profile = profileData;
  const pinnedPosts = pinnedData || [];

  // ── Tab definitions ───────────────────────────────────────────────────

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
    { id: 'posts', label: 'Posts', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'media', label: 'Media', icon: <Video className="w-4 h-4" /> },
    { id: 'dtus', label: 'DTUs', icon: <Database className="w-4 h-4" /> },
    { id: 'bookmarks', label: 'Bookmarks', icon: <Bookmark className="w-4 h-4" /> },
    { id: 'analytics', label: 'Analytics', icon: <BarChart2 className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-lattice-void text-white">
      {/* ── Header / Social Profile Card ──────────────────────────────── */}
      <header className="bg-lattice-surface border-b border-lattice-border">
        {/* Banner gradient */}
        <div className="h-36 bg-gradient-to-br from-neon-purple/40 via-neon-cyan/20 to-neon-blue/30 relative">
          <div className="absolute inset-0 bg-black/10" />
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          {/* Avatar + Edit button row */}
          <div className="flex items-end justify-between -mt-14 mb-4">
            {/* Avatar */}
            <div className="relative w-28 h-28 rounded-full ring-4 ring-lattice-surface bg-gradient-to-br from-neon-purple to-neon-cyan flex items-center justify-center text-3xl font-bold text-white overflow-hidden">
              {profile?.avatar ? (
                <Image
                  src={profile.avatar}
                  alt={profile.displayName}
                  fill
                  className="rounded-full object-cover"
                  unoptimized
                />
              ) : (
                <span>{profile?.displayName?.charAt(0)?.toUpperCase() || '?'}</span>
              )}
            </div>

            {/* Edit toggle */}
            <div className="flex items-center gap-2 mt-14">
              {profile && (
                <StreakIndicator userId={profile.userId} className="mr-2" />
              )}
              {isEditing ? (
                <>
                  <button
                    onClick={handleSaveProfile}
                    disabled={updateProfile.isPending}
                    className={cn(ds.btnPrimary, 'text-sm')}
                  >
                    {updateProfile.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    Save
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className={cn(ds.btnGhost, 'text-sm')}
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={handleStartEdit}
                  className={cn(ds.btnSecondary, 'text-sm')}
                >
                  <Edit3 className="w-4 h-4" />
                  Edit Profile
                </button>
              )}
            </div>
          </div>

          {/* Name, bio, creator badge */}
          <div className="pb-4">
            {isEditing ? (
              <div className="space-y-3 max-w-lg">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Display name"
                  className={ds.input}
                />
                <textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  placeholder="Write a short bio..."
                  rows={3}
                  className={ds.textarea}
                />
              </div>
            ) : profileLoading ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-7 w-48 bg-lattice-deep rounded" />
                <div className="h-4 w-64 bg-lattice-deep rounded" />
              </div>
            ) : profile ? (
              <>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold text-white">
                    {profile.displayName}
                  </h1>
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
                {profile.website && (
                  <a
                    href={profile.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-neon-cyan hover:underline mt-2"
                  >
                    <Link2 className="w-3 h-3" />
                    {(() => { try { return new URL(profile.website).hostname; } catch { return profile.website; } })()}
                  </a>
                )}
                {profile.createdAt && (
                  <span className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                    <Calendar className="w-3 h-3" />
                    Joined {new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </span>
                )}
              </>
            ) : (
              <div className="py-4">
                <p className="text-gray-400 text-sm">
                  Set up your social profile to connect with others.
                </p>
              </div>
            )}
          </div>

          {/* Stats row */}
          {profile && (
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
          )}

          {/* Merit Credit Score + Royalty Income */}
          {profile && meritData?.ok && (
            <MeritScoreCard
              score={meritData.score}
              level={meritData.level}
              breakdown={meritData.breakdown}
              royaltyIncome={royaltyData?.totalEarned || 0}
              royaltyCitations={royaltyData?.total || 0}
            />
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
        {/* Pinned posts (shown above all tabs) */}
        {pinnedPosts.length > 0 && (
          <PinnedPostsSection posts={pinnedPosts} />
        )}

        {/* Cognitive profile summary (compact, always shown) */}
        {personality && activeTab !== 'analytics' && (
          <CognitiveCard personality={personality} />
        )}

        {/* Tab content */}
        {activeTab === 'posts' && profile && (
          <PostsTab userId={profile.userId} />
        )}
        {activeTab === 'media' && profile && (
          <MediaTab userId={profile.userId} />
        )}
        {activeTab === 'dtus' && (
          <MyDTUsTab />
        )}
        {activeTab === 'bookmarks' && (
          <BookmarksTab />
        )}
        {activeTab === 'analytics' && profile && (
          <div className="space-y-6">
            {personality && <CognitiveCard personality={personality} />}
            <div className="flex justify-end">
              <a
                href="/lenses/analytics"
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-neon-cyan/10 text-neon-cyan text-sm font-medium hover:bg-neon-cyan/20 transition-colors"
              >
                <BarChart2 className="w-4 h-4" />
                Full Analytics Dashboard
              </a>
            </div>
            <CreatorAnalytics userId={profile.userId} />
          </div>
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

function PinnedPostsSection({ posts }: { posts: SocialPost[] }) {
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

// ── Cognitive Card (compact cognitive profile summary) ──────────────────────

function CognitiveCard({ personality }: { personality: Record<string, unknown> }) {
  const archetypeScores = (personality.archetypeScores || {}) as Record<string, number>;
  const diversityScore = (personality.diversityScore || 0) as number;
  const description = (personality.description || '') as string;

  const topArchetypes = Object.entries(archetypeScores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(ds.panel, 'bg-gradient-to-br from-lattice-surface to-lattice-deep')}
    >
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-neon-purple/20 flex items-center justify-center flex-shrink-0">
          <Brain className="w-6 h-6 text-neon-purple" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-300 mb-1">Cognitive Signature</h3>
          <p className="text-sm text-gray-400 line-clamp-2">{description}</p>
          <div className="flex items-center gap-4 mt-2">
            {topArchetypes.map(([archetype, score]) => (
              <span
                key={archetype}
                className={cn(
                  'flex items-center gap-1 text-xs',
                  ARCHETYPE_COLORS[archetype] || 'text-gray-400'
                )}
              >
                {ARCHETYPE_ICONS[archetype] || <Zap className="w-3 h-3" />}
                <span className="capitalize">{archetype}</span>
                <span className="text-gray-500">{score}%</span>
              </span>
            ))}
            <span className="text-xs text-gray-500">
              <Compass className="w-3 h-3 inline mr-1" />
              {diversityScore}% diversity
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Posts Tab ────────────────────────────────────────────────────────────────

function PostsTab({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['social-posts', userId],
    queryFn: async () => {
      const res = await api.get(`/api/social/posts/${userId}`);
      return (res.data.posts || []) as SocialPost[];
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
        <h3 className="text-lg font-semibold text-gray-300 mb-2">No posts yet</h3>
        <p className="text-gray-500 text-sm max-w-md mx-auto">
          Publish your DTUs to share your thoughts with the community.
        </p>
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

// ── Media Tab ───────────────────────────────────────────────────────────────

function MediaTab({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['social-media', userId],
    queryFn: async () => {
      const res = await api.get(`/api/social/posts/${userId}`, {
        params: { mediaOnly: true },
      });
      return (res.data.posts || []) as SocialPost[];
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
        <h3 className="text-lg font-semibold text-gray-300 mb-2">No media posts</h3>
        <p className="text-gray-500 text-sm max-w-md mx-auto">
          Posts with images, video, or audio will appear here.
        </p>
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

// ── Bookmarks Tab ───────────────────────────────────────────────────────────

function BookmarksTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-bookmarks'],
    queryFn: async () => {
      const res = await api.get('/api/social/bookmarks');
      return (res.data.bookmarks || []) as SocialPost[];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
      </div>
    );
  }

  const bookmarks = data || [];

  if (bookmarks.length === 0) {
    return (
      <div className={cn(ds.panel, 'text-center py-16')}>
        <Bookmark className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-300 mb-2">No bookmarks yet</h3>
        <p className="text-gray-500 text-sm max-w-md mx-auto">
          Bookmark posts from the feed to save them here for later.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {bookmarks.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}

// ── Post Card ───────────────────────────────────────────────────────────────

function PostCard({ post }: { post: SocialPost }) {
  const MediaIcon = post.mediaType
    ? MEDIA_TYPE_ICONS[post.mediaType] || FileText
    : BookOpen;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        ds.panel,
        'hover:border-gray-600 transition-colors'
      )}
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

// ── My DTUs Tab ─────────────────────────────────────────────────────────────

function MyDTUsTab() {
  const [page, setPage] = useState(0);
  const [selectedDtuId, setSelectedDtuId] = useState<string | null>(null);
  const PAGE_SIZE = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['my-dtus', page],
    queryFn: async () => {
      const res = await apiHelpers.dtus.myDtus({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      return res.data as { ok: boolean; dtus?: DTU[]; items?: DTU[]; total?: number };
    },
    staleTime: 30_000,
  });

  const dtus: DTU[] = data?.dtus || data?.items || [];
  const total = data?.total || 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-neon-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (dtus.length === 0 && page === 0) {
    return (
      <div className={cn(ds.panel, 'text-center py-16')}>
        <Database className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-300 mb-2">No DTUs yet</h3>
        <p className="text-gray-500 text-sm max-w-md mx-auto">
          Your discrete thought units will appear here as you create them
          through chat, lenses, or the DTU browser.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={cn(ds.panel, 'p-0 divide-y divide-lattice-border/50')}>
        {dtus.map((dtu) => (
          <button
            key={dtu.id}
            onClick={() => setSelectedDtuId(dtu.id)}
            className="w-full text-left px-4 py-3 hover:bg-lattice-surface/50 transition-colors"
          >
            <div className="flex items-start gap-3">
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded uppercase font-medium flex-shrink-0 mt-0.5',
                dtu.tier === 'mega' ? 'bg-neon-purple/20 text-neon-purple' :
                dtu.tier === 'hyper' ? 'bg-neon-pink/20 text-neon-pink' :
                dtu.tier === 'shadow' ? 'bg-gray-500/20 text-gray-400' :
                'bg-neon-blue/20 text-neon-blue'
              )}>
                {dtu.tier}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-200 truncate">
                  {dtu.title || dtu.summary || dtu.id.slice(0, 20)}
                </p>
                {dtu.summary && dtu.summary !== dtu.title && (
                  <p className="text-xs text-gray-500 truncate mt-0.5">{dtu.summary}</p>
                )}
                <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-600">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(dtu.timestamp).toLocaleDateString()}
                  </span>
                  {dtu.tags && dtu.tags.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Tag className="w-3 h-3" />
                      {dtu.tags.slice(0, 2).map(t => `#${t}`).join(' ')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} of {total}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 border border-lattice-border rounded disabled:opacity-30 hover:bg-lattice-surface"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={(page + 1) * PAGE_SIZE >= total}
              className="px-3 py-1 border border-lattice-border rounded disabled:opacity-30 hover:bg-lattice-surface"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selectedDtuId && (
        <DTUDetailView
          dtuId={selectedDtuId}
          onClose={() => setSelectedDtuId(null)}
          onNavigate={(id) => setSelectedDtuId(id)}
        />
      )}
    </div>
  );
}

// ── Merit Credit Score Card ──────────────────────────────────────────────

const LEVEL_COLORS: Record<string, string> = {
  newcomer: 'text-gray-400',
  emerging: 'text-neon-blue',
  established: 'text-neon-green',
  expert: 'text-neon-purple',
  master: 'text-neon-pink',
  legendary: 'text-yellow-400',
};

const LEVEL_BG: Record<string, string> = {
  newcomer: 'bg-gray-400/10',
  emerging: 'bg-neon-blue/10',
  established: 'bg-neon-green/10',
  expert: 'bg-neon-purple/10',
  master: 'bg-neon-pink/10',
  legendary: 'bg-yellow-400/10',
};

function MeritScoreCard({
  score,
  level,
  breakdown,
  royaltyIncome,
  royaltyCitations,
}: {
  score: number;
  level: string;
  breakdown: {
    citations: { raw: number; score: number };
    sales: { raw: number; score: number };
    royalties: { raw: number; score: number };
    community: { raw: number; score: number };
  };
  royaltyIncome: number;
  royaltyCitations: number;
}) {
  const maxCategoryScore = 250;

  const categories = [
    { key: 'citations', label: 'Citations', data: breakdown.citations, color: 'bg-neon-cyan', icon: <Quote className="w-3 h-3" /> },
    { key: 'sales', label: 'Sales', data: breakdown.sales, color: 'bg-neon-green', icon: <DollarSign className="w-3 h-3" /> },
    { key: 'royalties', label: 'Royalties', data: breakdown.royalties, color: 'bg-neon-pink', icon: <Zap className="w-3 h-3" /> },
    { key: 'community', label: 'Community', data: breakdown.community, color: 'bg-neon-purple', icon: <Users className="w-3 h-3" /> },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4 p-4 rounded-xl bg-gradient-to-br from-lattice-surface to-lattice-deep border border-lattice-border"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-yellow-400/10">
            <Award className="w-5 h-5 text-yellow-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-300">Merit Credit Score</h3>
            <span className={cn('text-xs font-medium capitalize px-2 py-0.5 rounded', LEVEL_COLORS[level] || 'text-gray-400', LEVEL_BG[level] || 'bg-gray-400/10')}>
              {level}
            </span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-2xl font-mono font-bold text-white">{score}</span>
          <span className="text-xs text-gray-500 block">/1000</span>
        </div>
      </div>

      {/* Breakdown bars */}
      <div className="space-y-2">
        {categories.map((cat) => (
          <div key={cat.key} className="flex items-center gap-2">
            <div className="flex items-center gap-1 w-24 text-xs text-gray-400">
              {cat.icon}
              <span>{cat.label}</span>
            </div>
            <div className="flex-1 h-2 bg-lattice-deep rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', cat.color)}
                style={{ width: `${(cat.data.score / maxCategoryScore) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 w-8 text-right font-mono">{cat.data.score}</span>
          </div>
        ))}
      </div>

      {/* Royalty income summary */}
      {(royaltyIncome > 0 || royaltyCitations > 0) && (
        <div className="mt-3 pt-3 border-t border-lattice-border flex items-center gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <DollarSign className="w-3 h-3 text-neon-green" />
            Total royalty income: <span className="text-neon-green font-mono font-medium">{royaltyIncome.toFixed(2)} CC</span>
          </span>
          <span className="flex items-center gap-1">
            from <span className="text-white font-medium">{royaltyCitations}</span> citations
          </span>
        </div>
      )}
    </motion.div>
  );
}
