'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  LogIn,
  LogOut,
  Hash,
  MessageSquare,
  Heart,
  Share2,
  Send,
  Loader2,
  ChevronLeft,
  UserCircle,
  PenSquare,
  X,
  Eye,
} from 'lucide-react';
import { cn, formatNumber, formatRelativeTime } from '@/lib/utils';
import { api } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────────

interface GroupInfo {
  groupId: string;
  name: string;
  description: string;
  rules?: string;
  memberCount: number;
  tags: string[];
  isMember: boolean;
  createdAt: string;
}

interface GroupMember {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  role: 'admin' | 'moderator' | 'member';
  joinedAt: string;
}

interface GroupPost {
  postId: string;
  authorId: string;
  authorName: string;
  content: string;
  mediaType?: string;
  createdAt: string;
  reactions: number;
  comments: number;
  shares: number;
}

// ── Gradient helper ──────────────────────────────────────────────────────────

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

// ── Post Compose ─────────────────────────────────────────────────────────────

function PostCompose({
  groupId,
  onPosted,
}: {
  groupId: string;
  onPosted: () => void;
}) {
  const [content, setContent] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const postMutation = useMutation({
    mutationFn: async () => {
      await api.post('/api/social/post', {
        content,
        groupId,
      });
    },
    onSuccess: () => {
      setContent('');
      setIsOpen(false);
      onPosted();
    },
  });

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="w-full flex items-center gap-3 p-4 rounded-xl bg-lattice-deep border border-lattice-border hover:border-neon-cyan/30 transition-all text-left"
      >
        <PenSquare className="w-5 h-5 text-gray-500" />
        <span className="text-sm text-gray-500">Post something to the group...</span>
      </button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-lattice-deep border border-neon-cyan/20"
    >
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Share something with the group..."
        className="w-full bg-transparent text-sm text-white placeholder-gray-500 resize-none focus:outline-none min-h-[100px]"
        autoFocus
      />
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-lattice-border">
        <span className="text-[10px] text-gray-600">
          {content.length}/2000
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setContent('');
              setIsOpen(false);
            }}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => postMutation.mutate()}
            disabled={!content.trim() || postMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-neon-cyan/15 text-neon-cyan text-xs font-medium border border-neon-cyan/30 hover:bg-neon-cyan/25 disabled:opacity-30 transition-all"
          >
            {postMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            Post
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Post Card ────────────────────────────────────────────────────────────────

function GroupPostCard({ post }: { post: GroupPost }) {
  const gradient = pickGradient(post.authorId);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-lattice-deep border border-lattice-border"
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className={cn(
            'w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold text-xs bg-gradient-to-br',
            gradient
          )}
        >
          {post.authorName.charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          {/* Author + time */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-white font-medium">
              {post.authorName}
            </span>
            <span className="text-xs text-gray-600">
              {formatRelativeTime(post.createdAt)}
            </span>
          </div>

          {/* Content */}
          <p className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">
            {post.content}
          </p>

          {/* Engagement */}
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
            <button className="flex items-center gap-1 hover:text-neon-pink transition-colors">
              <Heart className="w-3.5 h-3.5" />
              {post.reactions > 0 && formatNumber(post.reactions)}
            </button>
            <button className="flex items-center gap-1 hover:text-neon-cyan transition-colors">
              <MessageSquare className="w-3.5 h-3.5" />
              {post.comments > 0 && formatNumber(post.comments)}
            </button>
            <button className="flex items-center gap-1 hover:text-neon-green transition-colors">
              <Share2 className="w-3.5 h-3.5" />
              {post.shares > 0 && formatNumber(post.shares)}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Members Sidebar ──────────────────────────────────────────────────────────

function MembersSidebar({
  groupId,
  isOpen,
  onClose,
}: {
  groupId: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { data: members, isLoading } = useQuery({
    queryKey: ['group-members', groupId],
    queryFn: async () => {
      const res = await api.get(`/api/social/group/${groupId}/members`);
      return (res.data.members || []) as GroupMember[];
    },
    enabled: isOpen,
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 bg-black/40 z-40 lg:hidden"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: 300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 300, opacity: 0 }}
            className="fixed right-0 top-0 bottom-0 w-80 bg-lattice-surface border-l border-lattice-border z-50 overflow-y-auto"
          >
            <div className="flex items-center justify-between p-4 border-b border-lattice-border">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-neon-cyan" />
                Members
              </h3>
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
                </div>
              ) : members && members.length > 0 ? (
                members.map((member) => {
                  const gradient = pickGradient(member.userId);
                  return (
                    <div
                      key={member.userId}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-lattice-deep transition-colors"
                    >
                      <div
                        className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold bg-gradient-to-br',
                          gradient
                        )}
                      >
                        {member.avatarUrl ? (
                          <img
                            src={member.avatarUrl}
                            alt={member.displayName}
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : (
                          member.displayName.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-white truncate block">
                          {member.displayName}
                        </span>
                        {member.role !== 'member' && (
                          <span
                            className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded-full',
                              member.role === 'admin'
                                ? 'bg-neon-cyan/10 text-neon-cyan'
                                : 'bg-neon-purple/10 text-neon-purple'
                            )}
                          >
                            {member.role}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">
                  No members found
                </p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function GroupDetailPage() {
  const params = useParams();
  const groupId = params.groupId as string;
  const queryClient = useQueryClient();
  const [showMembers, setShowMembers] = useState(false);

  // Fetch group info
  const { data: group, isLoading: groupLoading } = useQuery({
    queryKey: ['group', groupId],
    queryFn: async () => {
      const res = await api.get(`/api/social/group/${groupId}`);
      return res.data as GroupInfo;
    },
    enabled: !!groupId,
  });

  // Fetch group feed
  const { data: feed, isLoading: feedLoading } = useQuery({
    queryKey: ['group-feed', groupId],
    queryFn: async () => {
      const res = await api.get(`/api/social/group/${groupId}/feed`);
      return (res.data.posts || []) as GroupPost[];
    },
    enabled: !!groupId,
  });

  // Join/leave mutations
  const joinMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/api/social/group/${groupId}/join`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group', groupId] });
    },
  });

  const leaveMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/api/social/group/${groupId}/leave`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group', groupId] });
    },
  });

  const handleRefreshFeed = () => {
    queryClient.invalidateQueries({ queryKey: ['group-feed', groupId] });
  };

  if (groupLoading) {
    return (
      <div className="min-h-screen bg-lattice-deep flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="min-h-screen bg-lattice-deep flex items-center justify-center">
        <div className="text-center">
          <Users className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h2 className="text-white font-medium mb-2">Group not found</h2>
          <a
            href="/groups"
            className="text-sm text-neon-cyan hover:underline"
          >
            Browse groups
          </a>
        </div>
      </div>
    );
  }

  const gradient = pickGradient(group.groupId);

  return (
    <div className="min-h-screen bg-lattice-deep">
      {/* Header */}
      <div className="border-b border-lattice-border">
        <div className={cn('h-32 bg-gradient-to-r', gradient, 'opacity-30')} />
        <div className="max-w-4xl mx-auto px-4 -mt-8">
          <div className="flex items-end justify-between pb-4">
            <div>
              <a
                href="/groups"
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors mb-2"
              >
                <ChevronLeft className="w-3 h-3" />
                All Groups
              </a>
              <h1 className="text-2xl font-bold text-white">{group.name}</h1>
              <p className="text-sm text-gray-400 mt-1 max-w-xl">
                {group.description}
              </p>

              {/* Tags */}
              {group.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {group.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] text-neon-purple/70 bg-neon-purple/5 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
                    >
                      <Hash className="w-2 h-2" />
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Member count + toggle sidebar */}
              <button
                onClick={() => setShowMembers(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-lattice-surface transition-all"
              >
                <UserCircle className="w-4 h-4" />
                {formatNumber(group.memberCount)} members
              </button>

              {/* Join/Leave */}
              <button
                onClick={() =>
                  group.isMember
                    ? leaveMutation.mutate()
                    : joinMutation.mutate()
                }
                disabled={joinMutation.isPending || leaveMutation.isPending}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  group.isMember
                    ? 'bg-lattice-surface text-gray-400 border border-lattice-border hover:border-red-500/30 hover:text-red-400'
                    : 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/25'
                )}
              >
                {joinMutation.isPending || leaveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : group.isMember ? (
                  <>
                    <LogOut className="w-4 h-4" />
                    Leave
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    Join Group
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Feed */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="space-y-4">
          {/* Post composer (only if member) */}
          {group.isMember && (
            <PostCompose groupId={groupId} onPosted={handleRefreshFeed} />
          )}

          {/* Feed posts */}
          {feedLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
            </div>
          ) : feed && feed.length > 0 ? (
            feed.map((post) => (
              <GroupPostCard key={post.postId} post={post} />
            ))
          ) : (
            <div className="text-center py-16">
              <MessageSquare className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No posts in this group yet</p>
              {group.isMember && (
                <p className="text-xs text-gray-600 mt-1">
                  Be the first to share something
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Members sidebar */}
      <MembersSidebar
        groupId={groupId}
        isOpen={showMembers}
        onClose={() => setShowMembers(false)}
      />
    </div>
  );
}
