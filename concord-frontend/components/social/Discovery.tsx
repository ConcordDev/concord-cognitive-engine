'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  TrendingUp,
  Users,
  Hash,
  Sparkles,
  Filter,
  Music,
  Video,
  Image as ImageIcon,
  FileText,
  Heart,
  Eye,
  Quote,
  UserPlus,
  Star,
  Loader2,
  Radio,
  Play,
  Flame,
  BookOpen,
  X,
} from 'lucide-react';
import { cn, formatNumber, formatRelativeTime, debounce } from '@/lib/utils';
import { api, createSharedSession, activeSharedSessions } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────────

type DiscoveryTab = 'trending' | 'topics' | 'users' | 'media';

interface TrendingDTU {
  dtuId: string;
  title: string;
  authorId: string;
  authorName: string;
  tags: string[];
  citationCount: number;
  score: number;
  createdAt: string;
  mediaType?: string;
  engagement?: {
    views: number;
    likes: number;
    comments: number;
  };
}

interface TrendingTopic {
  tag: string;
  count: number;
  category?: string;
  change?: 'up' | 'down' | 'stable';
}

interface SuggestedUser {
  userId: string;
  displayName: string;
  bio: string;
  followerCount: number;
  citationCount: number;
  matchScore: number;
  specialization?: string[];
}

interface SearchResult {
  id: string;
  title: string;
  type: 'dtu' | 'media' | 'user' | 'topic';
  subtitle?: string;
  tags?: string[];
  score?: number;
}

type CategoryFilter = 'all' | 'audio' | 'video' | 'image' | 'document' | 'text';

interface DiscoveryProps {
  currentUserId?: string;
  onNavigateToUser?: (userId: string) => void;
  onNavigateToContent?: (contentId: string) => void;
  className?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_FILTERS: Array<{ id: CategoryFilter; label: string; icon: typeof Sparkles }> = [
  { id: 'all', label: 'All', icon: Sparkles },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'video', label: 'Video', icon: Video },
  { id: 'image', label: 'Images', icon: ImageIcon },
  { id: 'document', label: 'Docs', icon: FileText },
  { id: 'text', label: 'Text', icon: BookOpen },
];

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

const MEDIA_TYPE_ICONS: Record<string, typeof Music> = {
  audio: Music,
  video: Video,
  image: ImageIcon,
  document: FileText,
  stream: Radio,
};

// ── Trending DTU Card ────────────────────────────────────────────────────────

