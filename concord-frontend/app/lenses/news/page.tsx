'use client';

import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useState, useMemo, useCallback } from 'react';
import { useUIStore } from '@/store/ui';
import {
  Newspaper,
  Clock,
  Tag,
  TrendingUp,
  Bookmark,
  Share2,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Filter,
  X,
  Eye,
  BarChart3,
  ArrowUpRight,
  Bell,
  Globe,
  Rss,
  Download,
  Quote,
  Play,
  Loader2,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { motion } from 'framer-motion';
import { ErrorState } from '@/components/common/EmptyState';
import { ReportButton } from '@/components/common/ReportButton';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useBookmarks } from '@/hooks/useBookmarks';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  source: string;
  category: string;
  timestamp: string;
  imageUrl?: string;
  trending: boolean;
  bookmarked: boolean;
  url?: string;
  readTime?: number;
  views?: number;
  importance?: 'low' | 'medium' | 'high' | 'critical';
}

type SortMode = 'newest' | 'oldest' | 'trending' | 'importance';
type ViewMode = 'feed' | 'compact' | 'headlines';

const IMPORTANCE_COLORS: Record<string, string> = {
  critical: 'text-red-400 bg-red-400/10 border-red-400/30',
  high: 'text-neon-orange bg-neon-orange/10 border-neon-orange/30',
  medium: 'text-neon-blue bg-neon-blue/10 border-neon-blue/30',
  low: 'text-gray-400 bg-gray-400/10 border-gray-400/30',
};

