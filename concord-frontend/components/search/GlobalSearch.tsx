'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  X,
  FileText,
  Tag,
  Users,
  Calendar,
  Brain,
  Clock,
  ArrowRight,
  Filter,
  Sparkles
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface SearchResult {
  id: string;
  type: 'dtu' | 'tag' | 'person' | 'date';
  title: string;
  excerpt?: string;
  tier?: string;
  tags?: string[];
  createdAt?: string;
  score?: number;
}

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect?: (result: SearchResult) => void;
}

type SearchScope = 'all' | 'dtus' | 'tags' | 'dates';

export function GlobalSearch({ isOpen, onClose, onSelect }: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scope, setScope] = useState<SearchScope>('all');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filterTier, setFilterTier] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterSort, setFilterSort] = useState('relevance');

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Load recent searches from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('concord-recent-searches');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setRecentSearches(parsed.slice(0, 5));
        } else {
          localStorage.removeItem('concord-recent-searches');
        }
      } catch {
        localStorage.removeItem('concord-recent-searches');
      }
    }
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    if (!isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Search logic
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const searchTimeout = setTimeout(async () => {
      setLoading(true);
      try {
        const params: Record<string, string | number> = { q: query, scope, limit: 20 };
        if (filterTier) params.tier = filterTier;
        if (filterDate) params.dateRange = filterDate;
        if (filterSort && filterSort !== 'relevance') params.sort = filterSort;
        const res = await api.get('/api/global/search', { params });
        const data = res.data;
        if (data.ok && Array.isArray(data.results)) {
          setResults(data.results);
        } else {
          setResults([]);
        }
      } catch (error) {
        console.error('Search failed:', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(searchTimeout);
  }, [query, scope, filterTier, filterDate, filterSort]);

  const handleSelect = useCallback((result: SearchResult) => {
    // Save to recent searches
    const updated = [query, ...recentSearches.filter(s => s !== query)].slice(0, 5);
    setRecentSearches(updated);
    localStorage.setItem('concord-recent-searches', JSON.stringify(updated));

    onSelect?.(result);
    onClose();
  }, [query, recentSearches, onSelect, onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault();
        handleSelect(results[selectedIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        // Cycle through scopes
        const scopes: SearchScope[] = ['all', 'dtus', 'tags', 'dates'];
        const currentIndex = scopes.indexOf(scope);
        setScope(scopes[(currentIndex + 1) % scopes.length]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, selectedIndex, scope, onClose, handleSelect]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const selectedEl = resultsRef.current.children[selectedIndex];
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const getResultIcon = (type: string) => {
    switch (type) {
      case 'dtu': return Brain;
      case 'tag': return Tag;
      case 'person': return Users;
      case 'date': return Calendar;
      default: return FileText;
    }
  };

  const scopeLabels: Record<SearchScope, string> = {
    all: 'All',
    dtus: 'DTUs',
    tags: 'Tags',
    dates: 'Dates'
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Search Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="fixed top-[10%] left-1/2 -translate-x-1/2 w-full max-w-2xl z-50"
          >
            <div className="bg-lattice-bg border border-lattice-border rounded-xl shadow-2xl overflow-hidden">
              {/* Search Input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-lattice-border">
                <Search className="w-5 h-5 text-gray-400" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search DTUs, tags, people..."
                  className="flex-1 bg-transparent text-white text-lg placeholder-gray-500 focus:outline-none"
                />
                {loading && (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                  >
                    <Sparkles className="w-5 h-5 text-neon-cyan" />
                  </motion.div>
                )}
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    className="p-1 text-gray-400 hover:text-white"
                  aria-label="Close">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Scope Tabs */}
              <div className="flex items-center gap-1 px-3 py-2 border-b border-lattice-border bg-lattice-surface/30">
                {(Object.keys(scopeLabels) as SearchScope[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setScope(s)}
                    className={cn(
                      'px-3 py-1 text-sm rounded transition-colors',
                      scope === s
                        ? 'bg-neon-cyan/20 text-neon-cyan'
                        : 'text-gray-400 hover:text-white'
                    )}
                  >
                    {scopeLabels[s]}
                  </button>
                ))}
                <div className="flex-1" />
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={cn(
                    'p-1.5 rounded transition-colors',
                    showFilters
                      ? 'bg-lattice-surface text-white'
                      : 'text-gray-400 hover:text-white'
                  )}
                aria-label="Filter">
                  <Filter className="w-4 h-4" />
                </button>
              </div>

              {/* Advanced Filters */}
              <AnimatePresence>
                {showFilters && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-b border-lattice-border"
                  >
                    <div className="p-4 grid grid-cols-3 gap-4">
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Tier</label>
                        <select value={filterTier} onChange={(e) => setFilterTier(e.target.value)} className="w-full bg-lattice-surface border border-lattice-border rounded px-2 py-1.5 text-sm text-white">
                          <option value="">All tiers</option>
                          <option value="regular">Regular</option>
                          <option value="mega">Mega</option>
                          <option value="hyper">Hyper</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Date range</label>
                        <select value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="w-full bg-lattice-surface border border-lattice-border rounded px-2 py-1.5 text-sm text-white">
                          <option value="">Any time</option>
                          <option value="today">Today</option>
                          <option value="week">This week</option>
                          <option value="month">This month</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Sort by</label>
                        <select value={filterSort} onChange={(e) => setFilterSort(e.target.value)} className="w-full bg-lattice-surface border border-lattice-border rounded px-2 py-1.5 text-sm text-white">
                          <option value="relevance">Relevance</option>
                          <option value="recent">Most recent</option>
                          <option value="resonance">Resonance</option>
                        </select>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Results */}
              <div ref={resultsRef} className="max-h-[400px] overflow-y-auto">
                {!query && recentSearches.length > 0 && (
                  <div className="p-3">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                      <Clock className="w-3.5 h-3.5" />
                      Recent searches
                    </div>
                    {recentSearches.map((search, i) => (
                      <button
                        key={i}
                        onClick={() => setQuery(search)}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left text-gray-400 hover:text-white hover:bg-lattice-surface rounded transition-colors"
                      >
                        <Search className="w-4 h-4" />
                        {search}
                      </button>
                    ))}
                  </div>
                )}

                {query && results.length === 0 && !loading && (
                  <div className="p-8 text-center">
                    <Search className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400">No results found for "{query}"</p>
                    <p className="text-sm text-gray-500 mt-1">Try different keywords or filters</p>
                  </div>
                )}

                {results.map((result, index) => {
                  const Icon = getResultIcon(result.type);
                  const isSelected = index === selectedIndex;

                  return (
                    <motion.button
                      key={result.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      onClick={() => handleSelect(result)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={cn(
                        'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors',
                        isSelected ? 'bg-neon-cyan/10' : 'hover:bg-lattice-surface'
                      )}
                    >
                      <div className={cn(
                        'p-2 rounded-lg mt-0.5',
                        isSelected ? 'bg-neon-cyan/20' : 'bg-lattice-surface'
                      )}>
                        <Icon className={cn(
                          'w-4 h-4',
                          isSelected ? 'text-neon-cyan' : 'text-gray-400'
                        )} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            'font-medium truncate',
                            isSelected ? 'text-white' : 'text-gray-200'
                          )}>
                            {result.title}
                          </span>
                          {result.tier && (
                            <span className={cn(
                              'text-xs px-1.5 py-0.5 rounded',
                              result.tier === 'mega' ? 'bg-neon-cyan/20 text-neon-cyan' :
                              result.tier === 'hyper' ? 'bg-neon-purple/20 text-neon-purple' :
                              'bg-gray-500/20 text-gray-400'
                            )}>
                              {result.tier}
                            </span>
                          )}
                        </div>
                        {result.excerpt && (
                          <p className="text-sm text-gray-500 truncate mt-0.5">
                            {result.excerpt}
                          </p>
                        )}
                        {result.tags && result.tags.length > 0 && (
                          <div className="flex items-center gap-1 mt-1">
                            {result.tags.map(tag => (
                              <span key={tag} className="text-xs text-gray-500">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {isSelected && (
                        <ArrowRight className="w-4 h-4 text-neon-cyan mt-1" />
                      )}
                    </motion.button>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-2 border-t border-lattice-border bg-lattice-surface/30 text-xs text-gray-500">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 bg-lattice-surface border border-lattice-border rounded">↑↓</kbd>
                    navigate
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 bg-lattice-surface border border-lattice-border rounded">↵</kbd>
                    select
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 bg-lattice-surface border border-lattice-border rounded">tab</kbd>
                    scope
                  </span>
                </div>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-lattice-surface border border-lattice-border rounded">esc</kbd>
                  close
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Hook for global search
export function useGlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handler = () => setIsOpen(true);
    document.addEventListener('toggle-global-search', handler);
    return () => document.removeEventListener('toggle-global-search', handler);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false)
  };
}