function TrendingCard({
  item,
  rank,
  onNavigate,
}: {
  item: TrendingDTU;
  rank: number;
  onNavigate?: (id: string) => void;
}) {
  const MediaIcon = item.mediaType ? MEDIA_TYPE_ICONS[item.mediaType] || BookOpen : BookOpen;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.05 }}
      onClick={() => onNavigate?.(item.dtuId)}
      className="group p-4 rounded-xl bg-lattice-deep border border-lattice-border hover:border-neon-cyan/30 transition-all cursor-pointer"
    >
      <div className="flex items-start gap-3">
        {/* Rank */}
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-lattice-surface flex items-center justify-center">
          <span className={cn('text-sm font-bold', rank <= 3 ? 'text-neon-cyan' : 'text-gray-400')}>
            {rank}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <MediaIcon className="w-4 h-4 text-gray-500" />
            <h3 className="text-white font-medium truncate group-hover:text-neon-cyan transition-colors">
              {item.title}
            </h3>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>{item.authorName}</span>
            <span>{formatRelativeTime(item.createdAt)}</span>
          </div>
          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {item.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="text-xs text-neon-cyan/60 bg-neon-cyan/5 px-1.5 py-0.5 rounded-full"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Score & engagement */}
        <div className="flex-shrink-0 text-right">
          <div className="flex items-center gap-1 text-neon-cyan text-sm font-medium">
            <Flame className="w-3.5 h-3.5" />
            {item.score}
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
            {item.citationCount > 0 && (
              <span className="flex items-center gap-0.5">
                <Quote className="w-3 h-3" />
                {item.citationCount}
              </span>
            )}
            {item.engagement && (
              <>
                <span className="flex items-center gap-0.5">
                  <Eye className="w-3 h-3" />
                  {formatNumber(item.engagement.views)}
                </span>
                <span className="flex items-center gap-0.5">
                  <Heart className="w-3 h-3" />
                  {formatNumber(item.engagement.likes)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Topic Tag ────────────────────────────────────────────────────────────────

function TopicTag({ topic, rank }: { topic: TrendingTopic; rank: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: rank * 0.03 }}
      className="group p-3 rounded-xl bg-lattice-deep border border-lattice-border hover:border-neon-purple/30 transition-all cursor-pointer"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-neon-purple" />
          <span className="text-white font-medium group-hover:text-neon-purple transition-colors">
            {topic.tag}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{formatNumber(topic.count)} posts</span>
          {topic.change === 'up' && <TrendingUp className="w-3 h-3 text-green-400" />}
          {topic.change === 'down' && <TrendingUp className="w-3 h-3 text-red-400 rotate-180" />}
        </div>
      </div>
      {topic.category && (
        <span className="text-xs text-gray-500 mt-1 inline-block">{topic.category}</span>
      )}
    </motion.div>
  );
}

// ── Suggested User Card ──────────────────────────────────────────────────────

function SuggestedUserCard({
  user,
  onNavigate,
}: {
  user: SuggestedUser;
  onNavigate?: (userId: string) => void;
}) {
  const [followed, setFollowed] = useState(false);
  const gradient = pickGradient(user.userId);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-lattice-deep border border-lattice-border hover:border-gray-600 transition-all"
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <button
          onClick={() => onNavigate?.(user.userId)}
          className={cn(
            'w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold bg-gradient-to-br',
            gradient
          )}
        >
          {user.displayName.charAt(0).toUpperCase()}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <button
              onClick={() => onNavigate?.(user.userId)}
              className="text-white font-medium hover:text-neon-cyan transition-colors truncate"
            >
              {user.displayName}
            </button>
            <button
              onClick={() => setFollowed((prev) => !prev)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all flex-shrink-0 ml-2',
                followed
                  ? 'bg-lattice-surface text-gray-400 border border-lattice-border'
                  : 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/25'
              )}
            >
              {followed ? (
                'Following'
              ) : (
                <>
                  <UserPlus className="w-3 h-3" />
                  Follow
                </>
              )}
            </button>
          </div>

          <p className="text-xs text-gray-500 mt-0.5">@{user.userId}</p>

          {user.bio && <p className="text-sm text-gray-400 mt-1.5 line-clamp-2">{user.bio}</p>}

          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {formatNumber(user.followerCount)} followers
            </span>
            <span className="flex items-center gap-1">
              <Quote className="w-3 h-3" />
              {formatNumber(user.citationCount)} citations
            </span>
            {user.matchScore > 0 && (
              <span className="flex items-center gap-1 text-neon-cyan">
                <Star className="w-3 h-3" />
                {Math.round(user.matchScore * 10) / 10} match
              </span>
            )}
          </div>

          {user.specialization && user.specialization.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {user.specialization.slice(0, 4).map((spec) => (
                <span
                  key={spec}
                  className="text-xs text-neon-purple/70 bg-neon-purple/5 px-1.5 py-0.5 rounded-full"
                >
                  {spec}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

function Discovery({
  currentUserId,
  onNavigateToUser,
  onNavigateToContent,
  className,
}: DiscoveryProps) {
  const [activeTab, setActiveTab] = useState<DiscoveryTab>('trending');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [showFilters, setShowFilters] = useState(false);

  // ── Data fetching ────────────────────────────────────────────────────

  // Active shared sessions for potential discovery
  const sharedSessionsQuery = useQuery({
    queryKey: ['active-shared-sessions'],
    queryFn: () => activeSharedSessions(),
    refetchInterval: 30000,
  });

  const trendingQuery = useQuery({
    queryKey: ['trending-dtus', categoryFilter],
    queryFn: async () => {
      const res = await api.get('/api/social/trending', { params: { limit: 20 } });
      return (res.data.trending || []) as TrendingDTU[];
    },
    enabled: activeTab === 'trending',
  });

  const topicsQuery = useQuery({
    queryKey: ['trending-topics'],
    queryFn: async () => {
      // In production, this would call a dedicated topics endpoint
      // For now, aggregate tags from trending
      const res = await api.get('/api/social/trending', { params: { limit: 50 } });
      const trending = (res.data.trending || []) as TrendingDTU[];

      // Aggregate tags
      const tagCounts = new Map<string, number>();
      for (const item of trending) {
        for (const tag of item.tags || []) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }

      return Array.from(tagCounts.entries())
        .map(([tag, count]) => ({
          tag,
          count,
          category: 'general',
          change: count > 2 ? ('up' as const) : ('stable' as const),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);
    },
    enabled: activeTab === 'topics',
  });

  const usersQuery = useQuery({
    queryKey: ['discover-users', currentUserId],
    queryFn: async () => {
      const res = await api.get(`/api/social/discover/${currentUserId}`);
      return (res.data.suggestions || []) as SuggestedUser[];
    },
    enabled: activeTab === 'users',
  });

  const mediaFeedQuery = useQuery({
    queryKey: ['media-feed', categoryFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        tab: 'trending',
        limit: 20,
      };
      if (categoryFilter !== 'all') {
        params.mediaType = categoryFilter;
      }
      const res = await api.get('/api/media/feed', { params });
      return (res.data.feed || []) as TrendingDTU[];
    },
    enabled: activeTab === 'media',
  });

  const searchQuery_ = useQuery({
    queryKey: ['search', searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];
      const res = await api.get('/api/connective-tissue/search', {
        params: { q: searchQuery.trim(), limit: 10 },
      });
      return (res.data.results || []) as SearchResult[];
    },
    enabled: searchQuery.trim().length >= 2,
  });

  // ── Search handler ───────────────────────────────────────────────────

  const handleSearchChange = useMemo(
    () =>
      debounce((value: string) => {
        setSearchQuery(value);
      }, 300),
    []
  );

  // ── Tabs ──────────────────────────────────────────────────────────────

  const tabs: Array<{ id: DiscoveryTab; label: string; icon: typeof TrendingUp }> = [
    { id: 'trending', label: 'Trending', icon: TrendingUp },
    { id: 'topics', label: 'Topics', icon: Hash },
    { id: 'users', label: 'People', icon: Users },
    { id: 'media', label: 'Media', icon: Play },
  ];

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className={cn('space-y-4', className)}>
      {/* Search bar */}
      <div className="relative">
        <Search
          className={cn(
            'absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors',
            isSearchFocused ? 'text-neon-cyan' : 'text-gray-500'
          )}
        />
        <input
          type="text"
          placeholder="Search DTUs, users, topics..."
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => setIsSearchFocused(true)}
          onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
          className={cn(
            'w-full pl-11 pr-4 py-3 rounded-xl bg-lattice-deep border text-white placeholder-gray-500 focus:outline-none transition-all',
            isSearchFocused
              ? 'border-neon-cyan/40 shadow-lg shadow-neon-cyan/5'
              : 'border-lattice-border'
          )}
        />

        {/* Search results dropdown */}
        <AnimatePresence>
          {isSearchFocused && searchQuery.trim().length >= 2 && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="absolute top-full left-0 right-0 mt-2 bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden z-50 shadow-xl max-h-80 overflow-y-auto"
            >
              {searchQuery_.isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
                </div>
              ) : searchQuery_.data && searchQuery_.data.length > 0 ? (
                searchQuery_.data.map((result) => (
                  <button
                    key={result.id}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-lattice-deep transition-colors text-left"
                    onClick={() => {
                      if (result.type === 'user') onNavigateToUser?.(result.id);
                      else onNavigateToContent?.(result.id);
                    }}
                  >
                    <div className="p-1.5 rounded-lg bg-lattice-deep">
                      {result.type === 'user' ? (
                        <Users className="w-4 h-4 text-neon-purple" />
                      ) : result.type === 'media' ? (
                        <Play className="w-4 h-4 text-neon-cyan" />
                      ) : (
                        <BookOpen className="w-4 h-4 text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{result.title}</div>
                      {result.subtitle && (
                        <div className="text-xs text-gray-500 truncate">{result.subtitle}</div>
                      )}
                    </div>
                    <span className="text-xs text-gray-600 capitalize">{result.type}</span>
                  </button>
                ))
              ) : (
                <div className="py-6 text-center text-gray-500 text-sm">No results found</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                activeTab === tab.id
                  ? 'bg-neon-cyan/10 text-neon-cyan'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-deep'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters((prev) => !prev)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors',
            showFilters ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-gray-400 hover:text-white'
          )}
        >
          <Filter className="w-4 h-4" />
          Filters
          {categoryFilter !== 'all' && <span className="w-2 h-2 rounded-full bg-neon-cyan" />}
        </button>
      </div>

      {/* Category filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-2 pb-2">
              {CATEGORY_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => setCategoryFilter(filter.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border',
                    categoryFilter === filter.id
                      ? 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30'
                      : 'text-gray-400 border-lattice-border hover:text-white hover:border-gray-500'
                  )}
                >
                  <filter.icon className="w-3.5 h-3.5" />
                  {filter.label}
                </button>
              ))}
              {categoryFilter !== 'all' && (
                <button
                  onClick={() => setCategoryFilter('all')}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-white transition-colors"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Shared Sessions */}
      {sharedSessionsQuery.data && sharedSessionsQuery.data.length > 0 && (
        <div className="rounded-xl bg-lattice-deep border border-lattice-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white flex items-center gap-2">
              <Radio className="w-4 h-4 text-neon-cyan" />
              Live Sessions
              <span className="text-xs text-gray-500">({sharedSessionsQuery.data.length})</span>
            </h4>
            <button
              onClick={() => createSharedSession([])}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Start Session
            </button>
          </div>
          <div className="space-y-2">
            {sharedSessionsQuery.data
              .slice(0, 5)
              .map(
                (session: {
                  id: string;
                  topic?: string;
                  participantCount?: number;
                  createdAt?: string;
                }) => (
                  <button
                    key={session.id}
                    onClick={() => onNavigateToContent?.(session.id)}
                    className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-lattice-surface transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-sm text-white truncate">
                        {session.topic || 'Shared Session'}
                      </span>
                    </div>
                    {session.participantCount != null && (
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {session.participantCount}
                      </span>
                    )}
                  </button>
                )
              )}
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="space-y-3">
        {/* Trending DTUs */}
        {activeTab === 'trending' && (
          <>
            {trendingQuery.isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
              </div>
            ) : trendingQuery.data && trendingQuery.data.length > 0 ? (
              trendingQuery.data.map((item, idx) => (
                <TrendingCard
                  key={item.dtuId}
                  item={item}
                  rank={idx + 1}
                  onNavigate={onNavigateToContent}
                />
              ))
            ) : (
              <EmptyState
                icon={TrendingUp}
                title="No Trending Content"
                description="Check back soon for trending DTUs and content."
              />
            )}
          </>
        )}

        {/* Topics */}
        {activeTab === 'topics' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {topicsQuery.isLoading ? (
              <div className="col-span-2 flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
              </div>
            ) : topicsQuery.data && topicsQuery.data.length > 0 ? (
              topicsQuery.data.map((topic, idx) => (
                <TopicTag key={topic.tag} topic={topic} rank={idx} />
              ))
            ) : (
              <div className="col-span-2">
                <EmptyState
                  icon={Hash}
                  title="No Topics Yet"
                  description="Topics will appear as content is published and tagged."
                />
              </div>
            )}
          </div>
        )}

        {/* Users */}
        {activeTab === 'users' && (
          <>
            {usersQuery.isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
              </div>
            ) : usersQuery.data && usersQuery.data.length > 0 ? (
              usersQuery.data.map((user) => (
                <SuggestedUserCard key={user.userId} user={user} onNavigate={onNavigateToUser} />
              ))
            ) : (
              <EmptyState
                icon={Users}
                title="No Suggestions"
                description="We'll suggest people to follow based on your interests once you create some DTUs."
              />
            )}
          </>
        )}

        {/* Media feed */}
        {activeTab === 'media' && (
          <>
            {mediaFeedQuery.isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
              </div>
            ) : mediaFeedQuery.data && mediaFeedQuery.data.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {mediaFeedQuery.data.map((item, _idx) => (
                  <MediaCard key={item.dtuId} item={item} onNavigate={onNavigateToContent} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Play}
                title="No Media Content"
                description="Upload audio, video, or images to see them here."
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Media Card (for media tab) ───────────────────────────────────────────────

function MediaCard({ item, onNavigate }: { item: TrendingDTU; onNavigate?: (id: string) => void }) {
  const MediaIcon = item.mediaType ? MEDIA_TYPE_ICONS[item.mediaType] || Play : Play;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      onClick={() => onNavigate?.(item.dtuId)}
      className="group rounded-xl bg-lattice-deep border border-lattice-border overflow-hidden hover:border-neon-cyan/30 transition-all cursor-pointer"
    >
      {/* Thumbnail area */}
      <div
        className={cn(
          'relative aspect-video bg-gradient-to-br flex items-center justify-center',
          pickGradient(item.dtuId)
        )}
      >
        <div className="absolute inset-0 bg-black/30" />
        <MediaIcon className="w-10 h-10 text-white/80 group-hover:text-white group-hover:scale-110 transition-all relative z-10" />

        {/* Engagement overlay */}
        {item.engagement && (
          <div className="absolute bottom-2 right-2 flex items-center gap-2 text-xs text-white/80">
            <span className="flex items-center gap-0.5">
              <Eye className="w-3 h-3" />
              {formatNumber(item.engagement.views)}
            </span>
            <span className="flex items-center gap-0.5">
              <Heart className="w-3 h-3" />
              {formatNumber(item.engagement.likes)}
            </span>
          </div>
        )}

        {item.mediaType && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/50 text-white text-xs capitalize">
            {item.mediaType}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <h4 className="text-white text-sm font-medium truncate group-hover:text-neon-cyan transition-colors">
          {item.title}
        </h4>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-gray-500">{item.authorName}</span>
          <span className="text-xs text-gray-600">{formatRelativeTime(item.createdAt)}</span>
        </div>
      </div>
    </motion.div>
  );
}

// ── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof TrendingUp;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center py-16">
      <Icon className="w-12 h-12 text-gray-600 mx-auto mb-4" />
      <h3 className="text-white font-medium mb-2">{title}</h3>
      <p className="text-sm text-gray-400 max-w-sm mx-auto">{description}</p>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedDiscovery = withErrorBoundary(Discovery);
export { _WrappedDiscovery as Discovery };
export default _WrappedDiscovery;