export default function NewsLensPage() {
  useLensNav('news');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('news');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchText, setSearchText] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [viewMode, setViewMode] = useState<ViewMode>('feed');
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const { bookmarkedIds, toggleBookmark } = useBookmarks('news');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();

  // Pull article to user's DTU substrate
  const pullMutation = useMutation({
    mutationFn: (articleId: string) => api.post(`/api/lens/news/${articleId}/pull`),
    onSuccess: (res) => {
      addToast({
        type: 'success',
        message: `Pulled to your substrate${res.data?.dtu?.title ? `: ${res.data.dtu.title}` : ''}`,
      });
      queryClient.invalidateQueries({ queryKey: ['dtus'] });
    },
    onError: () => addToast({ type: 'error', message: 'Failed to pull article' }),
  });

  // Cite an article (link it to one of user's DTUs)
  const citeMutation = useMutation({
    mutationFn: ({ articleId, userDtuId }: { articleId: string; userDtuId?: string }) =>
      api.post('/api/social/cite', { citedDtuId: articleId, citingDtuId: userDtuId || 'latest' }),
    onSuccess: () => addToast({ type: 'success', message: 'Citation recorded' }),
  });

  const runAction = useRunArtifact('news');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  const {
    items: newsItems,
    isLoading,
    isError,
    error,
    refetch,
  } = useLensData('news', 'article', {
    tags: selectedCategory !== 'all' ? [selectedCategory] : undefined,
    noSeed: true,
  });

  const {
    items: trendingItems,
    isError: isError2,
    error: error2,
    refetch: refetch2,
  } = useLensData('news', 'trending', { noSeed: true });

  const handleAction = async (action: string) => {
    const targetId = newsItems[0]?.id;
    if (!targetId) {
      setActionResult({ message: 'No news articles found. Add an article first.' });
      return;
    }
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) {
        setActionResult({
          message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}`,
        });
      } else {
        setActionResult(res.result as Record<string, unknown>);
      }
    } catch (e) {
      console.error(`Action ${action} failed:`, e);
      setActionResult({
        message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
      });
    } finally {
      setIsRunning(null);
    }
  };

  const categories = [
    { id: 'all', name: 'All', icon: Newspaper },
    { id: 'dtu', name: 'DTU Updates', icon: Tag },
    { id: 'growth', name: 'Growth OS', icon: ArrowUpRight },
    { id: 'market', name: 'Market', icon: BarChart3 },
    { id: 'governance', name: 'Governance', icon: Bell },
    { id: 'community', name: 'Community', icon: Eye },
  ];

  const articles: NewsArticle[] = useMemo(() => {
    return (newsItems || []).map((item) => {
      const data = (item.data || {}) as Record<string, unknown>;
      return {
        id: String(item.id || ''),
        title: String(data.title || item.title || ''),
        summary: String(data.summary || data.description || ''),
        source: String(data.source || ''),
        category: String(data.eventType?.toString().split(':')[1] || data.type || 'general'),
        timestamp: String(item.createdAt || item.updatedAt || ''),
        imageUrl: (data.imageUrl as string) || undefined,
        trending: Boolean(data.trending),
        bookmarked: false,
        url: (data.url as string) || (data.link as string) || undefined,
        readTime: (data.readTime as number) || undefined,
        views: (data.views as number) || undefined,
        importance: (data.importance as 'low' | 'medium' | 'high' | 'critical') || undefined,
      };
    });
  }, [newsItems]);

  // Extract unique sources for filtering
  const sources = useMemo(() => {
    const s = new Set(articles.map((a) => a.source).filter(Boolean));
    return ['all', ...Array.from(s)];
  }, [articles]);

  // Filtered + sorted articles
  const filteredArticles = useMemo(() => {
    let list = [...articles];

    // Search filter
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.summary.toLowerCase().includes(q) ||
          a.source.toLowerCase().includes(q)
      );
    }

    // Source filter
    if (sourceFilter !== 'all') {
      list = list.filter((a) => a.source === sourceFilter);
    }

    // Sort
    switch (sortMode) {
      case 'oldest':
        list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        break;
      case 'trending':
        list.sort((a, b) => (b.trending ? 1 : 0) - (a.trending ? 1 : 0));
        break;
      case 'importance': {
        const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
        list.sort(
          (a, b) => (rank[b.importance || 'low'] || 0) - (rank[a.importance || 'low'] || 0)
        );
        break;
      }
      default:
        list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }

    return list;
  }, [articles, searchText, sourceFilter, sortMode]);

  // toggleBookmark provided by useBookmarks hook — persists to backend

  const handleRefresh = useCallback(() => {
    refetch();
    refetch2();
  }, [refetch, refetch2]);

  const formatRelativeTime = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-blue border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading news...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={handleRefresh} />
      </div>
    );
  }

  return (
    <div data-lens-theme="news" className="p-6 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Newspaper className="w-7 h-7 text-neon-blue" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">News Lens</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className="text-sm text-gray-400">System updates, announcements, and trends</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DTUExportButton domain="news" data={{}} compact />
          <button
            onClick={handleRefresh}
            className="p-2 rounded-lg text-gray-400 hover:text-neon-blue hover:bg-lattice-elevated transition-colors"
            title="Refresh news"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowFilters((f) => !f)}
            className={`p-2 rounded-lg transition-colors ${
              showFilters
                ? 'text-neon-blue bg-neon-blue/10'
                : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
            }`}
            title="Toggle filters"
          >
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Search + Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search articles by title, summary, or source..."
            className="input-lattice w-full pl-10 pr-10"
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {showFilters && (
          <div className="panel p-4 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Sort:</label>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="input-lattice text-xs py-1"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="trending">Trending</option>
                <option value="importance">Importance</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Source:</label>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="input-lattice text-xs py-1"
              >
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {s === 'all' ? 'All sources' : s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">View:</label>
              <div className="flex gap-1">
                {(['feed', 'compact', 'headlines'] as ViewMode[]).map((vm) => (
                  <button
                    key={vm}
                    onClick={() => setViewMode(vm)}
                    className={`px-2 py-1 text-xs rounded ${
                      viewMode === vm
                        ? 'bg-neon-blue/20 text-neon-blue'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {vm.charAt(0).toUpperCase() + vm.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-xs text-gray-500 ml-auto">
              {filteredArticles.length} article{filteredArticles.length !== 1 ? 's' : ''}
              {searchText && ` matching "${searchText}"`}
            </div>
          </div>
        )}
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <Newspaper className="w-5 h-5 text-neon-blue" />
          <div>
            <p className="text-lg font-bold">{articles.length}</p>
            <p className="text-xs text-gray-500">Articles</p>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <Rss className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">{sources.length - 1}</p>
            <p className="text-xs text-gray-500">Sources</p>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <TrendingUp className="w-5 h-5 text-neon-pink" />
          <div>
            <p className="text-lg font-bold">{articles.filter((a) => a.trending).length}</p>
            <p className="text-xs text-gray-500">Trending Topics</p>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 3 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <Globe className="w-5 h-5 text-neon-purple" />
          <div>
            <p className="text-lg font-bold">{0}</p>
            <p className="text-xs text-gray-500">Today</p>
          </div>
        </motion.div>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-2 flex-wrap no-scrollbar">
        {categories.map((category) => {
          const Icon = category.icon;
          return (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
                selectedCategory === category.id
                  ? 'bg-neon-blue/20 text-neon-blue border border-neon-blue/30'
                  : 'bg-lattice-surface text-gray-400 hover:text-white'
              }`}
            >
              <Icon className="w-3 h-3" />
              {category.name}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main News Feed */}
        <div className="lg:col-span-2 space-y-4">
          {filteredArticles.length === 0 ? (
            <div className="panel p-8 text-center text-gray-500">
              <Newspaper className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No articles match your filters</p>
              {searchText && (
                <button
                  onClick={() => setSearchText('')}
                  className="mt-2 text-sm text-neon-blue hover:underline"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : viewMode === 'headlines' ? (
            /* Headlines view: compact list */
            <div className="panel divide-y divide-lattice-border">
              {filteredArticles.map((article) => (
                <div
                  key={article.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-lattice-elevated cursor-pointer transition-colors"
                  onClick={() =>
                    setExpandedArticle(expandedArticle === article.id ? null : article.id)
                  }
                >
                  {article.trending && <TrendingUp className="w-3 h-3 text-neon-pink shrink-0" />}
                  {article.importance && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${IMPORTANCE_COLORS[article.importance]}`}
                    >
                      {article.importance}
                    </span>
                  )}
                  <span className="text-sm flex-1 truncate">{article.title}</span>
                  <span className="text-xs text-gray-500 shrink-0">
                    {formatRelativeTime(article.timestamp)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleBookmark(article.id);
                    }}
                    className={
                      bookmarkedIds.has(article.id)
                        ? 'text-neon-yellow'
                        : 'text-gray-500 hover:text-neon-yellow'
                    }
                  >
                    <Bookmark className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            /* Feed / Compact view */
            filteredArticles.map((article, index) => {
              const isExpanded = expandedArticle === article.id;
              const isBookmarked = bookmarkedIds.has(article.id);
              return (
                <motion.article
                  key={article.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`lens-card transition-all cursor-pointer ${
                    viewMode === 'compact' ? 'py-3' : ''
                  } ${isExpanded ? 'glow-blue ring-1 ring-neon-blue/20' : 'hover:glow-blue'}`}
                  onClick={() => setExpandedArticle(isExpanded ? null : article.id)}
                >
                  <div className="flex gap-4">
                    {viewMode === 'feed' && article.imageUrl && (
                      <div className="w-24 h-24 rounded-lg bg-lattice-elevated flex-shrink-0 flex items-center justify-center">
                        <Newspaper className="w-8 h-8 text-gray-600" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {article.importance && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${IMPORTANCE_COLORS[article.importance]}`}
                            >
                              {article.importance}
                            </span>
                          )}
                          <h3
                            className={`font-semibold ${viewMode === 'compact' ? 'text-sm' : ''} line-clamp-2`}
                          >
                            {article.title}
                          </h3>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {article.trending && <TrendingUp className="w-4 h-4 text-neon-pink" />}
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-gray-500" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-gray-500" />
                          )}
                        </div>
                      </div>

                      {viewMode === 'feed' && (
                        <p className="text-sm text-gray-400 mt-1 line-clamp-2">{article.summary}</p>
                      )}

                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatRelativeTime(article.timestamp)}
                          </span>
                          <span>{article.source}</span>
                          {article.readTime && (
                            <span className="flex items-center gap-1">
                              <Eye className="w-3 h-3" />
                              {article.readTime}m read
                            </span>
                          )}
                          {article.views !== undefined && <span>{article.views} views</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              pullMutation.mutate(article.id);
                            }}
                            className="text-gray-400 hover:text-neon-green transition-colors"
                            title="Pull to substrate"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              citeMutation.mutate({ articleId: article.id });
                            }}
                            className="text-gray-400 hover:text-neon-cyan transition-colors"
                            title="Cite this article"
                          >
                            <Quote className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleBookmark(article.id);
                            }}
                            className={`transition-colors ${isBookmarked ? 'text-neon-yellow' : 'text-gray-400 hover:text-neon-yellow'}`}
                          >
                            <Bookmark className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard?.writeText(
                                `${window.location.origin}/lenses/news?article=${article.id}`
                              );
                              addToast({ type: 'info', message: 'Link copied' });
                            }}
                            className="text-gray-400 hover:text-neon-purple transition-colors"
                          >
                            <Share2 className="w-4 h-4" />
                          </button>
                          <ReportButton contentId={article.id} contentType="artifact" compact />
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t border-lattice-border space-y-3">
                          <p className="text-sm text-gray-300 leading-relaxed">{article.summary}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs px-2 py-1 rounded bg-lattice-elevated text-gray-400">
                              {article.category}
                            </span>
                            {article.trending && (
                              <span className="text-xs px-2 py-1 rounded bg-neon-pink/10 text-neon-pink border border-neon-pink/20">
                                Trending
                              </span>
                            )}
                          </div>
                          {article.url && (
                            <a
                              href={article.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-sm text-neon-blue hover:underline"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Read full article
                            </a>
                          )}
                          <div className="flex gap-2 pt-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                pullMutation.mutate(article.id);
                              }}
                              disabled={pullMutation.isPending}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-neon-green/10 text-neon-green border border-neon-green/20 hover:bg-neon-green/20 transition-colors disabled:opacity-50"
                            >
                              <Download className="w-3 h-3" />
                              {pullMutation.isPending ? 'Pulling...' : 'Pull to Substrate'}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                citeMutation.mutate({ articleId: article.id });
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20 hover:bg-neon-cyan/20 transition-colors"
                            >
                              <Quote className="w-3 h-3" />
                              Cite
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.article>
              );
            })
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Bookmarked count */}
          {bookmarkedIds.size > 0 && (
            <div className="panel p-4">
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-neon-yellow" />
                Bookmarks
              </h3>
              <p className="text-sm text-gray-400">
                {bookmarkedIds.size} article{bookmarkedIds.size !== 1 ? 's' : ''} bookmarked
              </p>
              <button
                onClick={() => {
                  setSearchText('');
                  setSourceFilter('all');
                }}
                className="text-xs text-neon-blue hover:underline mt-1"
              >
                View all
              </button>
            </div>
          )}

          {/* Trending Topics */}
          <div className="panel p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-neon-pink" />
              Trending Topics
            </h3>
            <div className="space-y-2">
              {trendingItems?.length > 0 ? (
                trendingItems.map((topic, index: number) => {
                  const topicData = topic.data as Record<string, unknown>;
                  return (
                    <div
                      key={topic.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-lattice-elevated cursor-pointer transition-colors"
                      onClick={() => setSearchText(String(topicData.name ?? topic.title ?? ''))}
                    >
                      <span className="text-gray-500 text-sm w-6 text-right font-mono">
                        {index + 1}
                      </span>
                      <div className="flex-1">
                        <p className="font-medium text-sm">
                          {String(topicData.name ?? topic.title ?? '')}
                        </p>
                        <p className="text-xs text-gray-500">
                          {String(topicData.count ?? 0)} mentions
                        </p>
                      </div>
                      <ArrowUpRight className="w-3 h-3 text-gray-600" />
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">No trending topics</p>
              )}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="panel p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-neon-blue" />
              Quick Stats
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-400">Total Articles</span>
                <span className="font-mono">{articles.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Articles Today</span>
                <span className="font-mono">{0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Active Sources</span>
                <span className="font-mono">{sources.length - 1}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Trending</span>
                <span className="font-mono text-neon-pink">
                  {articles.filter((a) => a.trending).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Your Bookmarks</span>
                <span className="font-mono text-neon-yellow">{bookmarkedIds.size}</span>
              </div>
            </div>
          </div>

          {/* Category Breakdown */}
          <div className="panel p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Tag className="w-4 h-4 text-neon-purple" />
              By Category
            </h3>
            <div className="space-y-2">
              {categories
                .filter((c) => c.id !== 'all')
                .map((cat) => {
                  const count = articles.filter((a) => a.category === cat.id).length;
                  const pct = articles.length > 0 ? (count / articles.length) * 100 : 0;
                  return (
                    <div key={cat.id} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">{cat.name}</span>
                        <span className="font-mono">{count}</span>
                      </div>
                      <div className="w-full h-1.5 bg-lattice-elevated rounded-full overflow-hidden">
                        <div
                          className="h-full bg-neon-blue/60 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {/* Real-time Data Panel */}
        <RealtimeDataPanel
          domain="news"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={insights}
          compact
        />
        <UniversalActions domain="news" artifactId={null} compact />

        {/* Backend Action Panel */}
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Newspaper className="w-4 h-4 text-neon-cyan" />
            News Analysis
          </h2>
          <div className="flex flex-wrap gap-2">
            {[
              { action: 'biasDetection', label: 'Bias Detection' },
              { action: 'eventExtraction', label: 'Event Extraction' },
              { action: 'narrativeTracking', label: 'Narrative Tracking' },
            ].map(({ action, label }) => (
              <button
                key={action}
                onClick={() => handleAction(action)}
                disabled={!!isRunning}
                className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50"
              >
                {isRunning === action ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
                {label}
              </button>
            ))}
          </div>
          {actionResult && (
            <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
              {'overallBiasScore' in actionResult && (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400 text-xs">
                      Bias Score:{' '}
                      <span className="text-neon-cyan font-bold">
                        {String(actionResult.overallBiasScore)}
                      </span>
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        actionResult.biasLevel === 'high'
                          ? 'bg-red-400/20 text-red-400'
                          : actionResult.biasLevel === 'moderate'
                            ? 'bg-yellow-400/20 text-yellow-400'
                            : 'bg-neon-green/20 text-neon-green'
                      }`}
                    >
                      {String(actionResult.biasLevel)}
                    </span>
                  </div>
                  {'sourceBiasProfiles' in actionResult &&
                    Array.isArray(actionResult.sourceBiasProfiles) &&
                    actionResult.sourceBiasProfiles.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-500 uppercase tracking-wider">Sources</p>
                        {(actionResult.sourceBiasProfiles as Array<Record<string, unknown>>)
                          .slice(0, 4)
                          .map((s, i) => (
                            <div
                              key={i}
                              className="flex justify-between text-xs bg-lattice-surface rounded px-2 py-1"
                            >
                              <span className="text-gray-300">{String(s.source)}</span>
                              <span className="text-yellow-400">{String(s.avgBiasScore ?? 0)}</span>
                            </div>
                          ))}
                      </div>
                    )}
                </div>
              )}
              {'eventsExtracted' in actionResult && (
                <div className="space-y-2">
                  <span className="text-gray-400 text-xs">
                    Events:{' '}
                    <span className="text-neon-cyan font-bold">
                      {String(actionResult.eventsExtracted)}
                    </span>
                  </span>
                  {'topEntities' in actionResult &&
                    Array.isArray(actionResult.topEntities) &&
                    actionResult.topEntities.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(actionResult.topEntities as Array<Record<string, unknown>>)
                          .slice(0, 5)
                          .map((e, i) => (
                            <span
                              key={i}
                              className="text-xs bg-neon-cyan/10 border border-neon-cyan/20 rounded px-2 py-0.5 text-neon-cyan"
                            >
                              {String(e.entity || e.name)}
                            </span>
                          ))}
                      </div>
                    )}
                </div>
              )}
              {'narrativeStability' in actionResult && (
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400 text-xs">
                      Stability:{' '}
                      <span className="text-neon-cyan font-bold">
                        {String(actionResult.narrativeStability)}
                      </span>
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        actionResult.stabilityLevel === 'stable'
                          ? 'bg-neon-green/20 text-neon-green'
                          : 'bg-yellow-400/20 text-yellow-400'
                      }`}
                    >
                      {String(actionResult.stabilityLevel)}
                    </span>
                  </div>
                  {'shiftCount' in actionResult && (
                    <p className="text-xs text-gray-400">
                      Narrative shifts:{' '}
                      <span className="text-yellow-400">{String(actionResult.shiftCount)}</span>
                    </p>
                  )}
                </div>
              )}
              {'message' in actionResult && (
                <p className="text-gray-400">{String(actionResult.message)}</p>
              )}
            </div>
          )}

          {/* Live Web Feed */}
          <div className="px-4 mb-2">
            <LensFeedPanel lensId="news" />
          </div>
        </div>
      </div>
    </div>
  );
}
