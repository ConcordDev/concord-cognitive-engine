'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link2, ChevronRight, Brain, Search, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';
import { showToast } from '@/components/common/Toasts';

interface Backlink {
  id: string;
  title: string;
  excerpt: string;
  tier: 'regular' | 'mega' | 'hyper' | 'shadow';
  createdAt: string;
  context?: string; // The text surrounding the link
}

interface BacklinksPanelProps {
  dtuId: string;
  className?: string;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function BacklinksPanel({ dtuId, className, collapsed = false, onToggle }: BacklinksPanelProps) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [forwardLinks, setForwardLinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'backlinks' | 'forward'>('backlinks');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const loadLinks = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch backlinks (DTUs that link to this one)
      const backlinkRes = await api.get(`/api/graph/neighbors/${dtuId}`, { params: { direction: 'incoming' } });
      setBacklinks(backlinkRes.data?.neighbors || []);

      // Fetch forward links (DTUs this one links to)
      const forwardRes = await api.get(`/api/graph/neighbors/${dtuId}`, { params: { direction: 'outgoing' } });
      setForwardLinks(forwardRes.data?.neighbors || []);
    } catch (error) {
      console.error('Failed to load links:', error);
    } finally {
      setLoading(false);
    }
  }, [dtuId]);

  useEffect(() => {
    if (!dtuId) return;
    loadLinks();
  }, [dtuId, loadLinks]);

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const links = activeTab === 'backlinks' ? backlinks : forwardLinks;
  const filteredLinks = searchQuery
    ? links.filter(l =>
        l.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.excerpt?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : links;

  const tierColors = {
    regular: 'bg-gray-500',
    mega: 'bg-neon-cyan',
    hyper: 'bg-neon-purple',
    shadow: 'bg-gray-700'
  };

  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        className={cn(
          'flex items-center justify-center w-10 h-full bg-lattice-surface border-l border-lattice-border hover:bg-lattice-border transition-colors',
          className
        )}
        title="Show backlinks"
      >
        <Link2 className="w-4 h-4 text-gray-400" />
        {(backlinks.length + forwardLinks.length) > 0 && (
          <span className="absolute top-2 right-2 w-4 h-4 bg-neon-cyan text-[10px] text-black font-bold rounded-full flex items-center justify-center">
            {backlinks.length + forwardLinks.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 280, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      className={cn(
        'flex flex-col bg-lattice-surface border-l border-lattice-border h-full',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-lattice-border">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-neon-cyan" />
          <span className="text-sm font-medium text-white">Links</span>
        </div>
        <button
          onClick={onToggle}
          className="p-1 text-gray-400 hover:text-white transition-colors"
        aria-label="Next">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-lattice-border">
        <button
          onClick={() => setActiveTab('backlinks')}
          className={cn(
            'flex-1 px-3 py-2 text-sm font-medium transition-colors relative',
            activeTab === 'backlinks'
              ? 'text-neon-cyan'
              : 'text-gray-400 hover:text-white'
          )}
        >
          Backlinks
          <span className="ml-1 text-xs opacity-60">({backlinks.length})</span>
          {activeTab === 'backlinks' && (
            <motion.div
              layoutId="tab-indicator"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-neon-cyan"
            />
          )}
        </button>
        <button
          onClick={() => setActiveTab('forward')}
          className={cn(
            'flex-1 px-3 py-2 text-sm font-medium transition-colors relative',
            activeTab === 'forward'
              ? 'text-neon-cyan'
              : 'text-gray-400 hover:text-white'
          )}
        >
          Links to
          <span className="ml-1 text-xs opacity-60">({forwardLinks.length})</span>
          {activeTab === 'forward' && (
            <motion.div
              layoutId="tab-indicator"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-neon-cyan"
            />
          )}
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-lattice-border">
        <div className="flex items-center gap-2 px-2 py-1.5 bg-lattice-bg rounded border border-lattice-border">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter links..."
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Links list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-lattice-border rounded w-3/4 mb-2" />
                <div className="h-3 bg-lattice-border rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : filteredLinks.length === 0 ? (
          <div className="p-6 text-center">
            <Link2 className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-400">
              {searchQuery
                ? 'No matching links found'
                : activeTab === 'backlinks'
                  ? 'No other DTUs link to this one yet'
                  : 'This DTU doesn\'t link to others yet'
              }
            </p>
          </div>
        ) : (
          <div className="divide-y divide-lattice-border">
            {filteredLinks.map((link) => (
              <BacklinkItem
                key={link.id}
                link={link}
                expanded={expandedIds.has(link.id)}
                onToggle={() => toggleExpanded(link.id)}
                tierColor={tierColors[link.tier]}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer with stats */}
      <div className="px-3 py-2 border-t border-lattice-border bg-lattice-bg/50">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{backlinks.length} incoming</span>
          <span>{forwardLinks.length} outgoing</span>
        </div>
      </div>
    </motion.div>
  );
}

interface BacklinkItemProps {
  link: Backlink;
  expanded: boolean;
  onToggle: () => void;
  tierColor: string;
}

const BacklinkItem = React.memo(function BacklinkItem({ link, expanded, onToggle, tierColor }: BacklinkItemProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="group"
    >
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-start gap-2 hover:bg-lattice-border/50 transition-colors text-left"
      >
        <motion.div
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronRight className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
        </motion.div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className={cn('w-2 h-2 rounded-full', tierColor)} />
            <span className="text-sm text-white font-medium truncate">
              {link.title || 'Untitled'}
            </span>
          </div>
          <p className="text-xs text-gray-400 truncate mt-0.5">
            {link.excerpt || 'No preview available'}
          </p>
        </div>
        <a
          href={`/lenses/thread?id=${link.id}`}
          onClick={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-neon-cyan transition-all"
          title="Open DTU"
        >
          <ArrowUpRight className="w-3.5 h-3.5" />
        </a>
      </button>

      <AnimatePresence>
        {expanded && link.context && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pl-8">
              <div className="p-2 bg-lattice-bg rounded border border-lattice-border text-xs text-gray-400">
                <p className="line-clamp-3">{link.context}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

// Unlinked mentions component - shows potential links
interface UnlinkedMention {
  id: string;
  title: string;
  matchText: string;
  confidence: number;
}

interface UnlinkedMentionsProps {
  dtuId: string;
  className?: string;
}

export function UnlinkedMentions({ dtuId, className }: UnlinkedMentionsProps) {
  const [mentions, setMentions] = useState<UnlinkedMention[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/dtus/${dtuId}/unlinked-mentions`)
      .then(r => { if (!cancelled) setMentions(r.data?.mentions || []); })
      .catch((e) => { console.error('[BacklinksPanel] Failed to fetch unlinked mentions:', e); showToast('error', 'Failed to load mentions'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dtuId]);

  if (loading || mentions.length === 0) return null;

  return (
    <div className={cn('bg-lattice-surface border border-lattice-border rounded-lg p-3', className)}>
      <div className="flex items-center gap-2 mb-3">
        <Brain className="w-4 h-4 text-neon-purple" />
        <span className="text-sm font-medium text-white">Potential Links</span>
        <span className="text-xs text-gray-400">AI-suggested</span>
      </div>
      <div className="space-y-2">
        {mentions.map((mention) => (
          <div
            key={mention.id}
            className="flex items-center justify-between p-2 bg-lattice-bg rounded hover:bg-lattice-border/50 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{mention.title}</p>
              <p className="text-xs text-gray-400">
                Mentions: "{mention.matchText}"
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">
                {Math.round(mention.confidence * 100)}%
              </span>
              <button
                onClick={() => { window.dispatchEvent(new CustomEvent('backlinks:create-link', { detail: { mention } })); }}
                className="px-2 py-1 text-xs bg-neon-cyan/20 text-neon-cyan rounded hover:bg-neon-cyan/30 transition-colors"
              >
                Link
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
