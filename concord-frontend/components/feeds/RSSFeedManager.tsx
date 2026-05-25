'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Rss,
  Plus,
  Trash2,
  RefreshCw,
  ExternalLink,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  FileText
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface FeedItem {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  content?: string;
  imported: boolean;
}

interface Feed {
  id: string;
  url: string;
  title: string;
  lastFetched?: string;
  itemCount: number;
  status: 'active' | 'error' | 'fetching';
  items: FeedItem[];
}

interface RSSFeedManagerProps {
  feeds: Feed[];
  onAddFeed?: (url: string) => void;
  onRemoveFeed?: (feedId: string) => void;
  onRefreshFeed?: (feedId: string) => void;
  onRefreshAll?: () => void;
  onImportItem?: (feedId: string, itemId: string) => void;
  className?: string;
}

export function RSSFeedManager({
  feeds,
  onAddFeed,
  onRemoveFeed,
  onRefreshFeed,
  onRefreshAll,
  onImportItem,
  className
}: RSSFeedManagerProps) {
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [expandedFeeds, setExpandedFeeds] = useState<Set<string>>(new Set());
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAddFeed = () => {
    if (newFeedUrl.trim() && onAddFeed) {
      onAddFeed(newFeedUrl.trim());
      setNewFeedUrl('');
      setShowAddForm(false);
    }
  };

  const toggleFeed = (feedId: string) => {
    setExpandedFeeds(prev => {
      const next = new Set(prev);
      if (next.has(feedId)) {
        next.delete(feedId);
      } else {
        next.add(feedId);
      }
      return next;
    });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  const getStatusIcon = (status: Feed['status']) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-400" />;
      case 'fetching':
        return <Loader2 className="w-4 h-4 text-neon-cyan animate-spin" />;
    }
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-lattice-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rss className="w-5 h-5 text-orange-400" />
          <span className="font-medium text-white">RSS Feeds</span>
          <span className="text-xs text-gray-400">({feeds.length})</span>
        </div>
        <div className="flex items-center gap-2">
          {onRefreshAll && (
            <button
              onClick={onRefreshAll}
              className="p-1.5 text-gray-400 hover:text-white transition-colors"
              title="Refresh all"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="p-1.5 text-gray-400 hover:text-white transition-colors"
            title="Add feed"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Add feed form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-lattice-border overflow-hidden"
          >
            <div className="p-4">
              <input
                type="url"
                value={newFeedUrl}
                onChange={(e) => setNewFeedUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddFeed();
                  if (e.key === 'Escape') {
                    setShowAddForm(false);
                    setNewFeedUrl('');
                  }
                }}
                placeholder="Enter RSS feed URL..."
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan"
                autoFocus
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleAddFeed}
                  disabled={!newFeedUrl.trim()}
                  className="flex-1 py-2 bg-neon-cyan text-black text-sm font-medium rounded-lg hover:bg-neon-cyan/90 transition-colors disabled:opacity-50"
                >
                  Add Feed
                </button>
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setNewFeedUrl('');
                  }}
                  className="flex-1 py-2 bg-lattice-surface border border-lattice-border text-gray-400 text-sm rounded-lg hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feeds list */}
      <div className="flex-1 overflow-y-auto">
        {feeds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Rss className="w-12 h-12 text-gray-600 mb-4" />
            <p className="text-gray-400 mb-2">No feeds yet</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="text-sm text-neon-cyan hover:underline"
            >
              Add your first feed
            </button>
          </div>
        ) : (
          feeds.map(feed => {
            const isExpanded = expandedFeeds.has(feed.id);

            return (
              <div key={feed.id} className="border-b border-lattice-border">
                {/* Feed header */}
                <button
                  onClick={() => toggleFeed(feed.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-lattice-surface/50 transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  )}

                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">
                        {feed.title}
                      </span>
                      {getStatusIcon(feed.status)}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                      <span>{feed.itemCount} items</span>
                      {feed.lastFetched && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTime(feed.lastFetched)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {onRefreshFeed && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRefreshFeed(feed.id);
                        }}
                        className="p-1.5 text-gray-400 hover:text-white transition-colors"
                        title="Refresh"
                      >
                        <RefreshCw className={cn(
                          'w-3 h-3',
                          feed.status === 'fetching' && 'animate-spin'
                        )} />
                      </button>
                    )}
                    {onRemoveFeed && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveFeed(feed.id);
                        }}
                        className="p-1.5 text-gray-400 hover:text-red-400 transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </button>

                {/* Feed items */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-3 space-y-2">
                        {feed.items.length === 0 ? (
                          <p className="text-sm text-gray-400 py-2 pl-7">
                            No items in this feed
                          </p>
                        ) : (
                          feed.items.slice(0, 10).map(item => (
                            <div
                              key={item.id}
                              className="ml-7 p-2 bg-lattice-surface/50 rounded-lg group"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <a
                                    href={item.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-white hover:text-neon-cyan transition-colors flex items-center gap-1"
                                  >
                                    {item.title}
                                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                                  </a>
                                  <span className="text-xs text-gray-400">
                                    {formatTime(item.pubDate)}
                                  </span>
                                </div>

                                {onImportItem && !item.imported && (
                                  <button
                                    onClick={() => onImportItem(feed.id, item.id)}
                                    className="px-2 py-1 text-xs bg-neon-cyan/10 text-neon-cyan rounded hover:bg-neon-cyan/20 transition-colors flex items-center gap-1"
                                  >
                                    <FileText className="w-3 h-3" />
                                    Import
                                  </button>
                                )}
                                {item.imported && (
                                  <span className="px-2 py-1 text-xs text-green-400 flex items-center gap-1">
                                    <CheckCircle className="w-3 h-3" />
                                    Imported
                                  </span>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                        {feed.items.length > 10 && (
                          <p className="text-xs text-gray-400 pl-7">
                            +{feed.items.length - 10} more items
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
