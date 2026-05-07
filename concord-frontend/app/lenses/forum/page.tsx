'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { apiHelpers } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowBigUp,
  ArrowBigDown,
  MessageSquare,
  Share2,
  Bookmark,
  BookmarkCheck,
  TrendingUp,
  Clock,
  Flame,
  Users,
  Plus,
  Search,
  X,
  Send,
  Award,
  Pin,
  Lock,
  Trash2,
  ChevronDown,
  ExternalLink,
  Copy,
  Shield,
  Eye,
  ArrowLeft,
  Hash,
  Check,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { ErrorState } from '@/components/common/EmptyState';
import { ReportButton } from '@/components/common/ReportButton';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { PullToSubstrate } from '@/components/lens/PullToSubstrate';
import { FeedBanner } from '@/components/lens/FeedBanner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserProfile {
  username: string;
  displayName: string;
  avatar: string;
  karma: number;
  joinedAt: string;
  bio: string;
  postCount: number;
  commentCount: number;
}

interface Comment {
  id: string;
  author: UserProfile;
  content: string;
  score: number;
  userVote: number;
  createdAt: string;
  awards: string[];
  replies: Comment[];
  collapsed: boolean;
}

interface Post {
  id: string;
  title: string;
  content: string;
  author: UserProfile;
  community: string;
  score: number;
  userVote: number;
  commentCount: number;
  createdAt: string;
  tags: string[];
  flair?: { text: string; color: string };
  pinned: boolean;
  locked: boolean;
  removed: boolean;
  awards: string[];
  saved: boolean;
  comments: Comment[];
  views: number;
}

interface Community {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  icon: string;
  banner: string;
  joined: boolean;
  rules: string[];
  createdAt: string;
  moderators: string[];
}

type SortMode = 'hot' | 'new' | 'top' | 'rising';
type ViewMode = 'feed' | 'detail' | 'profile';

// ---------------------------------------------------------------------------
// Award definitions
// ---------------------------------------------------------------------------

const AWARDS = [
  { id: 'fire', emoji: '\uD83D\uDD25', name: 'Hot Take', cost: 100 },
  { id: 'gold', emoji: '\uD83C\uDFC6', name: 'Top Post', cost: 500 },
  { id: 'platinum', emoji: '\uD83D\uDC8E', name: 'Platinum', cost: 1000 },
  { id: 'lightbulb', emoji: '\uD83D\uDCA1', name: 'Insightful', cost: 50 },
  { id: 'star', emoji: '\u2B50', name: 'Star Reply', cost: 250 },
  { id: 'rocket', emoji: '\uD83D\uDE80', name: 'Breakthrough', cost: 750 },
];

