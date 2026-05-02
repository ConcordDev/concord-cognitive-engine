'use client';

import { useState, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserPlus,
  UserMinus,
  Settings,
  Share2,
  Link2,
  Calendar,
  Heart,
  Music,
  Video,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  BookOpen,
  ExternalLink,
  Copy,
  Check,
  MoreHorizontal,
  Loader2,
  Users,
  Eye,
  Quote,
} from 'lucide-react';
import { cn, formatRelativeTime, formatNumber } from '@/lib/utils';
import { api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';

// ── Types ────────────────────────────────────────────────────────────────────

interface ProfileStats {
  dtuCount: number;
  publicDtuCount: number;
  citationCount: number;
  followerCount: number;
  followingCount: number;
}

interface UserProfileData {
  userId: string;
  displayName: string;
  bio: string;
  avatar: string;
  isPublic: boolean;
  specialization: string[];
  website: string;
  createdAt: string;
  updatedAt: string;
  stats: ProfileStats;
}

interface FeedItem {
  dtuId: string;
  title: string;
  authorId: string;
  authorName: string;
  tags: string[];
  tier: string;
  createdAt: string;
  citationCount: number;
  mediaType?: string;
  engagement?: {
    views: number;
    likes: number;
    comments: number;
  };
}

type ContentTab = 'posts' | 'media' | 'dtus' | 'liked';

interface UserProfileProps {
  userId: string;
  currentUserId?: string;
  onNavigateToUser?: (userId: string) => void;
  className?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const gradients = [
  'from-neon-cyan to-blue-600',
  'from-neon-purple to-pink-600',
  'from-neon-pink to-rose-600',
  'from-amber-400 to-orange-600',
  'from-violet-500 to-indigo-600',
  'from-teal-400 to-cyan-600',
];

function pickGradient(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return gradients[Math.abs(hash) % gradients.length];
}

const MEDIA_TYPE_ICONS: Record<string, typeof Music> = {
  audio: Music,
  video: Video,
  image: ImageIcon,
  document: FileText,
};

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Users;
}) {
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1 mb-0.5">
        <Icon className="w-3.5 h-3.5 text-gray-500" />
        <span className="text-lg font-bold text-white">{formatNumber(value)}</span>
      </div>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

// ── Content Item ─────────────────────────────────────────────────────────────

function ContentItem({ item }: { item: FeedItem }) {
  const MediaIcon = item.mediaType ? MEDIA_TYPE_ICONS[item.mediaType] || FileText : BookOpen;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-lattice-deep border border-lattice-border hover:border-gray-600 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-lattice-surface">
          <MediaIcon className="w-5 h-5 text-neon-cyan" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-white font-medium truncate">{item.title}</h4>
          <div className="flex items-center gap-3 mt-1">
            {item.createdAt && (
              <span className="text-xs text-gray-500">{formatRelativeTime(item.createdAt)}</span>
            )}
            {item.tier !== 'regular' && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-neon-purple/10 text-neon-purple">
                {item.tier}
              </span>
            )}
            {item.citationCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Quote className="w-3 h-3" />
                {item.citationCount}
              </span>
            )}
          </div>
          {item.tags && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {item.tags.slice(0, 4).map((tag) => (
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

        {/* Engagement */}
        {item.engagement && (
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Eye className="w-3 h-3" />
              {formatNumber(item.engagement.views)}
            </span>
            <span className="flex items-center gap-1">
              <Heart className="w-3 h-3" />
              {formatNumber(item.engagement.likes)}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Follow/Follower List ─────────────────────────────────────────────────────

function FollowList({
  title,
  users,
  onClose,
  onNavigate,
}: {
  title: string;
  users: Array<{ userId: string; displayName: string }>;
  onClose: () => void;
  onNavigate?: (userId: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-lattice-surface border border-lattice-border rounded-xl w-full max-w-md max-h-[60vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
          <h3 className="text-white font-medium">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <MessageCircle className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto max-h-[calc(60vh-56px)]">
          {users.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No users yet</div>
          ) : (
            users.map((user) => (
              <button
                key={user.userId}
                onClick={() => onNavigate?.(user.userId)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-lattice-deep transition-colors text-left"
              >
                <div
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm bg-gradient-to-br',
                    pickGradient(user.userId)
                  )}
                >
                  {user.displayName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="text-white text-sm font-medium">{user.displayName}</div>
                  <div className="text-xs text-gray-500">@{user.userId}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

function UserProfile({ userId, currentUserId, onNavigateToUser, className }: UserProfileProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ContentTab>('posts');
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  const isOwnProfile = currentUserId === userId;
  const gradient = pickGradient(userId);

  // ── Data fetching ────────────────────────────────────────────────────

  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    queryFn: async () => {
      const res = await api.get(`/api/social/profile/${userId}`);
      return res.data.profile as UserProfileData;
    },
    retry: 2,
  });

  const followersQuery = useQuery({
    queryKey: ['followers', userId],
    queryFn: async () => {
      const res = await api.get(`/api/social/followers/${userId}`);
      return res.data.followers as Array<{ userId: string; displayName: string }>;
    },
    enabled: showFollowers,
  });

  const followingQuery = useQuery({
    queryKey: ['following', userId],
    queryFn: async () => {
      const res = await api.get(`/api/social/following/${userId}`);
      return res.data.following as Array<{ userId: string; displayName: string }>;
    },
    enabled: showFollowing,
  });

  const contentQuery = useQuery({
    queryKey: ['user-content', userId, activeTab],
    queryFn: async () => {
      if (activeTab === 'media') {
        const res = await api.get(`/api/media/author/${userId}`, {
          params: { limit: 20, viewerId: currentUserId },
        });
        return (res.data.media || []) as FeedItem[];
      }
      // For posts/dtus/liked, use the user's posts endpoint
      const res = await api.get(`/api/social/posts/${userId}`, { params: { limit: 20 } });
      return (res.data.posts || res.data.feed || []) as FeedItem[];
    },
  });

  // ── Follow/Unfollow mutation ──────────────────────────────────────────

  const followMutation = useMutation({
    mutationFn: async (action: 'follow' | 'unfollow') => {
      if (action === 'follow') {
        return api.post('/api/social/follow', { followerId: currentUserId, followedId: userId });
      }
      return api.post('/api/social/unfollow', { followerId: currentUserId, followedId: userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', userId] });
      queryClient.invalidateQueries({ queryKey: ['followers', userId] });
    },
  });

  const isFollowing = useMemo(() => {
    // In production, the API would return this flag
    return false;
  }, []);

  const handleFollowToggle = useCallback(() => {
    if (!currentUserId) return;
    followMutation.mutate(isFollowing ? 'unfollow' : 'follow');
  }, [currentUserId, isFollowing, followMutation]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/profile/${userId}`);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (e) {
      console.error('[UserProfile] Failed to copy link:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to copy profile link' });
    }
  }, [userId]);

  // ── Content tabs ─────────────────────────────────────────────────────

  const tabs: Array<{ id: ContentTab; label: string; icon: typeof BookOpen }> = [
    { id: 'posts', label: 'Posts', icon: BookOpen },
    { id: 'media', label: 'Media', icon: Video },
    { id: 'dtus', label: 'DTUs', icon: FileText },
    { id: 'liked', label: 'Liked', icon: Heart },
  ];

  // ── Render ───────────────────────────────────────────────────────────

  const profile = profileQuery.data;

  if (profileQuery.isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-20', className)}>
        <Loader2 className="w-8 h-8 text-neon-cyan animate-spin" />
      </div>
    );
  }

  if (profileQuery.isError || !profile) {
    return (
      <div className={cn('text-center py-16', className)}>
        <Users className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <h3 className="text-white font-medium mb-2">Profile Not Found</h3>
        <p className="text-sm text-gray-400">
          This user does not exist or their profile is private.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-0', className)}>
      {/* Banner / Header */}
      <div className={cn('relative h-40 bg-gradient-to-br rounded-t-xl', gradient)}>
        <div className="absolute inset-0 bg-black/20" />

        {/* Profile actions (top right) */}
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
              onClick={() => setShowOptions((prev) => !prev)}
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
                  <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-lattice-deep transition-colors">
                    <Copy className="w-4 h-4" /> Copy ID
                  </button>
                  {isOwnProfile && (
                    <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-lattice-deep transition-colors">
                      <Settings className="w-4 h-4" /> Edit Profile
                    </button>
                  )}
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

      {/* Profile info */}
      <div className="relative px-5 pb-5 bg-lattice-surface border-x border-b border-lattice-border rounded-b-xl">
        {/* Avatar (overlapping the banner) */}
        <div className="flex items-end justify-between -mt-12 mb-4">
          <div
            className={cn(
              'relative w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold text-white ring-4 ring-lattice-surface bg-gradient-to-br',
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
              profile.displayName.charAt(0).toUpperCase()
            )}
          </div>

          {/* Follow button */}
          {!isOwnProfile && currentUserId && (
            <button
              onClick={handleFollowToggle}
              disabled={followMutation.isPending}
              className={cn(
                'flex items-center gap-2 px-5 py-2 rounded-full font-medium text-sm transition-all',
                isFollowing
                  ? 'bg-lattice-deep border border-lattice-border text-gray-300 hover:border-red-500/50 hover:text-red-400'
                  : 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/30'
              )}
            >
              {followMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isFollowing ? (
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
          )}
        </div>

        {/* Name & handle */}
        <div className="mb-3">
          <h1 className="text-xl font-bold text-white">{profile.displayName}</h1>
          <p className="text-sm text-gray-400">@{profile.userId}</p>
        </div>

        {/* Bio */}
        {profile.bio && <p className="text-gray-300 text-sm leading-relaxed mb-3">{profile.bio}</p>}

        {/* Meta info */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 mb-4">
          {profile.website && (
            <a
              href={profile.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-neon-cyan hover:underline"
            >
              <Link2 className="w-3 h-3" />
              {new URL(profile.website).hostname}
            </a>
          )}
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Joined{' '}
            {new Date(profile.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              year: 'numeric',
            })}
          </span>
        </div>

        {/* Specializations */}
        {profile.specialization && profile.specialization.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {profile.specialization.map((spec) => (
              <span
                key={spec}
                className="px-2 py-0.5 rounded-full bg-neon-purple/10 text-neon-purple text-xs"
              >
                {spec}
              </span>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-5 gap-2 p-3 rounded-xl bg-lattice-deep border border-lattice-border">
          <button
            onClick={() => setShowFollowers(true)}
            className="hover:bg-lattice-surface rounded-lg p-2 transition-colors"
          >
            <StatCard label="Followers" value={profile.stats.followerCount} icon={Users} />
          </button>
          <button
            onClick={() => setShowFollowing(true)}
            className="hover:bg-lattice-surface rounded-lg p-2 transition-colors"
          >
            <StatCard label="Following" value={profile.stats.followingCount} icon={UserPlus} />
          </button>
          <StatCard label="DTUs" value={profile.stats.dtuCount} icon={FileText} />
          <StatCard label="Public" value={profile.stats.publicDtuCount} icon={Eye} />
          <StatCard label="Citations" value={profile.stats.citationCount} icon={Quote} />
        </div>
      </div>

      {/* Content tabs */}
      <div className="mt-4">
        <div className="flex border-b border-lattice-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'text-neon-cyan border-neon-cyan'
                  : 'text-gray-400 border-transparent hover:text-white hover:border-gray-600'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content list */}
        <div className="mt-4 space-y-3">
          {contentQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
            </div>
          ) : contentQuery.data && contentQuery.data.length > 0 ? (
            contentQuery.data.map((item) => <ContentItem key={item.dtuId} item={item} />)
          ) : (
            <div className="text-center py-12">
              <BookOpen className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">No content yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Follow modals */}
      <AnimatePresence>
        {showFollowers && (
          <FollowList
            title={`Followers (${profile.stats.followerCount})`}
            users={followersQuery.data || []}
            onClose={() => setShowFollowers(false)}
            onNavigate={onNavigateToUser}
          />
        )}
        {showFollowing && (
          <FollowList
            title={`Following (${profile.stats.followingCount})`}
            users={followingQuery.data || []}
            onClose={() => setShowFollowing(false)}
            onNavigate={onNavigateToUser}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedUserProfile = withErrorBoundary(UserProfile);
export { _WrappedUserProfile as UserProfile };
export default _WrappedUserProfile;