const FLAIRS = [
  { text: 'Discussion', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { text: 'Tutorial', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { text: 'Showcase', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  { text: 'Question', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  { text: 'Collab', color: 'bg-pink-500/20 text-pink-400 border-pink-500/30' },
  { text: 'News', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
];

// ---------------------------------------------------------------------------
// Default author for locally-created posts/comments
// ---------------------------------------------------------------------------

const DEFAULT_AUTHOR: UserProfile = {
  username: 'you',
  displayName: 'You',
  avatar: 'Y',
  karma: 0,
  joinedAt: new Date().toISOString(),
  bio: '',
  postCount: 0,
  commentCount: 0,
};

// ---------------------------------------------------------------------------
// Initial state — populated from backend
// ---------------------------------------------------------------------------

const INITIAL_COMMUNITIES: Community[] = [];

function _mkComment(id: string, _author: string, content: string, score: number, replies: Comment[] = []): Comment {
  // Use a deterministic offset based on the id hash instead of Math.random()
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  const hrs = (Math.abs(hash) % 48) + 1;
  return { id, author: DEFAULT_AUTHOR, content, score, userVote: 0, createdAt: new Date(Date.now() - hrs * 3600000).toISOString(), awards: score > 80 ? ['\uD83D\uDD25'] : [], replies, collapsed: false };
}

const INITIAL_POSTS: Post[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatScore(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

function countAllComments(comments: Comment[]): number {
  return comments.reduce((sum, c) => sum + 1 + countAllComments(c.replies), 0);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ForumLensPage() {
  useLensNav('forum');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('forum');
  // ----- State -----
  const [posts, setPosts] = useState<Post[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [selectedCommunity, setSelectedCommunity] = useState<string>('all');
  const [sortMode, setSortMode] = useState<SortMode>('hot');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('feed');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<UserProfile | null>(null);

  // Modals
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  const [showAwardModal, setShowAwardModal] = useState<{ type: 'post' | 'comment'; id: string } | null>(null);
  const [showShareModal, setShowShareModal] = useState<string | null>(null);

  // Create post form
  const [newPostTitle, setNewPostTitle] = useState('');
  const [newPostContent, setNewPostContent] = useState('');
  const [newPostCommunity, setNewPostCommunity] = useState('');
  const [newPostTags, setNewPostTags] = useState('');
  const [newPostFlair, setNewPostFlair] = useState<number | null>(null);

  // Create community form
  const [newCommName, setNewCommName] = useState('');
  const [newCommDesc, setNewCommDesc] = useState('');

  // Comment reply
  const [modToolsOpenId, setModToolsOpenId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [postReplyContent, setPostReplyContent] = useState('');

  const { isLoading, isError: isError, error: error, refetch: refetch, items: postItems, create: createForumPost, update: updateForumPost, remove: removeForumPost } = useLensData('forum', 'post', {
    seed: INITIAL_POSTS.map(p => ({ title: p.title, data: p as unknown as Record<string, unknown> })),
  });
  const { isError: isError2, error: error2, refetch: refetch2, items: communityItems, create: createForumCommunity } = useLensData('forum', 'community', {
    seed: INITIAL_COMMUNITIES.map(c => ({ title: c.name, data: c as unknown as Record<string, unknown> })),
  });

  // Backend action wiring
  const runForumAction = useRunArtifact('forum');
  const [forumActionResult, setForumActionResult] = useState<Record<string, unknown> | null>(null);
  const [forumRunning, setForumRunning] = useState<string | null>(null);

  const handleForumAction = useCallback(async (action: string) => {
    const targetId = postItems[0]?.id;
    if (!targetId) return;
    setForumRunning(action);
    try {
      const res = await runForumAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setForumActionResult({ _action: action, message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setForumActionResult({ _action: action, ...(res.result as Record<string, unknown>) }); }
    } catch (e) { console.error(`Forum action ${action} failed:`, e); setForumActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setForumRunning(null);
  }, [postItems, runForumAction]);

  // Sync backend data into local state when available
  // IMPORTANT: Use the lens artifact ID (i.id) as the Post id so that
  // subsequent update/delete calls send the correct ID to the backend.
  useEffect(() => {
    if (postItems.length > 0) {
      setPosts(postItems.map(i => ({ ...(i.data as unknown as Post), id: i.id })));
    }
  }, [postItems]);

  useEffect(() => {
    if (communityItems.length > 0) {
      setCommunities(communityItems.map(i => ({ ...(i.data as unknown as Community), id: i.id })));
    }
  }, [communityItems]);

  // API queries for supplementary real-data integration
  useQuery({ queryKey: ['forum-posts-api', selectedCommunity, sortMode], queryFn: () => apiHelpers.dtus.paginated({ tags: selectedCommunity !== 'all' ? selectedCommunity : undefined, pageSize: 50 }).then(r => r.data) });
  useQuery({ queryKey: ['communities-api'], queryFn: () => apiHelpers.dtus.list().then(r => { const tags = new Set<string>(); (r.data?.dtus || []).forEach((d: Record<string, unknown>) => ((d.tags as string[]) || []).forEach(t => tags.add(t))); return { tags: Array.from(tags) }; }) });

  // ----- Filtered & sorted posts -----
  const displayPosts = useMemo(() => {
    let filtered = posts.filter(p => !p.removed);
    if (selectedCommunity !== 'all') filtered = filtered.filter(p => p.community === selectedCommunity);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q) || p.tags.some(t => t.toLowerCase().includes(q)) || p.author.username.toLowerCase().includes(q));
    }
    const pinned = filtered.filter(p => p.pinned);
    const unpinned = filtered.filter(p => !p.pinned);
    const sorted = [...unpinned].sort((a, b) => {
      if (sortMode === 'new') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortMode === 'top') return b.score - a.score;
      if (sortMode === 'rising') return (b.score / Math.max(1, (Date.now() - new Date(b.createdAt).getTime()) / 3600000)) - (a.score / Math.max(1, (Date.now() - new Date(a.createdAt).getTime()) / 3600000));
      // hot: score weighted by recency
      const hotScore = (p: Post) => p.score / Math.pow(((Date.now() - new Date(p.createdAt).getTime()) / 3600000) + 2, 1.5);
      return hotScore(b) - hotScore(a);
    });
    return [...pinned, ...sorted];
  }, [posts, selectedCommunity, sortMode, searchQuery]);

  const selectedPost = selectedPostId ? posts.find(p => p.id === selectedPostId) || null : null;

  // ----- Actions -----
  const handleVote = useCallback((postId: string, direction: number) => {
    setPosts(prev => {
      const updated = prev.map(p => {
        if (p.id !== postId) return p;
        const newVote = p.userVote === direction ? 0 : direction;
        const scoreDelta = newVote - p.userVote;
        return { ...p, userVote: newVote, score: p.score + scoreDelta };
      });
      // Persist voted post to backend via lens API
      const post = updated.find(p => p.id === postId);
      if (post) {
        updateForumPost(postId, { data: post as unknown as Record<string, unknown> }).catch(() => {
          // Rollback on failure
          setPosts(prev2 => prev2.map(p => {
            if (p.id !== postId) return p;
            const revertedVote = p.userVote === direction ? 0 : direction;
            return { ...p, userVote: revertedVote === direction ? 0 : p.userVote, score: p.score };
          }));
        });
      }
      return updated;
    });
  }, [updateForumPost]);

  const handleCommentVote = useCallback((commentId: string, direction: number) => {
    function updateComment(comments: Comment[]): Comment[] {
      return comments.map(c => {
        if (c.id === commentId) {
          const newVote = c.userVote === direction ? 0 : direction;
          return { ...c, userVote: newVote, score: c.score + (newVote - c.userVote) };
        }
        return { ...c, replies: updateComment(c.replies) };
      });
    }
    setPosts(prev => {
      const updated = prev.map(p => ({ ...p, comments: updateComment(p.comments) }));
      // Persist the post containing the comment to backend
      const postWithComment = updated.find(p => JSON.stringify(p.comments).includes(commentId));
      if (postWithComment) {
        updateForumPost(postWithComment.id, { data: postWithComment as unknown as Record<string, unknown> });
      }
      return updated;
    });
  }, [updateForumPost]);

  const handleCreatePost = useCallback(() => {
    if (!newPostTitle.trim() || !newPostCommunity) return;
    const newPost: Post = {
      id: `p${Date.now()}`, title: newPostTitle, content: newPostContent,
      author: DEFAULT_AUTHOR, community: newPostCommunity,
      score: 1, userVote: 1, commentCount: 0,
      createdAt: new Date().toISOString(),
      tags: newPostTags.split(',').map(t => t.trim()).filter(Boolean),
      flair: newPostFlair !== null ? FLAIRS[newPostFlair] : undefined,
      pinned: false, locked: false, removed: false, awards: [], saved: false, comments: [], views: 1,
    };
    setPosts(prev => [newPost, ...prev]);
    createForumPost({ title: newPost.title, data: newPost as unknown as Record<string, unknown>, meta: { status: 'active', tags: newPost.tags } });
    setShowCreatePost(false);
    setNewPostTitle(''); setNewPostContent(''); setNewPostCommunity(''); setNewPostTags(''); setNewPostFlair(null);
  }, [newPostTitle, newPostContent, newPostCommunity, newPostTags, newPostFlair, createForumPost]);

  const handleCreateCommunity = useCallback(() => {
    if (!newCommName.trim()) return;
    const slug = newCommName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const newComm: Community = { id: slug, name: newCommName, description: newCommDesc, memberCount: 1, icon: '\uD83D\uDCAC', banner: 'from-neon-cyan to-neon-purple', joined: true, rules: ['Be respectful', 'Stay on topic'], createdAt: new Date().toISOString(), moderators: [DEFAULT_AUTHOR.username] };
    setCommunities(prev => [...prev, newComm]);
    createForumCommunity({ title: newComm.name, data: newComm as unknown as Record<string, unknown>, meta: { status: 'active' } });
    setShowCreateCommunity(false);
    setNewCommName(''); setNewCommDesc('');
  }, [newCommName, newCommDesc, createForumCommunity]);

  const handleAddComment = useCallback((postId: string, parentCommentId: string | null, content: string) => {
    if (!content.trim()) return;
    const newComment: Comment = { id: `c${Date.now()}`, author: DEFAULT_AUTHOR, content, score: 1, userVote: 1, createdAt: new Date().toISOString(), awards: [], replies: [], collapsed: false };
    function insertReply(comments: Comment[]): Comment[] {
      return comments.map(c => {
        if (c.id === parentCommentId) return { ...c, replies: [...c.replies, newComment] };
        return { ...c, replies: insertReply(c.replies) };
      });
    }
    setPosts(prev => {
      const updated = prev.map(p => {
        if (p.id !== postId) return p;
        const updatedComments = parentCommentId ? insertReply(p.comments) : [...p.comments, newComment];
        return { ...p, comments: updatedComments, commentCount: countAllComments(updatedComments) };
      });
      // Persist the updated post with new comment to backend
      const updatedPost = updated.find(p => p.id === postId);
      if (updatedPost) {
        updateForumPost(postId, { data: updatedPost as unknown as Record<string, unknown> });
      }
      return updated;
    });
    setReplyTo(null); setReplyContent(''); setPostReplyContent('');
  }, [updateForumPost]);

  const handleToggleSave = useCallback((postId: string) => {
    setPosts(prev => {
      const updated = prev.map(p => p.id === postId ? { ...p, saved: !p.saved } : p);
      const post = updated.find(p => p.id === postId);
      if (post) {
        updateForumPost(postId, { data: post as unknown as Record<string, unknown> })
          .catch(() => {
            // Rollback on failure
            setPosts(prev2 => prev2.map(p => p.id === postId ? { ...p, saved: !p.saved } : p));
          });
      }
      return updated;
    });
  }, [updateForumPost]);

  const handleGiveAward = useCallback((awardEmoji: string) => {
    if (!showAwardModal) return;
    if (showAwardModal.type === 'post') {
      setPosts(prev => {
        const updated = prev.map(p => p.id === showAwardModal.id ? { ...p, awards: [...p.awards, awardEmoji], score: p.score + 10 } : p);
        // Persist award to backend
        const post = updated.find(p => p.id === showAwardModal.id);
        if (post) updateForumPost(showAwardModal.id, { data: post as unknown as Record<string, unknown> });
        return updated;
      });
    } else {
      function addAward(comments: Comment[]): Comment[] {
        return comments.map(c => {
          if (c.id === showAwardModal!.id) return { ...c, awards: [...c.awards, awardEmoji], score: c.score + 10 };
          return { ...c, replies: addAward(c.replies) };
        });
      }
      setPosts(prev => {
        const updated = prev.map(p => ({ ...p, comments: addAward(p.comments) }));
        // Persist the post containing the awarded comment
        const postWithAward = updated.find(p => JSON.stringify(p.comments).includes(showAwardModal!.id));
        if (postWithAward) updateForumPost(postWithAward.id, { data: postWithAward as unknown as Record<string, unknown> });
        return updated;
      });
    }
    setShowAwardModal(null);
  }, [showAwardModal, updateForumPost]);

  const handleModAction = useCallback((postId: string, action: 'pin' | 'lock' | 'remove') => {
    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;
      if (action === 'pin') return { ...p, pinned: !p.pinned };
      if (action === 'lock') return { ...p, locked: !p.locked };
      return { ...p, removed: true };
    }));
    if (action === 'remove') {
      removeForumPost(postId);
    } else {
      // Persist pin/lock state changes to backend
      const post = posts.find(p => p.id === postId);
      if (post) {
        const updated = action === 'pin' ? { ...post, pinned: !post.pinned } : { ...post, locked: !post.locked };
        updateForumPost(postId, { data: updated as unknown as Record<string, unknown> });
      }
    }
  }, [posts, removeForumPost, updateForumPost]);

  const handleToggleJoin = useCallback((commId: string) => {
    setCommunities(prev => prev.map(c => c.id === commId ? { ...c, joined: !c.joined, memberCount: c.memberCount + (c.joined ? -1 : 1) } : c));
  }, []);

  const openPostDetail = useCallback((postId: string) => {
    setSelectedPostId(postId);
    setViewMode('detail');
  }, []);

  const openProfile = useCallback((user: UserProfile) => {
    setSelectedProfile(user);
    setViewMode('profile');
  }, []);

  const backToFeed = useCallback(() => {
    setViewMode('feed');
    setSelectedPostId(null);
    setSelectedProfile(null);
  }, []);

  // ----- Comment renderer -----
  function renderComment(comment: Comment, postId: string, depth: number = 0) {
    const post = posts.find(p => p.id === postId);
    const isLocked = post?.locked;
    return (
      <div key={comment.id} className={cn('border-l-2 pl-3 mt-3', depth === 0 ? 'border-orange-500/20' : depth === 1 ? 'border-amber-700/20' : 'border-gray-800')}>
        <div className="flex items-start gap-2">
          <div className="flex flex-col items-center gap-0.5 mt-1">
            <button onClick={() => handleCommentVote(comment.id, 1)} className={cn('text-gray-500 hover:text-orange-400 transition-colors', comment.userVote === 1 && 'text-orange-500')}><ArrowBigUp className="w-4 h-4" /></button>
            <span className={cn('text-xs font-bold', comment.userVote === 1 ? 'text-orange-500' : comment.userVote === -1 ? 'text-blue-500' : 'text-gray-400')}>{comment.score}</span>
            <button onClick={() => handleCommentVote(comment.id, -1)} className={cn('text-gray-500 hover:text-blue-400 transition-colors', comment.userVote === -1 && 'text-blue-500')}><ArrowBigDown className="w-4 h-4" /></button>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <button onClick={() => openProfile(comment.author)} className="font-semibold text-neon-cyan hover:underline">u/{comment.author.username}</button>
              <span>{formatTime(comment.createdAt)}</span>
              {comment.awards.map((a, i) => <span key={i}>{a}</span>)}
            </div>
            <p className="text-sm text-gray-200 mt-1 whitespace-pre-wrap">{comment.content}</p>
            <div className="flex items-center gap-3 mt-1.5">
              {!isLocked && depth < 3 && (
                <button onClick={() => { setReplyTo(comment.id); setReplyContent(''); }} className="text-xs text-gray-500 hover:text-white flex items-center gap-1"><MessageSquare className="w-3 h-3" />Reply</button>
              )}
              <button onClick={() => setShowAwardModal({ type: 'comment', id: comment.id })} className="text-xs text-gray-500 hover:text-yellow-400 flex items-center gap-1"><Award className="w-3 h-3" />Award</button>
              <ReportButton contentId={comment.id} contentType="comment" compact />
            </div>
            <AnimatePresence>
              {replyTo === comment.id && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mt-2">
                  <div className="flex gap-2">
                    <input value={replyContent} onChange={e => setReplyContent(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddComment(postId, comment.id, replyContent)} placeholder="Write a reply..." className="flex-1 px-3 py-1.5 bg-lattice-bg border border-lattice-border rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan input-lattice" />
                    <button onClick={() => handleAddComment(postId, comment.id, replyContent)} className="px-3 py-1.5 bg-neon-cyan text-black text-sm font-medium rounded hover:bg-neon-cyan/90 btn-neon"><Send className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setReplyTo(null)} className="px-2 py-1.5 text-gray-400 hover:text-white text-sm"><X className="w-3.5 h-3.5" /></button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {depth < 3 && comment.replies.map(r => renderComment(r, postId, depth + 1))}
          </div>
        </div>
      </div>
    );
  }

  // ----- Post card -----
  function renderPostCard(post: Post) {
    return (
      <motion.article key={post.id} layout className={cn('bg-lattice-surface border rounded-lg hover:border-orange-500/30 transition-colors lens-card', post.pinned ? 'border-orange-400/40' : 'border-lattice-border')}>
        <div className="flex">
          {/* Vote column — orange/warm accent */}
          <div className="flex flex-col items-center p-2 bg-lattice-bg/50 rounded-l-lg min-w-[48px]">
            <button onClick={() => handleVote(post.id, 1)} className={cn('p-1 rounded hover:bg-orange-500/10 transition-colors', post.userVote === 1 ? 'text-orange-500' : 'text-gray-400 hover:text-orange-500')}><ArrowBigUp className="w-6 h-6" /></button>
            <span className={cn('text-sm font-bold py-0.5', post.userVote === 1 ? 'text-orange-500' : post.userVote === -1 ? 'text-blue-500' : 'text-white')}>{formatScore(post.score)}</span>
            <button onClick={() => handleVote(post.id, -1)} className={cn('p-1 rounded hover:bg-blue-500/10 transition-colors', post.userVote === -1 ? 'text-blue-500' : 'text-gray-400 hover:text-blue-500')}><ArrowBigDown className="w-6 h-6" /></button>
          </div>
          {/* Content */}
          <div className="flex-1 p-3 min-w-0">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1 flex-wrap">
              {post.pinned && <span className="flex items-center gap-1 text-neon-cyan font-medium"><Pin className="w-3 h-3" />Pinned</span>}
              {post.locked && <span className="flex items-center gap-1 text-yellow-500 font-medium"><Lock className="w-3 h-3" />Locked</span>}
              <button onClick={() => setSelectedCommunity(post.community)} className="font-medium text-white hover:underline">c/{post.community}</button>
              <span>by</span>
              <button onClick={() => openProfile(post.author)} className="hover:underline text-neon-cyan/80">u/{post.author.username}</button>
              <span>{formatTime(post.createdAt)}</span>
              {post.flair && <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold border', post.flair.color)}>{post.flair.text}</span>}
              {post.awards.map((a, i) => <span key={i}>{a}</span>)}
            </div>
            <h2 onClick={() => openPostDetail(post.id)} className="text-lg font-medium text-white mb-1 cursor-pointer hover:text-neon-cyan leading-snug">{post.title}</h2>
            {post.content && <p className="text-sm text-gray-400 mb-2 line-clamp-2">{post.content}</p>}
            {post.tags.length > 0 && (
              <div className="flex gap-1.5 mb-2 flex-wrap">
                {post.tags.slice(0, 4).map(t => <span key={t} className="px-2 py-0.5 bg-orange-500/10 border border-orange-500/20 rounded-full text-[10px] text-orange-300 font-medium"><Hash className="w-2.5 h-2.5 inline mr-0.5" />{t}</span>)}
              </div>
            )}
            <div className="flex items-center gap-1 text-gray-400 flex-wrap">
              <button onClick={() => openPostDetail(post.id)} className="flex items-center gap-1.5 text-xs hover:bg-lattice-bg px-2 py-1 rounded transition-colors"><MessageSquare className="w-4 h-4" />{post.commentCount} Comments</button>
              <button onClick={() => setShowAwardModal({ type: 'post', id: post.id })} className="flex items-center gap-1.5 text-xs hover:bg-lattice-bg px-2 py-1 rounded transition-colors hover:text-yellow-400"><Award className="w-4 h-4" />Award</button>
              <button onClick={() => setShowShareModal(post.id)} className="flex items-center gap-1.5 text-xs hover:bg-lattice-bg px-2 py-1 rounded transition-colors"><Share2 className="w-4 h-4" />Share</button>
              <ReportButton contentId={post.id} contentType="post" compact />
              <button onClick={() => handleToggleSave(post.id)} className={cn('flex items-center gap-1.5 text-xs hover:bg-lattice-bg px-2 py-1 rounded transition-colors', post.saved && 'text-neon-cyan')}>{post.saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}{post.saved ? 'Saved' : 'Save'}</button>
              <PullToSubstrate domain="forum" artifactId={post.id} compact />
              <div className="flex items-center gap-1.5 text-xs px-2 py-1 text-gray-500"><Eye className="w-3.5 h-3.5" />{post.views.toLocaleString()}</div>
              {/* Mod tools */}
              <div className="relative ml-auto">
                <button onClick={() => setModToolsOpenId(modToolsOpenId === post.id ? null : post.id)} className="flex items-center gap-1 text-xs hover:bg-lattice-bg px-2 py-1 rounded transition-colors"><Shield className="w-3.5 h-3.5" /><ChevronDown className="w-3 h-3" /></button>
                {modToolsOpenId === post.id && (
                <div className="absolute right-0 top-full mt-1 w-40 bg-lattice-surface border border-lattice-border rounded-lg shadow-xl z-20 py-1">
                  <button onClick={() => { handleModAction(post.id, 'pin'); setModToolsOpenId(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-lattice-bg"><Pin className="w-3.5 h-3.5" />{post.pinned ? 'Unpin' : 'Pin'}</button>
                  <button onClick={() => { handleModAction(post.id, 'lock'); setModToolsOpenId(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-lattice-bg"><Lock className="w-3.5 h-3.5" />{post.locked ? 'Unlock' : 'Lock'}</button>
                  <button onClick={() => { handleModAction(post.id, 'remove'); setModToolsOpenId(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"><Trash2 className="w-3.5 h-3.5" />Remove</button>
                </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.article>
    );
  }

  // ----- Post detail view -----
  function renderPostDetail() {
    if (!selectedPost) return null;
    return (
      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="flex-1 space-y-4">
        <button onClick={backToFeed} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-2"><ArrowLeft className="w-4 h-4" />Back to feed</button>
        <article className="bg-lattice-surface border border-lattice-border rounded-lg overflow-hidden lens-card">
          <div className="flex">
            <div className="flex flex-col items-center p-3 bg-lattice-bg/50 min-w-[56px]">
              <button onClick={() => handleVote(selectedPost.id, 1)} className={cn('p-1 rounded hover:bg-lattice-surface', selectedPost.userVote === 1 ? 'text-orange-500' : 'text-gray-400 hover:text-orange-500')}><ArrowBigUp className="w-7 h-7" /></button>
              <span className={cn('text-base font-bold py-1', selectedPost.userVote === 1 ? 'text-orange-500' : selectedPost.userVote === -1 ? 'text-blue-500' : 'text-white')}>{formatScore(selectedPost.score)}</span>
              <button onClick={() => handleVote(selectedPost.id, -1)} className={cn('p-1 rounded hover:bg-lattice-surface', selectedPost.userVote === -1 ? 'text-blue-500' : 'text-gray-400 hover:text-blue-500')}><ArrowBigDown className="w-7 h-7" /></button>
            </div>
            <div className="flex-1 p-4">
              <div className="flex items-center gap-2 text-xs text-gray-400 mb-2 flex-wrap">
                {selectedPost.pinned && <span className="flex items-center gap-1 text-neon-cyan font-medium"><Pin className="w-3 h-3" />Pinned</span>}
                {selectedPost.locked && <span className="flex items-center gap-1 text-yellow-500 font-medium"><Lock className="w-3 h-3" />Locked</span>}
                <button onClick={() => { setSelectedCommunity(selectedPost.community); backToFeed(); }} className="font-medium text-white hover:underline">c/{selectedPost.community}</button>
                <span>by</span>
                <button onClick={() => openProfile(selectedPost.author)} className="hover:underline text-neon-cyan/80">u/{selectedPost.author.username}</button>
                <span>{formatTime(selectedPost.createdAt)}</span>
                {selectedPost.flair && <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold border', selectedPost.flair.color)}>{selectedPost.flair.text}</span>}
                {selectedPost.awards.map((a, i) => <span key={i} className="text-sm">{a}</span>)}
              </div>
              <h1 className="text-2xl font-bold text-white mb-3">{selectedPost.title}</h1>
              {selectedPost.content && <div className="text-gray-300 text-sm mb-4 whitespace-pre-wrap leading-relaxed">{selectedPost.content}</div>}

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="forum" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
              {selectedPost.tags.length > 0 && (
                <div className="flex gap-1.5 mb-4 flex-wrap">
                  {selectedPost.tags.map(t => <span key={t} className="px-2 py-0.5 bg-lattice-bg border border-lattice-border rounded text-xs text-gray-400"><Hash className="w-3 h-3 inline mr-0.5" />{t}</span>)}
                </div>
              )}
              <div className="flex items-center gap-2 text-gray-400 border-t border-lattice-border pt-3 flex-wrap">
                <span className="text-xs flex items-center gap-1"><MessageSquare className="w-4 h-4" />{selectedPost.commentCount} Comments</span>
                <button onClick={() => setShowAwardModal({ type: 'post', id: selectedPost.id })} className="flex items-center gap-1 text-xs hover:text-yellow-400 transition-colors"><Award className="w-4 h-4" />Award</button>
                <button onClick={() => setShowShareModal(selectedPost.id)} className="flex items-center gap-1 text-xs hover:text-white transition-colors"><Share2 className="w-4 h-4" />Share</button>
                <ReportButton contentId={selectedPost.id} contentType="post" compact />
                <button onClick={() => handleToggleSave(selectedPost.id)} className={cn('flex items-center gap-1 text-xs transition-colors', selectedPost.saved ? 'text-neon-cyan' : 'hover:text-white')}>{selectedPost.saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}{selectedPost.saved ? 'Saved' : 'Save'}</button>
                <PullToSubstrate domain="forum" artifactId={selectedPost.id} compact />
                <span className="text-xs flex items-center gap-1 text-gray-500"><Eye className="w-3.5 h-3.5" />{selectedPost.views.toLocaleString()} views</span>
              </div>
            </div>
          </div>
        </article>

        {/* Comment input */}
        {!selectedPost.locked && (
          <div className="bg-lattice-surface border border-lattice-border rounded-lg p-4 lens-card">
            <p className="text-xs text-gray-400 mb-2">Comment as <span className="text-neon-cyan">u/{DEFAULT_AUTHOR.username}</span></p>
            <textarea value={postReplyContent} onChange={e => setPostReplyContent(e.target.value)} rows={3} placeholder="What are your thoughts?" className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan resize-none input-lattice" />
            <div className="flex justify-end mt-2">
              <button onClick={() => handleAddComment(selectedPost.id, null, postReplyContent)} disabled={!postReplyContent.trim()} className="px-4 py-1.5 bg-neon-cyan text-black text-sm font-medium rounded-full hover:bg-neon-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed btn-neon">Comment</button>
            </div>
          </div>
        )}
        {selectedPost.locked && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 flex items-center gap-2 text-yellow-400 text-sm"><Lock className="w-4 h-4" />This thread is locked. New comments are not allowed.</div>
        )}

        {/* Comments */}
        <div className="bg-lattice-surface border border-lattice-border rounded-lg p-4 lens-card">
          <h3 className="text-sm font-semibold text-white mb-3">Comments ({selectedPost.commentCount})</h3>
          {selectedPost.comments.length === 0 && <p className="text-sm text-gray-500 py-4 text-center">No comments yet. Be the first to share your thoughts!</p>}
          {selectedPost.comments.map(c => renderComment(c, selectedPost.id, 0))}
        </div>
      </motion.div>
    );
  }

  // ----- Profile view -----
  function renderProfile() {
    if (!selectedProfile) return null;
    const userPosts = posts.filter(p => p.author.username === selectedProfile.username && !p.removed);
    return (
      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="flex-1 space-y-4">
        <button onClick={backToFeed} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-2"><ArrowLeft className="w-4 h-4" />Back to feed</button>
        <div className="bg-lattice-surface border border-lattice-border rounded-lg overflow-hidden lens-card">
          <div className="h-24 bg-gradient-to-r from-neon-cyan/30 to-neon-purple/30" />
          <div className="px-6 pb-4 -mt-8">
            <div className="w-16 h-16 rounded-full bg-lattice-bg border-4 border-lattice-surface flex items-center justify-center text-lg font-bold text-neon-cyan">{selectedProfile.avatar}</div>
            <h2 className="text-xl font-bold text-white mt-2">{selectedProfile.displayName}</h2>
            <p className="text-sm text-gray-400">u/{selectedProfile.username}</p>
            <p className="text-sm text-gray-300 mt-2">{selectedProfile.bio}</p>
            <div className="flex gap-6 mt-3 text-sm">
              <div><span className="font-bold text-white">{selectedProfile.karma.toLocaleString()}</span> <span className="text-gray-400">karma</span></div>
              <div><span className="font-bold text-white">{selectedProfile.postCount}</span> <span className="text-gray-400">posts</span></div>
              <div><span className="font-bold text-white">{selectedProfile.commentCount}</span> <span className="text-gray-400">comments</span></div>
              <div className="text-gray-400">Joined {new Date(selectedProfile.joinedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
            </div>
          </div>
        </div>
        <h3 className="text-sm font-semibold text-white">Posts by u/{selectedProfile.username}</h3>
        {userPosts.length === 0 && <p className="text-gray-500 text-sm">No posts yet.</p>}
        <div className="space-y-3">{userPosts.map(p => renderPostCard(p))}</div>
      </motion.div>
    );
  }

  // ----- Sidebar -----
  function renderSidebar() {
    const activeCommunity = selectedCommunity !== 'all' ? communities.find(c => c.id === selectedCommunity) : null;
    return (
      <aside className="w-80 space-y-4 flex-shrink-0">
        {/* Community info panel */}
        <div className="bg-lattice-surface border border-lattice-border rounded-lg overflow-hidden panel">
          <div className={cn('h-20 bg-gradient-to-r', activeCommunity ? activeCommunity.banner : 'from-neon-cyan to-neon-purple')} />
          <div className="p-4">
            <h3 className="font-bold text-white mb-1 flex items-center gap-2">
              {activeCommunity ? <>{activeCommunity.icon} c/{activeCommunity.name}</> : 'Home'}
            </h3>
            <p className="text-sm text-gray-400 mb-3">{activeCommunity?.description || 'Your personal front page. Browse all communities.'}</p>
            {activeCommunity && (
              <div className="flex items-center gap-4 text-xs text-gray-400 mb-3">
                <span><Users className="w-3.5 h-3.5 inline mr-1" />{activeCommunity.memberCount.toLocaleString()} members</span>
                <span>Created {new Date(activeCommunity.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setShowCreatePost(true)} className="flex-1 py-2 bg-neon-cyan text-black font-medium rounded-full hover:bg-neon-cyan/90 transition-colors text-sm btn-neon">Create Post</button>
              {activeCommunity && (
                <button onClick={() => handleToggleJoin(activeCommunity.id)} className={cn('px-4 py-2 rounded-full text-sm font-medium border transition-colors', activeCommunity.joined ? 'border-gray-600 text-gray-300 hover:border-red-500 hover:text-red-400' : 'border-neon-cyan text-neon-cyan hover:bg-neon-cyan/10')}>
                  {activeCommunity.joined ? 'Joined' : 'Join'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Rules */}
        {activeCommunity && activeCommunity.rules.length > 0 && (
          <div className="bg-lattice-surface border border-lattice-border rounded-lg p-4 panel">
            <h3 className="font-bold text-white mb-2 text-sm">Community Rules</h3>
            <ol className="text-xs text-gray-400 space-y-1.5 list-decimal list-inside">
              {activeCommunity.rules.map((r, i) => <li key={i}>{r}</li>)}
            </ol>
          </div>
        )}

        {/* Communities list */}
        <div className="bg-lattice-surface border border-lattice-border rounded-lg p-4 panel">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-white flex items-center gap-2 text-sm"><Users className="w-4 h-4" />Communities</h3>
            <button onClick={() => setShowCreateCommunity(true)} className="text-neon-cyan hover:text-neon-cyan/80 transition-colors"><Plus className="w-4 h-4" /></button>
          </div>
          <div className="space-y-1">
            <button onClick={() => { setSelectedCommunity('all'); if (viewMode !== 'feed') backToFeed(); }} className={cn('w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors', selectedCommunity === 'all' ? 'bg-neon-cyan/20 text-neon-cyan' : 'hover:bg-lattice-bg text-gray-300')}>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-neon-cyan to-neon-purple flex items-center justify-center text-white text-xs font-bold">All</div>
              <span className="text-sm font-medium">All Communities</span>
            </button>
            {communities.map(comm => (
              <button key={comm.id} onClick={() => { setSelectedCommunity(comm.id); if (viewMode !== 'feed') backToFeed(); }} className={cn('w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors', selectedCommunity === comm.id ? 'bg-neon-cyan/20 text-neon-cyan' : 'hover:bg-lattice-bg text-gray-300')}>
                <div className="w-8 h-8 rounded-full bg-lattice-bg flex items-center justify-center text-sm">{comm.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{comm.name}</p>
                  <p className="text-[10px] text-gray-500">{comm.memberCount.toLocaleString()} members</p>
                </div>
                {comm.joined && <Check className="w-3.5 h-3.5 text-neon-cyan flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>

        {/* Lattice Rules */}
        <div className="bg-lattice-surface border border-lattice-border rounded-lg p-4 panel">
          <h3 className="font-bold text-white mb-2 text-sm">Lattice Rules</h3>
          <ol className="text-xs text-gray-400 space-y-1.5 list-decimal list-inside">
            <li>Respect the sovereignty lock</li>
            <li>No telemetry or data extraction</li>
            <li>Keep discussions constructive</li>
            <li>Link DTUs when relevant</li>
            <li>Tag appropriately</li>
          </ol>
        </div>
      </aside>
    );
  }

  // ===== RENDER =====

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />
      </div>
    );
  }
  return (
    <div className="lens-forum min-h-full bg-lattice-bg" data-lens-theme="forum">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-lattice-surface/95 backdrop-blur border-b border-orange-500/10">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-2xl">{'\uD83D\uDD25'}</span>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">Forum Lens</h1>
                <p className="text-xs text-gray-400">DTUs as discussion threads</p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-1 justify-end">
              <div className="relative max-w-xs w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input type="text" value={searchQuery} onChange={e => { setSearchQuery(e.target.value); if (viewMode !== 'feed') backToFeed(); }} placeholder="Search posts, tags, users..." className="w-full pl-10 pr-4 py-2 bg-lattice-bg border border-lattice-border rounded-full text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan input-lattice" />
                {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>}
              </div>
              <button onClick={() => setShowCreatePost(true)} className="flex items-center gap-2 px-4 py-2 bg-neon-cyan text-black font-medium rounded-full hover:bg-neon-cyan/90 transition-colors text-sm flex-shrink-0 btn-neon">
                <Plus className="w-4 h-4" />Create Post
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        <FeedBanner domain="forum" />
        <div className="flex gap-6 mt-4">
          {/* Main content */}
          <AnimatePresence mode="wait">
            {viewMode === 'feed' && (
              <motion.div key="feed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 space-y-4 min-w-0">
                {/* Sort bar */}
                <div className="flex items-center gap-2 p-2 bg-lattice-surface border border-lattice-border rounded-lg">
                  {([
                    { id: 'hot' as SortMode, icon: Flame, label: 'Hot' },
                    { id: 'new' as SortMode, icon: Clock, label: 'New' },
                    { id: 'top' as SortMode, icon: TrendingUp, label: 'Top' },
                    { id: 'rising' as SortMode, icon: ArrowBigUp, label: 'Rising' },
                  ]).map(sort => (
                    <button key={sort.id} onClick={() => setSortMode(sort.id)} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors', sortMode === sort.id ? 'bg-lattice-bg text-white' : 'text-gray-400 hover:text-white hover:bg-lattice-bg/50')}>
                      <sort.icon className="w-4 h-4" />{sort.label}
                    </button>
                  ))}
                </div>
                {searchQuery && <p className="text-sm text-gray-400">Showing results for &quot;{searchQuery}&quot; ({displayPosts.length} found)</p>}
                {displayPosts.length === 0 && <div className="text-center py-12 text-gray-500"><MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>No posts found.{searchQuery ? ' Try a different search.' : ' Be the first to post!'}</p></div>}
                <div className="space-y-3">{displayPosts.map(p => renderPostCard(p))}</div>
              </motion.div>
            )}
            {viewMode === 'detail' && renderPostDetail()}
            {viewMode === 'profile' && renderProfile()}
          </AnimatePresence>

          {/* Sidebar */}
          {renderSidebar()}
        </div>
      </div>

      {/* ========== MODALS ========== */}

      {/* Create Post Modal */}
      <AnimatePresence>
        {showCreatePost && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowCreatePost(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="w-full max-w-xl bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-lattice-border">
                <h2 className="text-lg font-bold text-white">Create a Post</h2>
                <button onClick={() => setShowCreatePost(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-4">
                {/* Community selection */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Community</label>
                  <select value={newPostCommunity} onChange={e => setNewPostCommunity(e.target.value)} className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded-lg text-sm text-white focus:outline-none focus:border-neon-cyan input-lattice">
                    <option value="">Select a community...</option>
                    {communities.map(c => <option key={c.id} value={c.id}>{c.icon} c/{c.name}</option>)}
                  </select>
                </div>
                {/* Title */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Title</label>
                  <input value={newPostTitle} onChange={e => setNewPostTitle(e.target.value)} placeholder="An interesting title..." maxLength={300} className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan input-lattice" />
                  <p className="text-[10px] text-gray-500 mt-1 text-right">{newPostTitle.length}/300</p>
                </div>
                {/* Content */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Content</label>
                  <textarea value={newPostContent} onChange={e => setNewPostContent(e.target.value)} rows={6} placeholder="Share your thoughts, tips, questions..." className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan resize-none input-lattice" />
                </div>
                {/* Tags */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Tags (comma-separated)</label>
                  <input value={newPostTags} onChange={e => setNewPostTags(e.target.value)} placeholder="mixing, tutorial, ableton" className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan input-lattice" />
                </div>
                {/* Flair */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Flair</label>
                  <div className="flex gap-2 flex-wrap">
                    {FLAIRS.map((f, i) => (
                      <button key={f.text} onClick={() => setNewPostFlair(newPostFlair === i ? null : i)} className={cn('px-3 py-1 rounded-full text-xs font-semibold border transition-colors', f.color, newPostFlair === i && 'ring-2 ring-white/40')}>
                        {f.text}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 px-5 py-4 border-t border-lattice-border">
                <button onClick={() => setShowCreatePost(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
                <button onClick={handleCreatePost} disabled={!newPostTitle.trim() || !newPostCommunity} className="px-6 py-2 bg-neon-cyan text-black font-medium rounded-full hover:bg-neon-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed text-sm btn-neon">Post</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Community Modal */}
      <AnimatePresence>
        {showCreateCommunity && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowCreateCommunity(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="w-full max-w-md bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-lattice-border">
                <h2 className="text-lg font-bold text-white">Create Community</h2>
                <button onClick={() => setShowCreateCommunity(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Community Name</label>
                  <input value={newCommName} onChange={e => setNewCommName(e.target.value)} placeholder="e.g. Ambient Production" maxLength={50} className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan input-lattice" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Description</label>
                  <textarea value={newCommDesc} onChange={e => setNewCommDesc(e.target.value)} rows={3} placeholder="What is this community about?" className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan resize-none input-lattice" />
                </div>
              </div>
              <div className="flex justify-end gap-3 px-5 py-4 border-t border-lattice-border">
                <button onClick={() => setShowCreateCommunity(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
                <button onClick={handleCreateCommunity} disabled={!newCommName.trim()} className="px-6 py-2 bg-neon-cyan text-black font-medium rounded-full hover:bg-neon-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed text-sm btn-neon">Create</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Award Modal */}
      <AnimatePresence>
        {showAwardModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowAwardModal(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="w-full max-w-sm bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-lattice-border">
                <h2 className="text-lg font-bold text-white flex items-center gap-2"><Award className="w-5 h-5 text-yellow-400" />Give Award</h2>
                <button onClick={() => setShowAwardModal(null)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 grid grid-cols-3 gap-3">
                {AWARDS.map(award => (
                  <button key={award.id} onClick={() => handleGiveAward(award.emoji)} className="flex flex-col items-center gap-1 p-3 bg-lattice-bg border border-lattice-border rounded-lg hover:border-yellow-500/50 hover:bg-yellow-500/5 transition-colors">
                    <span className="text-2xl">{award.emoji}</span>
                    <span className="text-xs text-white font-medium">{award.name}</span>
                    <span className="text-[10px] text-gray-500">{award.cost} credits</span>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share Modal */}
      <AnimatePresence>
        {showShareModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowShareModal(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="w-full max-w-sm bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-lattice-border">
                <h2 className="text-lg font-bold text-white">Share Post</h2>
                <button onClick={() => setShowShareModal(null)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-3">
                <button onClick={() => { navigator.clipboard?.writeText(`https://concord.lattice/forum/${showShareModal}`); setShowShareModal(null); }} className="w-full flex items-center gap-3 p-3 bg-lattice-bg border border-lattice-border rounded-lg hover:border-neon-cyan/50 transition-colors text-left">
                  <Copy className="w-5 h-5 text-gray-400" />
                  <div><p className="text-sm text-white font-medium">Copy Link</p><p className="text-xs text-gray-500">Copy the post URL to clipboard</p></div>
                </button>
                <button onClick={() => setShowShareModal(null)} className="w-full flex items-center gap-3 p-3 bg-lattice-bg border border-lattice-border rounded-lg hover:border-neon-cyan/50 transition-colors text-left">
                  <ExternalLink className="w-5 h-5 text-gray-400" />
                  <div><p className="text-sm text-white font-medium">Open in New Tab</p><p className="text-xs text-gray-500">Open the post in a new browser tab</p></div>
                </button>
                <button onClick={() => setShowShareModal(null)} className="w-full flex items-center gap-3 p-3 bg-lattice-bg border border-lattice-border rounded-lg hover:border-neon-cyan/50 transition-colors text-left">
                  <MessageSquare className="w-5 h-5 text-gray-400" />
                  <div><p className="text-sm text-white font-medium">Crosspost</p><p className="text-xs text-gray-500">Share to another community</p></div>
                </button>

      {/* Real-time Data Panel */}
      <UniversalActions domain="forum" artifactId={null} compact />

      {/* Forum Analytics Actions */}
      <div className="panel p-4 space-y-3 mx-4 mb-4">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Shield className="w-4 h-4 text-orange-400" />
          Community Analytics
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { action: 'threadAnalysis',   label: 'Thread Analysis',   icon: MessageSquare, color: 'text-neon-cyan' },
            { action: 'moderationQueue',  label: 'Moderation Queue',  icon: Shield,        color: 'text-red-400' },
            { action: 'communityHealth',  label: 'Community Health',  icon: TrendingUp,    color: 'text-neon-green' },
            { action: 'topicClustering',  label: 'Topic Clustering',  icon: Hash,          color: 'text-neon-purple' },
          ].map(({ action, label, icon: Icon, color }) => (
            <button
              key={action}
              onClick={() => handleForumAction(action)}
              disabled={!!forumRunning || !postItems[0]?.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-lattice-deep border border-lattice-border text-sm hover:border-orange-500/30 disabled:opacity-40 transition-colors"
            >
              {forumRunning === action ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className={`w-4 h-4 ${color}`} />}
              <span className="truncate text-xs">{label}</span>
            </button>
          ))}
        </div>

        {forumActionResult && (
          <div className="mt-3 rounded-lg bg-black/30 border border-white/10 p-4 relative">
            <button onClick={() => setForumActionResult(null)} className="absolute top-3 right-3 text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>

            {/* threadAnalysis */}
            {forumActionResult._action === 'threadAnalysis' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Thread Analysis</p>
                {(forumActionResult.message as string) ? <p className="text-sm text-gray-400">{forumActionResult.message as string}</p> : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: 'Posts', value: String(forumActionResult.totalPosts ?? 0), color: 'text-white' },
                        { label: 'Authors', value: String(forumActionResult.uniqueAuthors ?? 0), color: 'text-neon-cyan' },
                        { label: 'Avg Length', value: `${forumActionResult.avgPostLength ?? 0} chars`, color: 'text-gray-300' },
                        { label: 'Health', value: String(forumActionResult.health ?? '—'), color: (forumActionResult.health as string) === 'active-discussion' ? 'text-neon-green' : 'text-yellow-400' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                          <p className={`text-sm font-bold ${color} capitalize`}>{value}</p>
                          <p className="text-xs text-gray-400">{label}</p>
                        </div>
                      ))}
                    </div>
                    {Array.isArray(forumActionResult.topContributors) && (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-500">Top Contributors</p>
                        {(forumActionResult.topContributors as {name:string;posts:number}[]).map(c => (
                          <div key={c.name} className="flex items-center gap-3 text-xs px-2 py-1 rounded bg-white/5">
                            <span className="flex-1 text-white">{c.name}</span>
                            <span className="text-neon-cyan">{c.posts} posts</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* moderationQueue */}
            {forumActionResult._action === 'moderationQueue' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Moderation Queue</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Total Reports', value: String(forumActionResult.totalReports ?? 0), color: 'text-white' },
                    { label: 'Pending', value: String(forumActionResult.pending ?? 0), color: 'text-red-400' },
                    { label: 'Resolved', value: String(forumActionResult.resolved ?? 0), color: 'text-neon-green' },
                    { label: 'Urgency', value: String(forumActionResult.urgency ?? '—'), color: (forumActionResult.urgency as string) === 'high' ? 'text-red-400' : (forumActionResult.urgency as string) === 'medium' ? 'text-yellow-400' : 'text-neon-green' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                      <p className={`text-lg font-bold ${color} capitalize`}>{value}</p>
                      <p className="text-xs text-gray-400">{label}</p>
                    </div>
                  ))}
                </div>
                {!!forumActionResult.byReason && Object.keys(forumActionResult.byReason as object).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(forumActionResult.byReason as Record<string,number>).map(([reason, count]) => (
                      <span key={reason} className="text-xs px-2 py-1 rounded bg-red-400/10 border border-red-400/20 text-red-300 capitalize">{reason}: {count}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* communityHealth */}
            {forumActionResult._action === 'communityHealth' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Community Health</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Active Users', value: String(forumActionResult.activeUsers ?? 0), color: 'text-neon-green' },
                    { label: 'Total Users', value: String(forumActionResult.totalUsers ?? 0), color: 'text-white' },
                    { label: 'Activity Rate', value: `${forumActionResult.activityRate ?? 0}%`, color: 'text-neon-cyan' },
                    { label: 'Growth', value: `${(forumActionResult.growthRate as number) > 0 ? '+' : ''}${forumActionResult.growthRate ?? 0}%`, color: (forumActionResult.growthRate as number) >= 0 ? 'text-neon-green' : 'text-red-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                      <p className={`text-lg font-bold ${color}`}>{value}</p>
                      <p className="text-xs text-gray-400">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-bold px-3 py-1 rounded-full ${(forumActionResult.health as string) === 'thriving' ? 'bg-neon-green/20 text-neon-green' : (forumActionResult.health as string) === 'healthy' ? 'bg-neon-cyan/20 text-neon-cyan' : (forumActionResult.health as string) === 'declining' ? 'bg-yellow-400/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'}`}>{forumActionResult.health as string}</span>
                  <span className="text-xs text-gray-400">{forumActionResult.postsThisWeek as number} posts this week</span>
                </div>
                {Array.isArray(forumActionResult.recommendations) && (
                  <div className="space-y-1">
                    {(forumActionResult.recommendations as string[]).map((r, i) => (
                      <p key={i} className="text-xs text-gray-400 bg-white/5 rounded px-3 py-1">{r}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* topicClustering */}
            {forumActionResult._action === 'topicClustering' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Topic Clusters</p>
                {(forumActionResult.message as string) ? <p className="text-sm text-gray-400">{forumActionResult.message as string}</p> : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'Total Threads', value: String(forumActionResult.totalThreads ?? 0), color: 'text-white' },
                        { label: 'Top Topic', value: String(forumActionResult.topTopic ?? '—'), color: 'text-neon-purple' },
                        { label: 'Uncategorized', value: String(forumActionResult.uncategorized ?? 0), color: 'text-gray-400' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                          <p className={`text-sm font-bold ${color} capitalize`}>{value}</p>
                          <p className="text-xs text-gray-400">{label}</p>
                        </div>
                      ))}
                    </div>
                    {Array.isArray(forumActionResult.clusters) && (
                      <div className="space-y-1">
                        {(forumActionResult.clusters as {topic:string;threads:number;share:number}[]).map(c => (
                          <div key={c.topic} className="flex items-center gap-3 text-xs">
                            <span className="text-neon-purple w-24 truncate">#{c.topic}</span>
                            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-neon-purple/60 rounded-full" style={{ width: `${c.share}%` }} />
                            </div>
                            <span className="text-white w-8 text-right">{c.threads}</span>
                            <span className="text-gray-400 w-12 text-right">{c.share}%</span>
                          </div>
                        ))}
                      </div>
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
          domain="forum"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
